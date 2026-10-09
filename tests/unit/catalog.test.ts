import { describe, expect, it } from 'vitest';

import { activityForExercise, presentationKeyOrder, seededShuffle, toCard, type ExerciseCard } from '@/lib/domain/catalog';
import { singleChoiceFixture } from '../fixtures/exercises';

function card(overrides: Partial<ExerciseCard> = {}): ExerciseCard {
  return {
    id: 'ex-a',
    version: 1,
    category: 'conditional-reasoning',
    categoryLabel: '条件推理',
    format: 'single-choice',
    difficulty: 2,
    estimatedSeconds: 60,
    knowledgePoints: [],
    reviewTags: [],
    status: 'validated',
    ...overrides,
  };
}

describe('题库索引卡片', () => {
  it('toCard 只保留调度需要的轻量字段，不带题干与选项正文', () => {
    const result = toCard(singleChoiceFixture());
    expect(Object.keys(result).sort()).toEqual(
      ['category', 'categoryLabel', 'difficulty', 'estimatedSeconds', 'format', 'id', 'knowledgePoints', 'reviewTags', 'status', 'version'].sort(),
    );
    expect(result.categoryLabel).toBe('条件推理');
    expect(JSON.stringify(result)).not.toContain('如果');
  });
});

describe('活动类型映射', () => {
  it('“事实与推测”复习标签优先于题型映射', () => {
    expect(activityForExercise(card({ reviewTags: ['事实与推测'] }))).toBe('fact-vs-inference');
  });

  it('不同题型族落到不同的活动类型', () => {
    expect(activityForExercise(card({ category: 'deductive-reasoning' }))).toBe('exercise');
    expect(activityForExercise(card({ category: 'argument-analysis' }))).toBe('argument-analysis');
    expect(activityForExercise(card({ category: 'causal-reasoning' }))).toBe('causal-analysis');
    expect(activityForExercise(card({ category: 'decision-analysis' }))).toBe('real-problem-decomposition');
  });

  it('未知题型回落到 exercise，不会产生非法活动类型', () => {
    expect(activityForExercise(card({ category: '不存在的题型' as ExerciseCard['category'] }))).toBe('exercise');
  });
});

describe('带种子的打乱', () => {
  const items = ['A', 'B', 'C', 'D', 'E'];

  it('同一种子结果稳定，不依赖 Math.random', () => {
    expect(seededShuffle(items, 'ex-a-2026-03-17')).toEqual(seededShuffle(items, 'ex-a-2026-03-17'));
  });

  it('不同种子会改变顺序', () => {
    expect(seededShuffle(items, 'seed-1')).not.toEqual(seededShuffle(items, 'seed-2'));
  });

  it('不修改输入数组，元素不丢不重', () => {
    const copy = [...items];
    const shuffled = seededShuffle(items, 'seed');
    expect(items).toEqual(copy);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it('空数组与单元素数组安全', () => {
    expect(seededShuffle([], 'x')).toEqual([]);
    expect(seededShuffle(['A'], 'x')).toEqual(['A']);
  });

  it('选项顺序不暴露正确答案位置：同一题在同一天稳定', () => {
    const keys = ['A', 'B', 'C', 'D'];
    expect(presentationKeyOrder(keys, 'ex-a|2026-03-17')).toEqual(presentationKeyOrder(keys, 'ex-a|2026-03-17'));
    expect(presentationKeyOrder(keys, 'ex-a|2026-03-18')).not.toEqual(presentationKeyOrder(keys, 'ex-a|2026-03-17'));
  });
});
