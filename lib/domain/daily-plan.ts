import type { ExerciseCard } from '@/lib/domain/catalog';
import { activityForExercise } from '@/lib/domain/catalog';
import type { DailyPlanRecord, AttemptRecord } from '@/lib/domain/records';
import { type ActivityType, type LogicErrorType } from '@/lib/domain/taxonomy';
import type { AppSettings } from '@/lib/domain/settings';
import { reviewPriority, isDueForReview, type ReviewState } from '@/lib/domain/scheduling';
import { weaknessScore, type KnowledgeState } from '@/lib/domain/mastery';
import { addDays, diffDays, startOfWeekKey, todayKey, type DateKey } from '@/lib/domain/time';

export const DAILY_PLAN_ALGORITHM = 'logicdaily-daily-plan-v1';

export interface PlannedItem {
  id: string;
  activity: ActivityType;
  exerciseId: string | null;
  journalId: string | null;
  estimatedSeconds: number;
  reason: string;
  kind: 'new' | 'review' | 'same-day-relearn' | 'journal';
  required: boolean;
}

export interface DailyPlanDraft {
  dateKey: DateKey;
  profileId: string;
  budgetMinutes: number;
  restDay: boolean;
  items: PlannedItem[];
  notes: string[];
  generatedAt: number;
  algorithm: string;
}

export interface PlanContext {
  /** 由调用方传入，保证函数本身不读取系统时间。 */
  dateKey: DateKey;
  nowTs: number;
  profileId: string;
  settings: AppSettings;
  catalog: ExerciseCard[];
  reviewStates: ReviewState[];
  knowledgeStates: KnowledgeState[];
  attempts: AttemptRecord[];
  dueJournals: { id: string; title: string }[];
}

const REVIEW_SECONDS = 50;
const JOURNAL_SECONDS = 180;
const RECENT_AVOID_DAYS = 21;

