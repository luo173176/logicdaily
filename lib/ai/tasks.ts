/**
 * 任务定义与提示词装配 —— 服务端代理与客户端直连**共用**这一份。
 *
 * 这里刻意不 import config / ssrf / provider：同一套提示词、同一份输入约束、
 * 同一个输出契约，两边各写一份必然漂移（直连模式尤其容易偷偷放宽）。
 */
import { z } from 'zod';

import type { ChatMessage } from '@/lib/ai/provider-core';
import { AI_TASKS, TASK_INPUT_LIMITS, TASK_OUTPUT_SCHEMAS, type AiTask } from '@/lib/ai/output-schema';
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
  stepNotes: z
    .array(z.object({ stepId: z.string().max(40), text: z.string().max(4000) }))
    .max(12)
    .default([]),
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

/** 每个任务都可选地带上模型参数；直连模式还会带 baseUrl/apiKey（在客户端一侧校验，不进这个 schema）。 */
const commonOptionalFields = {
  model: z.string().max(80).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(128).max(4000).optional(),
  baseUrl: z.string().max(300).optional(),
};

export const aiRequestSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('analyze-reasoning'), payload: reasoningPayloadSchema, ...commonOptionalFields }),
  z.object({ task: z.literal('review-journal'), payload: journalPayloadSchema, ...commonOptionalFields }),
  z.object({ task: z.literal('analyze-material'), payload: materialPayloadSchema, ...commonOptionalFields }),
  z.object({ task: z.literal('recommend-practice'), payload: practicePayloadSchema, ...commonOptionalFields }),
  z.object({ task: z.literal('weekly-summary'), payload: weeklyPayloadSchema, ...commonOptionalFields }),
  z.object({ task: z.literal('ping'), payload: pingPayloadSchema, ...commonOptionalFields }),
]);

export type AiRequest = z.infer<typeof aiRequestSchema>;

export interface BuiltPrompt {
  messages: ChatMessage[];
  promptVersion: string;
}

export function buildTaskPrompt(request: AiRequest): BuiltPrompt {
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
      if (candidates.length === 0) throw new TaskPromptError('候选题目为空，无法推荐。');
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

/** 提示词装配阶段的失败：调用方按 bad_response 处理，不涉及网络。 */
export class TaskPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskPromptError';
  }
}

/** 模型回复的统一后处理：结构校验 + 推荐题目的白名单过滤。两种模式共用。 */
export function validateTaskResult(request: AiRequest, parsed: unknown): unknown {
  const schema = TASK_OUTPUT_SCHEMAS[request.task as AiTask];
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new TaskResultRejected(result.error.issues.map((issue) => issue.path.join('.')).join(','));
  }
  if (request.task === 'recommend-practice') {
    const allowed = new Set(request.payload.candidateIds);
    const proposed = (result.data as { exerciseIds: string[] }).exerciseIds;
    const filtered = proposed.filter((id) => allowed.has(id));
    if (filtered.length === 0) throw new TaskResultRejected('模型没有从候选题目中作出有效选择。');
    return { ...(result.data as Record<string, unknown>), exerciseIds: filtered };
  }
  return result.data;
}

export class TaskResultRejected extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super('模型返回的结构不符合要求，已丢弃这次结果。');
    this.name = 'TaskResultRejected';
    this.detail = detail;
  }
}

export function inputCharLimit(task: AiTask): number {
  return TASK_INPUT_LIMITS[task] + 4000;
}

export { AI_TASKS, SYSTEM_PROMPT_VERSION };
