import type { AttemptRecord, DailyPlanRecord, DailyProgressRecord } from '@/lib/domain/records';
import type { Journal } from '@/lib/domain/journal';
import type { ExerciseCard } from '@/lib/domain/catalog';
import { CATEGORY_LABELS, LOGIC_ERROR_LABELS, type ExerciseCategory, type LogicErrorType } from '@/lib/domain/taxonomy';
import { addDays, diffDays, rangeKeys, type DateKey } from '@/lib/domain/time';

export const MIN_SAMPLE_FOR_TREND = 12;
export const MIN_SAMPLE_FOR_COMPARISON = 6;

export interface Metric {
  key: string;
  label: string;
  value: number;
  display: string;
  formula: string;
  note?: string;
  insufficientData: boolean;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function inRange(attempts: AttemptRecord[], fromKey: DateKey, toKey: DateKey): AttemptRecord[] {
  return attempts.filter((a) => a.dateKey >= fromKey && a.dateKey <= toKey);
}

export function accuracyMetric(attempts: AttemptRecord[]): Metric {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.outcome === 'correct').length;
  const partial = attempts.filter((a) => a.outcome === 'partial').length;
  const weighted = total === 0 ? 0 : (correct + partial * 0.5) / total;
  return {
    key: 'accuracy',
    label: '作答正确率',
    value: weighted,
    display: total === 0 ? '暂无数据' : pct(weighted),
    formula: '(答对数 + 部分正确数 × 0.5) ÷ 总作答数。开放题的自评分不计入分母外的加权。',
    note: total < MIN_SAMPLE_FOR_TREND ? `样本 ${total} 次，少于 ${MIN_SAMPLE_FOR_TREND} 次时不宜比较趋势。` : undefined,
    insufficientData: total < MIN_SAMPLE_FOR_TREND,
  };
}

export function avgScoreMetric(attempts: AttemptRecord[]): Metric {
  const scored = attempts.filter((a) => a.outcome !== 'self-assessed');
  const avg = scored.length === 0 ? 0 : scored.reduce((s, a) => s + a.score, 0) / scored.length;
  return {
    key: 'avg-score',
    label: '平均得分',
    value: avg,
    display: scored.length === 0 ? '暂无数据' : avg.toFixed(2),
    formula: '每次作答得分（答对 1、部分正确按覆盖率、答错 0）的算术平均，排除开放题自评。',
    insufficientData: scored.length < MIN_SAMPLE_FOR_TREND,
  };
}

export function timeMetric(attempts: AttemptRecord[]): Metric {
  const answered = attempts.filter((a) => a.timeSpentSeconds > 0);
  const avg = answered.length === 0 ? 0 : answered.reduce((s, a) => s + a.timeSpentSeconds, 0) / answered.length;
  return {
    key: 'avg-time',
    label: '平均作答用时',
    value: avg,
    display: answered.length === 0 ? '暂无数据' : `${Math.round(avg)} 秒`,
    formula: '各题作答用时的算术平均，仅统计实际提交作答的记录。',
    insufficientData: answered.length < MIN_SAMPLE_FOR_TREND,
  };
}

