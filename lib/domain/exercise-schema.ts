import { z } from 'zod';

import {
  EXERCISE_CATEGORIES,
  KNOWLEDGE_POINT_IDS,
  LOGIC_ERROR_TYPES,
} from '@/lib/domain/taxonomy';

const idSchema = z
  .string()
  .min(3)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'ID 只能使用小写字母、数字、点、下划线和连字符');

const nonEmpty = z.string().min(1);

export const optionSchema = z.object({
  key: z.string().regex(/^[A-Z]$/, '选项 key 必须是大写字母'),
  text: nonEmpty,
  /** 该选项对应的典型推理错误；正确选项不应带此字段。 */
  errorType: z.enum(LOGIC_ERROR_TYPES).optional(),
  reason: z.string().min(4).optional(),
});

export const checkpointSchema = z.object({
  id: z.string().min(1),
  label: nonEmpty,
  keywords: z.array(nonEmpty).min(1),
  weight: z.number().int().min(1).max(5).default(1),
  required: z.boolean().default(false),
});

export const gradingConfigSchema = z
  .object({
    /** 多选/排序题是否给出 partial 结果。 */
    partialCredit: z.boolean().default(true),
    /** 排序题允许多少比例的相邻错位仍算基本正确（0～0.5）。 */
    orderTolerance: z.number().min(0).max(0.5).default(0.2),
  })
  .strict();

const explanationSchema = z.object({
  summary: z.string().min(8),
  steps: z.array(z.string().min(6)).min(1),
  commonMistakes: z
    .array(
      z.object({
        option: z.string().optional(),
        errorType: z.enum(LOGIC_ERROR_TYPES),
        why: z.string().min(8),
      }),
    )
    .default([]),
  takeaway: z.string().min(6),
});

const baseFields = {
  id: idSchema,
  version: z.number().int().min(1),
  category: z.enum(EXERCISE_CATEGORIES),
  knowledgePoints: z.array(z.enum(KNOWLEDGE_POINT_IDS as [string, ...string[]])).min(1).max(4),
  difficulty: z.number().int().min(1).max(5),
  estimatedSeconds: z.number().int().min(20).max(600),
  context: z.string().min(4).optional(),
  stem: z.string().min(6),
  prompt: z.string().min(4).optional(),
  explanation: explanationSchema,
  reviewTags: z.array(nonEmpty).min(1).max(6),
  provenance: z.string().min(4),
  status: z.enum(['draft', 'validated', 'retired']).default('validated'),
  grading: gradingConfigSchema.default({ partialCredit: true, orderTolerance: 0.2 }),
};

const singleChoice = z.object({
  ...baseFields,
  format: z.literal('single-choice'),
  options: z.array(optionSchema).min(2).max(6).superRefine((opts, ctx) => {
    const keys = opts.map((o) => o.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: '选项 key 重复' });
    }
  }),
  answer: z.object({ keys: z.array(z.string()).length(1) }),
  alternatives: z
    .array(z.object({ keys: z.array(z.string()).min(1), note: z.string().min(4) }))
    .default([]),
});

const multiChoice = z.object({
  ...baseFields,
  format: z.literal('multi-choice'),
  options: z.array(optionSchema).min(3).max(8),
  answer: z.object({ keys: z.array(z.string()).min(1) }),
  alternatives: z.array(z.object({ keys: z.array(z.string()).min(1), note: z.string().min(4) })).default([]),
});

const trueFalse = z.object({
  ...baseFields,
  format: z.literal('true-false'),
  answer: z.object({ value: z.boolean() }),
  alternatives: z.array(z.object({ keys: z.array(z.string()), note: z.string() })).default([]),
});

const shortAnswer = z.object({
  ...baseFields,
  format: z.literal('short-answer'),
  answer: z.object({
    checkpoints: z.array(checkpointSchema).min(2),
    /** 达到该加权覆盖率视为 correct。 */
    correctRatio: z.number().min(0.5).max(1).default(0.8),
    /** 达到该加权覆盖率视为 partial。 */
    partialRatio: z.number().min(0.2).max(0.9).default(0.5),
    modelAnswer: z.string().min(8),
  }),
  alternatives: z.array(z.object({ keys: z.array(z.string()), note: z.string() })).default([]),
});

const openResponse = z.object({
  ...baseFields,
  format: z.literal('open-response'),
  answer: z.object({
    /** 量表等级，供用户自评与可选的模型评价使用。 */
    scale: z
      .array(
        z.object({
          score: z.number().int().min(0).max(4),
          label: nonEmpty,
          criteria: z.string().min(8),
        }),
      )
      .min(3),
    guidance: z.string().min(8),
    /** 开放题没有唯一正确答案，判分只作为自我评估记录。 */
    selfAssessed: z.literal(true).default(true),
  }),
  alternatives: z.array(z.object({ keys: z.array(z.string()), note: z.string() })).default([]),
});

const ordering = z.object({
  ...baseFields,
  format: z.literal('ordering'),
  /** items 按正确顺序给出，界面负责打乱。 */
  items: z.array(z.object({ key: z.string().min(1), text: nonEmpty })).min(3).max(6),
  answer: z.object({ keys: z.array(z.string()).min(3) }),
  alternatives: z.array(z.object({ keys: z.array(z.string()), note: z.string() })).default([]),
});

export const exerciseSchema = z.discriminatedUnion('format', [
  singleChoice,
  multiChoice,
  trueFalse,
  shortAnswer,
  openResponse,
  ordering,
]);

export type ExerciseOption = z.infer<typeof optionSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type ExerciseExplanation = z.infer<typeof explanationSchema>;
export type Exercise = z.infer<typeof exerciseSchema>;
export type ExerciseFormat = Exercise['format'];

export const exerciseFileSchema = z.object({
  schemaVersion: z.number().int().min(1),
  category: z.enum(EXERCISE_CATEGORIES),
  exercises: z.array(exerciseSchema).min(1),
});

export type ExerciseFile = z.infer<typeof exerciseFileSchema>;

export const EXERCISE_CONTENT_VERSION = 1;
