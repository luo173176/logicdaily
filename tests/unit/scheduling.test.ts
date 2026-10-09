import { describe, expect, it } from 'vitest';

import {
  createReviewState,
  describeSchedule,
  isDueForReview,
  reviewPriority,
  reviewQuality,
  scheduleNext,
  SRS_LIMITS,
} from '@/lib/domain/scheduling';
import { addDays } from '@/lib/domain/time';

const TODAY = '2026-03-15';
const NOW = Date.UTC(2026, 2, 15, 4, 0, 0);

function input(overrides: Partial<Parameters<typeof scheduleNext>[1]> = {}) {
  return {
    exerciseId: 'ex-1',
    outcome: 'correct' as const,
    confidence: 4,
    timeSpentSeconds: 40,
    estimatedSeconds: 60,
    difficulty: 3,
    todayKey: TODAY,
    nowTs: NOW,
    ...overrides,
  };
}

describe('reviewQuality', () => {
  it('答对且高信心且不过慢记为 5', () => {
    expect(reviewQuality({ outcome: 'correct', confidence: 5, timeSpentSeconds: 30, estimatedSeconds: 60 })).toBe(5);
  });

  it('答对但低信心降为 3', () => {
    expect(reviewQuality({ outcome: 'correct', confidence: 2, timeSpentSeconds: 50, estimatedSeconds: 60 })).toBe(3);
  });

  it('部分正确记为 3（仍可维持间隔）', () => {
    expect(reviewQuality({ outcome: 'partial', confidence: 3, timeSpentSeconds: 60, estimatedSeconds: 60 })).toBe(3);
  });

  it('答错记为 1', () => {
    expect(reviewQuality({ outcome: 'incorrect', confidence: 3, timeSpentSeconds: 60, estimatedSeconds: 60 })).toBe(1);
  });

  it('开放题自评映射到 1..5', () => {
    expect(reviewQuality({ outcome: 'self-assessed', confidence: 3, timeSpentSeconds: 60, estimatedSeconds: 60, selfAssessmentScore: 4 })).toBe(5);
    expect(reviewQuality({ outcome: 'self-assessed', confidence: 3, timeSpentSeconds: 60, estimatedSeconds: 60, selfAssessmentScore: 0 })).toBe(1);
  });
});

describe('scheduleNext 成功路径', () => {
  it('第一次成功间隔 1 天', () => {
    const state = scheduleNext(null, input());
    expect(state.repetitions).toBe(1);
    expect(state.intervalDays).toBe(1);
    expect(state.dueDateKey).toBe(addDays(TODAY, 1));
  });

  it('连续成功时间隔按易度递增', () => {
    let state = scheduleNext(null, input());
    state = scheduleNext(state, input());
    const third = scheduleNext(state, input());
    expect(third.intervalDays).toBeGreaterThan(state.intervalDays);
    expect(third.ease).toBeLessThanOrEqual(SRS_LIMITS.maxEase);
  });

  it('间隔不会超过上限', () => {
    let state = scheduleNext(null, input({ confidence: 5, timeSpentSeconds: 10 }));
    for (let i = 0; i < 12; i += 1) {
      state = scheduleNext(state, input({ confidence: 5, timeSpentSeconds: 10 }));
    }
    expect(state.intervalDays).toBeLessThanOrEqual(SRS_LIMITS.maxIntervalDays);
  });

  it('难题的成功给出更短间隔', () => {
    let easy = scheduleNext(null, input({ difficulty: 1 }));
    let hard = scheduleNext(null, input({ difficulty: 5 }));
    easy = scheduleNext(easy, input({ difficulty: 1 }));
    hard = scheduleNext(hard, input({ difficulty: 5 }));
    expect(hard.intervalDays).toBeLessThanOrEqual(easy.intervalDays);
  });
});

describe('scheduleNext 失败路径', () => {
  it('答错重置重复次数并安排次日复习', () => {
    const good = scheduleNext(scheduleNext(null, input()), input());
    const lapsed = scheduleNext(good, input({ outcome: 'incorrect', confidence: 3 }));
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.sameDayRelearn).toBe(true);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.dueDateKey).toBe(addDays(TODAY, 1));
  });

  it('当天重学在 30 分钟后才到期', () => {
    const lapsed = scheduleNext(null, input({ outcome: 'incorrect' }));
    expect(isDueForReview(lapsed, TODAY, NOW + 20 * 60_000)).toBe(false);
    expect(isDueForReview(lapsed, TODAY, NOW + 31 * 60_000)).toBe(true);
  });

  it('累计 3 次答错标记为难题（leech）', () => {
    let state = scheduleNext(null, input({ outcome: 'incorrect' }));
    state = scheduleNext(state, input({ outcome: 'incorrect' }));
    state = scheduleNext(state, input({ outcome: 'incorrect' }));
    expect(state.leech).toBe(true);
    expect(state.lapses).toBe(SRS_LIMITS.leechLapses);
  });

  it('易度不会低于下限', () => {
    let state = scheduleNext(null, input());
    for (let i = 0; i < 6; i += 1) state = scheduleNext(state, input({ outcome: 'incorrect' }));
    expect(state.ease).toBeGreaterThanOrEqual(SRS_LIMITS.minEase);
  });
});

describe('到期与优先级', () => {
  it('未过期不到期', () => {
    const state = scheduleNext(null, input());
    expect(isDueForReview(state, TODAY, NOW)).toBe(false);
    expect(isDueForReview(state, addDays(TODAY, 1), NOW)).toBe(true);
  });

  it('逾期越久优先级越高', () => {
    const state = { ...createReviewState('ex-1', NOW), dueDateKey: addDays(TODAY, -5), repetitions: 1, intervalDays: 3 };
    const fresh = { ...state, dueDateKey: TODAY };
    expect(reviewPriority(state, TODAY, NOW)).toBeGreaterThan(reviewPriority(fresh, TODAY, NOW));
  });

  it('当天重学优先级高于普通到期', () => {
    const relearn = scheduleNext(null, input({ outcome: 'incorrect' }));
    const normal = { ...createReviewState('ex-2', NOW), dueDateKey: TODAY, repetitions: 2, intervalDays: 6 };
    expect(reviewPriority(relearn, TODAY, NOW + 31 * 60_000)).toBeGreaterThan(reviewPriority(normal, TODAY, NOW));
  });

  it('describeSchedule 对空队列与新错题给出不同说明', () => {
    expect(describeSchedule(createReviewState('x', NOW))).toContain('不在复习队列');
    const lapsed = scheduleNext(null, input({ outcome: 'incorrect' }));
    expect(describeSchedule(lapsed)).toContain('明天再练一次');
  });
});
