import type { Checkpoint, Exercise, ExerciseOption } from '@/lib/domain/exercise-schema';
import type { LogicErrorType } from '@/lib/domain/taxonomy';

export type GradeOutcome = 'correct' | 'partial' | 'incorrect' | 'self-assessed';

export type AnswerInput =
  | { format: 'single-choice' | 'multi-choice'; keys: string[] }
  | { format: 'true-false'; value: boolean | null }
  | { format: 'ordering'; keys: string[] }
  | { format: 'short-answer'; text: string }
  | { format: 'open-response'; text: string; score: number };

export interface GradeResult {
  outcome: GradeOutcome;
  /** 0～1，用于统计与调度。 */
  score: number;
  answered: boolean;
  /** 用户选中的正确项缺失部分。 */
  missedKeys: string[];
  /** 用户选中的非正确项。 */
  wrongKeys: string[];
  /** 命中的典型推理错误（来自所选项的 errorType 标记）。 */
  errorTypes: LogicErrorType[];
  matchedCheckpoints: Checkpoint[];
  missedCheckpoints: Checkpoint[];
  /** 通过 alternatives 被判为可接受的其他答案。 */
  acceptedAlternative: string | null;
  /** 面向用户的判分依据说明。 */
  rationale: string;
}

const EMPTY_MSG = '未提交作答，不计入正确率，也不更新复习队列。';

function trapTypes(options: ExerciseOption[] | undefined, keys: string[]): LogicErrorType[] {
  if (!options) return [];
  return options
    .filter((o) => keys.includes(o.key) && o.errorType)
    .map((o) => o.errorType as LogicErrorType);
}

