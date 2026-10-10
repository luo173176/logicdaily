'use client';

import type { AppSettings } from '@/lib/domain/settings';

export interface AiStatus {
  configured: boolean;
  defaultModel?: string;
  allowedBaseUrlCount?: number;
  allowClientBaseUrl?: boolean;
  limits?: { maxInputChars: number; maxOutputTokens: number; timeoutMs: number; dailyCallLimit: number; rateLimitPerMinute: number };
  tasks?: string[];
  /** 状态接口不可达（静态托管、未部署服务端等情况）。 */
  unreachable?: boolean;
  message?: string;
}

export interface CoachResponse<T = unknown> {
  ok: boolean;
  task?: string;
  result?: T;
  meta?: {
    model: string;
    promptVersion: string;
    latencyMs: number;
    inputChars: number;
    outputChars: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    usedToday: number;
    remainingToday: number;
  };
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
}

const ERROR_COPY: Record<string, string> = {
  not_configured: '服务端还没有配置模型凭据，基础训练功能照常可用。',
  invalid_request: '这次请求的内容不符合格式要求。',
  unsafe_url: '指定的模型服务地址不被服务端允许。',
  auth: '模型服务拒绝了当前凭据，请检查服务端 AI_API_KEY。',
  timeout: '模型响应超时，可以稍后重试或缩短提交内容。',
  rate_limited: '调用过于频繁或已达当日次数上限。',
  budget_exceeded: '内容过长或超出成本限制，请缩短后重试。',
  unavailable: '模型服务暂时不可用。',
  bad_response: '模型返回的结果不符合结构要求，已丢弃，请重试。',
  network: '无法连接模型服务。',
  forbidden: '请求来源不被接受。',
  no_server: '这个构建里没有服务端，AI 教练不可用；训练本身不受影响。',
};

export function describeAiError(code: string | undefined, fallback?: string): string {
  if (!code) return fallback ?? 'AI 调用失败。';
  return ERROR_COPY[code] ?? `${fallback ?? 'AI 调用失败'}（${code}）`;
}

/** 纯静态构建（APK 或没有 Node 服务端的托管）里 /api/ai/* 不存在。 */
export const NO_SERVER_MESSAGE =
  '这个构建里没有服务端，所以 AI 教练不可用：模型调用必须经过本站 /api/ai/*，而纯静态包（含 APK）不含 Node 运行时。判分、解析、错因归类与复习调度都在本机，不受影响。想用 AI 请把本项目部署成网页版。';

/** 用来把「接口返回的不是 JSON」这一情况与真正的解析错误区分开，避免把 SyntaxError 文案丢给用户。 */
class NoAiServerError extends Error {}

/**
 * 静态包里对 /api/ai/status 的请求未必是 404：Capacitor 的本地服务器默认开着 html5mode，
 * 任何无扩展名的路径都会被兜底成应用自己的 index.html 并返回 200，于是 response.ok 为真、
 * JSON 解析才失败。这里按内容判定并给出设计好的文案，而不是抛出 "Unexpected token '<'"。
 */
async function readAiJson(response: Response): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json') && /^\s*</.test(text)) throw new NoAiServerError();
  try {
    return JSON.parse(text);
  } catch {
    throw new NoAiServerError();
  }
}

function unreachableMessage(error: unknown): string {
  if (error instanceof NoAiServerError) return NO_SERVER_MESSAGE;
  return error instanceof Error ? error.message : '无法访问服务端 AI 状态接口。';
}

export async function readAiStatus(): Promise<AiStatus> {
  try {
    const response = await fetch('/api/ai/status', { cache: 'no-store' });
    if (!response.ok) return { configured: false, unreachable: true, message: `状态接口返回 ${response.status}。` };
    const json = (await readAiJson(response)) as AiStatus;
    return { ...json, configured: Boolean(json.configured) };
  } catch (error) {
    return { configured: false, unreachable: true, message: unreachableMessage(error) };
  }
}

async function callTask<T>(task: string, payload: unknown, settings: AppSettings, signal?: AbortSignal): Promise<CoachResponse<T>> {
  try {
    const response = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      signal,
      body: JSON.stringify({
        task,
        payload,
        model: settings.ai.model || undefined,
        temperature: settings.ai.temperature,
        maxOutputTokens: settings.ai.maxOutputTokens,
      }),
    });
    if (!response.ok && response.status === 404) {
      return { ok: false, code: 'no_server', message: NO_SERVER_MESSAGE };
    }
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    // 状态 200 却是 HTML：静态包里本地服务器把无扩展名路径兜底成了 index.html。
    const servedHtml = !contentType.includes('json') && /^\s*</.test(text);
    let json: CoachResponse<T> | null = null;
    try {
      json = JSON.parse(text) as CoachResponse<T>;
    } catch {
      json = null;
    }
    if (!json) {
      return servedHtml
        ? { ok: false, code: 'no_server', message: NO_SERVER_MESSAGE }
        : { ok: false, code: 'bad_response', message: describeAiError('bad_response') };
    }
    if (!json.ok) {
      return { ...json, message: json.message ?? describeAiError(json.code) };
    }
    return json;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, code: 'timeout', message: describeAiError('timeout') };
    }
    return { ok: false, code: 'network', message: describeAiError('network') };
  }
}

export function analyzeReasoning(settings: AppSettings, payload: Record<string, unknown>, signal?: AbortSignal) {
  return callTask('analyze-reasoning', payload, settings, signal);
}

export function reviewJournal(settings: AppSettings, payload: Record<string, unknown>, signal?: AbortSignal) {
  return callTask('review-journal', payload, settings, signal);
}

export function analyzeMaterial(settings: AppSettings, material: string, question?: string, signal?: AbortSignal) {
  return callTask('analyze-material', { material, question }, settings, signal);
}

export function recommendPractice(settings: AppSettings, payload: Record<string, unknown>, signal?: AbortSignal) {
  return callTask('recommend-practice', payload, settings, signal);
}

export function weeklySummary(settings: AppSettings, payload: Record<string, unknown>, signal?: AbortSignal) {
  return callTask('weekly-summary', payload, settings, signal);
}

export async function testAiConnection(): Promise<{ ok: boolean; reply?: string; message?: string }> {
  const settings = (await import('@/lib/domain/settings')).defaultSettings('local');
  const result = await callTask<{ reply?: string }>('ping', { note: 'logicdaily' }, settings);
  if (result.ok) return { ok: true, reply: result.result?.reply };
  return { ok: false, message: result.message ?? describeAiError(result.code) };
}

export function applyTheme(theme: AppSettings['theme']): void {
  if (typeof document === 'undefined') return;
  const dark =
    theme === 'dark' || (theme === 'system' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  try {
    localStorage.setItem('logicdaily:theme', theme);
  } catch {
    // 隐私模式下写入会抛错；主题只影响观感，不影响数据。
  }
}
