'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { useApp } from '@/app/providers';
import { Button, DifficultyPips, EmptyState, Note, ProgressBar, SectionTitle, Skeleton, StatusBadge } from '@/components/ui';
import { CATEGORY_LABELS } from '@/lib/domain/taxonomy';
import { toCard } from '@/lib/domain/catalog';
import type { Exercise } from '@/lib/domain/exercise-schema';
import { trainingStreak, weeklyActiveDays, planCompletion } from '@/lib/domain/daily-plan';
import type { DailyPlanRecord, DailyProgressRecord } from '@/lib/domain/records';
import type { Journal } from '@/lib/domain/journal';
import { listDueReviews } from '@/lib/services/training';
import { formatChineseDateWithWeekday, addDays, relativeDayLabel } from '@/lib/domain/time';
import { accuracyMetric, type Metric } from '@/lib/domain/stats';

interface Overview {
  plan: DailyPlanRecord | null;
  progress: DailyProgressRecord | null;
  dueReviews: { id: string; categoryLabel: string; difficulty: number; overdueDays: number; reason: string }[];
  recentJournals: { id: string; title: string; updatedAt: number; status: Journal['status'] }[];
  nextNew: { id: string; categoryLabel: string; difficulty: number; estimatedSeconds: number } | null;
  streak: { current: number; best: number; missedGraceUsed: boolean };
  week: { count: number; days: string[] };
  accuracy: Metric;
  attemptCount: number;
}

