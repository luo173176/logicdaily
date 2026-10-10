/**
 * 服务端侧的 provider 绑定：把 SSRF 检查接进调用核心。
 * 真正的 HTTP / 解析 / 重试实现在 lib/ai/provider-core.ts，那个文件必须保持客户端可导入，
 * 所以这里只负责注入「出站前检查」，不重复实现请求逻辑。
 */
import { UnsafeUrlError, resolveSafeTarget } from '@/lib/ai/ssrf';

import {
  AiError,
  OpenAiCompatibleProvider as CoreProvider,
  joinChatCompletions,
  type ProviderCoreOptions,
  type ResolveEndpoint,
} from '@/lib/ai/provider-core';

export {
  AiError,
  estimateTokens,
  joinChatCompletions,
  redactUrl,
  type ChatMessage,
  type ProviderRequest,
  type ProviderResult,
} from '@/lib/ai/provider-core';

export interface ServerProviderOptions extends Omit<ProviderCoreOptions, 'resolveEndpoint'> {
  /** 允许列表；出站前必须通过 SSRF 检查。 */
  allowedBaseUrls: string[];
  allowLoopback?: boolean;
}

/**
 * 出站前的强制检查：协议、凭据、允许列表、DNS 解析结果。
 * 被拒绝时转成 AiError('unsafe_url')，让调用核心按统一的错误契约处理。
 */
export function createServerEndpointResolver(allowedBaseUrls: string[], allowLoopback = false): ResolveEndpoint {
  return async (baseUrl) => {
    const endpoint = joinChatCompletions(baseUrl);
    try {
      const target = await resolveSafeTarget(endpoint, allowedBaseUrls, { allowLoopback });
      return joinChatCompletions(target.url.toString());
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw new AiError('unsafe_url', error.message, { cause: error });
      throw error;
    }
  };
}

export class OpenAiCompatibleProvider extends CoreProvider {
  constructor(options: ServerProviderOptions) {
    const { allowedBaseUrls, allowLoopback, ...rest } = options;
    super({ ...rest, resolveEndpoint: createServerEndpointResolver(allowedBaseUrls, allowLoopback) });
  }
}
