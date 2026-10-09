'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApp } from '@/app/providers';
import { CoachPanel } from '@/features/coach/coach-panel';
import { AnswerControls, emptyAnswer, isAnswered, type AnswerValue } from '@/components/answer-controls';
import { Button, Chip, ConfidencePicker, DifficultyPips, EmptyState, Note, ProgressBar, SectionTitle, Skeleton, StatusBadge } from '@/components/ui';
import type { Exercise } from '@/lib/domain/exercise-schema';
import { describeAnswer, type GradeResult } from '@/lib/domain/grading';
import { CATEGORY_LABELS, LOGIC_ERROR_EXPLANATIONS, LOGIC_ERROR_LABELS, CAUSE_LABELS, type CauseType } from '@/lib/domain/taxonomy';
import { describeSchedule } from '@/lib/domain/scheduling';
import {
  ensureTodayPlan,
  listDueReviews,
  outcomeLabel,
  reviseSelfReport,
  skipPlanItem,
  submitAttempt,
  completeNonExerciseItem,
} from '@/lib/services/training';
import type { DailyPlanRecord, DailyProgressRecord } from '@/lib/domain/records';
import type { PlannedItem } from '@/lib/domain/daily-plan';
import type { SelfReport } from '@/lib/domain/mistake';
import { addDays, relativeDayLabel } from '@/lib/domain/time';

const SELF_REPORT_OPTIONS: { value: Exclude<SelfReport, null>; label: string }[] = [
  { value: 'careless', label: '我粗心了／选错了' },
  { value: 'unknown-term', label: '有不懂的术语或概念' },
  { value: 'misread', label: '我读错题干了' },
  { value: 'ambiguous', label: '题目本身有歧义' },
];

type QueueItem = PlannedItem & { synthetic: boolean };

