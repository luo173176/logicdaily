import { describe, expect, it } from 'vitest';

import { exerciseSchema, exerciseFileSchema, EXERCISE_CONTENT_VERSION } from '@/lib/domain/exercise-schema';
import { allFixtures } from '../fixtures/exercises';

describe('exerciseSchema', () => {
  it('接受全部六种题型的合法结构', () => {
    for (const fixture of allFixtures()) {
      expect(() => exerciseSchema.parse(fixture)).not.toThrow();
    }
  });

  it('拒绝没有知识点的题目', () => {
    const bad = { ...allFixtures()[0], knowledgePoints: [] };
    expect(exerciseSchema.safeParse(bad).success).toBe(false);
  });

  it('拒绝单选题给出多个正确项', () => {
    const bad = { ...allFixtures()[0], answer: { keys: ['A', 'C'] } };
    expect(exerciseSchema.safeParse(bad).success).toBe(false);
  });

  it('拒绝重复的选项 key', () => {
    const bad = {
      ...allFixtures()[0],
      options: [
        { key: 'A', text: '甲' },
        { key: 'A', text: '乙' },
      ],
    };
    expect(exerciseSchema.safeParse(bad).success).toBe(false);
  });

  it('拒绝未知的题型分类或错误类型', () => {
    const badCategory = { ...allFixtures()[0], category: 'astrology' };
    expect(exerciseSchema.safeParse(badCategory).success).toBe(false);
    const badOption = {
      ...allFixtures()[0],
      options: allFixtures()[0].format === 'single-choice' ? [{ key: 'A', text: 'x', errorType: 'vibes' }] : [],
    };
    expect(exerciseSchema.safeParse(badOption).success).toBe(false);
  });

  it('拒绝解析步骤为空的题目（解析必须可解释）', () => {
    const bad = { ...allFixtures()[0], explanation: { ...allFixtures()[0].explanation, steps: [] } };
    expect(exerciseSchema.safeParse(bad).success).toBe(false);
  });

  it('文件结构要求 schemaVersion 与题目 id 唯一', () => {
    const file = {
      schemaVersion: EXERCISE_CONTENT_VERSION,
      category: 'conditional-reasoning',
      exercises: [allFixtures()[0], allFixtures()[0]],
    };
    const parsed = exerciseFileSchema.safeParse(file);
    expect(parsed.success).toBe(true);
  });

  it('默认值会被补齐：grading 与 status', () => {
    const minimal = { ...allFixtures()[0] } as Record<string, unknown>;
    delete minimal.grading;
    delete minimal.status;
    const result = exerciseSchema.parse(minimal);
    expect(result.status).toBe('validated');
    expect(result.grading.partialCredit).toBe(true);
  });
});
