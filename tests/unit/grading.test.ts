import { describe, expect, it } from 'vitest';

import { gradeExercise, describeAnswer, normalizeForKeyword } from '@/lib/domain/grading';
import type { Exercise } from '@/lib/domain/exercise-schema';
import {
  multiChoiceFixture,
  openResponseFixture,
  orderingFixture,
  shortAnswerFixture,
  singleChoiceFixture,
  trueFalseFixture,
} from '../fixtures/exercises';

describe('single-choice 判分', () => {
  const exercise = singleChoiceFixture();

  it('正确项给出 correct', () => {
    const r = gradeExercise(exercise, { format: 'single-choice', keys: ['A'] });
    expect(r.outcome).toBe('correct');
    expect(r.score).toBe(1);
    expect(r.errorTypes).toEqual([]);
  });

  it('选中被标记为典型错误的选项时给出对应错误类型', () => {
    const r = gradeExercise(exercise, { format: 'single-choice', keys: ['B'] });
    expect(r.outcome).toBe('incorrect');
    expect(r.errorTypes).toEqual(['affirming-consequent']);
  });

  it('未作答不算作答题，且 answered 为 false', () => {
    const r = gradeExercise(exercise, { format: 'single-choice', keys: [] });
    expect(r.answered).toBe(false);
    expect(r.outcome).toBe('incorrect');
  });

  it('可接受的其他答案判为 correct 并说明依据', () => {
    const withAlt = {
      ...exercise,
      alternatives: [{ keys: ['C'], note: '若考虑题目未说明比赛是否已改期，C 也可接受。' }],
    } as typeof exercise;
    const r = gradeExercise(withAlt, { format: 'single-choice', keys: ['C'] });
    expect(r.outcome).toBe('correct');
    expect(r.acceptedAlternative).toContain('C 也可接受');
  });
});

describe('multi-choice 判分', () => {
  it('全对为 correct', () => {
    const r = gradeExercise(multiChoiceFixture(), { format: 'multi-choice', keys: ['A', 'B', 'D'] });
    expect(r.outcome).toBe('correct');
  });

  it('只漏选为 partial，得分按覆盖比例', () => {
    const r = gradeExercise(multiChoiceFixture(), { format: 'multi-choice', keys: ['A', 'B'] });
    expect(r.outcome).toBe('partial');
    expect(r.score).toBeCloseTo(2 / 3);
    expect(r.missedKeys).toEqual(['D']);
  });

  it('含错选一律为 incorrect', () => {
    const r = gradeExercise(multiChoiceFixture(), { format: 'multi-choice', keys: ['A', 'B', 'C'] });
    expect(r.outcome).toBe('incorrect');
    expect(r.wrongKeys).toEqual(['C']);
    expect(r.errorTypes).toContain('base-rate-neglect');
  });

  it('关闭部分得分时漏选也记为 incorrect', () => {
    const strict = multiChoiceFixture(false);
    const r = gradeExercise(strict, { format: 'multi-choice', keys: ['A', 'B'] });
    expect(r.outcome).toBe('incorrect');
    expect(r.score).toBe(0);
  });

  it('重复 key 不会虚增覆盖比例', () => {
    const r = gradeExercise(multiChoiceFixture(), { format: 'multi-choice', keys: ['A', 'A', 'B'] });
    expect(r.score).toBeCloseTo(2 / 3);
  });
});

describe('true-false 判分', () => {
  it('与参考答案一致为 correct', () => {
    const r = gradeExercise(trueFalseFixture(true), { format: 'true-false', value: true });
    expect(r.outcome).toBe('correct');
  });

  it('不一致为 incorrect 并说明参考值', () => {
    const r = gradeExercise(trueFalseFixture(true), { format: 'true-false', value: false });
    expect(r.outcome).toBe('incorrect');
    expect(r.rationale).toContain('正确');
  });

  it('未选择不计入作答', () => {
    const r = gradeExercise(trueFalseFixture(true), { format: 'true-false', value: null });
    expect(r.answered).toBe(false);
  });
});

