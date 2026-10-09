import 'fake-indexeddb/auto';

import { afterAll, describe, expect, it } from 'vitest';

import { LogicDailyDatabase } from '@/lib/db/database';
import { LocalStore, validateBackupPayload } from '@/lib/db/store';
import { createEmptyJournal, journalSchema } from '@/lib/domain/journal';
import { createReviewState } from '@/lib/domain/scheduling';
import { createKnowledgeState } from '@/lib/domain/mastery';
import { defaultSettings } from '@/lib/domain/settings';
import type { AttemptRecord } from '@/lib/domain/records';
import { allFixtures, singleChoiceFixture } from '../fixtures/exercises';

let counter = 0;
const databases: LogicDailyDatabase[] = [];

function freshStore(): LocalStore {
  counter += 1;
  const db = new LogicDailyDatabase(`logicdaily-test-${counter}`);
  databases.push(db);
  return new LocalStore(db);
}

function attemptFixture(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: `atp-${counter}-${Math.random().toString(36).slice(2)}`,
    profileId: 'p1',
    exerciseId: 'ex-test-single',
    exerciseVersion: 1,
    dateKey: '2026-03-16',
    createdAt: Date.UTC(2026, 2, 16, 4),
    answer: { format: 'single-choice', keys: ['A'] },
    outcome: 'correct',
    score: 1,
    timeSpentSeconds: 42,
    confidence: 4,
    reasoning: '因为否定了后件。',
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

afterAll(async () => {
  for (const db of databases) await db.delete();
});

describe('LocalStore 题库播种', () => {
  it('首次播种写入全部题目，重复播种不产生变化', async () => {
    const store = freshStore();
    const exercises = allFixtures();
    const first = await store.seedExercises(exercises, 'content-v1');
    expect(first.inserted).toBe(exercises.length);
    expect(first.updated).toBe(0);

    const second = await store.seedExercises(exercises, 'content-v1');
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(await store.countExercises()).toBe(exercises.length);
  });

  it('题目版本更新会覆盖，内容包中移除的题目会被清理', async () => {
    const store = freshStore();
    const base = singleChoiceFixture();
    await store.seedExercises([base], 'content-v1');
    await store.seedExercises([{ ...base, version: 2, stem: `${base.stem}（改写）` }], 'content-v1');
    const loaded = await store.getExercise(base.id);
    expect(loaded?.version).toBe(2);

    await store.seedExercises([], 'content-v1');
    expect(await store.countExercises()).toBe(0);
  });

  it('按类别与状态过滤，并能读回完整结构', async () => {
    const store = freshStore();
    await store.seedExercises(allFixtures(), 'content-v1');
    const conditional = await store.listExercises({ category: 'conditional-reasoning' });
    expect(conditional.length).toBeGreaterThan(0);
    const ordering = await store.getExercise('ex-test-order');
    expect(ordering?.format).toBe('ordering');
    expect(ordering && 'items' in ordering ? ordering.items.length : 0).toBe(4);
  });
});

describe('LocalStore 记录读写', () => {
  it('按日期区间查询作答，并按时间升序返回', async () => {
    const store = freshStore();
    await store.addAttempt(attemptFixture({ dateKey: '2026-03-14', createdAt: 1 }));
    await store.addAttempt(attemptFixture({ dateKey: '2026-03-16', createdAt: 2 }));
    await store.addAttempt(attemptFixture({ dateKey: '2026-03-20', createdAt: 3 }));

    const window = await store.listAttempts({ profileId: 'p1', fromKey: '2026-03-15', toKey: '2026-03-17' });
    expect(window).toHaveLength(1);
    expect(window[0].dateKey).toBe('2026-03-16');

    const limited = await store.listAttempts({ profileId: 'p1', limit: 2 });
    expect(limited.map((a) => a.createdAt)).toEqual([2, 3]);
  });

  it('日期区间的两端都包含（“今天”的记录不能丢）', async () => {
    const store = freshStore();
    await store.addAttempt(attemptFixture({ id: 'atp-edge-a', dateKey: '2026-03-18', createdAt: 1 }));
    await store.addAttempt(attemptFixture({ id: 'atp-edge-b', dateKey: '2026-03-21', createdAt: 2 }));
    await store.addAttempt(attemptFixture({ id: 'atp-edge-c', dateKey: '2026-03-25', createdAt: 3 }));

    const bounded = await store.listAttempts({ profileId: 'p1', fromKey: '2026-03-18', toKey: '2026-03-21' });
    expect(bounded.map((a) => a.dateKey)).toEqual(['2026-03-18', '2026-03-21']);

    const sameDay = await store.listAttempts({ profileId: 'p1', fromKey: '2026-03-25', toKey: '2026-03-25' });
    expect(sameDay.map((a) => a.id)).toEqual(['atp-edge-c']);

    await store.saveProgress({
      dateKey: '2026-03-21',
      profileId: 'p1',
      planId: null,
      completedItemIds: ['item-1'],
      skippedItemIds: [],
      totalSeconds: 40,
      attempts: 1,
      updatedAt: 1,
    });
    const progress = await store.listProgress('p1', '2026-03-21', '2026-03-21');
    expect(progress.map((p) => p.attempts)).toEqual([1]);
  });

  it('复合主键的状态读写互不干扰', async () => {
    const store = freshStore();
    const review = { ...createReviewState('ex-test-single', 10), intervalDays: 4, dueDateKey: '2026-03-20' };
    await store.putReviewState('p1', review);
    await store.putReviewState('p2', { ...review, exerciseId: 'ex-test-single', intervalDays: 9 });

    const p1 = await store.getReviewState('p1', 'ex-test-single');
    const p2 = await store.getReviewState('p2', 'ex-test-single');
    expect(p1?.intervalDays).toBe(4);
    expect(p2?.intervalDays).toBe(9);
    expect((await store.listReviewStates('p1')).map((r) => r.intervalDays)).toEqual([4]);
  });

  it('知识点状态按 profile 隔离', async () => {
    const store = freshStore();
    await store.putKnowledgeState('p1', { ...createKnowledgeState('modus-ponens', 1), attempts: 5 });
    await store.putKnowledgeState('p2', { ...createKnowledgeState('modus-ponens', 1), attempts: 2 });
    expect(await store.getKnowledgeState('p2', 'modus-ponens')).toMatchObject({ attempts: 2 });
    expect((await store.listKnowledgeStates('p1'))[0].attempts).toBe(5);
  });

  it('日志默认排除软删除，可按 id 永久删除', async () => {
    const store = freshStore();
    const first = createEmptyJournal({ id: 'j-1', profileId: 'p1', nowTs: 10, title: '第一篇' });
    const second = createEmptyJournal({ id: 'j-2', profileId: 'p1', nowTs: 20, title: '第二篇' });
    await store.upsertJournal(first);
    await store.upsertJournal(second);
    await store.upsertJournal({ ...second, deleted: true, deletedAt: 30, updatedAt: 30 });

    expect((await store.listJournals({ profileId: 'p1' })).map((j) => j.id)).toEqual(['j-1']);
    expect((await store.listJournals({ profileId: 'p1', includeDeleted: true })).length).toBe(2);

    await store.deleteJournalPermanently('p1', 'j-1');
    expect(await store.getJournal('p1', 'j-1')).toBeNull();
  });

  it('跨 profile 读取他人日志会被拒绝', async () => {
    const store = freshStore();
    await store.upsertJournal(createEmptyJournal({ id: 'j-9', profileId: 'p1', nowTs: 1 }));
    expect(await store.getJournal('p2', 'j-9')).toBeNull();
    expect(await store.listJournals({ profileId: 'p2' })).toEqual([]);
  });
});

describe('备份导出与导入', () => {
  it('导出后再导入可以恢复进度、复习状态与日志', async () => {
    const store = freshStore();
    await store.seedExercises(allFixtures(), 'content-v1');
    await store.saveSettings({ ...defaultSettings('p1'), dailyBudgetMinutes: 12 });
    await store.addAttempt(attemptFixture());
    await store.putReviewState('p1', { ...createReviewState('ex-test-single', 5), dueDateKey: '2026-03-21', intervalDays: 3 });
    await store.putKnowledgeState('p1', { ...createKnowledgeState('modus-ponens', 5), attempts: 4, ewma: 0.7 });
    await store.upsertJournal(
      journalSchema.parse({
        ...createEmptyJournal({ id: 'j-1', profileId: 'p1', nowTs: 5, title: '关于涨价' }),
        facts: '涨价后销量增加',
        evidence: [{ id: 'e-1', journalId: 'j-1', stance: 'oppose', text: '同期竞品缺货', createdAt: 5 }],
      }),
    );

    const payload = await store.exportBackup('p1');
    expect(payload.counts.attempts).toBe(1);
    expect(payload.data.journals[0].evidence).toHaveLength(1);

    await store.clearLocalData('p1');
    expect(await store.countExercises()).toBe(0);
    expect(await store.listAttempts({ profileId: 'p1' })).toEqual([]);

    const restore = await store.importBackup(payload);
    expect(restore.added).toBeGreaterThan(0);
    expect((await store.listAttempts({ profileId: 'p1' }))[0].exerciseId).toBe('ex-test-single');
    expect((await store.getReviewState('p1', 'ex-test-single'))?.dueDateKey).toBe('2026-03-21');
    expect((await store.getKnowledgeState('p1', 'modus-ponens'))?.ewma).toBeCloseTo(0.7);
    expect((await store.listJournals({ profileId: 'p1' }))[0].title).toBe('关于涨价');
    expect((await store.getSettings('p1'))?.dailyBudgetMinutes).toBe(12);
  });

  it('重复导入同一份备份不会产生重复作答记录', async () => {
    const store = freshStore();
    await store.addAttempt(attemptFixture({ id: 'atp-fixed' }));
    const payload = await store.exportBackup('p1');
    const result = await store.importBackup(payload);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect((await store.listAttempts({ profileId: 'p1' })).length).toBe(1);
  });

  it('拒绝结构不合法、版本不符或来自其他应用的备份', async () => {
    const store = freshStore();
    const valid = await store.exportBackup('p1');
    expect(() => validateBackupPayload(null)).toThrow(/不是一个对象/);
    expect(() => validateBackupPayload({ ...valid, app: 'other' })).toThrow(/不是 LogicDaily/);
    expect(() => validateBackupPayload({ ...valid, backupSchemaVersion: 999 })).toThrow(/不被当前应用支持/);
    const missingData = { ...valid, data: { ...valid.data } } as Record<string, unknown>;
    delete (missingData.data as Record<string, unknown>).journals;
    expect(() => validateBackupPayload(missingData)).toThrow(/data.journals/);
  });

  it('导入会把旧版本设置字段迁移，并丢弃备份中意外出现的密钥字段', async () => {
    const store = freshStore();
    const payload = await store.exportBackup('p1');
    const legacy = JSON.parse(JSON.stringify(payload)) as { data: { settings: Record<string, unknown> } };
    legacy.data.settings = {
      profileId: 'p1',
      targetMinutes: 7,
      mode: 'local',
      ai: { enabled: true, apiKey: 'sk-should-be-dropped' },
    };
    await store.importBackup(legacy);
    const settings = await store.getSettings('p1');
    expect(settings?.dailyBudgetMinutes).toBe(7);
    expect(settings?.ai.enabled).toBe(true);
    expect(JSON.stringify(settings)).not.toContain('sk-should-be-dropped');
  });

  it('清除本地数据默认连同题库一起删除，但可保留题目缓存', async () => {
    const store = freshStore();
    await store.seedExercises(allFixtures(), 'content-v1');
    await store.addAttempt(attemptFixture());
    await store.clearLocalData('p1', { keepExercises: true });
    expect(await store.countExercises()).toBe(allFixtures().length);
    expect(await store.listAttempts({ profileId: 'p1' })).toEqual([]);
  });
});
