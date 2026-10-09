import { COACH_SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, jsonInstruction } from '@/lib/ai/prompts/system';

export const RECOMMEND_PRACTICE_PROMPT_VERSION = 'recommend-practice-v2';

const OUTPUT_SHAPE =
  '{argumentStructure:[{text,role}],strengths:[string],issues:[{description,errorType,reason}],supportingEvidence:[string],opposingEvidence:[string],alternativeExplanations:[string],nextVerification:[{action,distinguishes}],uncertainty:string,recommendedKnowledgePoints:[string],exerciseIds:[string],reason:string}';

export interface PracticeCandidate {
  id: string;
  categoryLabel: string;
  difficulty: number;
  knowledgePoints: string[];
  format: string;
}

export function buildPracticeMessages(input: {
  weakKnowledgePoints: string[];
  recentErrorTypes: string[];
  budgetMinutes: number;
  candidates: PracticeCandidate[];
}) {
  const catalog = input.candidates
    .map((c) => `- ${c.id}｜${c.categoryLabel}｜难度 ${c.difficulty}｜题型 ${c.format}｜知识点 ${c.knowledgePoints.join('/')}`)
    .join('\n');

  const user = [
    '任务：从给定候选题目中挑出最适合接下来练习的 1～5 题。',
    `薄弱知识点：${input.weakKnowledgePoints.join('、') || '（暂无足够样本）'}`,
    `近期反复出现的错误类型：${input.recentErrorTypes.join('、') || '（暂无）'}`,
    `可用时间：${input.budgetMinutes} 分钟`,
    '候选题目：',
    catalog,
    '',
    '要求：',
    '1. exerciseIds 只能从上面列出的 id 中选，不要发明新 id。',
    '2. 优先覆盖薄弱知识点，其次保证难度梯度（不要全部同难度）。',
    '3. 每次至少保留一题与薄弱点直接相关。',
    '4. reason 说明选择依据，让用户知道为什么是这几题。',
    '',
    jsonInstruction(OUTPUT_SHAPE),
  ].join('\n');

  return {
    promptVersion: RECOMMEND_PRACTICE_PROMPT_VERSION,
    system: COACH_SYSTEM_PROMPT,
    systemVersion: SYSTEM_PROMPT_VERSION,
    messages: [
      { role: 'system' as const, content: COACH_SYSTEM_PROMPT },
      { role: 'user' as const, content: user },
    ],
  };
}
