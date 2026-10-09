import type { Exercise, ExerciseFormat } from '@/lib/domain/exercise-schema';
import { ACTIVITY_TYPES, CATEGORY_LABELS, type ActivityType, type ExerciseCategory } from '@/lib/domain/taxonomy';

/**
 * 题库索引卡片：日常调度只需要这些轻量字段，完整题目按 id 取用，
 * 避免把整个题库常驻在计划计算的输入里。
 */
export interface ExerciseCard {
  id: string;
  version: number;
  category: ExerciseCategory;
  categoryLabel: string;
  format: ExerciseFormat;
  difficulty: number;
  estimatedSeconds: number;
  knowledgePoints: string[];
  reviewTags: string[];
  status: Exercise['status'];
}

export function toCard(exercise: Exercise): ExerciseCard {
  return {
    id: exercise.id,
    version: exercise.version,
    category: exercise.category,
    categoryLabel: CATEGORY_LABELS[exercise.category],
    format: exercise.format,
    difficulty: exercise.difficulty,
    estimatedSeconds: exercise.estimatedSeconds,
    knowledgePoints: exercise.knowledgePoints,
    reviewTags: exercise.reviewTags,
    status: exercise.status,
  };
}

const ACTIVITY_BY_CATEGORY: Record<ExerciseCategory, ActivityType> = {
  'deductive-reasoning': 'exercise',
  'inductive-reasoning': 'exercise',
  'conditional-reasoning': 'exercise',
  'truth-teller-puzzles': 'exercise',
  'necessary-sufficient-conditions': 'exercise',
  'contrapositive-conversion': 'exercise',
  'statistical-intuition': 'exercise',
  'argument-analysis': 'argument-analysis',
  'logical-fallacies': 'argument-analysis',
  'counterexample-rebuttal': 'argument-analysis',
  'causal-reasoning': 'causal-analysis',
  'correlation-vs-causation': 'causal-analysis',
  'problem-decomposition': 'real-problem-decomposition',
  'decision-analysis': 'real-problem-decomposition',
};

export function activityForExercise(card: ExerciseCard): ActivityType {
  if (card.reviewTags.includes('事实与推测')) return 'fact-vs-inference';
  const activity = ACTIVITY_BY_CATEGORY[card.category];
  return ACTIVITY_TYPES.includes(activity) ? activity : 'exercise';
}

/** 演示/测试用的稳定打乱：不依赖 Math.random，便于快照测试。 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const copy = [...items];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  const next = () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 选项顺序不暴露正确答案位置：按题目 id 与日期打乱，同一题在同一天保持稳定。 */
export function presentationKeyOrder(keys: string[], seed: string): string[] {
  return seededShuffle(keys, seed);
}
