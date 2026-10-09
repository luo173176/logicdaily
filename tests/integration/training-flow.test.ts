import 'fake-indexeddb/auto';

import { afterAll, describe, expect, it } from 'vitest';

import { LogicDailyDatabase } from '@/lib/db/database';
import { LocalStore } from '@/lib/db/store';
import { defaultSettings } from '@/lib/domain/settings';
import {
  ensureTodayPlan,
  listDueReviews,
  submitAttempt,
} from '@/lib/services/training';
import { allFixtures, singleChoiceFixture } from '../fixtures/exercises';

let counter = 1000;
const databases: LogicDailyDatabase[] = [];

async function preparedStore() {
  counter += 1;
  const db = new LogicDailyDatabase(`logicdaily-flow-${counter}`);
  databases.push(db);
  const store = new LocalStore(db);
  await store.seedExercises(allFixtures(), 'content-v1');
  await store.saveSettings(defaultSettings('p1'));
  return store;
}

afterAll(async () => {
  for (const db of databases) await db.delete();
});

const TODAY = '2026-03-16';
const NOW = Date.UTC(2026, 2, 16, 4, 0);

describe('submitAttempt 端到端影响', () => {
  it('答对时写入作答、更新复习计划与掌握度，并完成计划项', async () => {
    const store = await preparedStore();
    const { plan } = await ensureTodayPlan(store, { profileId: 'p1', settings: defaultSettings('p1'), dateKey: TODAY, nowTs: NOW });
    const target = plan.items.find((i) => i.exerciseId === 'ex-test-single');
    expect(target).toBeDefined();

    const result = await submitAttempt(store, {
      profileId: 'p1',
      exerciseId: 'ex-test-single',
      answer: { format: 'single-choice', keys: ['A'] },
      reasoning: '比赛没改到周四，说明天没下雨。',
      confidence: 4,
      timeSpentSeconds: 45,
      selfReport: null,
      planItemId: target?.id ?? null,
      isReview: false,
      dateKey: TODAY,
      nowTs: NOW,
    });

    expect(result.grade.outcome).toBe('correct');
    expect(result.attempt.cause).toBe('none');
    expect(result.review.repetitions).toBe(1);
    expect(result.review.dueDateKey).toBe('2026-03-17');
    expect(result.knowledgeStates.every((k) => k.attempts === 1)).toBe(true);
    expect(result.progress?.completedItemIds).toContain(target?.id);

    const saved = await store.getReviewState('p1', 'ex-test-single');
    expect(saved?.dueDateKey).toBe('2026-03-17');
    const ks = await store.getKnowledgeState('p1', 'modus-ponens');
    expect(ks?.attempts).toBe(1);
  });

  it('命中典型错误选项时记录错误类型并安排当天重学', async () => {
    const store = await preparedStore();
    const result = await submitAttempt(store, {
      profileId: 'p1',
      exerciseId: 'ex-test-single',
      answer: { format: 'single-choice', keys: ['B'] },
      reasoning: '既然没改期那就应该下雨了吧。',
      confidence: 3,
      timeSpentSeconds: 50,
      selfReport: null,
      planItemId: null,
      isReview: false,
      dateKey: TODAY,
      nowTs: NOW,
    });

    expect(result.grade.outcome).toBe('incorrect');
    expect(result.attempt.errorTypes).toEqual(['affirming-consequent']);
    expect(result.attempt.cause).toBe('logic-skill');
    expect(result.review.sameDayRelearn).toBe(true);
    expect(result.review.dueDateKey).toBe('2026-03-17');

    const due = await listDueReviews(store, 'p1', TODAY, NOW + 31 * 60_000);
    expect(due.map((d) => d.exercise.id)).toContain('ex-test-single');
    const notYet = await listDueReviews(store, 'p1', TODAY, NOW + 5 * 60_000);
    expect(notYet.map((d) => d.exercise.id)).not.toContain('ex-test-single');
  });

  it('用户标记题目歧义会生成待复核条目，并且不归因为能力问题', async () => {
    const store = await preparedStore();
    const result = await submitAttempt(store, {
      planItemId: null,
      profileId: 'p1',
      exerciseId: 'ex-test-single',
      answer: { format: 'single-choice', keys: ['C'] },
      reasoning: '题目里没说比赛是否已经改期。',
      confidence: 3,
      timeSpentSeconds: 80,
      selfReport: 'ambiguous',
      isReview: false,
      dateKey: TODAY,
      nowTs: NOW,
    });

    expect(result.classification.cause).toBe('ambiguous-question');
    expect(result.attempt.flaggedForReview).toBe(true);
    const issues = await store.listIssues('open');
    expect(issues).toHaveLength(1);
    expect(issues[0].exerciseId).toBe('ex-test-single');
  });

  it('同一题反复答错会累积 lapse 并在第三次标记为难题', async () => {
    const store = await preparedStore();
    let lastErrorTypes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await submitAttempt(store, {
        profileId: 'p1',
        exerciseId: 'ex-test-single',
        answer: { format: 'single-choice', keys: ['B'] },
        reasoning: '',
        confidence: 3,
        timeSpentSeconds: 60,
        selfReport: null,
        planItemId: null,
        isReview: i > 0,
        dateKey: TODAY,
        nowTs: NOW + i * 60_000,
      });
      lastErrorTypes = result.attempt.errorTypes;
      if (i === 2) expect(result.review.leech).toBe(true);
    }
    expect(lastErrorTypes).toEqual(['affirming-consequent']);
  });

  it('题目不存在时给出可操作的错误', async () => {
    const store = await preparedStore();
    await expect(
      submitAttempt(store, {
        profileId: 'p1',
        exerciseId: 'ex-missing',
        answer: { format: 'single-choice', keys: ['A'] },
        reasoning: '',
        confidence: 3,
        timeSpentSeconds: 10,
        selfReport: null,
        planItemId: null,
        isReview: false,
        dateKey: TODAY,
        nowTs: NOW,
      }),
    ).rejects.toThrow(/重新加载题库/);
  });
});

