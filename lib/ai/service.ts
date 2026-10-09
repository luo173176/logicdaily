import { z } from 'zod';

import { readServerAiConfig, type ServerAiConfig } from '@/lib/ai/config';
import { AI_TASKS, TASK_INPUT_LIMITS, TASK_OUTPUT_SCHEMAS, type AiTask } from '@/lib/ai/output-schema';
import { AiError, estimateTokens, OpenAiCompatibleProvider, redactUrl, type ProviderResult } from '@/lib/ai/provider';
import { isUrlAllowlisted } from '@/lib/ai/ssrf';
import {
  buildFollowUpMessages,
  buildJournalMessages,
  buildMaterialMessages,
  buildPingMessages,
  buildPracticeMessages,
  buildReasoningMessages,
  buildWeeklyMessages,
  SYSTEM_PROMPT_VERSION,
} from '@/lib/ai/prompts';
import { allExercises } from '@/lib/content/packs';
import { CATEGORY_LABELS, KNOWLEDGE_POINT_LABELS, LOGIC_ERROR_LABELS } from '@/lib/domain/taxonomy';

const chineseList = z.array(z.string().min(1).max(60)).max(8);

export const reasoningPayloadSchema = z.object({
  exerciseId: z.string().min(3).max(60),
  stem: z.string().min(4).max(3000),
  userAnswerText: z.string().min(1).max(2000),
  correctAnswerText: z.string().min(1).max(2000),
  reasoning: z.string().max(4000).default(''),
  confidence: z.number().int().min(1).max(5).default(3),
  detectedErrorTypes: chineseList.default([]),
  explanationSteps: z.array(z.string().min(1).max(300)).max(8).default([]),
  categoryKey: z.string().min(3).max(60),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) }))
    .max(6)
    .default([]),
});

export const journalPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  problem: z.string().max(4000).default(''),
  background: z.string().max(4000).default(''),
  facts: z.string().max(6000).default(''),
  assumptions: z.string().max(6000).default(''),
  conclusion: z.string().max(6000).default(''),
  alternativeExplanations: z.string().max(6000).default(''),
  keyUncertainties: z.string().max(6000).default(''),
  verificationActions: z.string().max(6000).default(''),
  selfConfidence: z.number().int().min(1).max(5).default(3),
  evidence: z
    .array(
      z.object({
        stance: z.enum(['support', 'oppose', 'alternative', 'unknown']),
        text: z.string().max(4000),
        source: z.string().max(300).default(''),
        reliability: z.number().int().min(1).max(5).default(3),
      }),
    )
    .max(20)
    .default([]),
  stepNotes: z.array(z.object({ stepId: z.string().max(40), text: z.string().max(4000) })).max(12).default([]),
  /** 客户端必须显式声明用户已同意把这篇日志发给模型。 */
  consented: z.literal(true),
});

export const materialPayloadSchema = z.object({
  material: z.string().min(20).max(12_000),
  question: z.string().max(500).optional(),
});

export const practicePayloadSchema = z.object({
  weakKnowledgePoints: chineseList.default([]),
  recentErrorTypes: chineseList.default([]),
  budgetMinutes: z.number().int().min(3).max(60).default(10),
  candidateIds: z.array(z.string().min(3).max(60)).min(1).max(120),
});

export const weeklyPayloadSchema = z.object({
  activeDays: z.number().int().min(0).max(7),
  attempts: z.number().int().min(0).max(10_000),
  accuracy: z.number().min(0).max(100),
  errorDistribution: z.string().max(600).default(''),
  journalCount: z.number().int().min(0).max(10_000),
  opposingEvidenceRate: z.number().min(0).max(100),
  reviewEffect: z.string().max(200).default(''),
  trendReliable: z.boolean().default(false),
});

export const pingPayloadSchema = z.object({ note: z.string().max(40).default('logicdaily') });