export function TrainingView() {
  const { store, profileId, settings, dateKey, nowTs, ready, seeding, notify, reseedContent } = useApp();
  const [plan, setPlan] = useState<DailyPlanRecord | null>(null);
  const [progress, setProgress] = useState<DailyProgressRecord | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  // 深链接参数（?mode=review / ?exercise=id）决定队列形态，必须在首次渲染前就位；
  // 服务端渲染时 window 不存在，取默认值，客户端首屏仍被 ready 挡住，不会造成水合差异。
  const [search] = useState(() => (typeof window === 'undefined' ? '' : window.location.search));
  const [reviewOnly] = useState(() => new URLSearchParams(search).get('mode') === 'review');
  const [focusExerciseId] = useState<string | null>(() => new URLSearchParams(search).get('exercise'));
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [answer, setAnswer] = useState<AnswerValue | null>(null);
  const [reasoning, setReasoning] = useState('');
  const [confidence, setConfidence] = useState(3);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<{
    grade: GradeResult;
    attemptId: string;
    cause: CauseType;
    errorTypes: string[];
    repeated: boolean;
    reviewSummary: string;
    acceptedAlternative: string | null;
  } | null>(null);
  const [selfReport, setSelfReport] = useState<SelfReport>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!store || !ready) return;
    let cancelled = false;
    (async () => {
      try {
        const bundle = await ensureTodayPlan(store, { profileId, settings, dateKey, nowTs });
        const storedProgress = await store.getProgress(profileId, dateKey);
        if (cancelled) return;
        setPlan(bundle.plan);
        setProgress(storedProgress);

        if (focusExerciseId) {
          // 定向练习：从复习列表或测试链接直接进入某一道题。
          setQueue([
            {
              id: `focus-${focusExerciseId}`,
              activity: 'exercise',
              exerciseId: focusExerciseId,
              journalId: null,
              estimatedSeconds: 60,
              reason: '定向练习',
              kind: 'new',
              required: false,
              synthetic: true,
            },
          ]);
          setError(null);
          return;
        }
        const done = new Set(storedProgress?.completedItemIds ?? []);
        const skippedIds = new Set(storedProgress?.skippedItemIds ?? []);
        const planItems: QueueItem[] = bundle.plan.items.map((item) => ({ ...item, synthetic: false }));
        const scoped = reviewOnly ? planItems.filter((i) => i.kind === 'review' || i.kind === 'same-day-relearn') : planItems;
        const pending = scoped.filter((i) => !done.has(i.id) && !skippedIds.has(i.id));

        if (reviewOnly && pending.length === 0) {
          // 计划里的复习项可能因为时间预算被排除了；复习页仍要能独立开跑。
          const due = await listDueReviews(store, profileId, dateKey, Date.now());
          setQueue(
            due.map((entry) => ({
              id: `synthetic-${entry.exercise.id}`,
              activity: 'error-review' as const,
              exerciseId: entry.exercise.id,
              journalId: null,
              estimatedSeconds: 50,
              reason: entry.overdueDays > 0 ? `复习：逾期 ${entry.overdueDays} 天` : '复习：今天到期',
              kind: 'review' as const,
              required: false,
              synthetic: true,
            })),
          );
        } else {
          setQueue(scoped);
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '今日计划生成失败。');
      }
    })();
    return () => {
      cancelled = true;
    };
    // settings/dateKey 变化时才重算；nowTs 每分钟更新不应触发重新生成
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ready, profileId, dateKey, settings, reviewOnly, focusExerciseId]);

  const completed = useMemo(() => new Set(progress?.completedItemIds ?? []), [progress]);
  const skipped = useMemo(() => new Set(progress?.skippedItemIds ?? []), [progress]);
  const activeItem = useMemo(() => queue?.find((item) => !completed.has(item.id) && !skipped.has(item.id)) ?? null, [queue, completed, skipped]);

  const loadExercise = useCallback(
    async (id: string) => {
      if (!store) return;
      const found = await store.getExercise(id);
      if (!found) {
        setError(`题目 ${id} 没能从本地题库找到，请在“我的 → 数据与隐私”里重新载入题库。`);
        return;
      }
      setExercise(found);
      setAnswer(emptyAnswer(found));
      setReasoning('');
      setConfidence(3);
      setResult(null);
      setSelfReport(null);
      setStartedAt(Date.now());
    },
    [store],
  );

  useEffect(() => {
    if (activeItem?.exerciseId) {
      void loadExercise(activeItem.exerciseId);
    } else {
      setExercise(null);
      setAnswer(null);
    }
  }, [activeItem, loadExercise]);

  if (!ready) {
    return (
      <div className="stack gap-3">
        <Skeleton lines={4} />
      </div>
    );
  }

  if (seeding.status === 'running') {
    return <Note title="正在准备题库">首次使用需要在本地载入题目，稍候即可开始。</Note>;
  }

  if (error) {
    return (
      <Note tone="bad" title="无法开始训练">
        {error}
      </Note>
    );
  }

  if (!plan) return <Skeleton lines={5} />;

  const queueItems: QueueItem[] = queue ?? [];
  const remaining = queueItems.filter((i) => !completed.has(i.id) && !skipped.has(i.id));

  if (plan.items.length === 0) {
    return (
      <div className="stack gap-4">
        <Note tone="warn" title="本地题库还是空的">
          <div className="stack gap-2">
            <p>{seeding.message || '题目尚未写入本机数据库。'}</p>
            <Button variant="secondary" size="sm" onClick={() => void reseedContent()}>
              重新载入题库
            </Button>
          </div>
        </Note>
      </div>
    );
  }

  if (remaining.length === 0) {
    return (
      <div className="stack gap-4">
        <SectionTitle>今天的任务已经完成</SectionTitle>
        <EmptyState
          title={`已完成 ${completed.size} 项，用时约 ${Math.round((progress?.totalSeconds ?? 0) / 60)} 分钟`}
          action={
            <div className="row wrap gap-2">
              <Button href="/journal">写一篇思考日志</Button>
              <Button href="/stats" variant="secondary">
                看训练统计
              </Button>
            </div>
          }
        >
          <p>计划里剩下的内容会留在复习队列中。{relativeDayLabel(addDays(dateKey, 1), dateKey)}会根据今天的表现重新安排。</p>
        </EmptyState>
        <PlanRationale plan={plan} />
      </div>
    );
  }

  if (!activeItem) {
    return <EmptyState title="今天没有安排的任务">可以在“我的 → 训练偏好”里调整每日时长或训练重点。</EmptyState>;
  }

  if (!activeItem.exerciseId) {
    return (
      <div className="stack gap-4">
        <PlanHeader plan={plan} progress={progress} completed={completed.size} total={queueItems.length} reviewOnly={reviewOnly} />
        <div className="card stack gap-3">
          <p className="label">思考日志</p>
          <p className="font-semibold">{activeItem.reason}</p>
          <div className="row wrap gap-2">
            <Button href={activeItem.journalId ? `/journal/${activeItem.journalId}` : '/journal/new'}>
              {activeItem.journalId ? '去复盘这篇日志' : '开始记录'}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                if (!store) return;
                const next = await completeNonExerciseItem(store, profileId, dateKey, activeItem.id, activeItem.estimatedSeconds, Date.now());
                setProgress(next);
                notify('已记录为完成。');
              }}
            >
              稍后完成
            </Button>
          </div>
        </div>
        <RemainingItems items={queueItems} completed={completed} skipped={skipped} />
      </div>
    );
  }

  return (
    <div className="stack gap-4">
      <PlanHeader plan={plan} progress={progress} completed={completed.size} total={queueItems.length} reviewOnly={reviewOnly} />

      {exercise && answer ? (
        <article className="card stack gap-4">
          <header className="stack gap-2">
            <div className="row-between wrap">
              <span className="chip">{CATEGORY_LABELS[exercise.category]}</span>
              <DifficultyPips level={exercise.difficulty} />
            </div>
            <p className="label">
              第 {queueItems.filter((i) => i.kind !== 'journal').indexOf(activeItem) + 1} 题 · 预计 {Math.round(exercise.estimatedSeconds / 15) * 15}{' '}
              秒 · {activeItem.kind === 'review' || activeItem.kind === 'same-day-relearn' ? '复习' : '新题'}
            </p>
            {exercise.context ? <p className="inset text-sm">{exercise.context}</p> : null}
            <h1 className="text-lg">{exercise.stem}</h1>
            {activeItem.reason ? <p className="faint">{activeItem.reason}</p> : null}
          </header>

          <AnswerControls exercise={exercise} answer={answer} onChange={setAnswer} disabled={!!result} revealed={!!result} seedSuffix={dateKey} />

          {!result ? (
            <div className="stack gap-3">
              <div className="stack gap-1.5">
                <label htmlFor="reasoning" className="label">
                  你的推理过程（建议写，写出来才能定位问题）
                </label>
                <textarea
                  id="reasoning"
                  rows={3}
                  value={reasoning}
                  onChange={(event) => setReasoning(event.target.value)}
                  placeholder="你是怎么从题目条件走到这个答案的？中间有没有你没写出来的假设？"
                />
              </div>
              <ConfidencePicker value={confidence} onChange={setConfidence} />
              <div className="row wrap gap-2">
                <Button
                  disabled={busy || !isAnswered(exercise, answer)}
                  onClick={async () => {
                    if (!store || !exercise || !startedAt) return;
                    setBusy(true);
                    setError(null);
                    try {
                      const submitted = await submitAttempt(store, {
                        profileId,
                        exerciseId: exercise.id,
                        answer,
                        reasoning,
                        confidence,
                        timeSpentSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
                        selfReport,
                        planItemId: activeItem.synthetic ? null : activeItem.id,
                        isReview: activeItem.kind !== 'new',
                        dateKey,
                        nowTs: Date.now(),
                      });
                      const updated = await store.getProgress(profileId, dateKey);
                      setResult({
                        grade: submitted.grade,
                        attemptId: submitted.attempt.id,
                        cause: submitted.attempt.cause,
                        errorTypes: submitted.attempt.errorTypes,
                        repeated: submitted.classification.repeatedPattern,
                        reviewSummary: describeSchedule(submitted.review),
                        acceptedAlternative: submitted.grade.acceptedAlternative,
                      });
                      setProgress(updated);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : '提交失败，请重试。');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? '提交中…' : '提交作答'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!store) return;
                    const next = await skipPlanItem(store, profileId, dateKey, activeItem.id, Date.now());
                    setProgress(next);
                    notify('已跳过，会保留在复习队列里。');
                  }}
                >
                  跳过这题
                </Button>
              </div>
              {!isAnswered(exercise, answer) ? <p className="faint">先选择一个答案或写下内容再提交。</p> : null}
            </div>
          ) : (
            <ResultPanel
              exercise={exercise}
              result={result}
              selfReport={selfReport}
              onSelfReport={async (next) => {
                if (!store) return;
                setSelfReport(next);
                const revised = await reviseSelfReport(store, {
                  profileId,
                  attemptId: result.attemptId,
                  selfReport: next,
                  nowTs: Date.now(),
                });
                if (revised) {
                  setResult({ ...result, cause: revised.attempt.cause, errorTypes: revised.attempt.errorTypes });
                  notify(next === 'ambiguous' ? '已标记题目歧义，并加入题库复核清单。' : `归因已更新为“${CAUSE_LABELS[revised.attempt.cause]}”。`);
                }
              }}
            />
          )}

          {result && exercise && answer ? (
            <CoachPanel
              context={{
                kind: 'attempt',
                exercise,
                grade: result.grade,
                answer,
                reasoning,
                confidence,
              }}
            />
          ) : null}
        </article>
      ) : (
        <Skeleton lines={4} />
      )}

      <RemainingItems items={queueItems} completed={completed} skipped={skipped} />
      <PlanRationale plan={plan} />
    </div>
  );
}

