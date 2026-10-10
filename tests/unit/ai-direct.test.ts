import { afterEach, describe, expect, it, vi } from 'vitest';

import { testAiConnection } from '@/lib/ai/client';
import { assertDirectEndpoint, callDirectTask } from '@/lib/ai/direct';
import { clearAiKey, clearAllAiKeys, maskAiKey, readAiKey, writeAiKey } from '@/lib/ai/credentials';
import { AiError } from '@/lib/ai/provider-core';
import { aiRequestSchema } from '@/lib/ai/tasks';
import { defaultSettings } from '@/lib/domain/settings';

/**
 * 直连模式的安全边界与密钥存放。这个模式主动放宽了「密钥只在服务器」这一条，
 * 所以这里盯着放宽之后仍然必须成立的几件事：仍然是 https（本机除外）、URL 里不带凭据、
 * 不跟随重定向、缺件时不出站、密钥不出现在任何文案里，以及密钥只落在浏览器存储。
 */

const KEY = 'sk-abcdef1234567890-livedemo';

function pingRequest() {
  const parsed = aiRequestSchema.safeParse({ task: 'ping', payload: { note: 'logicdaily' } });
  if (!parsed.success) throw new Error('ping 请求本身不合法');
  return parsed.data;
}

function providerReply(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], model: 'mock' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

interface Outbound {
  url: string;
  init: RequestInit;
}

/** 自己记录出站请求：比从 vi.fn 的 mock.calls 里取参数更好读，也不依赖泛型写法。 */
function recorder(content: unknown) {
  const outbound: Outbound[] = [];
  const spy = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    outbound.push({ url, init });
    return providerReply(content);
  });
  return { outbound, spy };
}

function directSettings(profileId: string) {
  const base = defaultSettings(profileId);
  return {
    ...base,
    ai: { ...base.ai, enabled: true, mode: 'direct' as const, baseUrl: 'https://api.example.com/v1', model: 'mock-model' },
  };
}

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (name: string) => map.get(name) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (name: string) => {
      map.delete(name);
    },
    setItem: (name: string, value: string) => {
      map.set(name, String(value));
    },
  } as unknown as Storage;
}

function useLocalStorage(storage: Storage): void {
  vi.stubGlobal('window', { localStorage: storage });
}

function captureAiError(run: () => void): AiError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error('预期抛出 AiError，但调用成功了');
}

