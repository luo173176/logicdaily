import type { Exercise } from '@/lib/domain/exercise-schema';
import type { AnswerInput } from '@/lib/domain/grading';

type ChoiceAnswer = Extract<AnswerInput, { format: 'single-choice' | 'multi-choice' }>;

/** 把用户的原始作答转成给教练看的文本（只包含这道题需要的信息）。 */
export function answerTextForExercise(exercise: Exercise, answer: AnswerInput): string {
  // 题目与作答的格式由调用方保证一致，这里按题目结构取值。
  switch (exercise.format) {
    case 'single-choice':
    case 'multi-choice': {
      const keys = (answer as ChoiceAnswer).keys ?? [];
      if (keys.length === 0) return '（未提交答案）';
      const byKey = new Map(exercise.options.map((option) => [option.key, option.text]));
      return keys.map((key) => `${key}. ${byKey.get(key) ?? '(未知选项)'}`).join('；');
    }
    case 'true-false': {
      const value = answer.format === 'true-false' ? answer.value : null;
      return value === null ? '（未判断）' : value ? '正确' : '错误';
    }
    case 'ordering': {
      const keys = answer.format === 'ordering' ? answer.keys : [];
      if (keys.length === 0) return '（未排列）';
      const text = (key: string) => exercise.items.find((item) => item.key === key)?.text ?? key;
      return keys.map((key, index) => `${index + 1}) ${text(key)}`).join(' → ');
    }
    case 'short-answer': {
      const text = answer.format === 'short-answer' ? answer.text : '';
      return text.trim() ? clip(text) : '（没有写任何内容）';
    }
    case 'open-response': {
      const open = answer.format === 'open-response' ? answer : { text: '', score: 2 };
      return `${open.text.trim() ? clip(open.text) : '（没有写任何内容）'}（自评等级 ${open.score}）`;
    }
  }
}

function clip(value: string): string {
  const flat = value.trim();
  return flat.length > 1500 ? `${flat.slice(0, 1500)}…（已截断）` : flat;
}
