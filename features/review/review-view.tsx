'use client';

import { useCallback, useEffect, useState } from 'react';

import { useApp } from '@/app/providers';
import { Button, DifficultyPips, EmptyState, Note, SectionTitle, Skeleton, StatusBadge } from '@/components/ui';
import { CATEGORY_LABELS, LOGIC_ERROR_LABELS } from '@/lib/domain/taxonomy';
import type { Exercise } from '@/lib/domain/exercise-schema';
import type { ReviewState } from '@/lib/domain/scheduling';
import { describeSchedule, SRS_LIMITS } from '@/lib/domain/scheduling';
import { listDueReviews } from '@/lib/services/training';

interface Row {
  exercise: Exercise;
  state: ReviewState;
  overdueDays: number;
}

export function ReviewView() {
  const { store, profileId, dateKey, nowTs, ready } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState<ReviewState[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store) return;
    try {
      const due = await listDueReviews(store, profileId, dateKey, nowTs);
      setRows(due.map((d) => ({ exercise: d.exercise, state: d.state, overdueDays: d.overdueDays })));
      setAll(await store.listReviewStates(profileId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取复习队列失败');
    }
  }, [store, profileId, dateKey, nowTs]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready) return <Skeleton lines={4} />;
  if (error) return <Note tone="bad" title="读取失败">{error}</Note>;
  if (!rows) return <Skeleton lines={4} />;

  const leeches = rows.filter((r) => r.state.leech);
  const upcoming = all
    .filter((s) => s.dueDateKey && s.dueDateKey > dateKey)
    .sort((a, b) => (a.dueDateKey ?? '').localeCompare(b.dueDateKey ?? ''))
    .slice(0, 5);

  return (
    <div className="stack gap-4">
      <header className="stack gap-1">
        <h1 className="text-2xl">复习</h1>
        <p className="muted text-sm">
          复习队列按间隔调度生成：答错的题当天再来一次，答对的题逐渐拉长间隔（最长 {SRS_LIMITS.maxIntervalDays} 天）。
        </p>
      </header>

      <div className="card row-between">
        <div className="stack gap-1">
          <p className="label">今天到期</p>
          <p className="text-xl font-semibold tabular-nums">{rows.length} 题</p>
        </div>
        {rows.length > 0 ? <Button href="/train?mode=review">开始复习</Button> : null}
      </div>

      {leeches.length > 0 ? (
        <Note tone="warn" title={`${leeches.length} 题已反复答错 ${SRS_LIMITS.leechLapses} 次以上`}>
          建议先读解析、写出正确形式，再做同类题。反复答错通常说明某个知识点还没建立，而不是练得不够。
        </Note>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="今天没有到期复习" action={<Button href="/train">去做今天的题</Button>}>
          <p>复习队列会在你答错或间隔到期时自动填充，不需要手动整理错题本。</p>
        </EmptyState>
      ) : (
        <ul className="stack gap-2">
          {rows.map((row) => (
            <li key={row.state.exerciseId} className="card stack gap-2">
              <div className="row-between">
                <span className="font-semibold">{CATEGORY_LABELS[row.exercise.category]}</span>
                <StatusBadge tone={row.overdueDays > 3 ? 'bad' : row.overdueDays > 0 ? 'warn' : 'neutral'} symbol={row.overdueDays > 0 ? '!' : '·'}>
                  {row.overdueDays > 0 ? `逾期 ${row.overdueDays} 天` : '今天到期'}
                </StatusBadge>
              </div>
              <p className="text-sm muted">{stemPreview(row.exercise.stem)}</p>
              <div className="row-between">
                <DifficultyPips level={row.exercise.difficulty} />
                <span className="faint">
                  重复 {row.state.repetitions} 次 · 答错 {row.state.lapses} 次
                  {row.state.lastErrorTypes.length > 0
                    ? ` · ${row.state.lastErrorTypes.map((t) => LOGIC_ERROR_LABELS[t]).join('、')}`
                    : ''}
                </span>
              </div>
              <p className="faint">{describeSchedule(row.state)}</p>
            </li>
          ))}
        </ul>
      )}

      {upcoming.length > 0 ? (
        <section className="stack gap-2">
          <SectionTitle>接下来会到期</SectionTitle>
          <ul className="stack gap-1.5 text-sm">
            {upcoming.map((state) => (
              <li key={state.exerciseId} className="inset row-between">
                <span className="muted">{state.dueDateKey}</span>
                <span className="faint">间隔 {state.intervalDays} 天</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="card">
        <summary className="cursor-pointer font-semibold">复习调度规则怎么运作</summary>
        <div className="mt-2 stack gap-1 text-sm muted">
          <p>· 作答结果与信心程度共同决定一个 0～5 的复习质量分。</p>
          <p>· 质量分达到 3：间隔按易度系数增长；低于 3：间隔重置为 1 天，并在当天约 30 分钟后再出现一次。</p>
          <p>· 越难的题在答对后获得越短的间隔，因为难题的记忆保持更脆弱。</p>
          <p>· 间隔上下限：{SRS_LIMITS.minIntervalDays} ～ {SRS_LIMITS.maxIntervalDays} 天；易度系数限制在 {SRS_LIMITS.minEase}～{SRS_LIMITS.maxEase}。</p>
        </div>
      </details>
    </div>
  );
}

function stemPreview(stem: string): string {
  const flat = stem.replace(/s+/g, ' ').trim();
  return flat.length > 50 ? `${flat.slice(0, 50)}…` : flat;
}
