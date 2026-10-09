'use client';

import { useCallback, useEffect, useState } from 'react';

import { useApp } from '@/app/providers';
import { EmptyState, Note, SectionTitle, Skeleton, StatusBadge } from '@/components/ui';
import type { AttemptRecord, DailyPlanRecord, DailyProgressRecord } from '@/lib/domain/records';
import type { Journal } from '@/lib/domain/journal';
import type { ExerciseCard } from '@/lib/domain/catalog';
import type { KnowledgeState } from '@/lib/domain/mastery';
import {
  accuracyMetric,
  avgScoreMetric,
  buildSuggestions,
  categoryStats,
  completionMetric,
  dailySeries,
  errorTypeDistribution,
  inRange,
  journalStats,
  reviewEffectiveness,
  timeMetric,
  trendCompare,
  type Metric,
} from '@/lib/domain/stats';
import { KNOWLEDGE_POINT_LABELS, LOGIC_ERROR_LABELS } from '@/lib/domain/taxonomy';
import { masteryBand, masteryPercent, rankedWeakPoints } from '@/lib/domain/mastery';
import { trainingStreak } from '@/lib/domain/daily-plan';
import { addDays, diffDays, formatChineseDate, startOfWeekKey, weekdayLabel } from '@/lib/domain/time';

type RangeKey = 'today' | 'week' | 'month' | 'all';

const RANGE_LABELS: Record<RangeKey, string> = { today: '今天', week: '本周', month: '近 30 天', all: '全部记录' };