async function captureRejected(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error('预期抛出 AiError，但调用成功了');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('直连地址的形状检查', () => {
  it('接受 https，并且允许带端口与路径', () => {
    expect(assertDirectEndpoint('https://api.deepseek.com/v1').host).toBe('api.deepseek.com');
    expect(assertDirectEndpoint('https://example.test:8443/v1').port).toBe('8443');
  });

  it('http 只放行本机地址', () => {
    for (const url of ['http://127.0.0.1:11434/v1', 'http://localhost:11434/v1', 'http://[::1]:11434/v1']) {
      expect(assertDirectEndpoint(url).protocol, url).toBe('http:');
    }
  });

  it('拒绝把 http 用在非本机地址上（密钥不能明文过网）', () => {
    for (const url of ['http://api.example.com/v1', 'http://10.0.0.5:11434/v1', 'http://192.168.1.20/v1']) {
      const error = captureAiError(() => assertDirectEndpoint(url));
      expect(error.kind, url).toBe('unsafe_url');
      expect(error.message, url).toContain('https');
    }
  });

  it('拒绝地址里携带凭据，也拒绝其他协议与无法解析的写法', () => {
    for (const url of ['https://user:pass@api.example.com/v1', 'ftp://api.example.com/v1', 'file:///etc/passwd', 'not a url', '']) {
      expect(captureAiError(() => assertDirectEndpoint(url)).kind, url || '(空)').toBe('unsafe_url');
    }
  });
});

describe('直连调用', () => {
  const params = {
    baseUrl: 'https://api.example.com/v1',
    apiKey: KEY,
    model: 'mock-model',
    temperature: 0.4,
    maxOutputTokens: 900,
    timeoutMs: 25_000,
  };

  it('缺地址、缺密钥、缺模型名称都在出站之前拦住', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    for (const changes of [{ baseUrl: '' }, { apiKey: '' }, { model: '  ' }]) {
      const error = await captureRejected(callDirectTask(pingRequest(), { ...params, ...changes }));
      expect(error.kind).toBe('not_configured');
      expect(error.message).not.toContain(KEY);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('请求只发给用户填的地址，带 Bearer 凭据，并且不跟随重定向', async () => {
    const { outbound, spy } = recorder({ reply: 'pong', echo: 'logicdaily' });
    vi.stubGlobal('fetch', spy);

    const outcome = await callDirectTask(pingRequest(), { ...params, baseUrl: 'https://api.example.com/v1/' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(outbound[0]?.url).toBe('https://api.example.com/v1/chat/completions');
    const headers = outbound[0]?.init.headers as Record<string, string>;
    expect(headers?.authorization).toBe(`Bearer ${KEY}`);
    expect(outbound[0]?.init.redirect).toBe('error');
    expect(outbound[0]?.init.method).toBe('POST');
    expect(outcome.result).toMatchObject({ reply: 'pong' });
    // 对外只留主机与路径，不带查询串。
    expect(outcome.endpoint).toBe('https://api.example.com/v1/');
  });

  it('非回环的 http 地址在 fetch 之前就被拒绝', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const error = await captureRejected(callDirectTask(pingRequest(), { ...params, baseUrl: 'http://10.0.0.5:11434/v1' }));
    expect(error.kind).toBe('unsafe_url');
    expect(error.message).toContain('https');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('模型回复不合契约时丢弃而不是透传，文案里没有密钥', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => providerReply({ nope: 1 })),
    );
    const error = await captureRejected(callDirectTask(pingRequest(), params));
    expect(error.kind).toBe('bad_response');
    expect(error.message).toContain('结构不符合要求');
    expect(error.message).not.toContain(KEY);
  });

  it('本机直连时密钥从浏览器存储取出，且完全不碰本站 /api/ai', async () => {
    const storage = fakeStorage();
    useLocalStorage(storage);
    writeAiKey('p-direct', KEY);
    const { outbound, spy } = recorder({ reply: 'pong', echo: 'logicdaily' });
    vi.stubGlobal('fetch', spy);

    const result = await testAiConnection(directSettings('p-direct'));

    expect(result.ok).toBe(true);
    expect(result.reply).toBe('pong');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(outbound[0]?.url).toBe('https://api.example.com/v1/chat/completions');
    const headers = outbound[0]?.init.headers as Record<string, string>;
    expect(headers?.authorization).toBe(`Bearer ${KEY}`);
    expect(outbound.every((call) => !call.url.includes('/api/ai/'))).toBe(true);
  });

  it('存储里没有密钥时直接给出可执行的提示，不发请求', async () => {
    useLocalStorage(fakeStorage());
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await testAiConnection(directSettings('p-direct'));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('API Key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('网络失败时的提示里既没有密钥也没有请求正文', async () => {
    const storage = fakeStorage();
    useLocalStorage(storage);
    writeAiKey('p-direct', KEY);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const result = await testAiConnection(directSettings('p-direct'));
    expect(result.ok).toBe(false);
    expect(result.message ?? '').not.toContain(KEY);
    expect(result.message ?? '').not.toContain('logicdaily');
  });
});

describe('直连模式下的密钥存放', () => {
  it('读写按 profile 隔离，空值等于删除', () => {
    useLocalStorage(fakeStorage());

    expect(readAiKey('a')).toBe('');
    writeAiKey('a', KEY);
    writeAiKey('b', 'other-key-value');
    expect(readAiKey('a')).toBe(KEY);
    expect(readAiKey('b')).toBe('other-key-value');

    writeAiKey('a', '');
    expect(readAiKey('a')).toBe('');
    expect(readAiKey('b')).toBe('other-key-value');

    clearAiKey('b');
    expect(readAiKey('b')).toBe('');
  });

  it('清除本地数据时只带走密钥，不动其他浏览器存储', () => {
    const storage = fakeStorage();
    storage.setItem('logicdaily:theme', 'dark');
    useLocalStorage(storage);
    writeAiKey('a', KEY);
    writeAiKey('b', KEY);

    clearAllAiKeys();

    expect(readAiKey('a')).toBe('');
    expect(readAiKey('b')).toBe('');
    expect(storage.getItem('logicdaily:theme')).toBe('dark');
  });

  it('界面用的指纹只暴露首尾与长度', () => {
    expect(maskAiKey(KEY)).toBe(`sk…${KEY.slice(-2)}（${KEY.length} 位）`);
    expect(maskAiKey(KEY)).not.toContain(KEY);
    expect(maskAiKey('short')).toBe('已保存 5 位');
    expect(maskAiKey('')).toBe('');
  });

  it('设置记录里没有密钥字段，所以导出备份不可能带上它', () => {
    const settings = directSettings('p-direct');
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).toContain('"mode":"direct"');
  });
});