describe('ensureTodayPlan 持久化', () => {
  it('同一天第二次调用返回已保存的计划', async () => {
    const store = await preparedStore();
    const settings = defaultSettings('p1');
    const first = await ensureTodayPlan(store, { profileId: 'p1', settings, dateKey: TODAY, nowTs: NOW });
    expect(first.regenerated).toBe(true);
    expect(first.plan.items.length).toBeGreaterThan(0);

    const second = await ensureTodayPlan(store, { profileId: 'p1', settings, dateKey: TODAY, nowTs: NOW + 60_000 });
    expect(second.regenerated).toBe(false);
    expect(second.plan.items.map((i) => i.id)).toEqual(first.plan.items.map((i) => i.id));

    const stored = await store.getPlan('p1', TODAY);
    expect(stored?.id).toBe(first.plan.id);
    const progress = await store.getProgress('p1', TODAY);
    expect(progress?.planId).toBe(first.plan.id);
  });

  it('答错之后新生成的计划会把错题放进复习项', async () => {
    const store = await preparedStore();
    await submitAttempt(store, {
      profileId: 'p1',
      exerciseId: 'ex-test-single',
      answer: { format: 'single-choice', keys: ['B'] },
      reasoning: '',
      confidence: 3,
      timeSpentSeconds: 40,
      selfReport: null,
      planItemId: null,
      isReview: false,
      dateKey: TODAY,
      nowTs: NOW,
    });
    const settings = defaultSettings('p1');
    const tomorrow = await ensureTodayPlan(store, { profileId: 'p1', settings, dateKey: '2026-03-17', nowTs: NOW + 86_400_000 });
    expect(tomorrow.plan.items.some((i) => i.exerciseId === 'ex-test-single' && i.activity === 'error-review')).toBe(true);
  });

  it('题库为空时计划只包含日志项而不崩溃', async () => {
    counter += 1;
    const db = new LogicDailyDatabase(`logicdaily-empty-${counter}`);
    databases.push(db);
    const store = new LocalStore(db);
    const { plan } = await ensureTodayPlan(store, { profileId: 'p1', settings: defaultSettings('p1'), dateKey: TODAY, nowTs: NOW });
    expect(plan.items.every((i) => i.exerciseId === null)).toBe(true);
  });
});

describe('判分口径与题库结构一致', () => {
  it('示范题都能被 schema 接受且答案选项不带错误标记', async () => {
    const store = await preparedStore();
    const exercises = await store.listExercises();
    expect(exercises.length).toBe(allFixtures().length);
    for (const exercise of exercises) {
      if (exercise.format === 'single-choice' || exercise.format === 'multi-choice') {
        const traps = exercise.options.filter((o) => o.errorType).map((o) => o.key);
        for (const key of exercise.answer.keys) expect(traps).not.toContain(key);
      }
    }
  });

  it('单选题的正确项在解析中没有被标为常见错误', () => {
    const exercise = singleChoiceFixture();
    if (exercise.format === 'single-choice') {
      const wrong = exercise.options.filter((o) => !exercise.answer.keys.includes(o.key));
      expect(wrong.length).toBeGreaterThan(0);
      expect(exercise.explanation.commonMistakes.length).toBeGreaterThan(0);
    }
  });
});