export function normalizeForKeyword(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[，。、；：！？“”‘’（）《》【】…—－\-_,.;:!?"'`()<>[\]{}\/\\|+*=^%$#@&~`]/g, '');
}

function gradeChoice(
  exercise: Extract<Exercise, { format: 'single-choice' | 'multi-choice' }>,
  keys: string[],
): GradeResult {
  const expected = [...exercise.answer.keys].sort();
  const selected = [...new Set(keys)].sort();
  const wrongKeys = selected.filter((k) => !expected.includes(k));
  const missedKeys = expected.filter((k) => !selected.includes(k));
  const errorTypes = trapTypes(exercise.options, selected).filter((_, i, arr) => arr.indexOf(_) === i);

  if (selected.length === 0) {
    return {
      outcome: 'incorrect',
      score: 0,
      answered: false,
      missedKeys: expected,
      wrongKeys: [],
      errorTypes: [],
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: null,
      rationale: EMPTY_MSG,
    };
  }

  const exact = wrongKeys.length === 0 && missedKeys.length === 0;
  if (exact) {
    return {
      outcome: 'correct',
      score: 1,
      answered: true,
      missedKeys: [],
      wrongKeys: [],
      errorTypes,
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: null,
      rationale: '所选答案与参考答案完全一致。',
    };
  }

  const alternative = exercise.alternatives.find(
    (a) => [...a.keys].sort().join('|') === selected.join('|'),
  );
  if (alternative) {
    return {
      outcome: 'correct',
      score: 1,
      answered: true,
      missedKeys: [],
      wrongKeys: [],
      errorTypes: [],
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: alternative.note,
      rationale: `按题目说明，这一组答案同样可以接受：${alternative.note}`,
    };
  }

  if (exercise.format === 'single-choice') {
    return {
      outcome: 'incorrect',
      score: 0,
      answered: true,
      missedKeys: expected,
      wrongKeys: selected,
      errorTypes,
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: null,
      rationale: '单选题答案与参考答案不同。',
    };
  }

  if (!exercise.grading.partialCredit) {
    return {
      outcome: 'incorrect',
      score: 0,
      answered: true,
      missedKeys,
      wrongKeys,
      errorTypes,
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: null,
      rationale: '本题设置为必须全部选对，漏选或错选都记为未答对。',
    };
  }

  if (wrongKeys.length === 0 && missedKeys.length > 0) {
    const score = selected.length / expected.length;
    return {
      outcome: 'partial',
      score,
      answered: true,
      missedKeys,
      wrongKeys: [],
      errorTypes,
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: null,
      rationale: `方向正确但不完整：漏选 ${missedKeys.join('、')}。错选会直接记为未答对，漏选记为部分正确。`,
    };
  }

  return {
    outcome: 'incorrect',
    score: 0,
    answered: true,
    missedKeys,
    wrongKeys,
    errorTypes,
    matchedCheckpoints: [],
    missedCheckpoints: [],
    acceptedAlternative: null,
    rationale: `包含与参考答案不符的选项（${wrongKeys.join('、')}），因此记为未答对。`,
  };
}

function gradeTrueFalse(
  exercise: Extract<Exercise, { format: 'true-false' }>,
  value: boolean | null,
): GradeResult {
  if (value === null) {
    return {
      outcome: 'incorrect',
      score: 0,
      answered: false,
      missedKeys: [String(exercise.answer.value)],
      wrongKeys: [],
      errorTypes: [],
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: null,
      rationale: EMPTY_MSG,
    };
  }
  const correct = value === exercise.answer.value;
  return {
    outcome: correct ? 'correct' : 'incorrect',
    score: correct ? 1 : 0,
    answered: true,
    missedKeys: correct ? [] : [String(exercise.answer.value)],
    wrongKeys: correct ? [] : [String(value)],
    errorTypes: [],
    matchedCheckpoints: [],
    missedCheckpoints: [],
    acceptedAlternative: null,
    rationale: correct
      ? '判断与参考答案一致。'
      : `参考答案为“${exercise.answer.value ? '正确' : '错误'}”。`,
  };
}

function gradeOrdering(
  exercise: Extract<Exercise, { format: 'ordering' }>,
  keys: string[],
): GradeResult {
  const expected = exercise.answer.keys;
  if (keys.length === 0) {
    return {
      outcome: 'incorrect',
      score: 0,
      answered: false,
      missedKeys: expected,
      wrongKeys: [],
      errorTypes: [],
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: null,
      rationale: EMPTY_MSG,
    };
  }
  const selected = keys.filter((k) => expected.includes(k));
  const wrongKeys = keys.filter((k) => !expected.includes(k));
  const missedKeys = expected.filter((k) => !selected.includes(k));

  if (selected.length === expected.length && selected.join('|') === expected.join('|')) {
    return {
      outcome: 'correct',
      score: 1,
      answered: true,
      missedKeys: [],
      wrongKeys: [],
      errorTypes: [],
      matchedCheckpoints: [],
      missedCheckpoints: [],
      acceptedAlternative: null,
      rationale: '顺序与参考答案一致。',
    };
  }

  // 计分方式：统计两两先后关系被保持的比例（Kendall 一致性）。
  // 一处相邻换位只会破坏与它相关的两对关系，比“完全一致才算对”更贴合拆解类题目。
  const totalPairs = (expected.length * (expected.length - 1)) / 2;
  let concordant = 0;
  for (let i = 0; i < expected.length; i += 1) {
    for (let j = i + 1; j < expected.length; j += 1) {
      const a = selected.indexOf(expected[i]);
      const b = selected.indexOf(expected[j]);
      if (a !== -1 && b !== -1 && a < b) concordant += 1;
    }
  }
  const ratio = totalPairs === 0 ? 0 : concordant / totalPairs;
  const tolerance = exercise.grading.orderTolerance;
  const outcome: GradeOutcome = ratio >= 1 - tolerance ? 'partial' : 'incorrect';

  return {
    outcome,
    score: outcome === 'incorrect' ? Math.min(ratio, 0.49) : ratio,
    answered: true,
    missedKeys,
    wrongKeys,
    errorTypes: missedKeys.length > 0 || ratio < 1 ? ['missing-reasoning-step'] : [],
    matchedCheckpoints: [],
    missedCheckpoints: [],
    acceptedAlternative: null,
    rationale: `按两两先后关系计分：${concordant}/${totalPairs} 对顺序正确。漏排：${
      missedKeys.join('、') || '无'
    }。`,
  };
}

function gradeShortAnswer(
  exercise: Extract<Exercise, { format: 'short-answer' }>,
  text: string,
): GradeResult {
  const haystack = normalizeForKeyword(text);
  if (haystack.length === 0) {
    return {
      outcome: 'incorrect',
      score: 0,
      answered: false,
      missedKeys: [],
      wrongKeys: [],
      errorTypes: [],
      matchedCheckpoints: [],
      missedCheckpoints: exercise.answer.checkpoints,
      acceptedAlternative: null,
      rationale: EMPTY_MSG,
    };
  }

  const matched: Checkpoint[] = [];
  const missed: Checkpoint[] = [];
  for (const cp of exercise.answer.checkpoints) {
    const hit = cp.keywords.some((k) => haystack.includes(normalizeForKeyword(k)));
    (hit ? matched : missed).push(cp);
  }

  const totalWeight = exercise.answer.checkpoints.reduce((s, c) => s + c.weight, 0);
  const hitWeight = matched.reduce((s, c) => s + c.weight, 0);
  const ratio = totalWeight === 0 ? 0 : hitWeight / totalWeight;
  const missingRequired = exercise.answer.checkpoints
    .filter((c) => c.required)
    .some((c) => !matched.includes(c));

  let outcome: GradeOutcome = 'incorrect';
  if (ratio >= exercise.answer.correctRatio && !missingRequired) outcome = 'correct';
  else if (ratio >= exercise.answer.partialRatio) outcome = 'partial';

  const errorTypes: LogicErrorType[] = missingRequired
    ? ['missing-reasoning-step']
    : missed.length > 0
      ? ratio < exercise.answer.partialRatio
        ? ['insufficient-evidence']
        : ['missing-reasoning-step']
      : [];

  return {
    outcome,
    score: Math.min(ratio, 1),
    answered: true,
    missedKeys: missed.map((c) => c.id),
    wrongKeys: [],
    errorTypes,
    matchedCheckpoints: matched,
    missedCheckpoints: missed,
    acceptedAlternative: null,
    rationale: `要点覆盖 ${hitWeight}/${totalWeight}（${Math.round(ratio * 100)}%）。${
      missingRequired ? '缺少被标记为必要的要点。' : ''
    }这是基于关键词的自动检查，用来提示你漏掉了哪些环节，不代表最终评分。`,
  };
}

function gradeOpenResponse(
  exercise: Extract<Exercise, { format: 'open-response' }>,
  text: string,
  score: number,
): GradeResult {
  const clamped = Math.max(0, Math.min(4, Math.round(score ?? 0)));
  const level = exercise.answer.scale.find((s) => s.score === clamped) ?? null;
  const trimmed = text.trim();
  return {
    outcome: 'self-assessed',
    score: clamped / 4,
    answered: trimmed.length > 0,
    missedKeys: [],
    wrongKeys: [],
    errorTypes: [],
    matchedCheckpoints: [],
    missedCheckpoints: [],
    acceptedAlternative: null,
    rationale: `开放题没有唯一正确答案，记录你的自评等级：${
      level ? `${level.label} —— ${level.criteria}` : '未选择等级'
    }。`,
  };
}

export function gradeExercise(exercise: Exercise, answer: AnswerInput): GradeResult {
  if (answer.format !== exercise.format) {
    throw new Error(`答题格式 ${answer.format} 与题目 ${exercise.id} 的 ${exercise.format} 不一致`);
  }
  // 以 answer.format 作为判别依据；两个联合类型在此处已被证明一致，因此按分支收窄题目类型。
  switch (answer.format) {
    case 'single-choice':
    case 'multi-choice':
      return gradeChoice(exercise as ChoiceExercise, answer.keys);
    case 'true-false':
      return gradeTrueFalse(exercise as TrueFalseExercise, answer.value);
    case 'ordering':
      return gradeOrdering(exercise as OrderingExercise, answer.keys);
    case 'short-answer':
      return gradeShortAnswer(exercise as ShortAnswerExercise, answer.text);
    case 'open-response':
      return gradeOpenResponse(exercise as OpenResponseExercise, answer.text, answer.score);
  }
}

type ChoiceExercise = Extract<Exercise, { format: 'single-choice' | 'multi-choice' }>;
type TrueFalseExercise = Extract<Exercise, { format: 'true-false' }>;
type OrderingExercise = Extract<Exercise, { format: 'ordering' }>;
type ShortAnswerExercise = Extract<Exercise, { format: 'short-answer' }>;
type OpenResponseExercise = Extract<Exercise, { format: 'open-response' }>;

/** 展示用：把参考答案渲染成可读文本。 */
export function describeAnswer(exercise: Exercise): string {
  switch (exercise.format) {
    case 'single-choice':
    case 'multi-choice':
      return exercise.answer.keys.join('、');
    case 'true-false':
      return exercise.answer.value ? '正确' : '错误';
    case 'ordering':
      return exercise.items
        .filter((i) => exercise.answer.keys.includes(i.key))
        .sort((a, b) => exercise.answer.keys.indexOf(a.key) - exercise.answer.keys.indexOf(b.key))
        .map((i, idx) => `${idx + 1}. ${i.text}`)
        .join(' → ');
    case 'short-answer':
      return exercise.answer.checkpoints.map((c) => c.label).join('；');
    case 'open-response':
      return exercise.answer.guidance;
  }
}
