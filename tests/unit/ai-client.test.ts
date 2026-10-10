import { afterEach, describe, expect, it, vi } from 'vitest';

import { analyzeMaterial, readAiStatus, testAiConnection } from '@/lib/ai/client';
import { defaultSettings } from '@/lib/domain/settings';

/**
 * 这些用例盯着同一件事：纯静态构建（APK / 无 Node 服务端的托管）里 /api/ai/* 不存在，
 * 但 Capacitor 的本地服务器默认把无扩展名路径兜底成应用自己的 index.html 并返回 200。
 * 此时 response.ok 为真、JSON 解析才失败，界面绝不能把 "Unexpected token '<'" 丢给用户看。
 */

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(): Response {
  return new Response('<!DOCTYPE html><html><head><title>LogicDaily</title></head><body></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readAiStatus 在缺少服务端时的降级', () => {
  it('200 + HTML（Capacitor SPA 兜底）时给出设计好的说明，而不是 JSON 解析错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse()),
    );
    const status = await readAiStatus();
    expect(status.configured).toBe(false);
    expect(status.unreachable).toBe(true);
    expect(status.message).toContain('没有服务端');
    expect(status.message).not.toMatch(/Unexpected token|is not valid JSON/);
  });

  it('200 + 非 JSON 的坏正文也不会漏出解析器文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json at all', { status: 200, headers: { 'content-type': 'text/plain' } })),
    );
    const status = await readAiStatus();
    expect(status.unreachable).toBe(true);
    expect(status.message).not.toMatch(/JSON/);
  });

  it('非 2xx 时报告状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );
    const status = await readAiStatus();
    expect(status.unreachable).toBe(true);
    expect(status.message).toContain('503');
  });

  it('网络异常时仍然降级为不可达而不是抛出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const status = await readAiStatus();
    expect(status.unreachable).toBe(true);
    expect(status.message).toContain('Failed to fetch');
  });

  it('正常 JSON 响应按 configured 报告', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: true, configured: true, defaultModel: 'm-1' })),
    );
    const status = await readAiStatus();
    expect(status).toMatchObject({ configured: true, defaultModel: 'm-1' });
    expect(status.unreachable).toBeFalsy();
  });
});

describe('AI 调用在缺少服务端时的降级', () => {
  const settings = defaultSettings('p-test');

  it('analyze 拿到 HTML 时返回 no_server 说明，而不是「模型返回格式不符合预期」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse()),
    );
    const result = await analyzeMaterial(settings, '一段材料');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('no_server');
    expect(result.message).toContain('没有服务端');
    expect(result.message).not.toMatch(/Unexpected token|结构要求/);
  });

  it('404 也识别为没有服务端', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const result = await analyzeMaterial(settings, '一段材料');
    expect(result.code).toBe('no_server');
  });

  it('服务端返回结构化的失败时按原样透传', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: false, code: 'rate_limited', message: '稍后再试' }, { status: 429 })),
    );
    const result = await analyzeMaterial(settings, '一段材料');
    expect(result).toMatchObject({ ok: false, code: 'rate_limited', message: '稍后再试' });
  });

  it('连通性自检同样不会漏出解析器文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse()),
    );
    const result = await testAiConnection();
    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/Unexpected token|is not valid JSON/);
  });
});
