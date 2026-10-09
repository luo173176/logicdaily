import { z } from 'zod';

export const journalEvidenceSchema = z.object({
  id: z.string().min(1),
  journalId: z.string().min(1),
  stance: z.enum(['support', 'oppose', 'alternative', 'unknown']),
  text: z.string().min(1).max(4000),
  source: z.string().max(300).default(''),
  /** 1～5，你对这条证据可靠性的自评。 */
  reliability: z.number().int().min(1).max(5).default(3),
  createdAt: z.number(),
});

export const journalStepAnswerSchema = z.object({
  stepId: z.string().min(1),
  text: z.string().max(4000).default(''),
  updatedAt: z.number(),
});

export const journalSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  title: z.string().min(1).max(120),
  problem: z.string().max(4000).default(''),
  background: z.string().max(4000).default(''),
  facts: z.string().max(6000).default(''),
  assumptions: z.string().max(6000).default(''),
  conclusion: z.string().max(6000).default(''),
  alternativeExplanations: z.string().max(6000).default(''),
  keyUncertainties: z.string().max(6000).default(''),
  verificationActions: z.string().max(6000).default(''),
  /** 复盘时填写的实际结果，用于把练习表现与现实结果区分开。 */
  reviewOutcome: z.string().max(6000).default(''),
  reviewDelta: z.enum(['better', 'as-expected', 'worse', 'unknown']).default('unknown'),
  steps: z.array(journalStepAnswerSchema).default([]),
  evidence: z.array(journalEvidenceSchema).default([]),
  tags: z.array(z.string().min(1).max(24)).max(12).default([]),
  /** 1～5，写下结论时的信心；后续复盘可以对比。 */
  selfConfidence: z.number().int().min(1).max(5).default(3),
  status: z.enum(['open', 'review-due', 'reviewed', 'decided', 'archived']).default('open'),
  reviewDueDateKey: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** 软删除标记，同步时需要传播。 */
  deleted: z.boolean().default(false),
  deletedAt: z.number().nullable().default(null),
  /** 用户选择把这篇日志送 AI 分析时才上传内容；本地默认不外发。 */
  aiConsent: z.boolean().default(false),
});

export type JournalEvidence = z.infer<typeof journalEvidenceSchema>;
export type JournalStepAnswer = z.infer<typeof journalStepAnswerSchema>;
export type Journal = z.infer<typeof journalSchema>;

export const JOURNAL_STATUS_LABELS: Record<Journal['status'], string> = {
  open: '仍在思考',
  'review-due': '待复盘',
  reviewed: '已复盘',
  decided: '已做决定',
  archived: '已归档',
};

export const EVIDENCE_STANCE_LABELS: Record<JournalEvidence['stance'], string> = {
  support: '支持当前结论',
  oppose: '与结论冲突',
  alternative: '支持另一种解释',
  unknown: '暂时不确定',
};

/** 快速记录模式只要求标题与问题，向导字段可留空。 */
export function createEmptyJournal(input: { id: string; profileId: string; nowTs: number; title?: string }): Journal {
  return journalSchema.parse({
    id: input.id,
    profileId: input.profileId,
    title: input.title?.slice(0, 120) || '未命名思考',
    createdAt: input.nowTs,
    updatedAt: input.nowTs,
  });
}

export function journalCompleteness(journal: Journal): { filled: number; total: number; percent: number } {
  const coreFields: Array<keyof Journal> = [
    'problem',
    'background',
    'facts',
    'assumptions',
    'conclusion',
    'alternativeExplanations',
    'keyUncertainties',
    'verificationActions',
  ];
  const filled = coreFields.filter((f) => typeof journal[f] === 'string' && (journal[f] as string).trim().length > 0).length;
  const total = coreFields.length;
  return { filled, total, percent: Math.round((filled / total) * 100) };
}

export function searchJournals(journals: Journal[], query: string, tag?: string): Journal[] {
  const q = query.trim().toLowerCase();
  return journals.filter((j) => {
    if (j.deleted) return false;
    if (tag && !j.tags.includes(tag)) return false;
    if (!q) return true;
    const haystack = [
      j.title,
      j.problem,
      j.background,
      j.facts,
      j.assumptions,
      j.conclusion,
      j.alternativeExplanations,
      j.keyUncertainties,
      j.verificationActions,
      j.reviewOutcome,
      j.tags.join(' '),
      ...j.steps.map((s) => s.text),
      ...j.evidence.map((e) => e.text),
    ]
      .join('\n')
      .toLowerCase();
    return q
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => haystack.includes(token));
  });
}
