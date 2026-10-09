import { gradeExercise, type AnswerInput, type GradeOutcome, type GradeResult } from '@/lib/domain/grading';
import { classifyMistake, type SelfReport } from '@/lib/domain/mistake';
import { scheduleNext, type ReviewState } from '@/lib/domain/scheduling';
import { updateKnowledgeState, type KnowledgeState } from '@/lib/domain/mastery';
import { generateDailyPlan, planToRecord, type DailyPlanDraft } from '@/lib/domain/daily-plan';
import type { Exercise } from '@/lib/domain/exercise-schema';
import type { AttemptRecord, DailyPlanRecord, DailyProgressRecord, ExerciseIssueReport } from '@/lib/domain/records';
import { toCard } from '@/lib/domain/catalog';
import type { CauseType, LogicErrorType } from '@/lib/domain/taxonomy';
import { addDays, diffDays, todayKey as defaultTodayKey } from '@/lib/domain/time';
import type { AppSettings } from '@/lib/domain/settings';
import type { DataStore } from '@/lib/db/store';

export interface SubmitAttemptInput {
  profileId: string;
  exerciseId: string;
  answer: AnswerInput;
  reasoning: string;
  confidence: number;
  timeSpentSeconds: number;
  selfReport: SelfReport;
  planItemId: string | null;
  isReview: boolean;
  dateKey: string;
  nowTs: number;
}

export interface SubmitAttemptResult {
  attempt: AttemptRecord;
  grade: GradeResult;
  classification: ReturnType<typeof classifyMistake>;
  review: ReviewState;
  knowledgeStates: KnowledgeState[];
  progress: DailyProgressRecord | null;
  exercise: Exercise;
}

/**
 * 一次提交的全部后续影响都在这里完成：判分 → 归因 → 复习调度 → 掌握度 → 进度 → 题目复核。
 * 放在服务层是为了让界面只负责收集输入，判分与统计口径保持单一来源。
 */
export async function submitAttempt(store: DataStore, input: SubmitAttemptInput): Promise<SubmitAttemptResult> {
  const exercise = await store.getExercise(input.exerciseId);
  if (!exercise) throw new Error(`题目 ${input.exerciseId} 不存在，可能需要重新加载题库。`);

  const grade = gradeExercise(exercise, input.answer);
  const recent = await store.listAttempts({
    profileId: input.profileId,
    fromKey: addDays(input.dateKey, -30),
    toKey: input.dateKey,
  });

  const priorErrorCounts: Partial<Record<LogicErrorType, number>> = {};
  for (const attempt of recent) {
    for (const type of attempt.errorTypes) priorErrorCounts[type] = (priorErrorCounts[type] ?? 0) + 1;
  }

  const classification = classifyMistake({
    exercise,
    grade,
    outcome: grade.outcome,
    timeSpentSeconds: input.timeSpentSeconds,
    confidence: input.confidence,
    selfReport: input.selfReport,
    priorErrorCounts,
  });

  const attempt: AttemptRecord = {
    id: `atp-${input.nowTs.toString(36)}-${input.exerciseId}`,
    profileId: input.profileId,
    exerciseId: exercise.id,
    exerciseVersion: exercise.version,
    dateKey: input.dateKey,
    createdAt: input.nowTs,
    answer: input.answer,
    outcome: grade.outcome,
    score: grade.score,
    timeSpentSeconds: input.timeSpentSeconds,
    confidence: input.confidence,
    reasoning: input.reasoning,
    selfReport: input.selfReport,
    errorTypes: classification.errorTypes,
    cause: classification.cause as CauseType,
    planItemId: input.planItemId,
    isReview: input.isReview,
    flaggedForReview: classification.flagForReview,
    aiAnalysisId: null,
  };

  await store.addAttempt(attempt);

  const priorReview = await store.getReviewState(input.profileId, exercise.id);
  const review = scheduleNext(priorReview ?? null, {
    exerciseId: exercise.id,
    outcome: grade.outcome,
    confidence: input.confidence,
    timeSpentSeconds: input.timeSpentSeconds,
    estimatedSeconds: exercise.estimatedSeconds,
    difficulty: exercise.difficulty,
    selfAssessmentScore: grade.outcome === 'self-assessed' ? Math.round(grade.score * 4) : undefined,
    todayKey: input.dateKey,
    nowTs: input.nowTs,
  });
  review.lastErrorTypes = classification.errorTypes;
  await store.putReviewState(input.profileId, review);

  const updatedKnowledgeStates: KnowledgeState[] = [];
  for (const knowledgePointId of exercise.knowledgePoints) {
    const prior = await store.getKnowledgeState(input.profileId, knowledgePointId);
    const next = updateKnowledgeState(prior ?? null, {
      knowledgePointId,
      outcome: grade.outcome,
      difficulty: exercise.difficulty,
      confidence: input.confidence,
      errorTypes: classification.errorTypes,
      todayKey: input.dateKey,
      nowTs: input.nowTs,
      selfAssessmentScore: grade.outcome === 'self-assessed' ? Math.round(grade.score * 4) : undefined,
    });
    await store.putKnowledgeState(input.profileId, next);
    updatedKnowledgeStates.push(next);
  }

  let progress: DailyProgressRecord | null = null;
  if (input.planItemId) {
    progress = await markPlanItemDone(store, input.profileId, input.dateKey, input.planItemId, input.timeSpentSeconds, input.nowTs);
  }

  if (classification.flagForReview) {
    const issue: ExerciseIssueReport = {
      id: `issue-${input.nowTs.toString(36)}-${exercise.id}`,
      exerciseId: exercise.id,
      profileId: input.profileId,
      kind: 'ambiguous',
      note: '用户在作答后标记该题表述存在歧义。',
      dateKey: input.dateKey,
      createdAt: input.nowTs,
      status: 'open',
    };
    await store.reportIssue(issue);
  }

  return { attempt, grade, classification, review, knowledgeStates: updatedKnowledgeStates, progress, exercise };
}