function PlanHeader({
  plan,
  progress,
  completed,
  total,
  reviewOnly,
}: {
  plan: DailyPlanRecord;
  progress: DailyProgressRecord | null;
  completed: number;
  total: number;
  reviewOnly: boolean;
}) {
  return (
    <header className="card stack gap-2">
      <div className="row-between">
        <h1 className="text-lg">{reviewOnly ? '复习队列' : plan.restDay ? '休息日的轻量任务' : '今天的训练'}</h1>
        <span className="chip">{plan.budgetMinutes} 分钟</span>
      </div>
      <ProgressBar value={completed} total={total} label={reviewOnly ? '复习进度' : '完成项目'} />
      <p className="faint">已用时 {Math.round((progress?.totalSeconds ?? 0) / 60)} 分钟。进度只记录你真正做过的事，不代表能力变化。</p>
    </header>
  );
}

function RemainingItems({ items, completed, skipped }: { items: QueueItem[]; completed: Set<string>; skipped: Set<string> }) {
  const remaining = items.filter((i) => !completed.has(i.id) && !skipped.has(i.id));
  if (remaining.length <= 1) return null;
  return (
    <section className="stack gap-2">
      <p className="label">今天还剩 {remaining.length - 1} 项</p>
      <ul className="stack gap-1.5 text-sm">
        {remaining.slice(1).map((item) => (
          <li key={item.id} className="inset">
            <span className="muted">{item.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanRationale({ plan }: { plan: DailyPlanRecord }) {
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">今天的任务是怎么排出来的</summary>
      <ul className="mt-2 stack gap-1 text-sm muted">
        {plan.notes.map((note, index) => (
          <li key={index}>· {note}</li>
        ))}
        <li>· 算法版本：{plan.algorithm}</li>
      </ul>
    </details>
  );
}

function ResultPanel({
  exercise,
  result,
  selfReport,
  onSelfReport,
}: {
  exercise: Exercise;
  result: {
    grade: GradeResult;
    cause: CauseType;
    errorTypes: string[];
    repeated: boolean;
    reviewSummary: string;
    acceptedAlternative: string | null;
  };
  selfReport: SelfReport;
  onSelfReport: (next: Exclude<SelfReport, null>) => void;
}) {
  const { grade } = result;
  const tone = grade.outcome === 'correct' ? 'ok' : grade.outcome === 'partial' ? 'warn' : grade.outcome === 'self-assessed' ? 'neutral' : 'bad';
  const symbol = grade.outcome === 'correct' ? '✓' : grade.outcome === 'partial' ? '◐' : grade.outcome === 'self-assessed' ? '✎' : '✗';

  return (
    <section className="stack gap-4">
      <div className="row-between wrap">
        <StatusBadge tone={tone} symbol={symbol}>
          {outcomeLabel(grade.outcome)}
        </StatusBadge>
        <span className="faint">{grade.rationale}</span>
      </div>

      {result.acceptedAlternative ? (
        <Note tone="neutral" title="这个答案也被接受">
          {result.acceptedAlternative}
        </Note>
      ) : null}

      {grade.outcome !== 'correct' && grade.outcome !== 'self-assessed' ? (
        <div className="stack gap-2">
          <p className="label">这次更像下面哪种情况？（用于区分能力问题与偶然因素）</p>
          <div className="row wrap gap-2">
            {SELF_REPORT_OPTIONS.map((option) => (
              <Chip key={option.value} pressed={selfReport === option.value} onPress={() => onSelfReport(option.value)}>
                {option.label}
              </Chip>
            ))}
          </div>
          <p className="faint">
            当前归因：{CAUSE_LABELS[result.cause]}
            {result.errorTypes.length > 0
              ? ` · 涉及 ${result.errorTypes.map((t) => LOGIC_ERROR_LABELS[t as keyof typeof LOGIC_ERROR_LABELS]).join('、')}`
              : ''}
          </p>
          {result.repeated ? (
            <Note tone="warn" title="同类错误反复出现">
              同一类推理错误最近已出现两次以上，建议集中做几道同类题，并在解析里写出它的正确形式。
            </Note>
          ) : null}
        </div>
      ) : null}

      {result.errorTypes.length > 0 ? (
        <div className="stack gap-2">
          {result.errorTypes.map((type) => (
            <Note key={type} tone="warn" title={`典型错误：${LOGIC_ERROR_LABELS[type as keyof typeof LOGIC_ERROR_LABELS]}`}>
              {LOGIC_ERROR_EXPLANATIONS[type as keyof typeof LOGIC_ERROR_EXPLANATIONS]}
            </Note>
          ))}
        </div>
      ) : null}

      <div className="hairline pt-4 stack gap-2">
        <p className="label">参考答案</p>
        <p className="font-semibold">{describeAnswer(exercise)}</p>
        <p className="label mt-2">解析</p>
        <p>{exercise.explanation.summary}</p>
        <ol className="stack gap-1 pl-5 text-sm">
          {exercise.explanation.steps.map((step, index) => (
            <li key={index}>
              {index + 1}. {step}
            </li>
          ))}
        </ol>
        {exercise.explanation.commonMistakes.length > 0 ? (
          <div className="stack gap-1 text-sm">
            <p className="label mt-2">容易踩的坑</p>
            {exercise.explanation.commonMistakes.map((mistake, index) => (
              <p key={index} className="muted">
                {mistake.option ? `选项 ${mistake.option}：` : ''}
                {mistake.why}
              </p>
            ))}
          </div>
        ) : null}
        <p className="inset mt-2 text-sm">记住：{exercise.explanation.takeaway}</p>
      </div>

      <p className="faint">{result.reviewSummary}</p>
    </section>
  );
}