export function StatsView() {
  const { store, profileId, settings, dateKey, ready } = useApp();
  const [range, setRange] = useState<RangeKey>('month');
  const [data, setData] = useState<{
    attempts: AttemptRecord[];
    plans: DailyPlanRecord[];
    progresses: DailyProgressRecord[];
    journals: Journal[];
    knowledgeStates: KnowledgeState[];
    catalog: ExerciseCard[];
  } | null>(null);

  const load = useCallback(async () => {
    if (!store) return;
    const fromKey = addDays(dateKey, -120);
    const attempts = await store.listAttempts({ profileId, fromKey, toKey: dateKey });
    const [exercises, journals, knowledgeStates, plans, progressList] = await Promise.all([
      store.listExercises(),
      store.listJournals({ profileId }),
      store.listKnowledgeStates(profileId),
      store.listPlans(profileId, fromKey, dateKey),
      store.listProgress(profileId, fromKey, dateKey),
    ]);
    setData({
      attempts,
      journals,
      knowledgeStates,
      plans,
      progresses: progressList,
      catalog: exercises.map((exercise) => ({
        id: exercise.id,
        version: exercise.version,
        category: exercise.category,
        categoryLabel: '',
        format: exercise.format,
        difficulty: exercise.difficulty,
        estimatedSeconds: exercise.estimatedSeconds,
        knowledgePoints: exercise.knowledgePoints,
        reviewTags: exercise.reviewTags,
        status: exercise.status,
      })),
    });
  }, [store, profileId, dateKey]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready) return <Skeleton lines={6} />;
  if (!data) return <Skeleton lines={6} />;

  const window = selectRange(data.attempts, range, dateKey);
  const errors = errorTypeDistribution(window);
  const categories = categoryStats(window, data.catalog);
  const accuracy = accuracyMetric(window);
  const avgScore = avgScoreMetric(window);
  const time = timeMetric(window);
  const review = reviewEffectiveness(data.attempts);
  const completion = completionMetric(data.plans, data.progresses, addDays(dateKey, -29), dateKey);
  const journalSummary = journalStats(data.journals);
  const streak = trainingStreak([...new Set(data.attempts.map((a) => a.dateKey))], settings, dateKey);
  const suggestions = buildSuggestions({
    attempts: data.attempts,
    errors,
    categories,
    journals: data.journals,
    dueReviews: 0,
    streakCurrent: streak.current,
    streakBest: streak.best,
  });
  const weak = rankedWeakPoints(data.knowledgeStates, 6);
  const series = dailySeries(data.attempts, addDays(dateKey, -29), dateKey);
  const midpoint = addDays(dateKey, -14);
  const trend = trendCompare(window, range === 'all' ? midpoint : addDays(dateKey, -7));
  const decided = data.journals.filter((j) => j.reviewOutcome.trim().length > 0);

  return (
    <div className="stack gap-4">
      <header className="stack gap-2">
        <h1 className="text-2xl">训练报告</h1>
        <p className="muted text-sm">
          这里只统计你的练习行为与作答表现。它不是智力或逻辑能力的测量，每一项都能展开看计算方式。
        </p>
        <div className="row wrap gap-2" role="tablist" aria-label="时间范围">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={range === key}
              className={`chip chip-toggle ${range === key ? 'border-brand' : ''}`}
              onClick={() => setRange(key)}
            >
              {RANGE_LABELS[key]}
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <MetricCard metric={accuracy} />
        <MetricCard metric={avgScore} />
        <MetricCard metric={time} />
        <MetricCard metric={completion} />
        <MetricCard metric={review} />
        <MetricCard metric={journalSummary.opposingEvidenceRate} />
      </section>

      <SectionTitle>近 30 天作答量</SectionTitle>
      <BarChart
        points={series.map((point) => ({ label: point.dateKey.slice(5), value: point.attempts }))}
        emptyText="还没有作答记录。"
      />

      <SectionTitle>题型表现</SectionTitle>
      {categories.length === 0 ? (
        <EmptyState title="暂无题型数据">做几道题后这里会出现按题型的表现。</EmptyState>
      ) : (
        <ul className="stack gap-2">
          {categories.map((row) => (
            <li key={row.category} className="card row-between">
              <span className="font-semibold">{row.label}</span>
              <span className="row gap-2">
                <span className="tabular-nums">{Math.round(row.correctRate * 100)}%</span>
                <span className="faint">{row.attempts} 次</span>
                {row.insufficientData ? <StatusBadge tone="warn">样本少</StatusBadge> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>错误类型分布</SectionTitle>
      {errors.length === 0 ? (
        <p className="faint">这段时间没有记录到可归类的推理错误。</p>
      ) : (
        <ul className="stack gap-2">
          {errors.slice(0, 8).map((row) => (
            <li key={row.errorType} className="card stack gap-1">
              <div className="row-between">
                <span className="font-semibold">{row.label}</span>
                <span className="faint">
                  {row.count} 次 · {Math.round(row.share * 100)}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
                <div className="h-full rounded-full bg-warn" style={{ width: `${Math.round(row.share * 100)}%` }} />
              </div>
              {row.repeatRate >= 0.4 && row.count >= 3 ? (
                <p className="faint">跨题重复率 {Math.round(row.repeatRate * 100)}%：更像稳定习惯，不是偶发失误。</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>知识点掌握度</SectionTitle>
      {weak.length === 0 ? (
        <p className="faint">单个知识点至少 3 次作答后才计算掌握度。</p>
      ) : (
        <ul className="stack gap-2">
          {weak.map((state) => {
            const percent = masteryPercent(state);
            const band = masteryBand(state);
            return (
              <li key={state.knowledgePointId} className="card row-between">
                <span className="stack gap-1">
                  <span className="font-semibold">{KNOWLEDGE_POINT_LABELS[state.knowledgePointId] ?? state.knowledgePointId}</span>
                  <span className="faint">
                    {state.attempts} 次作答 · 答对 {state.correct} · 最近错误：
                    {state.recentErrorTypes.map((t) => LOGIC_ERROR_LABELS[t as keyof typeof LOGIC_ERROR_LABELS]).join('、') || '无'}
                  </span>
                </span>
                <span className="row gap-2">
                  <StatusBadge tone={band.tone === 'unknown' ? 'neutral' : band.tone === 'weak' ? 'warn' : 'ok'}>{band.label}</StatusBadge>
                  <span className="tabular-nums font-semibold">{percent === null ? '—' : `${percent}`}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <SectionTitle>变化趋势</SectionTitle>
      <div className="card stack gap-2">
        <div className="row-between">
          <span className="label">前半段 vs 后半段平均得分</span>
          <span className="tabular-nums font-semibold">
            {trend.reliable ? `${trend.earlier.toFixed(2)} → ${trend.later.toFixed(2)}` : '样本不足'}
          </span>
        </div>
        <p className="faint">{trend.note}</p>
        <p className="faint">连续训练：当前 {streak.current} 天，历史最长 {streak.best} 天。连续天数不代表能力变化。</p>
      </div>

      <SectionTitle>现实中的复盘结果</SectionTitle>
      {decided.length === 0 ? (
        <p className="faint">还没有日志填写过复盘结果。练习表现和现实结果分开看，才不会被分数误导。</p>
      ) : (
        <ul className="stack gap-2">
          {decided.slice(0, 6).map((journal) => (
            <li key={journal.id} className="card stack gap-1">
              <div className="row-between">
                <span className="font-semibold">{journal.title}</span>
                <span className="chip">
                  {journal.reviewDelta === 'better'
                    ? '比预期好'
                    : journal.reviewDelta === 'worse'
                      ? '比预期差'
                      : journal.reviewDelta === 'as-expected'
                        ? '与预期一致'
                        : '未判断'}
                </span>
              </div>
              <p className="text-sm muted">{journal.reviewOutcome}</p>
              <p className="faint">当初信心 {journal.selfConfidence}/5</p>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>本周复盘</SectionTitle>
      <WeeklyReview attempts={data.attempts} dateKey={dateKey} />

      <SectionTitle>建议</SectionTitle>
      <ul className="stack gap-2">
        {suggestions.map((suggestion, index) => (
          <li key={index} className="card stack gap-1">
            <p className="font-semibold">{suggestion.text}</p>
            <p className="faint">依据：{suggestion.basis}</p>
          </li>
        ))}
      </ul>

      <Note title="这些数字不能说明什么">
        <p>
          正确率受题型熟悉度、题目难度分布和当天状态影响；掌握度只覆盖本题库里出现过的知识点。任何一项都不足以支持“逻辑能力提升
          X%”这样的结论。真正值得看的是：你能否说出自己的推理依据，以及现实复盘时预测与结果的差距。
        </p>
      </Note>
    </div>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <div className="card stack gap-1">
      <p className="label">{metric.label}</p>
      <p className="text-xl font-semibold tabular-nums">{metric.display}</p>
      {metric.insufficientData ? <StatusBadge tone="warn">样本不足</StatusBadge> : null}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-brand">怎么算</summary>
        <p className="mt-1 text-xs muted">{metric.formula}</p>
        {metric.note ? <p className="mt-1 text-xs faint">{metric.note}</p> : null}
      </details>
    </div>
  );
}

function WeeklyReview({ attempts, dateKey }: { attempts: AttemptRecord[]; dateKey: string }) {
  const weekStart = startOfWeekKey(dateKey);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const perDay = days.map((day) => {
    const list = attempts.filter((a) => a.dateKey === day);
    const scored = list.filter((a) => a.outcome !== 'self-assessed');
    return {
      day,
      count: list.length,
      score: scored.length === 0 ? 0 : scored.reduce((s, a) => s + a.score, 0) / scored.length,
    };
  });
  const total = perDay.reduce((s, d) => s + d.count, 0);
  return (
    <div className="card stack gap-2">
      <p className="label">{`${formatChineseDate(weekStart)} 起一周`}</p>
      {total === 0 ? (
        <p className="faint">本周还没有作答记录。</p>
      ) : (
        <ul className="row wrap gap-2 text-sm">
          {perDay.map((entry) => (
            <li key={entry.day} className="inset min-w-[72px] flex-1 stack gap-1">
              <span className="faint">{weekdayLabel(entry.day)}</span>
              <span className="font-semibold tabular-nums">{entry.count} 题</span>
              {entry.count > 0 ? <span className="faint">得分 {entry.score.toFixed(2)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BarChart({ points, emptyText }: { points: { label: string; value: number }[]; emptyText: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="faint">{emptyText}</p>;
  return (
    <div className="card">
      <div role="img" aria-label="近 30 天每天的作答数量柱状图" className="flex h-24 items-end gap-1">
        {points.map((point, index) => (
          <div
            key={point.label + index}
            className="flex-1 rounded-t bg-brand"
            style={{ height: `${Math.max(3, Math.round((point.value / max) * 100))}%`, opacity: point.value === 0 ? 0.15 : 1 }}
            title={`${point.label}：${point.value} 题`}
          />
        ))}
      </div>
      <div className="row-between mt-2 faint">
        <span>{points[0]?.label}</span>
        <span>峰值 {max} 题/天</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function selectRange(attempts: AttemptRecord[], range: RangeKey, dateKey: string): AttemptRecord[] {
  switch (range) {
    case 'today':
      return inRange(attempts, dateKey, dateKey);
    case 'week':
      return inRange(attempts, startOfWeekKey(dateKey), dateKey);
    case 'month':
      return inRange(attempts, addDays(dateKey, -29), dateKey);
    case 'all':
      return attempts;
  }
}

export function daysSinceFirst(attempts: AttemptRecord[], dateKey: string): number {
  if (attempts.length === 0) return 0;
  const first = attempts.map((a) => a.dateKey).sort()[0];
  return diffDays(first, dateKey) + 1;
}
