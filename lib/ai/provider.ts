import { joinChatCompletions, resolveSafeTarget, UnsafeUrlError } from '@/lib/ai/ssrf';

export type AiErrorKind =
  'not_configured' | 'timeout' | 'rate_limited' | 'unavailable' | 'auth' | 'bad_response' | 'network' | 'unsafe_url' | 'budget_exceeded';

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(kind: AiErrorKind, message: string, options?: { retryable?: boolean; cause?: unknown; status?: number }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AiError';
    this.kind = kind;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ProviderResult {
  content: string;
  model: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  /** 上游返回的结构化输出字段（若有），用于二次校验。 */
  parsed: unknown;
}

export interface ProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  retryLimit: number;
  /** 允许列表；出站前必须通过 SSRF 检查。 */
  allowedBaseUrls: string[];
  allowLoopback?: boolean;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function classifyStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'bad_response';
}

/** 只用于日志：任何情况下都不输出密钥或认证头。 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '(无效地址)';
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new AiError('bad_response', '模型没有返回结构化结果，请重试或换用支持 JSON 输出的模型。');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new AiError('bad_response', '模型返回的 JSON 无法解析。', { cause: error });
  }
}

export class OpenAiCompatibleProvider {
  constructor(private readonly options: ProviderOptions) {}

  async chat(request: ProviderRequest): Promise<ProviderResult> {
    const target = await this.safeTarget();
    const body = JSON.stringify({
      model: this.options.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      // 结构化输出依赖上游支持；不支持时服务端仍会用 zod 二次校验。
      response_format: { type: 'json_object' },
      stream: false,
    });

    let attempt = 0;
    let lastError: AiError | null = null;

    while (attempt <= this.options.retryLimit) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      const externalSignal = request.signal;
      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onExternalAbort);
      const startedAt = Date.now();

      try {
        const response = await fetch(joinChatCompletions(target.url.toString()), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.options.apiKey}`,
            'user-agent': 'LogicDaily/0.1 (+https://github.com/luo173176/logicdaily)',
          },
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const status = response.status;
          // 上游错误正文可能包含请求内容回显，因此只保留状态码。
          const kind = classifyStatus(status);
          throw new AiError(
            kind,
            kind === 'auth' ? '模型服务拒绝了凭据。' : kind === 'rate_limited' ? '模型服务限流，请稍后再试。' : '模型服务暂时不可用。',
            {
              retryable: RETRYABLE_STATUS.has(status),
              status,
            },
          );
        }

        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
          model?: string;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.length === 0) {
          throw new AiError('bad_response', '模型返回了空内容。');
        }

        return {
          content,
          model: json.model ?? this.options.model,
          latencyMs: Date.now() - startedAt,
          promptTokens: json.usage?.prompt_tokens ?? null,
          completionTokens: json.usage?.completion_tokens ?? null,
          totalTokens: json.usage?.total_tokens ?? null,
          parsed: extractJson(content),
        };
      } catch (error) {
        if (error instanceof AiError) {
          lastError = error;
          if (!error.retryable || attempt > this.options.retryLimit) throw error;
        } else if (error instanceof UnsafeUrlError) {
          throw new AiError('unsafe_url', error.message, { cause: error });
        } else if (error instanceof Error && error.name === 'AbortError') {
          lastError = new AiError('timeout', `请求超过 ${Math.round(this.options.timeoutMs / 1000)} 秒已中断。`, {
            retryable: attempt <= this.options.retryLimit,
            cause: error,
          });
          if (!lastError.retryable) throw lastError;
        } else {
          lastError = new AiError('network', '无法连接模型服务，请检查网络或服务地址。', { retryable: true, cause: error });
          if (attempt > this.options.retryLimit) throw lastError;
        }
        // 指数退避，给 429 与冷启动一点时间。
        await new Promise((resolve) => setTimeout(resolve, Math.min(4000, 400 * 2 ** (attempt - 1))));
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }
    }

    throw lastError ?? new AiError('unavailable', '模型调用失败。');
  }

  /** 供状态自检使用：只做地址检查，不发出请求。 */
  async safeTarget() {
    return resolveSafeTarget(joinChatCompletions(this.options.baseUrl), this.options.allowedBaseUrls, {
      allowLoopback: this.options.allowLoopback,
    });
  }
}

/** 从消息文本长度粗算用量，用于成本上限；真实数字以上游 usage 为准。 */
export function estimateTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return Math.ceil(chars / 2.2);
}
