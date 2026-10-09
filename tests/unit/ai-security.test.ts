import { describe, expect, it, beforeEach } from 'vitest';

import { checkRate, rateSnapshot, resetRateState } from '@/lib/ai/ratelimit';
import { isPrivateAddress, isUrlAllowlisted, joinChatCompletions, resolveSafeTarget, UnsafeUrlError } from '@/lib/ai/ssrf';

describe('私有与保留地址判定', () => {
  it('拒绝回环、私有网段、链路本地与云元数据地址', () => {
    for (const address of [
      '127.0.0.1',
      '127.5.5.5',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254', // 云厂商元数据服务
      '100.64.0.1', // 运营商级 NAT
      '0.0.0.0',
      '224.0.0.5', // 组播
      '240.0.0.1', // 保留
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::',
      '::ffff:127.0.0.1', // IPv4 映射地址
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('允许公网地址', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '192.0.1.1', '2001:4860:4860::8888']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('无法识别的写法按不安全处理（fail closed）', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('999.1.1.1')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});

describe('允许列表', () => {
  const allowlist = ['https://api.openai.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1'];

  it('协议与主机必须完全一致', () => {
    expect(isUrlAllowlisted('https://api.openai.com/v1/chat/completions', allowlist)).toBe(true);
    expect(isUrlAllowlisted('http://api.openai.com/v1', allowlist)).toBe(false);
    expect(isUrlAllowlisted('https://api.openai.com.evil.example/v1', allowlist)).toBe(false);
    expect(isUrlAllowlisted('https://evil.example/?u=https://api.openai.com', allowlist)).toBe(false);
  });

  it('允许前缀目录下的更深路径，但不允许跳出前缀', () => {
    const base = 'https://example.com/v1';
    expect(isUrlAllowlisted('https://example.com/v1/chat/completions', [base])).toBe(true);
    expect(isUrlAllowlisted('https://example.com/v1', [base])).toBe(true);
    expect(isUrlAllowlisted('https://example.com/v1beta/chat', [base])).toBe(false);
    expect(isUrlAllowlisted('https://example.com/', [base])).toBe(false);
  });

  it('允许列表条目可以省略协议（按 https 理解）', () => {
    expect(isUrlAllowlisted('https://api.openai.com/v1', ['api.openai.com'])).toBe(true);
  });

  it('非法 URL 直接判为不允许', () => {
    expect(isUrlAllowlisted('不是地址', allowlist)).toBe(false);
    expect(isUrlAllowlisted('', allowlist)).toBe(false);
  });
});

describe('出站请求前的强制检查', () => {
  const allowlist = ['https://api.example.com', 'https://public.test'];

  it('只接受 https（未显式放行时）', async () => {
    await expect(resolveSafeTarget('http://api.example.com/v1', allowlist)).rejects.toThrow(UnsafeUrlError);
    await expect(resolveSafeTarget('ftp://api.example.com', allowlist)).rejects.toThrow('只允许 http/https。');
  });

  it('拒绝地址中携带凭据', async () => {
    await expect(resolveSafeTarget('https://user:pass@api.example.com/v1', allowlist)).rejects.toThrow('凭据');
  });

  it('拒绝显式端口，避免服务端变成内网端口探测器', async () => {
    await expect(resolveSafeTarget('https://api.example.com:8443/v1', allowlist)).rejects.toThrow('显式端口');
  });

  it('拒绝允许列表之外的目标', async () => {
    await expect(resolveSafeTarget('https://other.example/v1', allowlist)).rejects.toThrow('允许列表');
  });

  it('字面量内网 IP 即使写进允许列表也被拒绝', async () => {
    await expect(resolveSafeTarget('https://127.0.0.1/v1', ['https://127.0.0.1'])).rejects.toThrow('内网或保留地址');
    await expect(resolveSafeTarget('https://169.254.169.254/latest/meta-data', ['https://169.254.169.254'])).rejects.toThrow(
      '内网或保留地址',
    );
  });

  it('本机测试模式才放行 127.0.0.1', async () => {
    const target = await resolveSafeTarget('http://127.0.0.1:11434/v1', ['http://127.0.0.1:11434'], { allowLoopback: true });
    expect(target.hostname).toBe('127.0.0.1');
    await expect(resolveSafeTarget('https://10.0.0.5/v1', ['https://10.0.0.5'], { allowLoopback: true })).rejects.toThrow(
      '内网或保留地址',
    );
  });

  it('公网字面量 IP 正常放行', async () => {
    const target = await resolveSafeTarget('https://8.8.8.8/v1', ['https://8.8.8.8']);
    expect(target.addresses).toEqual(['8.8.8.8']);
  });

  it('域名解析失败时拒绝，不放行未知目标', async () => {
    await expect(resolveSafeTarget('https://no-such-host.invalid/v1', ['https://no-such-host.invalid'])).rejects.toThrow(UnsafeUrlError);
  });

  it('无法解析的字符串被拒绝', async () => {
    await expect(resolveSafeTarget('api.example.com', allowlist)).rejects.toThrow('无法解析');
  });
});

describe('chat/completions 地址拼接', () => {
  it('容忍尾部斜杠，且不重复拼接', () => {
    expect(joinChatCompletions('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions');
    expect(joinChatCompletions('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions');
    expect(joinChatCompletions('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1/chat/completions');
    expect(joinChatCompletions('https://api.example.com/v1/chat/completions///')).toBe('https://api.example.com/v1/chat/completions');
  });
});

describe('限流与用量上限', () => {
  beforeEach(() => resetRateState());

  it('每分钟窗口内的请求数受限，并给出 retryAfter', () => {
    const key = 'user-a';
    const options = { key, perMinute: 3, dailyLimit: 100, dateKey: '2026-03-17' };
    expect(checkRate({ ...options, nowMs: 1_000 }).allowed).toBe(true);
    expect(checkRate({ ...options, nowMs: 2_000 }).allowed).toBe(true);
    expect(checkRate({ ...options, nowMs: 3_000 }).allowed).toBe(true);

    const blocked = checkRate({ ...options, nowMs: 4_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.usedToday).toBe(3);
  });

  it('窗口滑过后恢复额度', () => {
    const options = { key: 'user-b', perMinute: 1, dailyLimit: 100, dateKey: '2026-03-17' };
    expect(checkRate({ ...options, nowMs: 0 }).allowed).toBe(true);
    expect(checkRate({ ...options, nowMs: 30_000 }).allowed).toBe(false);
    expect(checkRate({ ...options, nowMs: 61_000 }).allowed).toBe(true);
  });

  it('每日上限独立于每分钟窗口，换日即重置', () => {
    const options = { key: 'user-c', perMinute: 100, dailyLimit: 2, dateKey: '2026-03-17' };
    expect(checkRate({ ...options, nowMs: 0 }).allowed).toBe(true);
    expect(checkRate({ ...options, nowMs: 1 }).allowed).toBe(true);
    const blocked = checkRate({ ...options, nowMs: 2 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(3600);
    expect(checkRate({ ...options, dateKey: '2026-03-18', nowMs: 3 }).allowed).toBe(true);
  });

  it('上限为 0 表示禁用，而不是无限', () => {
    const decision = checkRate({ key: 'user-d', perMinute: 5, dailyLimit: 0, dateKey: '2026-03-17' });
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(0);
  });

  it('不同 key 之间互不影响', () => {
    expect(checkRate({ key: 'k1', perMinute: 1, dailyLimit: 10, dateKey: '2026-03-17' }).allowed).toBe(true);
    expect(checkRate({ key: 'k1', perMinute: 1, dailyLimit: 10, dateKey: '2026-03-17' }).allowed).toBe(false);
    expect(checkRate({ key: 'k2', perMinute: 1, dailyLimit: 10, dateKey: '2026-03-17' }).allowed).toBe(true);
    expect(rateSnapshot().keys).toBe(2);
  });
});
