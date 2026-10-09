import { describe, expect, it } from 'vitest';

import type { AttemptRecord } from '@/lib/domain/records';
import type { ExerciseCard } from '@/lib/domain/catalog';
import type { Journal } from '@/lib/domain/journal';
import { createEmptyJournal } from '@/lib/domain/journal';
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
} from '@/lib/domain/stats';

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: `atp-${Math.random().toString(36).slice(2)}`,
    profileId: 'p1',
    exerciseId: 'ex-a',
    exerciseVersion: 1,
    dateKey: '2026-03-16',
    createdAt: Date.UTC(2026, 2, 16, 4),
    answer: { format: 'single-choice', keys: ['A'] },
    outcome: 'correct',
    score: 1,
    timeSpentSeconds: 30,
    confidence: 3,
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

function card(overrides: Partial<ExerciseCard> = {}): ExerciseCard {
  return {
    id: 'ex-a',
    version: 1,
    category: 'conditional-reasoning',
    categoryLabel: '条件推理',
    format: 'single-choice',
    difficulty: 2,
    estimatedSeconds: 60,
    knowledgePoints: ['modus-tollens'],
    reviewTags: [],
    status: 'validated',
    ...overrides,
  };
}

describe('指标口径', () => {
  it('没有数据时给出“暂无数据”并标记样本不足，而不是 0%', () => {
    for (const metric of [accuracyMetric([]), avgScoreMetric([]), timeMetric([])]) {
      expect(metric.display).toBe('暂无数据');
      expect(metric.insufficientData).toBe(true);
      expect(metric.formula.length).toBeGreaterThan(0);
    }
  });

  it('正确率把部分正确按 0.5 加权，开放题自评不进分子', () => {
    const list = [
      attempt({ outcome: 'correct', score: 1 }),
      attempt({ outcome: 'partial', score: 0.6 }),
      attempt({ outcome: 'incorrect', score: 0 }),
      attempt({ outcome: 'self-assessed', score: 0.75 }),
    ];
    const metric = accuracyMetric(list);
    expect(metric.value).toBeCloseTo((1 + 0.5) / 4);
    expect(metric.display).toBe('38%');
    expect(metric.insufficientData).toBe(true); // 4 次 < 12 次阈值
  });

  it('平均得分排除自评题，用时按全部作答求平均', () => {
    const list = [attempt({ score: 1, timeSpentSeconds: 10 }), attempt({ score: 0, timeSpentSeconds: 20, outcome: 'incorrect' })];
    expect(avgScoreMetric(list).value).toBeCloseTo(0.5);
    expect(timeMetric(list).value).toBeCloseTo(15);
    expect(timeMetric(list).display).toBe('15 秒');
  });

  it('inRange 两端都包含', () => {
    const list = [attempt({ dateKey: '2026-03-01' }), attempt({ dateKey: '2026-03-05' }), attempt({ dateKey: '2026-03-09' })];
    expect(inRange(list, '2026-03-01', '2026-03-05')).toHaveLength(2);
  });
});

describe('错误类型分布', () => {
  it('跨题重复率区分“稳定习惯”和“偶发失误”', () => {
    // 同一道题上重复同一个错误：1 - 唯一题数/次数 = 1 - 1/2 = 0.5，视为稳定习惯。
    const same = [
      attempt({ exerciseId: 'ex-a', errorTypes: ['denying-antecedent'] }),
      attempt({ exerciseId: 'ex-a', errorTypes: ['denying-antecedent'] }),
    ];
    expect(errorTypeDistribution(same)[0].repeatRate).toBeCloseTo(0.5);

    // 分散在三道不同题上：没有跨题重复，视为偶发。
    const spread = [
      attempt({ exerciseId: 'ex-a', errorTypes: ['denying-antecedent'] }),
      attempt({ exerciseId: 'ex-b', errorTypes: ['denying-antecedent'] }),
      attempt({ exerciseId: 'ex-c', errorTypes: ['denying-antecedent'] }),
    ];
    const row = errorTypeDistribution(spread)[0];
    expect(row.count).toBe(3);
    expect(row.share).toBeCloseTo(1);
    expect(row.repeatRate).toBeCloseTo(0);
    expect(row.label).toBe('否定前件');
  });

  it('一次错误没有重复可言，重复率为 0', () => {
    const row = errorTypeDistribution([attempt({ errorTypes: ['false-dilemma'] })])[0];
    expect(row.repeatRate).toBe(0);
  });
});