export async function markPlanItemDone(
  store: DataStore,
  profileId: string,
  dateKey: string,
  itemId: string,
  seconds: number,
  nowTs: number,
): Promise<DailyProgressRecord> {
  const existing = await store.getProgress(profileId, dateKey);
  const progress: DailyProgressRecord = existing ?? {
    dateKey,
    profileId,
    planId: null,
    completedItemIds: [],
    skippedItemIds: [],
    totalSeconds: 0,
    attempts: 0,
    updatedAt: nowTs,
  };
  const completed = new Set(progress.completedItemIds);
  completed.add(itemId);
  const record: DailyProgressRecord = {
    ...progress,
    completedItemIds: [...completed],
    totalSeconds: progress.totalSeconds + seconds,
    attempts: progress.attempts + 1,
    updatedAt: nowTs,
  };
  await store.saveProgress(record);
  return record;
}

export async function markJournalItemDone(
  store: DataStore,
  profileId: string,
  dateKey: string,
  itemId: string,
  seconds: number,
  nowTs: number,
): Promise<DailyProgressRecord> {
  const existing = await store.getProgress(profileId, dateKey);
  const base: DailyProgressRecord = existing ?? {
    dateKey,
    profileId,
    planId: null,
    completedItemIds: [],
    skippedItemIds: [],
    totalSeconds: 0,
    attempts: 0,
    updatedAt: nowTs,
  };
  const completed = new Set(base.completedItemIds);
  completed.add(itemId);
  const record: DailyProgressRecord = {
    ...base,
    completedItemIds: [...completed],
    totalSeconds: base.totalSeconds + seconds,
    updatedAt: nowTs,
  };
  await store.saveProgress(record);
  return record;
}

export interface PlanBundle {
  plan: DailyPlanRecord;
  draft: DailyPlanDraft;
  regenerated: boolean;
}

/**
 * 每天第一次进入时生成计划并持久化；同一天再次进入使用同一份计划，
 * 这样“为什么今天给我这些题”在事后仍可解释。
 */
export async function ensureTodayPlan(
  store: DataStore,
  options: { profileId: string; settings: AppSettings; dateKey: string; nowTs: number; timezone?: string },
): Promise<PlanBundle> {
  const { profileId, settings, dateKey, nowTs } = options;
  const stored = await store.getPlan(profileId, dateKey);
  if (stored) return { plan: stored, draft: draftFromRecord(stored), regenerated: false };

  const exercises = await store.listExercises({ status: 'validated' });
  const catalog = exercises.map(toCard);
  const reviewStates = await store.listReviewStates(profileId);
  const knowledgeStates = await store.listKnowledgeStates(profileId);
  const attempts = await store.listAttempts({ profileId, fromKey: addDays(dateKey, -60), toKey: dateKey });
  const journals = await store.listJournals({ profileId });
  const dueJournals = journals
    .filter((j) => j.reviewDueDateKey !== null && j.reviewDueDateKey <= dateKey && !j.deleted)
    .map((j) => ({ id: j.id, title: j.title }));

  const draft = generateDailyPlan({
    dateKey,
    nowTs,
    profileId,
    settings,
    catalog,
    reviewStates,
    knowledgeStates,
    attempts,
    dueJournals,
  });
  const plan = planToRecord(draft);
  // 题库尚未就绪时不落库，否则空计划会被缓存一整天。
  if (catalog.length > 0) await store.savePlan(plan);
  const existing = await store.getProgress(profileId, dateKey);
  if (!existing) {
    await store.saveProgress({
      dateKey,
      profileId,
      planId: plan.id,
      completedItemIds: [],
      skippedItemIds: [],
      totalSeconds: 0,
      attempts: 0,
      updatedAt: nowTs,
    });
  }
  return { plan, draft, regenerated: true };
}

