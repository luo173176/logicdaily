import type { GradeOutcome, GradeResult } from '@/lib/domain/grading';
import type { Exercise } from '@/lib/domain/exercise-schema';
import type { LogicErrorType } from '@/lib/domain/taxonomy';
import { CAUSE_LABELS, type CauseType } from '@/lib/domain/taxonomy';

export type SelfReport = 'careless' | 'unknown-term' | 'misread' | 'ambiguous' | null;

export interface MistakeInput {
  exercise: Exercise;
  grade: GradeResult;
  outcome: GradeOutcome;
  timeSpentSeconds: number;
  /** 1～5，用户提交前的自评信心。 */
  confidence: number;
  selfReport?: SelfReport;
  /** 该知识点/错误类型在历史中已出现的次数。 */
  priorErrorCounts?: Partial<Record<LogicErrorType, number>>;
}

export interface MistakeClassification {
  cause: CauseType;
  errorTypes: LogicErrorType[];
  /** 是否属于近期反复出现的同类推理错误。 */
  repeatedPattern: boolean;
  rationale: string;
  /** 题目本身可能被误读或有歧义，应进入题库复核队列。 */
  flagForReview: boolean;
}

const NOT_APPLICABLE: MistakeClassification = {
  cause: 'none',
  errorTypes: [],
  repeatedPattern: false,
  rationale: CAUSE_LABELS.none,
  flagForReview: false,
};

/**
 * 归因优先级：用户自报 > 未作答 > 空前的速度且没踩到设计陷阱 > 命中陷阱选项 > 低信心 > 兜底。
 * 这样做的目的是避免把“答错”一律归为逻辑能力问题：粗心、术语不熟、读题偏差都会给出不同结论。
 */
export function classifyMistake(input: MistakeInput): MistakeClassification {
  const {
    exercise,
    grade,
    outcome,
    timeSpentSeconds,
    confidence,
    selfReport = null,
    priorErrorCounts = {},
  } = input;

  if (outcome === 'correct' || outcome === 'self-assessed') {
    return NOT_APPLICABLE;
  }

  const errorTypes = dedupe(grade.errorTypes);
  const repeatedPattern =
    errorTypes.length > 0 &&
    errorTypes.some((t) => (priorErrorCounts[t] ?? 0) >= 2) &&
    outcome !== 'partial';

  if (selfReport === 'ambiguous') {
    return {
      cause: 'ambiguous-question',
      errorTypes,
      repeatedPattern: false,
      rationale: '你标记了题目表述存在歧义，本次不作能力归因，并已加入题库复核队列。',
      flagForReview: true,
    };
  }
  if (selfReport === 'misread') {
    return {
      cause: 'misread-question',
      errorTypes,
      repeatedPattern: false,
      rationale: '你表示读题理解有偏差。重读题干后再次作答通常就能判断是能力问题还是理解问题。',
      flagForReview: false,
    };
  }
  if (selfReport === 'careless') {
    return {
      cause: 'carelessness',
      errorTypes,
      repeatedPattern: false,
      rationale: '你表示是粗心或选错选项，因此不计为推理能力缺陷。',
      flagForReview: false,
    };
  }
  if (selfReport === 'unknown-term') {
    return {
      cause: 'knowledge-gap',
      errorTypes,
      repeatedPattern: false,
      rationale:
        '你标记了不熟悉的术语或概念。这属于知识缺口，建议先补充相关说明再练习同类题目。',
      flagForReview: false,
    };
  }

  if (!grade.answered) {
    return {
      cause: 'unknown',
      errorTypes: [],
      repeatedPattern: false,
      rationale: '本题没有提交作答，不做归因。',
      flagForReview: false,
    };
  }

  const rushed =
    timeSpentSeconds > 0 &&
    timeSpentSeconds < Math.max(8, exercise.estimatedSeconds * 0.3) &&
    errorTypes.length === 0;

  if (rushed) {
    return {
      cause: 'carelessness',
      errorTypes,
      repeatedPattern: false,
      rationale: `作答用时 ${Math.round(timeSpentSeconds)} 秒，明显短于预估 ${exercise.estimatedSeconds} 秒，且没有命中题目设计的典型推理陷阱，更像匆忙作答。`,
      flagForReview: false,
    };
  }

  if (errorTypes.length > 0) {
    return {
      cause: 'logic-skill',
      errorTypes,
      repeatedPattern,
      rationale: repeatedPattern
        ? '你选择了题目预先标记为典型错误的选项，而且这类错误近期已多次出现，值得专项练习。'
        : '你选择了题目预先标记为典型错误的选项，可以对照解析检查推理链条的哪一步出了问题。',
      flagForReview: false,
    };
  }

  if (confidence <= 2) {
    return {
      cause: 'knowledge-gap',
      errorTypes,
      repeatedPattern: false,
      rationale: '你自评信心较低且没有命中设计陷阱，更可能是相关概念或术语还不熟悉。',
      flagForReview: false,
    };
  }

  if (outcome === 'partial') {
    return {
      cause: 'logic-skill',
      errorTypes,
      repeatedPattern,
      rationale: '方向基本正确但不完整，主要缺口在于推理步骤或要点没有覆盖全。',
      flagForReview: false,
    };
  }

  return {
    cause: 'unknown',
    errorTypes,
    repeatedPattern: false,
    rationale: '现有信息不足以区分具体原因，只记录事实，不做归因。',
    flagForReview: false,
  };
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}