describe('题型与趋势', () => {
  it('目录里不存在的题目不计入题型统计', () => {
    const list = [attempt({ exerciseId: 'ex-missing' })];
    expect(categoryStats(list, [card()])).toEqual([]);
  });

  it('样本量不足时仍然给出数字，但标记 insufficientData', () => {
    const rows = categoryStats([attempt()], [card()]);
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].insufficientData).toBe(true);
  });

  it('趋势比较在中点前后各需 12 次样本', () => {
    const before = Array.from({ length: 5 }, () => attempt({ dateKey: '2026-03-01' }));
    const after = Array.from({ length: 5 }, () => attempt({ dateKey: '2026-03-20', score: 0.5, outcome: 'partial' }));
    const weak = trendCompare([...before, ...after], '2026-03-10');
    expect(weak.reliable).toBe(false);
    expect(weak.note).toContain('不做变化结论');

    const manyBefore = Array.from({ length: 12 }, () => attempt({ dateKey: '2026-03-01', score: 0.5, outcome: 'partial' }));
    const manyAfter = Array.from({ length: 12 }, () => attempt({ dateKey: '2026-03-20' }));
    const strong = trendCompare([...manyBefore, ...manyAfter], '2026-03-10');
    expect(strong.reliable).toBe(true);
    expect(strong.delta).toBeCloseTo(0.5);
  });
});

describe('复习效果', () => {
  it('少于 6 组配对样本时明确拒绝比较', () => {
    const list = [attempt({ exerciseId: 'ex-a' }), attempt({ exerciseId: 'ex-a', isReview: true, score: 0 })];
    const metric = reviewEffectiveness(list);
    expect(metric.insufficientData).toBe(true);
    expect(metric.display).toBe('样本不足');
    expect(metric.note).toContain('配对样本 1 组');
  });

  it('只比较“同一题的首次与复习”，单次出现的题不参与配对', () => {
    const pairs = Array.from({ length: 6 }, (_, i) => [
      attempt({ exerciseId: `ex-${i}`, score: 0, outcome: 'incorrect' }),
      attempt({ exerciseId: `ex-${i}`, score: 1, isReview: true }),
    ]).flat();
    // 只作答过一次的题没有“复习前后”可言，不应进入分母。
    const singles = Array.from({ length: 3 }, (_, i) => attempt({ exerciseId: `solo-${i}`, score: 0, outcome: 'incorrect' }));
    const metric = reviewEffectiveness([...pairs, ...singles]);
    expect(metric.insufficientData).toBe(false);
    expect(metric.value).toBeCloseTo(1);
    expect(metric.display).toBe('+1.00');
    expect(metric.note).toContain('不等于逻辑能力');
  });
});

describe('每日任务完成率', () => {
  const plan = (dateKey: string, requiredIds: string[]) => ({
    id: `plan-${dateKey}`,
    profileId: 'p1',
    dateKey,
    budgetMinutes: 10,
    restDay: false,
    items: requiredIds.map((id) => ({
      id,
      activity: 'exercise' as const,
      exerciseId: 'ex-a',
      journalId: null,
      estimatedSeconds: 60,
      reason: '',
      kind: 'new' as const,
      required: true,
    })),
    generatedAt: 1,
    notes: [],
    algorithm: 'logicdaily-daily-plan-v1',
  });

  it('空计划日不计入分母，完成必做项即算完成', () => {
    const plans = [plan('2026-03-01', ['i1']), plan('2026-03-02', ['i1']), { ...plan('2026-03-03', []), items: [] }];
    const progresses = [
      {
        dateKey: '2026-03-01',
        profileId: 'p1',
        planId: 'plan-2026-03-01',
        completedItemIds: ['i1'],
        skippedItemIds: [],
        totalSeconds: 60,
        attempts: 1,
        updatedAt: 1,
      },
      {
        dateKey: '2026-03-02',
        profileId: 'p1',
        planId: 'plan-2026-03-02',
        completedItemIds: [],
        skippedItemIds: [],
        totalSeconds: 0,
        attempts: 0,
        updatedAt: 1,
      },
    ];
    const metric = completionMetric(plans, progresses, '2026-03-01', '2026-03-03');
    expect(metric.value).toBeCloseTo(0.5);
    expect(metric.formula).toContain('必做项');
    expect(metric.insufficientData).toBe(true); // 3 天 < 7 天
  });
});

