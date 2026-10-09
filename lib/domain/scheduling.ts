import type { GradeOutcome } from '@/lib/domain/grading';
import type { LogicErrorType } from '@/lib/domain/taxonomy';
import { addDays, type DateKey } from '@/lib/domain/time';

/**
 * LD-SRS：以 SM-2 为骨架，针对“每天 5～15 分钟的短题练习”做了三点收敛：
 * 1. 上限 45 天，避免复习队列长期空转；
 * 2. 答错当天追加一次重学（sameDayRelearn），因为错题的同日再练对短题最有效；
 * 3. 难题的成功给予更短的间隔（难度越大记忆越不牢），不直接改等级分值。
 */

export const SRS_LIMITS = {
  minIntervalDays: 1,
  maxIntervalDays: 45,
  minEase: 1.8,
  maxEase: 2.8,
  defaultEase: 2.5,
  sameDayRelearnMinutes: 30,
  leechLapses: 3,
} as const;

export interface ReviewState {
  exerciseId: string;
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  /** 下一次到期日；null 表示当前不在复习队列中。 */
  dueDateKey: DateKey | null;
  /** 需要在当天稍晚再练一次。 */
  sameDayRelearn: boolean;
  sameDayRelearnAfterTs: number | null;
  /** 反复答错，建议先读解析再做同类题。 */
  leech: boolean;
  lastOutcome: GradeOutcome | null;
  lastConfidence: number | null;
  lastErrorTypes: LogicErrorType[];
  updatedAt: number;
}

export interface ScheduleInput {
  exerciseId: string;
  outcome: GradeOutcome;
  confidence: number;
  timeSpentSeconds: number;
  estimatedSeconds: number;
  difficulty: number;
  /** 开放题的自评等级 0～4。 */
  selfAssessmentScore?: number;
  todayKey: DateKey;
  nowTs: number;
}

export function reviewQuality(input: {
  outcome: GradeOutcome;
  confidence: number;
  timeSpentSeconds: number;
  estimatedSeconds: number;
  selfAssessmentScore?: number;
}): number {
  let q: number;
  switch (input.outcome) {
    case 'correct':
      q = 4;
      break;
    case 'partial':
      q = 3;
      break;
    case 'incorrect':
      q = 1;
      break;
    case 'self-assessed': {
      const score = Math.max(0, Math.min(4, Math.round(input.selfAssessmentScore ?? 2)));
      q = score + 1;
      break;
    }
  }

  const timeRatio =
    input.estimatedSeconds > 0 ? input.timeSpentSeconds / input.estimatedSeconds : 1;

  if (input.outcome === 'correct') {
    // 又快又确信才算“牢固”，否则只是勉强答对。
    if (input.confidence >= 4 && timeRatio <= 1.2) q += 1;
  }
  if (input.confidence <= 2) q -= 1;

  return Math.max(0, Math.min(5, Math.round(q)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function difficultyMultiplier(difficulty: number): number {
  return clamp(1 - (difficulty - 3) * 0.08, 0.7, 1.3);
}

export function createReviewState(exerciseId: string, nowTs: number): ReviewState {
  return {
    exerciseId,
    ease: SRS_LIMITS.defaultEase,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    dueDateKey: null,
    sameDayRelearn: false,
    sameDayRelearnAfterTs: null,
    leech: false,
    lastOutcome: null,
    lastConfidence: null,
    lastErrorTypes: [],
    updatedAt: nowTs,
  };
}

export function scheduleNext(prev: ReviewState | null, input: ScheduleInput): ReviewState {
  const base = prev ?? createReviewState(input.exerciseId, input.nowTs);
  const q = reviewQuality(input);
  const diffMult = difficultyMultiplier(input.difficulty);

  if (q >= 3) {
    const repetitions = base.repetitions + 1;
    const easeGain = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
    const ease = clamp(base.ease + easeGain, SRS_LIMITS.minEase, SRS_LIMITS.maxEase);

    let intervalDays: number;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = Math.round(3 * diffMult * 2) / 2 || 1;
    else intervalDays = Math.round(base.intervalDays * ease * diffMult);

    intervalDays = clamp(
      Math.max(1, Math.round(intervalDays)),
      SRS_LIMITS.minIntervalDays,
      SRS_LIMITS.maxIntervalDays,
    );

    return {
      ...base,
      ease,
      intervalDays,
      repetitions,
      dueDateKey: addDays(input.todayKey, intervalDays),
      sameDayRelearn: false,
      sameDayRelearnAfterTs: null,
      lastOutcome: input.outcome,
      lastConfidence: input.confidence,
      lastErrorTypes: base.lastErrorTypes,
      updatedAt: input.nowTs,
    };
  }

  const lapses = base.lapses + 1;
  return {
    ...base,
    ease: clamp(base.ease - 0.2, SRS_LIMITS.minEase, SRS_LIMITS.maxEase),
    intervalDays: SRS_LIMITS.minIntervalDays,
    repetitions: 0,
    lapses,
    dueDateKey: addDays(input.todayKey, 1),
    sameDayRelearn: true,
    sameDayRelearnAfterTs: input.nowTs + SRS_LIMITS.sameDayRelearnMinutes * 60_000,
    leech: lapses >= SRS_LIMITS.leechLapses,
    lastOutcome: input.outcome,
    lastConfidence: input.confidence,
    lastErrorTypes: base.lastErrorTypes,
    updatedAt: input.nowTs,
  };
}

export function isDueForReview(state: ReviewState, todayKey: DateKey, nowTs: number): boolean {
  if (state.dueDateKey === null) return false;
  if (state.dueDateKey > todayKey) {
    // 次日到期，但当天重学时间已到：同日再练优先。
    return (
      state.sameDayRelearn &&
      state.sameDayRelearnAfterTs !== null &&
      nowTs >= state.sameDayRelearnAfterTs
    );
  }
  return true;
}

/** 复习优先级：逾期天数 > 反复次数 > 新加入的错题。 */
export function reviewPriority(
  state: ReviewState,
  todayKey: DateKey,
  nowTs: number,
): number {
  const overdue = state.dueDateKey ? daysOverdue(state.dueDateKey, todayKey) : 0;
  let priority = overdue * 10 + state.lapses * 4 + (state.repetitions === 0 ? 3 : 0);
  if (isDueForReview(state, todayKey, nowTs) && state.sameDayRelearn) priority += 25;
  if (state.leech) priority += 6;
  return priority;
}

export function daysOverdue(dueDateKey: DateKey, todayKey: DateKey): number {
  let count = 0;
  let cursor = dueDateKey;
  while (cursor < todayKey && count < 3650) {
    cursor = addDays(cursor, 1);
    count += 1;
  }
  return count;
}

/** 供界面解释调度结果使用。 */
export function describeSchedule(state: ReviewState): string {
  if (state.dueDateKey === null) return '当前不在复习队列中。';
  if (state.repetitions === 0 && state.lapses > 0) {
    return `上次答错，明天再练一次；如果当天还有一次练习机会，会在约 ${SRS_LIMITS.sameDayRelearnMinutes} 分钟后重复出现。`;
  }
  return `已连续 ${state.repetitions} 次记牢，间隔系数 ${state.ease.toFixed(2)}，下次复习安排在 ${state.dueDateKey}（间隔 ${state.intervalDays} 天）。`;
}
