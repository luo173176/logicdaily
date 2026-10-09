import { describe, expect, it } from 'vitest';

import { allExercises, buildExercisePacks, EXERCISE_CONTENT_TAG } from '@/lib/content/packs';
import { EXERCISE_CATEGORIES, KNOWLEDGE_POINT_IDS, LOGIC_ERROR_TYPES } from '@/lib/domain/taxonomy';
import { exerciseSchema } from '@/lib/domain/exercise-schema';
import { gradeExercise } from '@/lib/domain/grading';
import { toCard } from '@/lib/domain/catalog';

/**
 * 这道测试是题库进入应用的最后一道关：
 * 脚本校验（scripts/validate-exercises.mjs）用等价规则，这里用真正生效的 zod schema。
 */
describe('内置题库', () => {
  const exercises = allExercises();

  it(`题量满足首个可用版本要求（>=100），当前 ${exercises.length} 题`, () => {
    expect(exercises.length).toBeGreaterThanOrEqual(100);
    expect(EXERCISE_CONTENT_TAG).toMatch(/^content-v/);
  });

  it('每一题都能被 schema 解析', () => {
    for (const exercise of exercises) {
      expect(() => exerciseSchema.parse(exercise)).not.toThrow();
    }
  });

  it('ID 唯一且格式一致', () => {
    const ids = exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^ex-[a-z-]+-\d{3}$/);
  });

  it('14 个类别都有题目', () => {
    const covered = new Set(exercises.map((e) => e.category));
    for (const category of EXERCISE_CATEGORIES) expect(covered.has(category)).toBe(true);
  });

  it('六种作答格式都被覆盖', () => {
    const formats = new Set(exercises.map((e) => e.format));
    for (const format of ['single-choice', 'multi-choice', 'true-false', 'short-answer', 'ordering', 'open-response']) {
      expect(formats.has(format as never)).toBe(true);
    }
  });

  it('15 种逻辑错误类型都在解析中出现过', () => {
    const used = new Set<string>();
    for (const exercise of exercises) {
      for (const mistake of exercise.explanation.commonMistakes) used.add(mistake.errorType);
      if ('options' in exercise) {
        for (const option of exercise.options) if (option.errorType) used.add(option.errorType);
      }
    }
    for (const type of LOGIC_ERROR_TYPES) expect(used.has(type)).toBe(true);
  });

  it('知识点 id 都在目录内', () => {
    const allowed = new Set(KNOWLEDGE_POINT_IDS);
    for (const exercise of exercises) {
      for (const kp of exercise.knowledgePoints) expect(allowed.has(kp)).toBe(true);
    }
  });

  it('正确答案选项不会被标记为典型错误，且解析解释了每个被标记的陷阱', () => {
    for (const exercise of exercises) {
      if (exercise.format !== 'single-choice' && exercise.format !== 'multi-choice') continue;
      const traps = exercise.options.filter((o) => o.errorType);
      for (const trap of traps) {
        expect(exercise.answer.keys).not.toContain(trap.key);
        expect(exercise.explanation.commonMistakes.some((m) => m.option === trap.key)).toBe(true);
      }
    }
  });

  it('简答题的关键词确实能匹配到参考答案（判分与解析一致）', () => {
    const normalized = (value: string) => value.replace(/[\s，。、；：“”‘’（）《》【】—\-,.:;!?'"`()<>\[\]{}]/g, '').toLowerCase();
    for (const exercise of exercises) {
      if (exercise.format !== 'short-answer') continue;
      const model = normalized(exercise.answer.modelAnswer);
      for (const checkpoint of exercise.answer.checkpoints) {
        const hit = checkpoint.keywords.some((keyword) => model.includes(normalized(keyword)));
        expect(hit, `${exercise.id} 要点 ${checkpoint.id} 的关键词在 modelAnswer 中找不到`).toBe(true);
      }
    }
  });

  it('排序题的答案是 items 的排列', () => {
    for (const exercise of exercises) {
      if (exercise.format !== 'ordering') continue;
      expect([...exercise.answer.keys].sort()).toEqual(exercise.items.map((i) => i.key).sort());
    }
  });

  it('用参考答案判分，每题都能得到 correct（答案与判分规则自洽）', () => {
    for (const exercise of exercises) {
      let answer;
      switch (exercise.format) {
        case 'single-choice':
        case 'multi-choice':
          answer = { format: exercise.format, keys: exercise.answer.keys };
          break;
        case 'true-false':
          answer = { format: 'true-false', value: exercise.answer.value };
          break;
        case 'ordering':
          answer = { format: 'ordering', keys: exercise.answer.keys };
          break;
        case 'short-answer':
          answer = { format: 'short-answer', text: exercise.answer.modelAnswer };
          break;
        case 'open-response':
          continue;
      }
      const grade = gradeExercise(exercise, answer as never);
      expect(grade.outcome, `${exercise.id} 用参考答案判分没有得到 correct：${grade.rationale}`).toBe('correct');
    }
  });

  it('题目可以转换成调度用的轻量卡片', () => {
    const cards = buildExercisePacks().flatMap((pack) => pack.exercises.map(toCard));
    expect(cards.length).toBeGreaterThanOrEqual(100);
    expect(cards.every((card) => card.categoryLabel.length > 0)).toBe(true);
  });

  it('难度与预估时长分布合理', () => {
    const byDifficulty = new Map<number, number>();
    for (const exercise of exercises) byDifficulty.set(exercise.difficulty, (byDifficulty.get(exercise.difficulty) ?? 0) + 1);
    for (const level of [1, 2, 3, 4, 5]) {
      if (level === 1) continue;
      expect((byDifficulty.get(level) ?? 0) > 0, `缺少难度 ${level} 的题目`).toBe(true);
    }
    expect(exercises.every((e) => e.estimatedSeconds >= 30 && e.estimatedSeconds <= 200)).toBe(true);
  });
});

/**
 * 校验脚本是纯 Node，无法导入 TS 枚举，只能维护一份副本。
 * 这份测试保证副本不会和权威定义漂移：漂移的后果是加了新题型后，
 * `content:validate` 会把合法题目判成非法（或反过来静默放过非法值）。
 */
describe('校验脚本的枚举副本', () => {
  it('scripts/content-enums.mjs 与 lib/domain/taxonomy.ts 完全一致', async () => {
    const { CATEGORY_ENUM, ERROR_ENUM } = await import('../../scripts/content-enums.mjs');
    expect([...CATEGORY_ENUM].sort()).toEqual([...EXERCISE_CATEGORIES].sort());
    expect([...ERROR_ENUM].sort()).toEqual([...LOGIC_ERROR_TYPES].sort());
  });
});
