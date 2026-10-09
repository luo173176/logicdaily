import { z } from 'zod';

import { LOGIC_ERROR_TYPES } from '@/lib/domain/taxonomy';

const sentence = z.string().min(2).max(600);

export const argumentRoleSchema = z.enum(['conclusion', 'premise', 'assumption', 'evidence', 'background', 'counterexample']);

/**
 * 教练输出的最小公共结构：界面直接按这些字段渲染，
 * 因此服务端必须校验后才能返回给客户端（模型输出视为不可信输入）。
 */
export const coachBaseSchema = z.object({
  argumentStructure: z
    .array(z.object({ text: sentence, role: argumentRoleSchema }))
    .max(12)
    .default([]),
  strengths: z.array(sentence).max(6).default([]),
  issues: z
    .array(
      z.object({
        description: sentence,
        errorType: z.enum(LOGIC_ERROR_TYPES).nullable().optional(),
        reason: sentence,
      }),
    )
    .max(6)
    .default([]),
  supportingEvidence: z.array(sentence).max(6).default([]),
  opposingEvidence: z.array(sentence).max(6).default([]),
  alternativeExplanations: z.array(sentence).max(6).default([]),
  nextVerification: z
    .array(z.object({ action: sentence, distinguishes: sentence.nullable().optional() }))
    .max(6)
    .default([]),
  uncertainty: sentence,
  recommendedKnowledgePoints: z.array(z.string().min(1).max(40)).max(6).default([]),
});

export const reasoningAnalysisSchema = coachBaseSchema.extend({
  /** 苏格拉底式追问，界面优先展示这些提问而不是答案。 */
  questions: z.array(sentence).min(1).max(4),
  missingPremise: sentence.nullable().default(null),
});

export const journalReviewSchema = coachBaseSchema.extend({
  questions: z.array(sentence).min(1).max(4),
  factsMixedWithInference: z.array(sentence).max(6).default([]),
  strongestCounterView: sentence.nullable().default(null),
});

export const materialAnalysisSchema = coachBaseSchema.extend({
  mainConclusion: sentence,
  premises: z.array(sentence).max(8).default([]),
  implicitAssumptions: z.array(sentence).max(8).default([]),
  fallacies: z
    .array(z.object({ name: sentence, where: sentence, why: sentence }))
    .max(6)
    .default([]),
  evidenceQuality: z.enum(['strong', 'mixed', 'weak', 'absent']),
  missingInformation: z.array(sentence).max(6).default([]),
});

export const practiceRecommendationSchema = coachBaseSchema.extend({
  exerciseIds: z.array(z.string().min(3).max(60)).min(1).max(5),
  reason: sentence,
});

export const weeklySummarySchema = coachBaseSchema.extend({
  observations: z.array(sentence).min(1).max(6),
  suggestions: z.array(sentence).min(1).max(4),
  caution: sentence,
});

export const pingSchema = z.object({ reply: z.string().min(1).max(120), echo: z.string().max(40) });

export type CoachBase = z.infer<typeof coachBaseSchema>;
export type ReasoningAnalysis = z.infer<typeof reasoningAnalysisSchema>;
export type JournalReview = z.infer<typeof journalReviewSchema>;
export type MaterialAnalysis = z.infer<typeof materialAnalysisSchema>;
export type PracticeRecommendation = z.infer<typeof practiceRecommendationSchema>;
export type WeeklySummary = z.infer<typeof weeklySummarySchema>;

export const AI_TASKS = [
  'analyze-reasoning',
  'review-journal',
  'analyze-material',
  'recommend-practice',
  'weekly-summary',
  'ping',
] as const;

export type AiTask = (typeof AI_TASKS)[number];

export const TASK_OUTPUT_SCHEMAS: Record<AiTask, z.ZodTypeAny> = {
  'analyze-reasoning': reasoningAnalysisSchema,
  'review-journal': journalReviewSchema,
  'analyze-material': materialAnalysisSchema,
  'recommend-practice': practiceRecommendationSchema,
  'weekly-summary': weeklySummarySchema,
  ping: pingSchema,
};

export const TASK_INPUT_LIMITS: Record<AiTask, number> = {
  'analyze-reasoning': 6000,
  'review-journal': 12000,
  'analyze-material': 12000,
  'recommend-practice': 6000,
  'weekly-summary': 6000,
  ping: 200,
};
