import { exerciseSchema, type Exercise } from '@/lib/domain/exercise-schema';

import argumentAnalysis from '@/content/exercises/argument-analysis.json';
import causalReasoning from '@/content/exercises/causal-reasoning.json';
import conditionalReasoning from '@/content/exercises/conditional-reasoning.json';
import contrapositiveConversion from '@/content/exercises/contrapositive-conversion.json';
import correlationVsCausation from '@/content/exercises/correlation-vs-causation.json';
import counterexampleRebuttal from '@/content/exercises/counterexample-rebuttal.json';
import decisionAnalysis from '@/content/exercises/decision-analysis.json';
import deductiveReasoning from '@/content/exercises/deductive-reasoning.json';
import inductiveReasoning from '@/content/exercises/inductive-reasoning.json';
import logicalFallacies from '@/content/exercises/logical-fallacies.json';
import necessarySufficient from '@/content/exercises/necessary-sufficient-conditions.json';
import problemDecomposition from '@/content/exercises/problem-decomposition.json';
import statisticalIntuition from '@/content/exercises/statistical-intuition.json';
import truthTellerPuzzles from '@/content/exercises/truth-teller-puzzles.json';

/** 内容包标识：题目增删或修订时一并递增，客户端据此决定是否重新播种。 */
export const EXERCISE_CONTENT_TAG = 'content-v1.0';

const RAW_PACKS = [
  deductiveReasoning,
  inductiveReasoning,
  conditionalReasoning,
  truthTellerPuzzles,
  necessarySufficient,
  contrapositiveConversion,
  causalReasoning,
  correlationVsCausation,
  statisticalIntuition,
  logicalFallacies,
  argumentAnalysis,
  counterexampleRebuttal,
  problemDecomposition,
  decisionAnalysis,
];

/**
 * 播种前用同一份 zod schema 再校验一次：
 * JSON 导入的静态类型很宽，这里保证进入本地库的题目结构可靠。
 */
export function buildExercisePacks(): { category: string; exercises: Exercise[] }[] {
  return RAW_PACKS.map((pack) => ({
    category: pack.category,
    exercises: pack.exercises.map((exercise) => exerciseSchema.parse(exercise)),
  }));
}

export function allExercises(): Exercise[] {
  return buildExercisePacks().flatMap((pack) => pack.exercises);
}