describe('日志统计', () => {
  function journal(overrides: Partial<Journal> = {}): Journal {
    return { ...createEmptyJournal({ id: 'j-1', profileId: 'p1', nowTs: 1 }), ...overrides };
  }

  it('删除的日志不进入任何统计', () => {
    const list = [journal(), journal({ id: 'j-2', deleted: true })];
    const stats = journalStats(list);
    expect(stats.total).toBe(1);
    expect(stats.open).toBe(1);
  });

  it('反面证据只统计 oppose 与 alternative', () => {
    const list = [
      journal({ id: 'j-1', evidence: [{ id: 'e1', journalId: 'j-1', stance: 'support', text: '支持', source: '', reliability: 3, createdAt: 1 }] }),
      journal({ id: 'j-2', evidence: [{ id: 'e2', journalId: 'j-2', stance: 'oppose', text: '反对', source: '', reliability: 3, createdAt: 1 }] }),
      journal({
        id: 'j-3',
        evidence: [{ id: 'e3', journalId: 'j-3', stance: 'alternative', text: '另一种解释', source: '', reliability: 3, createdAt: 1 }],
      }),
    ];
    const stats = journalStats(list);
    expect(stats.withOpposingEvidence).toBe(2);
    expect(stats.opposingEvidenceRate.value).toBeCloseTo(2 / 3);
    expect(stats.opposingEvidenceRate.insufficientData).toBe(true);
  });

  it('复盘样本不足 3 篇时不评估信心校准', () => {
    const stats = journalStats([journal({ status: 'reviewed', reviewOutcome: '结果如预期' })]);
    expect(stats.reviewed).toBe(1);
    expect(stats.confidenceCalibration.label).toBe('已复盘 1 篇');
    expect(stats.confidenceCalibration.note).toContain('暂不评估');
  });
});

describe('作答量序列与建议', () => {
  it('dailySeries 补齐区间内的空白天', () => {
    const series = dailySeries([attempt({ dateKey: '2026-03-03' })], '2026-03-01', '2026-03-05');
    expect(series.map((d) => d.attempts)).toEqual([0, 0, 1, 0, 0]);
    expect(series[2].dateKey).toBe('2026-03-03');
  });

  it('数据不足时只给一条“先积累数据”的建议', () => {
    const suggestions = buildSuggestions({
      attempts: [attempt()],
      errors: [],
      categories: [],
      journals: [],
      dueReviews: 0,
      streakCurrent: 0,
      streakBest: 0,
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].basis).toContain('不生成结论');
  });

  it('每条建议都带依据，且会点名高重复错误与薄弱题型', () => {
    const attempts = Array.from({ length: 12 }, (_, i) =>
      attempt({ exerciseId: `ex-${i % 4}`, dateKey: '2026-03-10', errorTypes: ['denying-antecedent'], outcome: 'incorrect', score: 0 }),
    );
    const suggestions = buildSuggestions({
      attempts,
      errors: errorTypeDistribution(attempts),
      categories: categoryStats(attempts, [card({ id: 'ex-0' }), card({ id: 'ex-1' }), card({ id: 'ex-2' }), card({ id: 'ex-3' })]),
      journals: [],
      dueReviews: 2,
      streakCurrent: 1,
      streakBest: 5,
    });
    expect(suggestions.every((s) => s.basis.length > 0)).toBe(true);
    expect(suggestions.some((s) => s.text.includes('到期复习'))).toBe(true);
    expect(suggestions.some((s) => s.text.includes('否定前件'))).toBe(true);
    expect(suggestions.some((s) => s.text.includes('条件推理'))).toBe(true);
  });

  it('只写支持证据的日志会被点名', () => {
    const journals = ['j-1', 'j-2'].map((id) => ({
      ...createEmptyJournal({ id, profileId: 'p1', nowTs: 1 }),
      evidence: [{ id: `e-${id}`, journalId: id, stance: 'support' as const, text: '只有支持', source: '', reliability: 3, createdAt: 1 }],
    }));
    const suggestions = buildSuggestions({
      attempts: [],
      errors: [],
      categories: [],
      journals,
      dueReviews: 0,
      streakCurrent: 0,
      streakBest: 0,
    });
    expect(suggestions.some((s) => s.text.includes('只记录了支持自己结论的证据'))).toBe(true);
  });
});
