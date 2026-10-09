/**
 * 题库校验脚本使用的枚举。
 *
 * 单独成文件是为了让 vitest 能把它和 `lib/domain/taxonomy.ts` 里的权威定义对比。
 * 校验脚本是纯 Node（不导入 TS），所以只能维护一份副本 —— 有副本就必须有防漂移的测试，
 * 否则加了新题型或新错误类型时，脚本会静默地把合法题目判成非法（或反过来）。
 */

export const CATEGORY_ENUM = [
  'deductive-reasoning',
  'inductive-reasoning',
  'conditional-reasoning',
  'truth-teller-puzzles',
  'necessary-sufficient-conditions',
  'contrapositive-conversion',
  'causal-reasoning',
  'correlation-vs-causation',
  'statistical-intuition',
  'logical-fallacies',
  'argument-analysis',
  'counterexample-rebuttal',
  'problem-decomposition',
  'decision-analysis',
];

export const ERROR_ENUM = [
  'affirming-consequent',
  'denying-antecedent',
  'hasty-generalization',
  'correlation-as-causation',
  'ignoring-counterexample',
  'equivocation',
  'false-dilemma',
  'circular-reasoning',
  'ad-hominem',
  'appeal-to-majority',
  'insufficient-evidence',
  'conclusion-overreach',
  'base-rate-neglect',
  'premise-misidentification',
  'missing-reasoning-step',
];
