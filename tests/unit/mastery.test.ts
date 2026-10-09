import { describe, expect, it } from 'vitest';

import {
  createKnowledgeState,
  knowledgeEvidence,
  MASTERY_MIN_ATTEMPTS,
  masteryBand,
  masteryPercent,
  rankedWeakPoints,
  updateKnowledgeState,
  weaknessScore,
  masteryFormulaText,
} from '@/lib/domain/mastery';

const NOW = Date.UTC(2026, 2, 15, 4, 0);
const TODAY = '2026-03-15';

function update(outcome: 'correct' | 'partial' | 'incorrect', overrides: Record<string, unknown> = {}) {
  return {
    knowledgePointId: 'kp-1',
    outcome,
    difficulty: 3,
    confidence: 4,
    errorTypes: [],
    todayKey: TODAY,
    nowTs: NOW,
    ...overrides,
  };
}

describe('掌握度', () => {
  it('样本不足时不给出百分比', () => {
    const state = updateKnowledgeState(null, update('correct'));
    expect(state.attempts).toBe(1);
    expect(masteryPercent(state)).toBeNull();
    expect(knowledgeEvidence(state)).toBe('insufficient');
    expect(masteryBand(state).tone).toBe('unknown');
  });

  it('连续答对让表现值上升但不跳到 100', () => {
    let state = createKnowledgeState('kp-1', NOW);
    for (let i = 0; i < 6; i += 1) state = updateKnowledgeState(state, update('correct'));
    expect(state.attempts).toBe(6);
    const percent = masteryPercent(state);
    expect(percent).not.toBeNull();
    expect(percent ?? 0).toBeGreaterThan(80);
    expect(percent ?? 0).toBeLessThan(100);
    expect(knowledgeEvidence(state)).toBe('developing');
  });

  it('连续答错把表现值压到低位', () => {
    let state = createKnowledgeState('kp-1', NOW);
    for (let i = 0; i < 6; i += 1) state = updateKnowledgeState(state, update('incorrect', { confidence: 3 }));
    expect(masteryPercent(state)).toBeLessThan(15);
    expect(masteryBand(state).tone).toBe('weak');
  });

  it('低信心的答对推进幅度小于高信心的答对', () => {
    const base = createKnowledgeState('kp-1', NOW);
    const lowConf = updateKnowledgeState(base, update('correct', { confidence: 1 }));
    const highConf = updateKnowledgeState(base, update('correct', { confidence: 5 }));
    expect(highConf.ewma).toBeGreaterThan(lowConf.ewma);
  });

  it('部分正确介于答对与答错之间', () => {
    const base = createKnowledgeState('kp-1', NOW);
    const wrong = updateKnowledgeState(base, update('incorrect'));
    const partial = updateKnowledgeState(base, update('partial'));
    const right = updateKnowledgeState(base, update('correct'));
    expect(partial.ewma).toBeGreaterThan(wrong.ewma);
    expect(partial.ewma).toBeLessThan(right.ewma);
  });

  it('结果始终落在 0..1', () => {
    let state = createKnowledgeState('kp-1', NOW);
    for (let i = 0; i < 30; i += 1) {
      state = updateKnowledgeState(state, update(i % 3 === 0 ? 'incorrect' : 'correct', { difficulty: 5 }));
    }
    expect(state.ewma).toBeGreaterThanOrEqual(0);
    expect(state.ewma).toBeLessThanOrEqual(1);
  });

  it('保留最近 5 个错误类型用于薄弱定位', () => {
    let state = createKnowledgeState('kp-1', NOW);
    for (const t of ['equivocation', 'false-dilemma', 'circular-reasoning', 'ad-hominem', 'base-rate-neglect', 'hasty-generalization'] as const) {
      state = updateKnowledgeState(state, update('incorrect', { errorTypes: [t] }));
    }
    expect(state.recentErrorTypes.length).toBeLessThanOrEqual(5);
    expect(state.recentErrorTypes).not.toContain('equivocation');
  });

  it('薄弱排序需要达到最小样本', () => {
    const strong = { ...createKnowledgeState('kp-strong', NOW), attempts: MASTERY_MIN_ATTEMPTS + 2, ewma: 0.9 };
    const weak = { ...createKnowledgeState('kp-weak', NOW), attempts: MASTERY_MIN_ATTEMPTS + 2, ewma: 0.2 };
    const tiny = { ...createKnowledgeState('kp-tiny', NOW), attempts: 1, ewma: 0 };
    const ranked = rankedWeakPoints([strong, weak, tiny]);
    expect(ranked[0].knowledgePointId).toBe('kp-weak');
    expect(ranked.map((r) => r.knowledgePointId)).not.toContain('kp-tiny');
    expect(weaknessScore(weak)).toBeGreaterThan(weaknessScore(strong));
    expect(weaknessScore(tiny)).toBe(0);
  });

  it('公式说明里明确不等于能力测量', () => {
    expect(masteryFormulaText()).toContain('不能等同于逻辑能力或智力水平');
    expect(masteryFormulaText()).toContain(String(MASTERY_MIN_ATTEMPTS));
  });
});
