/**
 * 服务端 AI 调用主流程。配置、SSRF 边界与限流都在这层，
 * 提示词装配与输出契约来自 lib/ai/tasks.ts（客户端直连用的是同一份）。
 */
import { readServerAiConfig, type ServerAiConfig } from '@/lib/ai/config';
import { AiError, estimateTokens, OpenAiCompatibleProvider, redactUrl, type ProviderResult } from '@/lib/ai/provider';
import { isUrlAllowlisted } from '@/lib/ai/ssrf';
import {
  AI_TASKS,
  SYSTEM_PROMPT_VERSION,
  TaskPromptError,
  TaskResultRejected,
  aiRequestSchema,
  buildTaskPrompt,
  inputCharLimit,
  validateTaskResult,
  type AiRequest,
} from '@/lib/ai/tasks';

export type { AiRequest };
export { aiRequestSchema };

export interface RunContext {
  config?: ServerAiConfig;
  dateKey: string;
  /** 用于日志与限流，不写入任何持久化正文。 */
  actor: string;
}

export interface RunOutcome {
  task: AiRequest['task'];
  result: unknown;
  model: string;
  baseUrl: string;
  promptVersion: string;
  systemVersion: string;
  latencyMs: number;
  inputChars: number;
  outputChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

function resolveBaseUrl(request: AiRequest, config: ServerAiConfig): string {
  if (!request.baseUrl) {
    if (!config.baseUrl) throw new AiError('not_configured', '服务端未配置 AI_BASE_URL。');
    return config.baseUrl;
  }
  if (!config.allowClientBaseUrl) {
    throw new AiError('unsafe_url', '服务端不允许由客户端指定模型服务地址。');
  }
  if (!isUrlAllowlisted(request.baseUrl, config.allowedBaseUrls)) {
    throw new AiError('unsafe_url', '指定的模型服务地址不在允许列表中。');
  }
  return request.baseUrl;
}

/**
 * 三条硬约束：
 * 1. 客户端传来的 baseUrl 必须通过允许列表 + DNS 私网检查；
 * 2. 模型返回一律按 zod 校验，未通过就报错而不是透传；
 * 3. 任何日志与错误消息都不包含密钥、认证头或用户正文。
 */
export async function runAiTask(request: AiRequest, context: RunContext): Promise<RunOutcome> {
  const config = context.config ?? readServerAiConfig();
  if (!config.configured || !config.apiKey || !config.baseUrl) {
    throw new AiError('not_configured', '模型服务尚未配置，基础训练功能不受影响。');
  }

  const baseUrl = resolveBaseUrl(request, config);
  let prompt;
  try {
    prompt = buildTaskPrompt(request);
  } catch (error) {
    if (error instanceof TaskPromptError) throw new AiError('bad_response', error.message);
    throw error;
  }
  const inputChars = prompt.messages.reduce((sum, message) => sum + message.content.length, 0);
  if (inputChars > inputCharLimit(request.task)) {
    throw new AiError('budget_exceeded', '这次请求的内容过长，请缩短后重试。');
  }

  const provider = new OpenAiCompatibleProvider({
    baseUrl,
    apiKey: config.apiKey,
    model: request.model?.trim() || config.defaultModel,
    timeoutMs: Math.min(request.task === 'ping' ? 15_000 : config.timeoutMs, config.timeoutMs),
    retryLimit: config.retryLimit,
    allowedBaseUrls: config.allowedBaseUrls,
    allowLoopback: process.env.NODE_ENV !== 'production' && process.env.AI_ALLOW_LOOPBACK === 'true',
  });

  const temperature = request.temperature ?? 0.4;
  const maxTokens = Math.min(request.maxOutputTokens ?? config.maxOutputTokens, config.maxOutputTokens);

  let response: ProviderResult;
  try {
    response = await provider.chat({ messages: prompt.messages, temperature, maxTokens });
  } catch (error) {
    if (error instanceof AiError) {
      throw new AiError(error.kind, error.message, { status: error.status, retryable: error.retryable });
    }
    throw new AiError('unavailable', '模型调用失败。', { cause: error });
  }

  let result: unknown;
  try {
    result = validateTaskResult(request, response.parsed);
  } catch (error) {
    if (error instanceof TaskResultRejected) throw new AiError('bad_response', error.message, { cause: error.detail });
    throw error;
  }

  void estimateTokens(prompt.messages);
  return {
    task: request.task,
    result,
    model: response.model,
    // 对外只暴露主机名，避免把内部路径或查询参数交给客户端。
    baseUrl: redactUrl(baseUrl),
    promptVersion: prompt.promptVersion,
    systemVersion: SYSTEM_PROMPT_VERSION,
    latencyMs: response.latencyMs,
    inputChars,
    outputChars: response.content.length,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
    totalTokens: response.totalTokens,
  };
}

export { AI_TASKS, SYSTEM_PROMPT_VERSION };