function draftFromRecord(plan: DailyPlanRecord): DailyPlanDraft {
  return {
    dateKey: plan.dateKey,
    profileId: plan.profileId,
    budgetMinutes: plan.budgetMinutes,
    restDay: plan.restDay,
    items: plan.items,
    notes: plan.notes,
    generatedAt: plan.generatedAt,
    algorithm: plan.algorithm,
  };
}

export interface DueReviewItem {
  exercise: Exercise;
  state: ReviewState;
  overdueDays: number;
}

export async function listDueReviews(
  store: DataStore,
  profileId: string,
  dateKey: string,
  nowTs: number,
): Promise<DueReviewItem[]> {
  const states = await store.listReviewStates(profileId);
  const out: DueReviewItem[] = [];
  for (const state of states) {
    if (!state.dueDateKey || state.dueDateKey > dateKey) {
      if (!(state.sameDayRelearn && state.sameDayRelearnAfterTs !== null && nowTs >= state.sameDayRelearnAfterTs)) {
        continue;
      }
    }
    const exercise = await store.getExercise(state.exerciseId);
    if (!exercise || exercise.status === 'retired') continue;
    out.push({
      exercise,
      state,
      overdueDays: state.dueDateKey ? Math.max(0, diffDays(state.dueDateKey, dateKey)) : 0,
    });
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays);
}

export function outcomeLabel(outcome: GradeOutcome): string {
  switch (outcome) {
    case 'correct':
      return '答对';
    case 'partial':
      return '部分正确';
    case 'incorrect':
      return '未答对';
    case 'self-assessed':
      return '已自评';
  }
}

export function resolveTodayKey(settings: AppSettings, at: Date = new Date()): string {
  return defaultTodayKey(at, settings.timezone || undefined);
}

export interface SelfReportRevision {
  attempt: AttemptRecord;
  classification: ReturnType<typeof classifyMistake>;
}

/**
 * 用户在看完解析后修正“自己为什么错”。只重写归因与题目标记，
 * 不改动得分与复习调度——避免用户通过改口操纵间隔。
 */
export async function reviseSelfReport(
  store: DataStore,
  options: { profileId: string; attemptId: string; selfReport: SelfReport; nowTs: number },
): Promise<SelfReportRevision | null> {
  const attempts = await store.listAttempts({ profileId: options.profileId });
  const attempt = attempts.find((a) => a.id === options.attemptId);
  if (!attempt) return null;

  const exercise = await store.getExercise(attempt.exerciseId);
  if (!exercise) return null;

  const grade = gradeExercise(exercise, attempt.answer);
  const priorErrorCounts: Partial<Record<LogicErrorType, number>> = {};
  for (const other of attempts) {
    if (other.id === attempt.id) continue;
    for (const type of other.errorTypes) priorErrorCounts[type] = (priorErrorCounts[type] ?? 0) + 1;
  }

  const classification = classifyMistake({
    exercise,
    grade,
    outcome: grade.outcome,
    timeSpentSeconds: attempt.timeSpentSeconds,
    confidence: attempt.confidence,
    selfReport: options.selfReport,
    priorErrorCounts,
  });

  const revised: AttemptRecord = {
    ...attempt,
    selfReport: options.selfReport,
    cause: classification.cause as CauseType,
    errorTypes: classification.errorTypes,
    flaggedForReview: classification.flagForReview,
  };
  await store.addAttempt(revised);

  if (classification.flagForReview) {
    const issues = await store.listIssues();
    const already = issues.some(
      (i) => i.exerciseId === exercise.id && i.profileId === options.profileId && i.kind === 'ambiguous' && i.status === 'open',
    );
    if (!already) {
      await store.reportIssue({
        id: `issue-${options.nowTs.toString(36)}-${exercise.id}`,
        exerciseId: exercise.id,
        profileId: options.profileId,
        kind: 'ambiguous',
        note: '用户在查看解析后标记该题表述存在歧义。',
        dateKey: attempt.dateKey,
        createdAt: options.nowTs,
        status: 'open',
      });
    }
  }

  return { attempt: revised, classification };
}

export async function skipPlanItem(
  store: DataStore,
  profileId: string,
  dateKey: string,
  itemId: string,
  nowTs: number,
): Promise<DailyProgressRecord> {
  const existing = await store.getProgress(profileId, dateKey);
  const base: DailyProgressRecord = existing ?? {
    dateKey,
    profileId,
    planId: null,
    completedItemIds: [],
    skippedItemIds: [],
    totalSeconds: 0,
    attempts: 0,
    updatedAt: nowTs,
  };
  const skipped = new Set(base.skippedItemIds);
  skipped.add(itemId);
  const record: DailyProgressRecord = { ...base, skippedItemIds: [...skipped], updatedAt: nowTs };
  await store.saveProgress(record);
  return record;
}

export async function completeNonExerciseItem(
  store: DataStore,
  profileId: string,
  dateKey: string,
  itemId: string,
  seconds: number,
  nowTs: number,
): Promise<DailyProgressRecord> {
  return markJournalItemDone(store, profileId, dateKey, itemId, seconds, nowTs);
}
