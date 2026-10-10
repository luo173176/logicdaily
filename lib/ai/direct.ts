/**
 * 本机直连模式：不经过本站服务端，由 WebView/浏览器直接请求模型服务商。
 *
 * 存在的理由：纯离线构建（APK、静态托管）里没有 Node 服务端，服务端代理那条路根本不存在。
 * 让用户填 base_url + Key 直连，是让这些构建也能用上 AI 的唯一办法。
 *
 * 与安全模式的关系（务必如实写进文档，不要假装等价）：
 * - 服务端代理：密钥只在服务器，出站前有 SSRF 允许列表 + DNS 私网拒绝 + 服务端权威配额。
 * - 本机直连：密钥存在本机 localStorage（明文），没有服务端配额，也没有 DNS 私网检查——
 *   此时真正的边界是浏览器同源策略/CORS：服务商不给跨域许可就调不通。
 * 因此直连只放宽到「用户自己的设备、自己的密钥、自己填的地址」这个范围，
 * 并且仍然强制：https（或本机 http）、URL 内不得携带凭据、不跟随重定向。
 */
import { AiError, OpenAiCompatibleProvider, joinChatCompletions, redactUrl, type ResolveEndpoint } from '@/lib/ai/provider-core';
import { SYSTEM_PROMPT_VERSION } from '@/lib/ai/prompts';
import { TaskPromptError, TaskResultRejected, buildTaskPrompt, inputCharLimit, validateTaskResult, type AiRequest } from '@/lib/ai/tasks';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * 直连地址的形状检查。注意这里**不做**内网/私网拦截：用户可能就是要连局域网里的
 * Ollama，而浏览器本来就能自由访问这些地址，拦在这里只会让功能不可用而已。
 */
export function assertDirectEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiError('unsafe_url', '模型服务地址无法解析，请填写完整 URL，例如 https://api.deepseek.com/v1。');
  }
  if (url.protocol === 'http:') {
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new AiError('unsafe_url', '只有本机地址可以使用 http，其他地址必须用 https，否则密钥会明文经过网络。');
    }
  } else if (url.protocol !== 'https:') {
    throw new AiError('unsafe_url', '只支持 http/https 地址。');
  }
  if (url.username || url.password) {
    throw new AiError('unsafe_url', '地址里不要写用户名或密码，密钥请填在下面的输入框。');
  }
  return url;
}

export interface DirectParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface DirectOutcome {
  result: unknown;
  model: string;
  /** 只暴露主机名与路径，避免把查询参数之类的东西留在记录里。 */
  endpoint: string;
  promptVersion: string;
  systemVersion: string;
  latencyMs: number;
  inputChars: number;
  outputChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

/**
 * 与 runAiTask 等价的直连版本：同一份提示词、同一个输出契约、同一套错误种类。
 * 两边共用 lib/ai/tasks.ts，所以不会出现「直连模式偷偷放宽校验」的情况。
 */
export async function callDirectTask(request: AiRequest, params: DirectParams, signal?: AbortSignal): Promise<DirectOutcome> {
  if (!params.baseUrl.trim()) throw new AiError('not_configured', '直连模式需要填写模型服务地址（Base URL）。');
  if (!params.apiKey.trim()) throw new AiError('not_configured', '直连模式需要填写 API Key。');
  if (!params.model.trim()) throw new AiError('not_configured', '直连模式必须填写模型名称，因为没有服务端默认值可回退。');

  const resolveEndpoint: ResolveEndpoint = (base) => joinChatCompletions(assertDirectEndpoint(base).toString());

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
    baseUrl: params.baseUrl.trim(),
    apiKey: params.apiKey.trim(),
    model: params.model.trim(),
    // 移动端网络不稳，重试一次足够；再多只会让用户对着转圈的按钮等。
    timeoutMs: request.task === 'ping' ? Math.min(params.timeoutMs, 15_000) : params.timeoutMs,
    retryLimit: 1,
    resolveEndpoint,
  });

  const response = await provider.chat({
    messages: prompt.messages,
    temperature: params.temperature,
    maxTokens: params.maxOutputTokens,
    signal,
  });

  let result: unknown;
  try {
    result = validateTaskResult(request, response.parsed);
  } catch (error) {
    if (error instanceof TaskResultRejected) throw new AiError('bad_response', error.message, { cause: error.detail });
    throw error;
  }

  return {
    result,
    model: response.model,
    endpoint: redactUrl(params.baseUrl.trim()),
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