export const aiRequestSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('analyze-reasoning'), payload: reasoningPayloadSchema, model: z.string().max(80).optional(), temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(128).max(4000).optional(), baseUrl: z.string().max(300).optional() }),
  z.object({ task: z.literal('review-journal'), payload: journalPayloadSchema, model: z.string().max(80).optional(), temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(128).max(4000).optional(), baseUrl: z.string().max(300).optional() }),
  z.object({ task: z.literal('analyze-material'), payload: materialPayloadSchema, model: z.string().max(80).optional(), temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(128).max(4000).optional(), baseUrl: z.string().max(300).optional() }),
  z.object({ task: z.literal('recommend-practice'), payload: practicePayloadSchema, model: z.string().max(80).optional(), temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(128).max(4000).optional(), baseUrl: z.string().max(300).optional() }),
  z.object({ task: z.literal('weekly-summary'), payload: weeklyPayloadSchema, model: z.string().max(80).optional(), temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(128).max(4000).optional(), baseUrl: z.string().max(300).optional() }),
  z.object({ task: z.literal('ping'), payload: pingPayloadSchema, model: z.string().max(80).optional(), temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().min(128).max(4000).optional(), baseUrl: z.string().max(300).optional() }),
]);

export type AiRequest = z.infer<typeof aiRequestSchema>;

export interface RunContext {
  config?: ServerAiConfig;
  dateKey: string;
  /** 用于日志与限流，不写入任何持久化正文。 */
  actor: string;
}

export interface RunOutcome {
  task: AiTask;
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

function buildPrompt(request: AiRequest) {
  switch (request.task) {
    case 'analyze-reasoning': {
      const payload = request.payload;
      const input = {
        categoryLabel: CATEGORY_LABELS[payload.categoryKey as keyof typeof CATEGORY_LABELS] ?? payload.categoryKey,
        stem: payload.stem,
        userAnswerText: payload.userAnswerText,
        correctAnswerText: payload.correctAnswerText,
        reasoning: payload.reasoning,
        confidence: payload.confidence,
        detectedErrorTypes: payload.detectedErrorTypes.map((t) => LOGIC_ERROR_LABELS[t as keyof typeof LOGIC_ERROR_LABELS] ?? t),
        explanationSteps: payload.explanationSteps,
      };
      return payload.history.length > 0 ? buildFollowUpMessages({ ...input, history: payload.history }) : buildReasoningMessages(input);
    }
    case 'review-journal':
      return buildJournalMessages(request.payload);
    case 'analyze-material':
      return buildMaterialMessages(request.payload.material, request.payload.question);
    case 'recommend-practice': {
      const catalog = allExercises();
      const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
      const candidates = request.payload.candidateIds
        .map((id) => byId.get(id))
        .filter((exercise): exercise is NonNullable<typeof exercise> => Boolean(exercise))
        .map((exercise) => ({
          id: exercise.id,
          categoryLabel: CATEGORY_LABELS[exercise.category],
          difficulty: exercise.difficulty,
          knowledgePoints: exercise.knowledgePoints.map((kp) => KNOWLEDGE_POINT_LABELS[kp] ?? kp),
          format: exercise.format,
        }));
      if (candidates.length === 0) throw new AiError('bad_response', '候选题目为空，无法推荐。');
      return buildPracticeMessages({
        weakKnowledgePoints: request.payload.weakKnowledgePoints,
        recentErrorTypes: request.payload.recentErrorTypes,
        budgetMinutes: request.payload.budgetMinutes,
        candidates,
      });
    }
    case 'weekly-summary':
      return buildWeeklyMessages(request.payload);
    case 'ping':
      return buildPingMessages(request.payload.note);
  }
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
 * 服务端 AI 调用主流程。三条硬约束：
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
  const prompt = buildPrompt(request);
  const inputChars = prompt.messages.reduce((sum, message) => sum + message.content.length, 0);
  if (inputChars > TASK_INPUT_LIMITS[request.task] + 4000) {
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

  const schema = TASK_OUTPUT_SCHEMAS[request.task];
  const parsed = schema.safeParse(response.parsed);
  if (!parsed.success) {
    throw new AiError('bad_response', '模型返回的结构不符合要求，已丢弃这次结果。', {
      cause: parsed.error.issues.map((issue) => issue.path.join('.')).join(','),
    });
  }

  let result = parsed.data;
  if (request.task === 'recommend-practice') {
    const allowed = new Set(request.payload.candidateIds);
    const proposed = (result as { exerciseIds: string[] }).exerciseIds;
    const filtered = proposed.filter((id) => allowed.has(id));
    if (filtered.length === 0) throw new AiError('bad_response', '模型没有从候选题目中作出有效选择。');
    result = { ...(result as Record<string, unknown>), exerciseIds: filtered };
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

export { AI_TASKS };
