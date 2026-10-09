/**
 * 服务端 AI 配置。这里读取的变量都只存在于 Node 运行时：
 * 绝不要把密钥写进 next.config.ts 的 env（那份配置会被打进浏览器包），
 * 也不要加 NEXT_PUBLIC_ 前缀。
 */

export interface ServerAiConfig {
  configured: boolean;
  apiKey: string | null;
  baseUrl: string | null;
  defaultModel: string;
  /** 管理员允许的服务地址；只有出现在这里的地址才允许被使用。 */
  allowedBaseUrls: string[];
  /** 是否允许调用方在 allowlist 内指定 baseUrl。 */
  allowClientBaseUrl: boolean;
  maxInputChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
  dailyCallLimit: number;
  rateLimitPerMinute: number;
  retryLimit: number;
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function listEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readServerAiConfig(env: NodeJS.ProcessEnv = process.env): ServerAiConfig {
  const apiKey = env.AI_API_KEY?.trim() || null;
  const baseUrl = env.AI_BASE_URL?.trim() || null;
  const defaultModel = env.AI_MODEL?.trim() || 'gpt-4o-mini';
  const allowlist = listEnv('AI_ALLOWED_BASE_URLS');
  if (baseUrl && !allowlist.includes(baseUrl) && !allowlist.some((item) => baseUrl.startsWith(item))) {
    allowlist.unshift(baseUrl);
  }

  return {
    configured: Boolean(apiKey && baseUrl),
    apiKey,
    baseUrl,
    defaultModel,
    allowedBaseUrls: allowlist,
    allowClientBaseUrl: env.AI_ALLOW_CLIENT_BASE_URL === 'true',
    maxInputChars: numberEnv('AI_MAX_INPUT_CHARS', 12_000, 500, 60_000),
    maxOutputTokens: numberEnv('AI_MAX_OUTPUT_TOKENS', 900, 128, 4_000),
    timeoutMs: numberEnv('AI_TIMEOUT_MS', 25_000, 3_000, 120_000),
    dailyCallLimit: numberEnv('AI_DAILY_LIMIT', 60, 0, 5_000),
    rateLimitPerMinute: numberEnv('AI_RATE_LIMIT_PER_MIN', 12, 1, 300),
    retryLimit: numberEnv('AI_RETRY_LIMIT', 2, 0, 5),
  };
}

/** 供状态接口暴露的公开信息：不包含密钥、不包含完整 URL 路径。 */
export function publicAiStatus(config: ServerAiConfig) {
  return {
    configured: config.configured,
    defaultModel: config.defaultModel,
    allowedBaseUrlCount: config.allowedBaseUrls.length,
    allowClientBaseUrl: config.allowClientBaseUrl,
    limits: {
      maxInputChars: config.maxInputChars,
      maxOutputTokens: config.maxOutputTokens,
      timeoutMs: config.timeoutMs,
      dailyCallLimit: config.dailyCallLimit,
      rateLimitPerMinute: config.rateLimitPerMinute,
    },
  };
}