export function generateDailyPlan(ctx: PlanContext): DailyPlanDraft {
  const weekday = weekdayOf(ctx.dateKey);
  const restDay = ctx.settings.restWeekdays.includes(weekday);
  const budgetMinutes = restDay ? Math.max(3, Math.round(ctx.settings.dailyBudgetMinutes * 0.4)) : ctx.settings.dailyBudgetMinutes;
  const budgetSeconds = budgetMinutes * 60;

  const notes: string[] = [];
  const items: PlannedItem[] = [];
  let usedSeconds = 0;

  const attemptedByExercise = groupAttempts(ctx.attempts);
  const recentSeen = recentSeenExerciseIds(ctx.attempts, ctx.dateKey);

  // 1. 当天需要重学的错题优先，它们通常来自 30 分钟前的那一次答错。
  const sameDay = ctx.reviewStates
    .filter((s) => s.sameDayRelearn && isDueForReview(s, ctx.dateKey, ctx.nowTs))
    .sort((a, b) => (b.sameDayRelearnAfterTs ?? 0) - (a.sameDayRelearnAfterTs ?? 0));
  for (const state of sameDay) {
    if (usedSeconds + REVIEW_SECONDS > budgetSeconds) break;
    const card = ctx.catalog.find((c) => c.id === state.exerciseId);
    if (!card) continue;
    usedSeconds += REVIEW_SECONDS;
    items.push({
      id: `item-${items.length + 1}`,
      activity: 'error-review',
      exerciseId: card.id,
      journalId: null,
      estimatedSeconds: REVIEW_SECONDS,
      reason: '上次答错，安排当天再看一次，重点读解析里标出的推理步骤。',
      kind: 'same-day-relearn',
      required: true,
    });
  }
  if (sameDay.length > 0) notes.push(`包含 ${sameDay.length} 项当天重学（答错后约 30 分钟重复）。`);

  // 2. 到期复习，按逾期天数与反复次数排序。
  const dueReviews = ctx.reviewStates
    .filter((s) => !s.sameDayRelearn && isDueForReview(s, ctx.dateKey, ctx.nowTs))
    .map((s) => ({ state: s, priority: reviewPriority(s, ctx.dateKey, ctx.nowTs) }))
    .filter(({ state, priority }) => {
      const card = ctx.catalog.find((c) => c.id === state.exerciseId);
      return Boolean(card) && priority > 0 && !items.some((i) => i.exerciseId === state.exerciseId);
    })
    .sort((a, b) => b.priority - a.priority);

  const reviewShare = 1 - clamp(ctx.settings.newToReviewRatio, 0, 1);
  const reviewBudgetSeconds = Math.max(0, budgetSeconds * reviewShare - usedSeconds);
  let reviewUsed = 0;
  for (const { state } of dueReviews) {
    if (reviewUsed + REVIEW_SECONDS > reviewBudgetSeconds) break;
    const card = ctx.catalog.find((c) => c.id === state.exerciseId)!;
    const overdue = state.dueDateKey ? Math.max(0, diffDays(state.dueDateKey, ctx.dateKey)) : 0;
    reviewUsed += REVIEW_SECONDS;
    usedSeconds += REVIEW_SECONDS;
    items.push({
      id: `item-${items.length + 1}`,
      activity: 'error-review',
      exerciseId: card.id,
      journalId: null,
      estimatedSeconds: REVIEW_SECONDS,
      reason: overdue > 0 ? `已逾期 ${overdue} 天需要复习（累计答错 ${state.lapses} 次）。` : `按计划复习（当前间隔 ${state.intervalDays} 天）。`,
      kind: 'review',
      required: false,
    });
  }
  if (reviewUsed > 0) notes.push(`复习占用 ${Math.round(reviewUsed / 60)} 分钟。`);

  // 3. 到期复盘的思考日志：现实结果与判断的差距，是训练的真正落点。
  for (const journal of ctx.dueJournals.slice(0, 2)) {
    if (usedSeconds + 90 > budgetSeconds) break;
    usedSeconds += 90;
    items.push({
      id: `item-${items.length + 1}`,
      activity: 'real-problem-decomposition',
      exerciseId: null,
      journalId: journal.id,
      estimatedSeconds: 90,
      reason: `《${journal.title}》到了复盘时间：对比当初的预测与实际结果。`,
      kind: 'journal',
      required: false,
    });
  }

  // 4. 新题：在剩余时间里按薄弱项、难度适配、类别多样性挑选。
  const newBudgetSeconds = Math.max(0, budgetSeconds - usedSeconds);
  const targetDifficulty = pickTargetDifficulty(ctx, attemptedByExercise);
  const weakWeight = weakPointWeights(ctx.knowledgeStates);
  const recentErrorTypes = repeatedErrorTypes(ctx.attempts);
  const rng = makeRng(`${ctx.profileId}|${ctx.dateKey}`);
  const usedCategories = new Set(items.map((i) => categoryOf(ctx.catalog, i.exerciseId)));

  const pool = ctx.catalog.filter((card) => card.status === 'validated' && !recentSeen.has(card.id));
  const preferred = ctx.settings.preferredCategories;
  const scoped = preferred.length > 0 ? pool.filter((c) => preferred.includes(c.category)) : pool;
  const candidates = scoped.length > 0 ? scoped : pool;

  const scored = candidates.map((card) => {
    const knowledgeBonus = card.knowledgePoints.reduce((s, id) => s + (weakWeight.get(id) ?? 0), 0);
    const difficultyFit = 1 / (1 + Math.abs(card.difficulty - targetDifficulty));
    const categoryPenalty = usedCategories.has(card.category) ? 0.3 : 1;
    const errorFit = card.reviewTags.some((t) => recentErrorTypes.has(t)) ? 1.3 : 1;
    const jitter = 0.85 + rng() * 0.3;
    return { card, weight: (0.4 + knowledgeBonus) * difficultyFit * categoryPenalty * errorFit * jitter };
  });

  const ordered = scored.sort((a, b) => b.weight - a.weight);
  let newUsed = 0;
  for (const { card } of ordered) {
    const seconds = Math.min(card.estimatedSeconds, REVIEW_SECONDS * 2);
    if (newUsed + seconds > newBudgetSeconds) continue;
    newUsed += seconds;
    usedSeconds += seconds;
    usedCategories.add(card.category);
    items.push({
      id: `item-${items.length + 1}`,
      activity: activityForExercise(card),
      exerciseId: card.id,
      journalId: null,
      estimatedSeconds: seconds,
      reason: describeNewReason(card, weakWeight, targetDifficulty),
      kind: 'new',
      required: false,
    });
  }
  notes.push(`新题目标难度 ${targetDifficulty}（依据近 10 次作答表现与难度偏好 ${ctx.settings.difficultyBias.toFixed(2)}）。`);

  // 5. 思考日志入口：即使时间紧张也保留一个轻量选项，它是本产品的核心差异化环节。
  if (ctx.settings.journalDailyReminder && items.length > 0) {
    const hasJournalItem = items.some((i) => i.journalId !== null);
    if (!hasJournalItem) {
      items.push({
        id: `item-${items.length + 1}`,
        activity: 'free-journal',
        exerciseId: null,
        journalId: null,
        estimatedSeconds: Math.min(JOURNAL_SECONDS, Math.max(60, budgetSeconds - usedSeconds)),
        reason: restDay ? '休息日只做一篇轻量记录：今天有什么判断值得回头看？' : '把今天工作、阅读或沟通中遇到的真实问题写成一篇思考日志。',
        kind: 'journal',
        required: false,
      });
    }
  }

  if (restDay) {
    notes.unshift('今天是你的休息日：任务量已减到最小，未完成的题目不会中断连续训练。');
  }
  if (usedSeconds < budgetSeconds * 0.4 && items.filter((i) => i.kind === 'new').length === 0) {
    notes.push('复习与新题都不足，题库可能已被你做完，或时间预算较小。');
  }

  return {
    dateKey: ctx.dateKey,
    profileId: ctx.profileId,
    budgetMinutes,
    restDay,
    items,
    notes,
    generatedAt: ctx.nowTs,
    algorithm: DAILY_PLAN_ALGORITHM,
  };
}

