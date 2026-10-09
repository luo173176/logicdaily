import { describe, expect, it } from 'vitest';

import {
  generateDailyPlan,
  planCompletion,
  planToRecord,
  trainingStreak,
  weeklyActiveDays,
  makeRng,
  type PlanContext,
} from '@/lib/domain/daily-plan';
import type { ExerciseCard } from '@/lib/domain/catalog';
import { defaultSettings } from '@/lib/domain/settings';
import { createReviewState, scheduleNext } from '@/lib/domain/scheduling';
import { createKnowledgeState } from '@/lib/domain/mastery';
import type { AttemptRecord } from '@/lib/domain/records';
import { addDays } from '@/lib/domain/time';

const TODAY = '2026-03-16'; // 周一
const NOW = Date.UTC(2026, 2, 16, 3, 0);

function card(id: string, overrides: Partial<ExerciseCard> = {}): ExerciseCard {
  return {
    id,
    version: 1,
    category: 'conditional-reasoning',
    categoryLabel: '条件推理',
    format: 'single-choice',
    difficulty: 3,
    estimatedSeconds: 60,
    knowledgePoints: ['modus-ponens'],
    reviewTags: ['条件推理'],
    status: 'validated',
    ...overrides,
  };
}

const CATALOG = [
  card('ex-a'),
  card('ex-b'),
  card('ex-c'),
  card('ex-d'),
  card('ex-e', { category: 'causal-reasoning', categoryLabel: '因果推理', knowledgePoints: ['common-cause'] }),
  card('ex-f', { category: 'argument-analysis', categoryLabel: '论证分析', reviewTags: ['事实与推测'] }),
  card('ex-retired', { status: 'retired' }),
];

function context(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    dateKey: TODAY,
    nowTs: NOW,
    profileId: 'local',
    settings: defaultSettings('local'),
    catalog: CATALOG,
    reviewStates: [],
    knowledgeStates: [],
    attempts: [],
    dueJournals: [],
    ...overrides,
  };
}

function attempt(exerciseId: string, overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: `atp-${exerciseId}`,
    profileId: 'local',
    exerciseId,
    exerciseVersion: 1,
    dateKey: TODAY,
    createdAt: NOW,
    answer: { format: 'single-choice', keys: ['A'] },
    outcome: 'correct',
    score: 1,
    timeSpentSeconds: 40,
    confidence: 4,
    reasoning: '',
    selfReport: null,
    errorTypes: [],
    cause: 'none',
    planItemId: null,
    isReview: false,
    flaggedForReview: false,
    aiAnalysisId: null,
    ...overrides,
  };
}