export function causeDistribution(attempts: AttemptRecord[]): {
  cause: string;
  label: string;
  count: number;
  share: number;
}[] {
  const counts = new Map<string, number>();
  for (const a of attempts) {
    if (a.outcome === 'correct' || a.outcome === 'self-assessed') continue;
    counts.set(a.cause, (counts.get(a.cause) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  return [...counts.entries()]
    .map(([cause, count]) => ({ cause, label: cause, count, share: total === 0 ? 0 : count / total }))
    .sort((a, b) => b.count - a.count);
}

export function errorTypeDistribution(attempts: AttemptRecord[]): {
  errorType: LogicErrorType;
  label: string;
  count: number;
  share: number;
  repeatRate: number;
}[] {
  const counts = new Map<LogicErrorType, number>();
  const exerciseSets = new Map<LogicErrorType, Set<string>>();
  for (const a of attempts) {
    for (const t of a.errorTypes) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      const set = exerciseSets.get(t) ?? new Set<string>();
      set.add(a.exerciseId);
      exerciseSets.set(t, set);
    }
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  return [...counts.entries()]
    .map(([errorType, count]) => ({
      errorType,
      label: LOGIC_ERROR_LABELS[errorType],
      count,
      share: total === 0 ? 0 : count / total,
      // 同一道题重复出现同一错误，说明是稳定的思维习惯而不是偶发。
      repeatRate: count === 0 ? 0 : 1 - (exerciseSets.get(errorType)?.size ?? 1) / count,
    }))
    .sort((a, b) => b.count - a.count);
}

export function categoryStats(
  attempts: AttemptRecord[],
  catalog: ExerciseCard[],
): {
  category: ExerciseCategory;
  label: string;
  attempts: number;
  correctRate: number;
  avgScore: number;
  insufficientData: boolean;
}[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const groups = new Map<ExerciseCategory, AttemptRecord[]>();
  for (const a of attempts) {
    const card = byId.get(a.exerciseId);
    if (!card) continue;
    const list = groups.get(card.category) ?? [];
    list.push(a);
    groups.set(card.category, list);
  }
  return [...groups.entries()]
    .map(([category, list]) => {
      const scored = list.filter((x) => x.outcome !== 'self-assessed');
      const correct = list.filter((x) => x.outcome === 'correct').length;
      return {
        category,
        label: CATEGORY_LABELS[category],
        attempts: list.length,
        correctRate: list.length === 0 ? 0 : correct / list.length,
        avgScore: scored.length === 0 ? 0 : scored.reduce((s, x) => s + x.score, 0) / scored.length,
        insufficientData: list.length < MIN_SAMPLE_FOR_TREND,
      };
    })
    .sort((a, b) => b.attempts - a.attempts);
}

/**
 * 复习效果定义为“复习作答的表现 − 首次作答的表现”，只比较同一道题两次都有记录的情况。
 * 样本少时明确标记不足，避免把它说成能力提升。
 */
export function reviewEffectiveness(attempts: AttemptRecord[]): Metric {
  const first = new Map<string, AttemptRecord>();
  const reviews: AttemptRecord[] = [];
  const ordered = [...attempts].sort((a, b) => a.createdAt - b.createdAt);
  for (const a of ordered) {
    if (!first.has(a.exerciseId)) first.set(a.exerciseId, a);
    else if (a.isReview) reviews.push(a);
  }
  const paired = reviews.filter((r) => first.has(r.exerciseId));
  if (paired.length < MIN_SAMPLE_FOR_COMPARISON) {
    return {
      key: 'review-effect',
      label: '复习后表现变化',
      value: 0,
      display: '样本不足',
      formula: '复习作答平均得分 − 同一题首次作答平均得分。',
      note: `配对样本 ${paired.length} 组，少于 ${MIN_SAMPLE_FOR_COMPARISON} 组时不做比较。`,
      insufficientData: true,
    };
  }
  const firstAvg = paired.reduce((s, r) => s + (first.get(r.exerciseId)?.score ?? 0), 0) / paired.length;
  const reviewAvg = paired.reduce((s, r) => s + r.score, 0) / paired.length;
  const delta = reviewAvg - firstAvg;
  return {
    key: 'review-effect',
    label: '复习后表现变化',
    value: delta,
    display: `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`,
    formula: '复习作答平均得分 − 同一题首次作答平均得分（仅配对样本）。',
    note: '这是练习表现的变化，不等于逻辑能力的测量。',
    insufficientData: false,
  };
}

export function completionMetric(plans: DailyPlanRecord[], progresses: DailyProgressRecord[], fromKey: DateKey, toKey: DateKey): Metric {
  const within = plans.filter((p) => p.dateKey >= fromKey && p.dateKey <= toKey);
  const progressByDate = new Map(progresses.map((x) => [x.dateKey, x]));
  let done = 0;
  let total = 0;
  for (const plan of within) {
    const progress = progressByDate.get(plan.dateKey);
    const required = plan.items.filter((i) => i.required);
    if (required.length === 0 && plan.items.length === 0) continue;
    total += 1;
    const completed = progress ? new Set(progress.completedItemIds) : new Set<string>();
    const target = required.length > 0 ? required : plan.items;
    if (target.every((i) => completed.has(i.id))) done += 1;
  }
  const rate = total === 0 ? 0 : done / total;
  return {
    key: 'completion',
    label: '每日任务完成率',
    value: rate,
    display: total === 0 ? '暂无数据' : pct(rate),
    formula: '完成必做项（若有）或全部项目的天数 ÷ 有计划的天数。',
    insufficientData: total < 7,
  };
}

export function journalStats(journals: Journal[]): {
  total: number;
  open: number;
  reviewed: number;
  withOpposingEvidence: number;
  opposingEvidenceRate: Metric;
  confidenceCalibration: { label: string; note: string };
} {
  const live = journals.filter((j) => !j.deleted);
  const reviewed = live.filter((j) => j.status === 'reviewed' || j.status === 'decided');
  const withOpposing = live.filter((j) => j.evidence.some((e) => e.stance === 'oppose' || e.stance === 'alternative'));
  const rate = live.length === 0 ? 0 : withOpposing.length / live.length;
  const reviewedWithOutcome = reviewed.filter((j) => j.reviewOutcome.trim().length > 0);
  return {
    total: live.length,
    open: live.filter((j) => j.status === 'open' || j.status === 'review-due').length,
    reviewed: reviewed.length,
    withOpposingEvidence: withOpposing.length,
    opposingEvidenceRate: {
      key: 'opposing-evidence',
      label: '主动记录反面证据的比例',
      value: rate,
      display: live.length === 0 ? '暂无数据' : pct(rate),
      formula: '包含“与结论冲突”或“支持另一种解释”证据的日志数 ÷ 全部日志数。',
      note: '这是一个行为指标：你是否在寻找反对证据，而不是成绩。',
      insufficientData: live.length < 5,
    },
    confidenceCalibration: {
      label: `已复盘 ${reviewedWithOutcome.length} 篇`,
      note:
        reviewedWithOutcome.length < 3
          ? '复盘样本不足 3 篇，暂不评估你的信心与实际结果的吻合程度。'
          : '可以对比“当初的信心”和“复盘结论”，观察自己是否高估了判断。',
    },
  };
}

export function dailySeries(
  attempts: AttemptRecord[],
  fromKey: DateKey,
  toKey: DateKey,
): { dateKey: DateKey; attempts: number; score: number; seconds: number }[] {
  const days = rangeKeys(fromKey, Math.max(1, diffDays(fromKey, toKey) + 1));
  const byDate = new Map<string, AttemptRecord[]>();
  for (const a of attempts) {
    const list = byDate.get(a.dateKey) ?? [];
    list.push(a);
    byDate.set(a.dateKey, list);
  }
  return days.map((dateKey) => {
    const list = byDate.get(dateKey) ?? [];
    const scored = list.filter((x) => x.outcome !== 'self-assessed');
    return {
      dateKey,
      attempts: list.length,
      score: scored.length === 0 ? 0 : scored.reduce((s, x) => s + x.score, 0) / scored.length,
      seconds: list.reduce((s, x) => s + x.timeSpentSeconds, 0),
    };
  });
}

export function trendCompare(
  attempts: AttemptRecord[],
  midpoint: DateKey,
): { earlier: number; later: number; delta: number; reliable: boolean; note: string } {
  const before = attempts.filter((a) => a.dateKey < midpoint && a.outcome !== 'self-assessed');
  const after = attempts.filter((a) => a.dateKey >= midpoint && a.outcome !== 'self-assessed');
  const avg = (list: AttemptRecord[]) => (list.length === 0 ? 0 : list.reduce((s, a) => s + a.score, 0) / list.length);
  const earlier = avg(before);
  const later = avg(after);
  const reliable = before.length >= MIN_SAMPLE_FOR_TREND && after.length >= MIN_SAMPLE_FOR_TREND;
  return {
    earlier,
    later,
    delta: later - earlier,
    reliable,
    note: reliable
      ? '两段样本量都足够，可以观察平均得分的变化（仍只是练习表现）。'
      : `样本不足（前 ${before.length} / 后 ${after.length}），不做变化结论。`,
  };
}

export interface Suggestion {
  text: string;
  basis: string;
}

/** 规则化建议：每条都能说明依据，且在数据不足时明确不说。 */
export function buildSuggestions(input: {
  attempts: AttemptRecord[];
  errors: ReturnType<typeof errorTypeDistribution>;
  categories: ReturnType<typeof categoryStats>;
  journals: Journal[];
  dueReviews: number;
  streakCurrent: number;
  streakBest: number;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const { attempts, errors, categories, journals, dueReviews, streakCurrent, streakBest } = input;

  if (dueReviews > 0) {
    out.push({
      text: `先把 ${dueReviews} 项到期复习做完，再开新题。`,
      basis: '复习队列按间隔调度排序，逾期项的收益最高。',
    });
  }

  const top = errors[0];
  if (top && top.count >= 3 && top.repeatRate >= 0.3) {
    out.push({
      text: `近期“${top.label}”出现 ${top.count} 次，而且多次出现在不同题目上，建议集中做 3 道同类题并在解析里写出它的正确形式。`,
      basis: `错误类型分布：${top.label} 占比 ${pct(top.share)}，跨题重复率 ${pct(top.repeatRate)}。`,
    });
  }

  const weakCategory = [...categories].filter((c) => !c.insufficientData).sort((a, b) => a.correctRate - b.correctRate)[0];
  if (weakCategory) {
    out.push({
      text: `${weakCategory.label}的正确率是 ${pct(weakCategory.correctRate)}（${weakCategory.attempts} 次作答），可以把它作为本周的主要练习面。`,
      basis: '按题型聚合作答记录，样本量达到阈值后才给出建议。',
    });
  }

  const noOpposing = journals.filter((j) => !j.deleted && j.evidence.every((e) => e.stance === 'support'));
  if (noOpposing.length >= 2) {
    out.push({
      text: `有 ${noOpposing.length} 篇日志只记录了支持自己结论的证据。挑一篇，写出至少一条反对证据或第二种解释。`,
      basis: '日志中反面证据缺失是可通过行为直接改善的部分，与答题正确率无关。',
    });
  }

  if (attempts.length >= 5 && streakCurrent === 0 && streakBest > 2) {
    out.push({
      text: '连续训练已中断，但历史数据仍然有效：今天只做一道题也能重新开始。',
      basis: '连续天数只用于提示恢复，不作为成功指标。',
    });
  }

  const recent = inRange(attempts, addDays(attempts.at(-1)?.dateKey ?? '1970-01-01', -13), attempts.at(-1)?.dateKey ?? '1970-01-01');
  const rushRate = recent.length === 0 ? 0 : recent.filter((a) => a.cause === 'carelessness').length / recent.length;
  if (recent.length >= MIN_SAMPLE_FOR_TREND && rushRate >= 0.3) {
    out.push({
      text: '近两周有较多“作答过快”的错。下次提交前，先用一句话写出你的推理依据。',
      basis: `近 14 天 ${recent.length} 次作答中 ${Math.round(rushRate * recent.length)} 次被归因为匆忙。`,
    });
  }

  if (out.length === 0) {
    out.push({
      text: '先完成今天的一道题和一篇日志，积累到 12 次作答后这里会出现具体建议。',
      basis: '数据不足时不生成结论，避免给出无依据的判断。',
    });
  }
  return out;
}

export function metricListForDay(attempts: AttemptRecord[]): Metric[] {
  return [accuracyMetric(attempts), avgScoreMetric(attempts), timeMetric(attempts)];
}
