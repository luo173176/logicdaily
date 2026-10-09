import { describe, expect, it } from 'vitest';

import { classifyMistake } from '@/lib/domain/mistake';
import { gradeExercise } from '@/lib/domain/grading';
import { singleChoiceFixture } from '../fixtures/exercises';

function build(overrides: Partial<Parameters<typeof classifyMistake>[0]> = {}) {
  const exercise = singleChoiceFixture();
  const grade = gradeExercise(exercise, { format: 'single-choice', keys: ['B'] });
  return {
    exercise,
    grade,
    outcome: grade.outcome,
    timeSpentSeconds: 45,
    confidence: 4,
    ...overrides,
  };
}

describe('classifyMistake 归因优先级', () => {
  it('答对不做归因', () => {
    const exercise = singleChoiceFixture();
    const grade = gradeExercise(exercise, { format: 'single-choice', keys: ['A'] });
    const r = classifyMistake(build({ grade, outcome: grade.outcome }));
    expect(r.cause).toBe('none');
  });

  it('用户自报“题目有歧义”优先，并进入复核队列', () => {
    const r = classifyMistake(build({ selfReport: 'ambiguous' }));
    expect(r.cause).toBe('ambiguous-question');
    expect(r.flagForReview).toBe(true);
  });

  it('用户自报“不熟悉术语”归为知识缺口', () => {
    const r = classifyMistake(build({ selfReport: 'unknown-term' }));
    expect(r.cause).toBe('knowledge-gap');
    expect(r.flagForReview).toBe(false);
  });

  it('用户自报“粗心”归为粗心，即使命中陷阱选项', () => {
    const r = classifyMistake(build({ selfReport: 'careless' }));
    expect(r.cause).toBe('carelessness');
    expect(r.errorTypes).toContain('affirming-consequent');
  });

  it('未作答时不归因', () => {
    const exercise = singleChoiceFixture();
    const grade = gradeExercise(exercise, { format: 'single-choice', keys: [] });
    const r = classifyMistake(build({ grade, outcome: grade.outcome, timeSpentSeconds: 0 }));
    expect(r.cause).toBe('unknown');
  });

  it('命中题目设计好的陷阱选项 → 推理方式问题', () => {
    const r = classifyMistake(build());
    expect(r.cause).toBe('logic-skill');
    expect(r.errorTypes).toEqual(['affirming-consequent']);
  });

  it('极短时间且未命中陷阱 → 粗心', () => {
    const exercise = singleChoiceFixture();
    const grade = gradeExercise(exercise, { format: 'single-choice', keys: ['C'] });
    const r = classifyMistake(build({ grade, outcome: grade.outcome, timeSpentSeconds: 5 }));
    expect(r.cause).toBe('carelessness');
  });

  it('低信心且未命中陷阱 → 知识缺口', () => {
    const exercise = singleChoiceFixture();
    const grade = gradeExercise(exercise, { format: 'single-choice', keys: ['C'] });
    const r = classifyMistake(build({ grade, outcome: grade.outcome, timeSpentSeconds: 90, confidence: 1 }));
    expect(r.cause).toBe('knowledge-gap');
  });

  it('同一错误类型近期出现两次以上标记为反复模式', () => {
    const r = classifyMistake(build({ priorErrorCounts: { 'affirming-consequent': 2 } }));
    expect(r.repeatedPattern).toBe(true);
  });

  it('部分正确不标记为反复模式，避免把不完整当成稳定缺陷', () => {
    const r = classifyMistake(build({ outcome: 'partial', priorErrorCounts: { 'affirming-consequent': 3 } }));
    expect(r.repeatedPattern).toBe(false);
    expect(r.cause).toBe('logic-skill');
  });

  it('开放题自评不产生逻辑缺陷归因', () => {
    const exercise = singleChoiceFixture();
    const grade = gradeExercise(exercise, { format: 'single-choice', keys: ['B'] });
    const r = classifyMistake(build({ grade, outcome: 'self-assessed' }));
    expect(r.cause).toBe('none');
  });
});
