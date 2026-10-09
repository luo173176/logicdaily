import type { GradeOutcome } from '@/lib/domain/grading';

/**
 * 掌握度是“你在本题库上就该知识点的作答表现”的指数加权平均，
 * 不是智力或逻辑能力的测量。低于 MIN_ATTEMPTS 次样本时不给出百分比。
 */

export const MASTERY_MIN_ATTEMPTS = 3;
export const MASTERY_ALPHA = 0.3;

export interface KnowledgeState {
  knowledgePointId: string;
  /** 0～1 的指数加权表现值。 */
  ewma: number;
  attempts: number;
  correct: number;
  partial: number;
  incorrect: number;
  /** 最近一次出现的错误类型，用于薄弱项定位。 */
  recentErrorTypes: string[];
  lastAttemptDateKey: string | null;
  updatedAt: number;
}

export interface MasteryUpdate {
  knowledgePointId: string;
  outcome: GradeOutcome;
  difficulty: number;
  confidence: number;
  errorTypes: string[];
  todayKey: string;
  nowTs: number;
  selfAssessmentScore?: number;
}

export function createKnowledgeState(id: string, nowTs: number): KnowledgeState {
  return {
    knowledgePointId: id,
    ewma: 0.5,
    attempts: 0,
    correct: 0,
    partial: 0,
    incorrect: 0,
    recentErrorTypes: [],
    lastAttemptDateKey: null,
    updatedAt: nowTs,
  };
}

function outcomeValue(outcome: GradeOutcome, selfAssessmentScore?: number): number {
  switch (outcome) {
    case 'correct':
      return 1;
    case 'partial':
      return 0.55;
    case 'incorrect':
      return 0;
    case 'self-assessed': {
      const score = Math.max(0, Math.min(4, selfAssessmentScore ?? 2));
      return 0.25 + score * 0.1875;
    }
  }
}

export function knowledgeEvidence(state: KnowledgeState): 'insufficient' | 'developing' | 'established' {
  if (state.attempts < MASTERY_MIN_ATTEMPTS) return 'insufficient';
  if (state.attempts < 8) return 'developing';
  return 'established';
}

export function updateKnowledgeState(prev: KnowledgeState | null, input: MasteryUpdate): KnowledgeState {
  const base = prev ?? createKnowledgeState(input.knowledgePointId, input.nowTs);

  const value = outcomeValue(input.outcome, input.selfAssessmentScore);
  // 低信心作答携带的信息更少；极高难度下的作答权重略高。
  const confidenceSignal = 0.55 + 0.09 * clamp(input.confidence, 1, 5);
  const difficultyWeight = clamp(0.7 + 0.1 * input.difficulty, 0.8, 1.2);
  const step = MASTERY_ALPHA * difficultyWeight * confidenceSignal * (value - base.ewma);
  const ewma = clamp(base.ewma + step, 0, 1);

  const counts = {
    correct: base.correct + (input.outcome === 'correct' ? 1 : 0),
    partial: base.partial + (input.outcome === 'partial' ? 1 : 0),
    incorrect: base.incorrect + (input.outcome === 'incorrect' ? 1 : 0),
  };

  return {
    knowledgePointId: input.knowledgePointId,
    ewma,
    attempts: base.attempts + 1,
    ...counts,
    recentErrorTypes: unique([...base.recentErrorTypes, ...input.errorTypes]).slice(-5),
    lastAttemptDateKey: input.todayKey,
    updatedAt: input.nowTs,
  };
}

export function masteryPercent(state: KnowledgeState | null): number | null {
  if (!state || state.attempts < MASTERY_MIN_ATTEMPTS) return null;
  return Math.round(state.ewma * 100);
}

export function masteryBand(state: KnowledgeState | null): {
  label: string;
  tone: 'neutral' | 'weak' | 'growing' | 'solid' | 'unknown';
} {
  const percent = masteryPercent(state);
  if (percent === null) return { label: '样本不足', tone: 'unknown' };
  if (percent < 40) return { label: '需要巩固', tone: 'weak' };
  if (percent < 65) return { label: '正在形成', tone: 'growing' };
  if (percent < 85) return { label: '较为稳定', tone: 'solid' };
  return { label: '表现稳定', tone: 'solid' };
}

export function weaknessScore(state: KnowledgeState): number {
  if (state.attempts < MASTERY_MIN_ATTEMPTS) return 0;
  return (1 - state.ewma) * Math.min(state.attempts / 8, 1.5);
}

export function rankedWeakPoints(states: KnowledgeState[], limit = 5): KnowledgeState[] {
  return [...states]
    .filter((s) => s.attempts >= MASTERY_MIN_ATTEMPTS)
    .sort((a, b) => weaknessScore(b) - weaknessScore(a))
    .slice(0, limit);
}

export function masteryFormulaText(): string {
  return [
    `ewma' = ewma + ${MASTERY_ALPHA} × 难度权重(0.8～1.2) × 信心信号(0.64～1.00) × (表现值 − ewma)`,
    '表现值：答对 1，部分正确 0.55，答错 0，开放题按自评等级映射。',
    `样本不足 ${MASTERY_MIN_ATTEMPTS} 次时不显示百分比。`,
    '掌握度只描述你在本题库上的作答表现，不能等同于逻辑能力或智力水平。',
  ].join('\n');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