export function planToRecord(draft: DailyPlanDraft): DailyPlanRecord {
  return {
    id: `plan-${draft.profileId}-${draft.dateKey}`,
    profileId: draft.profileId,
    dateKey: draft.dateKey,
    budgetMinutes: draft.budgetMinutes,
    restDay: draft.restDay,
    items: draft.items.map((item) => ({ ...item, id: item.id })),
    notes: draft.notes,
    generatedAt: draft.generatedAt,
    algorithm: draft.algorithm,
  };
}

export function planEstimatedSeconds(items: PlannedItem[]): number {
  return items.reduce((s, i) => s + i.estimatedSeconds, 0);
}

export function planCompletion(
  plan: DailyPlanRecord | DailyPlanDraft,
  completedItemIds: string[],
): { done: number; total: number; percent: number; requiredMissing: string[] } {
  const items = plan.items as PlannedItem[] | DailyPlanRecord['items'];
  const total = items.length;
  const done = items.filter((i) => completedItemIds.includes(i.id)).length;
  const requiredMissing = items.filter((i) => i.required && !completedItemIds.includes(i.id)).map((i) => i.id);
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), requiredMissing };
}

/**
 * 连续训练天数：休息日与“昨天没练但今天练了”都不清零，只有连续 2 天以上缺席才中断。
 * 这是有意为之——避免因为一次中断产生惩罚性体验。
 */