describe('generateDailyPlan', () => {
  it('同一 profile 同一天得到完全相同的计划（不使用随机数）', () => {
    const a = generateDailyPlan(context());
    const b = generateDailyPlan(context());
    expect(a.items.map((i) => i.exerciseId)).toEqual(b.items.map((i) => i.exerciseId));
    expect(a.items.length).toBeGreaterThan(0);
  });

  it('计划总时长不超过预算', () => {
    const draft = generateDailyPlan(context({ settings: { ...defaultSettings('local'), dailyBudgetMinutes: 5 } }));
    const total = draft.items.reduce((s, i) => s + i.estimatedSeconds, 0);
    expect(total).toBeLessThanOrEqual(5 * 60 + 180); // 日志项作为可选项额外保留
    expect(draft.budgetMinutes).toBe(5);
  });

  it('到期复习排在前面，并说明逾期情况', () => {
    const due = {
      ...createReviewState('ex-e', NOW),
      dueDateKey: addDays(TODAY, -3),
      repetitions: 2,
      intervalDays: 4,
      lapses: 1,
    };
    const draft = generateDailyPlan(context({ reviewStates: [due] }));
    expect(draft.items[0].exerciseId).toBe('ex-e');
    expect(draft.items[0].activity).toBe('error-review');
    expect(draft.items[0].reason).toContain('逾期 3 天');
  });

  it('答错产生的当天重学被标记为必做', () => {
    const lapsed = scheduleNext(null, {
      exerciseId: 'ex-b',
      outcome: 'incorrect',
      confidence: 3,
      timeSpentSeconds: 30,
      estimatedSeconds: 60,
      difficulty: 3,
      todayKey: TODAY,
      nowTs: NOW - 40 * 60_000,
    });
    const draft = generateDailyPlan(context({ reviewStates: [lapsed] }));
    const relearn = draft.items.find((i) => i.kind === 'same-day-relearn');
    expect(relearn?.exerciseId).toBe('ex-b');
    expect(relearn?.required).toBe(true);
  });

  it('已答过的题在 21 天内不重复出现', () => {
    const draft = generateDailyPlan(context({ attempts: [attempt('ex-a', { dateKey: addDays(TODAY, -5) })] }));
    expect(draft.items.some((i) => i.exerciseId === 'ex-a')).toBe(false);
  });

  it('retired 题目不进入计划', () => {
    const draft = generateDailyPlan(context({ settings: { ...defaultSettings('local'), dailyBudgetMinutes: 60 } }));
    expect(draft.items.some((i) => i.exerciseId === 'ex-retired')).toBe(false);
  });

  it('薄弱知识点会提高对应题目被选中的机会', () => {
    const weakState = { ...createKnowledgeState('common-cause', NOW), attempts: 6, ewma: 0.15 };
    const draft = generateDailyPlan(
      context({
        settings: { ...defaultSettings('local'), newToReviewRatio: 1, dailyBudgetMinutes: 6 },
        knowledgeStates: [weakState],
      }),
    );
    expect(draft.items.some((i) => i.exerciseId === 'ex-e')).toBe(true);
  });

  it('休息日只保留最小任务且不会清空复习计划', () => {
    const settings = { ...defaultSettings('local'), restWeekdays: [1], dailyBudgetMinutes: 15 };
    const draft = generateDailyPlan(context({ settings }));
    expect(draft.restDay).toBe(true);
    expect(draft.budgetMinutes).toBe(6);
    expect(draft.notes[0]).toContain('休息日');
  });

  it('到期复盘的日志会成为一项任务', () => {
    const draft = generateDailyPlan(context({ dueJournals: [{ id: 'j-1', title: '关于涨价的推断' }] }));
    const item = draft.items.find((i) => i.journalId === 'j-1');
    expect(item).toBeDefined();
    expect(item?.reason).toContain('复盘');
  });

  it('总是保留一个思考日志入口', () => {
    const draft = generateDailyPlan(context());
    expect(draft.items.some((i) => i.activity === 'free-journal')).toBe(true);
  });

  it('事实与推测标签映射到对应活动类型', () => {
    const draft = generateDailyPlan(context({ settings: { ...defaultSettings('local'), dailyBudgetMinutes: 60, newToReviewRatio: 1 } }));
    expect(draft.items.some((i) => i.activity === 'fact-vs-inference')).toBe(true);
  });

  it('planCompletion 只在必做项缺失时报缺', () => {
    const draft = generateDailyPlan(
      context({ reviewStates: [{ ...createReviewState('ex-a', NOW), sameDayRelearn: true, sameDayRelearnAfterTs: NOW - 1, dueDateKey: TODAY }] }),
    );
    const record = planToRecord(draft);
    const required = record.items.filter((i) => i.required).map((i) => i.id);
    const result = planCompletion(record, required);
    expect(result.requiredMissing).toEqual([]);
    expect(result.percent).toBeGreaterThanOrEqual(0);
    const missing = planCompletion(record, []);
    expect(missing.requiredMissing).toEqual(required);
  });
});

describe('连续与周活跃', () => {
  const settings = { ...defaultSettings('local'), restWeekdays: [0] };

  it('今天没练但昨天练了不清零（宽限一天）', () => {
    const streak = trainingStreak([addDays(TODAY, -1), addDays(TODAY, -2)], settings, TODAY);
    expect(streak.current).toBe(2);
    expect(streak.missedGraceUsed).toBe(true);
  });

  it('休息日中断不清连续', () => {
    // TODAY 是周一，周日为休息日
    const streak = trainingStreak([addDays(TODAY, -2), TODAY], settings, TODAY);
    expect(streak.current).toBeGreaterThanOrEqual(1);
  });

  it('缺席两天以上中断当前连续，但保留历史最长', () => {
    const streak = trainingStreak([addDays(TODAY, -6), addDays(TODAY, -5)], settings, TODAY);
    expect(streak.current).toBe(0);
    expect(streak.best).toBe(2);
  });

  it('周活跃只覆盖本周一到周日', () => {
    // TODAY 是周一：上一天属于上一周，不应计入。
    const week = weeklyActiveDays([TODAY, addDays(TODAY, 1), addDays(TODAY, -1)], TODAY);
    expect(week.count).toBe(2);
    expect(week.days).toHaveLength(7);
    expect(week.days[0]).toBe(TODAY);
    expect(week.days[6]).toBe(addDays(TODAY, 6));
  });

  it('随机数生成器按种子确定', () => {
    expect(makeRng('abc')()).toBe(makeRng('abc')());
    expect(makeRng('abc')()).not.toBe(makeRng('abd')());
  });
});
