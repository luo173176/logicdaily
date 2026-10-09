import type { AnswerInput, GradeOutcome } from '@/lib/domain/grading';
import type { ActivityType, CauseType, LogicErrorType } from '@/lib/domain/taxonomy';
import type { SelfReport } from '@/lib/domain/mistake';

export interface AttemptRecord {
  id: string;
  profileId: string;
  exerciseId: string;
  /** 记录作答时的题目版本，题目更新后旧记录仍可解释。 */
  exerciseVersion: number;
  dateKey: string;
  createdAt: number;
  answer: AnswerInput;
  outcome: GradeOutcome;
  score: number;
  timeSpentSeconds: number;
  confidence: number;
  reasoning: string;
  selfReport: SelfReport;
  errorTypes: LogicErrorType[];
  cause: CauseType;
  planItemId: string | null;
  isReview: boolean;
  /** 用户认为题目有歧义，需要人工复核。 */
  flaggedForReview: boolean;
  aiAnalysisId: string | null;
}

export interface DailyPlanItemRecord {
  id: string;
  activity: ActivityType;
  exerciseId: string | null;
  journalId: string | null;
  estimatedSeconds: number;
  reason: string;
  kind: 'new' | 'review' | 'same-day-relearn' | 'journal';
  required: boolean;
}

export interface DailyPlanRecord {
  id: string;
  profileId: string;
  dateKey: string;
  budgetMinutes: number;
  restDay: boolean;
  items: DailyPlanItemRecord[];
  notes: string[];
  generatedAt: number;
  /** 生成计划时使用的时间基准，复盘时能还原“为什么是这些题”。 */
  algorithm: string;
}

export interface DailyProgressRecord {
  dateKey: string;
  profileId: string;
  planId: string | null;
  /** 已完成的项目 id。 */
  completedItemIds: string[];
  skippedItemIds: string[];
  totalSeconds: number;
  attempts: number;
  updatedAt: number;
}

export interface ExerciseIssueReport {
  id: string;
  exerciseId: string;
  profileId: string;
  kind: 'ambiguous' | 'wrong-answer' | 'typo' | 'too-hard' | 'duplicate' | 'other';
  note: string;
  dateKey: string;
  createdAt: number;
  status: 'open' | 'acknowledged' | 'fixed' | 'rejected';
}

export interface AIUsageRecord {
  id: string;
  profileId: string;
  task: string;
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: number;
  latencyMs: number;
  inputChars: number;
  outputChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  status: 'ok' | 'error' | 'rejected' | 'degraded';
  /** 只保存错误类别与可公开的描述，不保存用户隐私正文。 */
  errorCode: string | null;
  errorMessage: string | null;
}

export interface AIAnalysisRecord {
  id: string;
  profileId: string;
  /** 关联对象：题目作答或思考日志。 */
  subjectKind: 'attempt' | 'journal' | 'material' | 'profile';
  subjectId: string | null;
  task: string;
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: number;
  /** 结构化结果本身（不含模型原始自由文本以外的隐私）。 */
  result: unknown;
  uncertainty: string;
  /** 用户是否同意保留本次输入的全文摘要。 */
  retainedInputSummary: string | null;
}

export interface SyncStateRecord {
  profileId: string;
  /** 本地数据的单调递增修订号。 */
  localRevision: number;
  lastSyncedAt: number | null;
  lastSyncedRevision: number;
  pendingOps: number;
  conflicts: number;
  mode: 'local' | 'cloud';
  updatedAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}