export function trainingStreak(
  activeDateKeys: DateKey[],
  settings: AppSettings,
  reference: DateKey = todayKey(),
): { current: number; best: number; missedGraceUsed: boolean } {
  const active = new Set(activeDateKeys);
  let cursor = reference;
  if (!active.has(cursor)) cursor = addDays(cursor, -1);
  if (!active.has(cursor)) {
    return { current: 0, best: longestRun(activeDateKeys), missedGraceUsed: false };
  }

  let current = 0;
  let graceUsed = false;
  while (current < 3650) {
    if (active.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
      continue;
    }
    const isRest = settings.restWeekdays.includes(weekdayOf(cursor));
    if (isRest || !graceUsed) {
      graceUsed = graceUsed || !isRest;
      cursor = addDays(cursor, -1);
      continue;
    }
    break;
  }
  return { current, best: longestRun(activeDateKeys), missedGraceUsed: graceUsed };
}

export function weeklyActiveDays(activeDateKeys: DateKey[], reference: DateKey): { count: number; days: DateKey[] } {
  const weekStart = startOfWeekKey(reference);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const set = new Set(activeDateKeys);
  return { count: days.filter((d) => set.has(d)).length, days };
}

function weekdayOf(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function longestRun(keys: DateKey[]): number {
  const sorted = [...new Set(keys)].sort();
  let best = 0;
  let run = 0;
  let prev: DateKey | null = null;
  for (const key of sorted) {
    run = prev && diffDays(prev, key) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}

function groupAttempts(attempts: AttemptRecord[]): Map<string, AttemptRecord[]> {
  const map = new Map<string, AttemptRecord[]>();
  for (const a of attempts) {
    const list = map.get(a.exerciseId) ?? [];
    list.push(a);
    map.set(a.exerciseId, list);
  }
  return map;
}

function recentSeenExerciseIds(attempts: AttemptRecord[], dateKey: DateKey): Set<string> {
  const cutoff = addDays(dateKey, -RECENT_AVOID_DAYS);
  return new Set(attempts.filter((a) => a.dateKey >= cutoff).map((a) => a.exerciseId));
}

function pickTargetDifficulty(ctx: PlanContext, grouped: Map<string, AttemptRecord[]>): number {
  const recent = [...grouped.values()]
    .map((list) => list[list.length - 1])
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  const base = recent.length === 0 ? 0.5 : recent.reduce((s, a) => s + performanceValue(a), 0) / recent.length;
  const bias = ctx.settings.difficultyBias;
  return clamp(Math.round(1 + base * 2.6 + bias * 1.8), 1, 5);
}

function performanceValue(attempt: AttemptRecord): number {
  if (attempt.outcome === 'self-assessed') return 0.5 + attempt.score * 0.4;
  if (attempt.outcome === 'correct' && attempt.confidence >= 4) return 1;
  return attempt.score;
}

function weakPointWeights(states: KnowledgeState[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const state of states) map.set(state.knowledgePointId, weaknessScore(state));
  return map;
}

function repeatedErrorTypes(attempts: AttemptRecord[]): Set<string> {
  const counts = new Map<LogicErrorType, number>();
  const recentCut = addDays(attempts.length ? attempts[attempts.length - 1].dateKey : '1970-01-01', -30);
  for (const a of attempts) {
    if (a.dateKey < recentCut) continue;
    for (const t of a.errorTypes) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([t]) => t));
}

function categoryOf(catalog: ExerciseCard[], id: string | null) {
  if (!id) return null;
  return catalog.find((c) => c.id === id)?.category ?? null;
}

function describeNewReason(card: ExerciseCard, weakWeight: Map<string, number>, targetDifficulty: number): string {
  const weak = card.knowledgePoints
    .map((id) => ({ id, w: weakWeight.get(id) ?? 0 }))
    .filter((x) => x.w > 0.25)
    .sort((a, b) => b.w - a.w)[0];
  if (weak) return `新题：针对薄弱知识点练习，难度 ${card.difficulty}（目标 ${targetDifficulty}）。`;
  return `新题：难度 ${card.difficulty}（目标 ${targetDifficulty}），用于扩展${card.categoryLabel}的练习面。`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 计划必须可复现：同一 profile + 同一天得到同一套题，因此不使用 Math.random。 */
export function makeRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