export function HomeView() {
  const { store, profileId, settings, dateKey, nowTs, ready, seeding, storageOk } = useApp();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store) return;
    try {
      const [plan, progress, journals, reviews, attempts30] = await Promise.all([
        store.getPlan(profileId, dateKey),
        store.getProgress(profileId, dateKey),
        store.listJournals({ profileId }),
        listDueReviews(store, profileId, dateKey, nowTs),
        store.listAttempts({ profileId, fromKey: addDays(dateKey, -29), toKey: dateKey }),
      ]);

      const activeKeys = new Set(attempts30.map((a) => a.dateKey));
      const nextNew = await pickNextNewExercise(
        store,
        profileId,
        attempts30.map((a) => a.exerciseId),
        plan,
      );

      const allKeys = await allActiveKeys(store, profileId, dateKey);
      const streak = trainingStreak(allKeys, settings, dateKey);
      const week = weeklyActiveDays(allKeys, dateKey);

      setOverview({
        plan,
        progress,
        dueReviews: reviews.slice(0, 5).map((r) => ({
          id: r.exercise.id,
          categoryLabel: CATEGORY_LABELS[r.exercise.category],
          difficulty: r.exercise.difficulty,
          overdueDays: r.overdueDays,
          reason: r.overdueDays > 0 ? `逾期 ${r.overdueDays} 天` : '今天到期',
        })),
        recentJournals: journals.slice(0, 3).map((j) => ({ id: j.id, title: j.title, updatedAt: j.updatedAt, status: j.status })),
        nextNew,
        streak,
        week,
        accuracy: accuracyMetric(attempts30),
        attemptCount: attempts30.length,
      });
      void activeKeys;
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取本地数据失败。');
    }
  }, [store, profileId, dateKey, nowTs, settings]);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  if (!ready) return <Skeleton lines={6} />;
  if (!storageOk) {
    return (
      <Note tone="bad" title="本地存储不可用">
        {seeding.message} 这个应用默认把数据保存在你自己的设备上，因此需要浏览器允许 IndexedDB。
      </Note>
    );
  }
  if (error)
    return (
      <Note tone="bad" title="读取数据时出错">
        {error}
      </Note>
    );
  if (!overview) return <Skeleton lines={6} />;

  const completion = overview.plan ? planCompletion(overview.plan, overview.progress?.completedItemIds ?? []) : null;
  const doneToday = (overview.progress?.completedItemIds.length ?? 0) > 0;

  return (
    <div className="stack gap-4">
      <header className="stack gap-1">
        <p className="label">{formatChineseDateWithWeekday(dateKey)}</p>
        <h1 className="text-2xl">{doneToday ? '继续今天的训练' : '今天从一道题开始'}</h1>
        <p className="muted text-sm">{settings.dailyBudgetMinutes} 分钟就能完成一次有效练习。连续天数只用于帮你恢复节奏，不是成绩。</p>
      </header>

      {!settings.onboarded ? (
        <Note tone="neutral" title="第一次使用？">
          <div className="stack gap-2">
            <p>先花 30 秒设定每天的训练时长与感兴趣的领域，也可以直接跳过。</p>
            <Button href="/onboarding" size="sm">
              开始新手引导
            </Button>
          </div>
        </Note>
      ) : null}

      <section className="card stack gap-3">
        <ProgressBar value={completion?.done ?? 0} total={completion?.total ?? 0} label={overview.plan?.restDay ? '休息日任务' : '今日进度'} />
        {overview.plan ? (
          <ul className="stack gap-1 text-sm">
            {overview.plan.items.map((item) => {
              const isDone = overview.progress?.completedItemIds.includes(item.id);
              const isSkipped = overview.progress?.skippedItemIds.includes(item.id);
              return (
                <li key={item.id} className="row gap-2">
                  <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line-strong text-xs">
                    {isDone ? '✓' : isSkipped ? '–' : ''}
                  </span>
                  <span className={isDone ? 'muted line-through' : ''}>{item.reason}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm muted">还没有今日计划，点击开始训练就会自动生成。</p>
        )}
        <Button href="/train" disabled={seeding.status === 'failed'}>
          {doneToday ? '继续训练' : '开始今天的训练'}
        </Button>
        {seeding.status === 'failed' ? <p className="faint">题库还没准备好：{seeding.message}</p> : null}
      </section>

      <section className="row gap-3">
        <div className="card flex-1">
          <p className="label">连续训练</p>
          <p className="text-xl font-semibold tabular-nums">{overview.streak.current} 天</p>
          <p className="faint">最长 {overview.streak.best} 天</p>
        </div>
        <div className="card flex-1">
          <p className="label">本周活跃</p>
          <p className="text-xl font-semibold tabular-nums">{overview.week.count}/7 天</p>
          <p className="faint">按周一起算</p>
        </div>
      </section>

      <SectionTitle
        action={
          <Link href="/review" className="text-sm text-brand no-underline">
            全部复习
          </Link>
        }
      >
        待复习错题
      </SectionTitle>
      {overview.dueReviews.length === 0 ? (
        <EmptyState title="暂时没有到期复习">答错的题会按间隔调度自动进入这里。</EmptyState>
      ) : (
        <ul className="stack gap-2">
          {overview.dueReviews.map((review) => (
            <li key={review.id}>
              <Link href="/review" className="card row-between no-underline" data-pressable>
                <span className="stack gap-1">
                  <span className="font-semibold">{review.categoryLabel}</span>
                  <span className="faint">{review.reason}</span>
                </span>
                <DifficultyPips level={review.difficulty} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>今日推荐</SectionTitle>
      {overview.nextNew ? (
        <div className="card stack gap-2">
          <div className="row-between">
            <StatusBadge tone="neutral" symbol="▷">
              {overview.nextNew.categoryLabel}
            </StatusBadge>
            <DifficultyPips level={overview.nextNew.difficulty} />
          </div>
          <p className="text-sm muted">
            预计 {Math.round(overview.nextNew.estimatedSeconds / 15) * 15} 秒。推荐依据：你薄弱知识点较多且未在近 21 天做过。
          </p>
          <Button href="/train" variant="secondary" size="sm">
            立刻开始
          </Button>
        </div>
      ) : (
        <EmptyState title="没有可推荐的新题">题库可能已全部做过，或仍在载入中。</EmptyState>
      )}

      <SectionTitle
        action={
          <Link href="/journal" className="text-sm text-brand no-underline">
            全部日志
          </Link>
        }
      >
        最近的思考日志
      </SectionTitle>
      {overview.recentJournals.length === 0 ? (
        <EmptyState
          title="还没有记录过真实生活中的问题"
          action={
            <Button href="/journal/new" size="sm">
              写第一篇
            </Button>
          }
        >
          <p>这个应用真正想训练的是你把工作、阅读和沟通里的模糊问题拆开来看。</p>
        </EmptyState>
      ) : (
        <ul className="stack gap-2">
          {overview.recentJournals.map((journal) => (
            <li key={journal.id}>
              <Link href={`/journal?edit=${journal.id}`} className="card row-between no-underline" data-pressable>
                <span className="font-semibold">{journal.title}</span>
                <span className="faint">{relativeDayLabel(dateKey, dateKey)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle
        action={
          <Link href="/stats" className="text-sm text-brand no-underline">
            查看报告
          </Link>
        }
      >
        训练概览
      </SectionTitle>
      <div className="card row-between">
        <div className="stack gap-1">
          <p className="label">近 30 天正确率</p>
          <p className="text-lg font-semibold">{overview.accuracy.display}</p>
        </div>
        <p className="faint max-w-[60%] text-right">{overview.accuracy.formula}</p>
      </div>
    </div>
  );
}

async function allActiveKeys(store: NonNullable<ReturnType<typeof useApp>['store']>, profileId: string, dateKey: string) {
  const attempts = await store.listAttempts({ profileId, fromKey: addDays(dateKey, -120), toKey: dateKey });
  return [...new Set(attempts.map((a) => a.dateKey))];
}

async function pickNextNewExercise(
  store: NonNullable<ReturnType<typeof useApp>['store']>,
  profileId: string,
  seenIds: string[],
  plan: DailyPlanRecord | null,
) {
  const plannedNew = plan?.items.find((i) => i.kind === 'new' && i.exerciseId && !(i.id in ({} as object)));
  const candidateId = plannedNew?.exerciseId;
  if (!candidateId) return null;
  const exercise: Exercise | null = await store.getExercise(candidateId);
  if (!exercise) return null;
  void seenIds;
  return {
    id: exercise.id,
    categoryLabel: CATEGORY_LABELS[exercise.category],
    difficulty: exercise.difficulty,
    estimatedSeconds: exercise.estimatedSeconds,
  };
}

export function exerciseCardLabel(exercise: Exercise): string {
  return toCard(exercise).categoryLabel;
}
