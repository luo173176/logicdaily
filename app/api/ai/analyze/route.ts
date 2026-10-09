import { NextResponse } from 'next/server';

import { publicAiStatus, readServerAiConfig } from '@/lib/ai/config';
import { checkRate } from '@/lib/ai/ratelimit';
import { runAiTask, aiRequestSchema, type AiRequest } from '@/lib/ai/service';
import { AiError } from '@/lib/ai/provider';
import { todayKey } from '@/lib/domain/time';

const STATUS_BY_KIND: Record<string, number> = {
  not_configured: 503,
  unsafe_url: 403,
  auth: 502,
  timeout: 504,
  rate_limited: 429,
  budget_exceeded: 429,
  unavailable: 503,
  bad_response: 502,
  network: 502,
};

/** 请求来源校验：没有 Origin（同源 curl/服务端）时按同源处理；跨站 Origin 一律拒绝。 */
function sameOriginGuard(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    if (new URL(origin).host !== new URL(request.url).host) return 'cross-origin';
  } catch {
    return 'bad-origin';
  }
  return null;
}

/**
 * 限流用的调用者标识。
 *
 * 转发头只有在运维显式声明可信时才读取：`TRUST_PROXY_HEADERS=x-forwarded-for` 这样配置。
 * 未配置时一律归入同一个共享桶——宁可粗一点，也不让客户端伪造的 X-Forwarded-For 把配额打散。
 */
function actorKey(request: Request): string {
  const trusted = (process.env.TRUST_PROXY_HEADERS ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  for (const name of trusted) {
    const value = request.headers.get(name);
    if (!value) continue;
    // x-forwarded-for 是「客户端, 代理1, 代理2」，只有最左边的才是声称的客户端地址。
    const candidate = (name === 'x-forwarded-for' ? value.split(',')[0] : value).trim();
    if (candidate) return candidate;
  }
  return 'shared';
}

export async function POST(request: Request) {
  const originProblem = sameOriginGuard(request);
  if (originProblem) {
    return NextResponse.json({ ok: false, code: 'forbidden', message: '请求来源不被接受。' }, { status: 403 });
  }

  const config = readServerAiConfig();
  const body: unknown = await request.json().catch(() => null);
  const parsed = aiRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'invalid_request', message: '请求结构不符合要求，已拒绝。' }, { status: 400 });
  }

  const dateKey = todayKey(new Date(), 'UTC');
  const rate = checkRate({
    key: `${actorKey(request)}|${parsed.data.task}`,
    perMinute: config.rateLimitPerMinute,
    dailyLimit: config.dailyCallLimit,
    dateKey,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', message: '调用过于频繁或已达当日上限，请稍后再试。', retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const outcome = await runAiTask(parsed.data as AiRequest, { config, dateKey, actor: actorKey(request) });
    console.log(
      JSON.stringify({
        evt: 'ai_call',
        task: outcome.task,
        model: outcome.model,
        ms: outcome.latencyMs,
        tokens: outcome.totalTokens,
        status: 'ok',
      }),
    );
    return NextResponse.json({
      ok: true,
      task: outcome.task,
      result: outcome.result,
      meta: {
        model: outcome.model,
        promptVersion: outcome.promptVersion,
        systemVersion: outcome.systemVersion,
        latencyMs: outcome.latencyMs,
        inputChars: outcome.inputChars,
        outputChars: outcome.outputChars,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
        totalTokens: outcome.totalTokens,
        usedToday: rate.usedToday,
        remainingToday: Math.max(0, config.dailyCallLimit - rate.usedToday),
      },
    });
  } catch (error) {
    const kind = error instanceof AiError ? error.kind : 'unavailable';
    const message = error instanceof AiError ? error.message : '模型调用出现未预期的错误。';
    // 只记录类别与状态码：错误对象可能带有请求正文，不进入日志。
    console.log(JSON.stringify({ evt: 'ai_call', status: 'error', code: kind }));
    return NextResponse.json({ ok: false, code: kind, message }, { status: STATUS_BY_KIND[kind] ?? 500 });
  }
}

export async function GET() {
  const config = readServerAiConfig();
  return NextResponse.json({ ok: true, ...publicAiStatus(config) });
}