describe('ordering 判分', () => {
  const exercise = orderingFixture();

  it('完全正确的顺序', () => {
    const r = gradeExercise(exercise, { format: 'ordering', keys: ['s1', 's2', 's3', 's4'] });
    expect(r.outcome).toBe('correct');
  });

  it('相邻顺序大部分正确时为 partial', () => {
    const r = gradeExercise(exercise, { format: 'ordering', keys: ['s1', 's2', 's4', 's3'] });
    expect(r.outcome).toBe('partial');
    expect(r.errorTypes).toContain('missing-reasoning-step');
  });

  it('完全打乱时为 incorrect', () => {
    const r = gradeExercise(exercise, { format: 'ordering', keys: ['s4', 's3', 's2', 's1'] });
    expect(r.outcome).toBe('incorrect');
    expect(r.score).toBeLessThan(0.5);
  });
});

describe('short-answer 要点判分', () => {
  const exercise = shortAnswerFixture() as Extract<Exercise, { format: 'short-answer' }>;

  it('覆盖全部要点为 correct', () => {
    const text = '这里有一个隐含前提：评价即变化。也可能只是他们注意到了外在行为。可以用一周记录来验证。';
    const r = gradeExercise(exercise, { format: 'short-answer', text });
    expect(r.outcome).toBe('correct');
    expect(r.matchedCheckpoints.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('缺少必要要点时最多为 partial', () => {
    const text = '也许还有其他解释，比如他们只是随口一说。可以再观察一周来验证。';
    const r = gradeExercise(exercise, { format: 'short-answer', text });
    expect(r.outcome).toBe('partial');
    expect(r.missedCheckpoints.map((c) => c.id)).toContain('c1');
  });

  it('只命中低权重要点时为 incorrect', () => {
    const r = gradeExercise(exercise, { format: 'short-answer', text: '需要再确认一下数据。' });
    expect(r.outcome).toBe('incorrect');
    expect(r.errorTypes).toContain('missing-reasoning-step');
    expect(r.missedCheckpoints.map((c) => c.id)).toContain('c1');
  });

  it('没有必需要点时，覆盖率过低归为证据不足', () => {
    const relaxed = {
      ...exercise,
      answer: {
        ...exercise.answer,
        checkpoints: exercise.answer.checkpoints.map((c) => ({ ...c, required: false })),
      },
    } as typeof exercise;
    const r = gradeExercise(relaxed, { format: 'short-answer', text: '需要再确认一下数据。' });
    expect(r.outcome).toBe('incorrect');
    expect(r.errorTypes).toContain('insufficient-evidence');
  });

  it('空白作答 answered 为 false', () => {
    const r = gradeExercise(exercise, { format: 'short-answer', text: '   ' });
    expect(r.answered).toBe(false);
  });

  it('关键词匹配忽略空白与标点差异', () => {
    expect(normalizeForKeyword('隐含 前提：是“这个”。')).toBe('隐含前提是这个');
  });
});

describe('open-response 自评', () => {
  const exercise = openResponseFixture();

  it('记录自评等级但不产生正确性判断', () => {
    const r = gradeExercise(exercise, { format: 'open-response', text: '可能有共同的第三因素。', score: 3 });
    expect(r.outcome).toBe('self-assessed');
    expect(r.score).toBeCloseTo(0.75);
    expect(r.rationale).toContain('指出机制');
  });

  it('越界分数被夹紧', () => {
    const r = gradeExercise(exercise, { format: 'open-response', text: 'x', score: 9 });
    expect(r.score).toBe(1);
  });
});

describe('格式不一致保护', () => {
  it('题目格式与答案格式不同直接抛错', () => {
    expect(() => gradeExercise(singleChoiceFixture(), { format: 'multi-choice', keys: ['A'] } as never)).toThrow(/不一致/);
  });

  it('describeAnswer 对每种题型都能生成可读文本', () => {
    expect(describeAnswer(singleChoiceFixture())).toBe('A');
    expect(describeAnswer(trueFalseFixture(false))).toBe('错误');
    expect(describeAnswer(orderingFixture())).toContain('写清真正要回答的问题');
    expect(describeAnswer(shortAnswerFixture())).toContain('指出隐含前提');
    expect(describeAnswer(openResponseFixture())).toContain('结论依赖哪些前提');
  });
});
