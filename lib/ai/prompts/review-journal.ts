import { COACH_SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, jsonInstruction } from '@/lib/ai/prompts/system';

export const REVIEW_JOURNAL_PROMPT_VERSION = 'review-journal-v2';

export interface JournalPromptInput {
  title: string;
  problem: string;
  background: string;
  facts: string;
  assumptions: string;
  conclusion: string;
  alternativeExplanations: string;
  keyUncertainties: string;
  verificationActions: string;
  evidence: { stance: string; text: string; source: string; reliability: number }[];
  stepNotes: { stepId: string; text: string }[];
  selfConfidence: number;
}

const OUTPUT_SHAPE =
  '{argumentStructure:[{text,role}],strengths:[string],issues:[{description,errorType,reason}],supportingEvidence:[string],opposingEvidence:[string],alternativeExplanations:[string],nextVerification:[{action,distinguishes}],uncertainty:string,recommendedKnowledgePoints:[string],questions:[string],factsMixedWithInference:[string],strongestCounterView:string|null}';

export function buildJournalMessages(input: JournalPromptInput) {
  const evidenceLines = input.evidence.length
    ? input.evidence
        .map((item) => `- [${item.stance}] ${item.text}${item.source ? `（来源：${item.source}，可靠性 ${item.reliability}/5）` : ''}`)
        .join('\n')
    : '（用户还没有列出任何证据）';

  const stepLines = input.stepNotes.filter((s) => s.text.trim()).map((s) => `- ${s.stepId}：${s.text}`).join('\n');

  const user = [
    '任务：复盘这篇真实生活思考日志。',
    `标题：${input.title}`,
    `要回答的问题：${input.problem || '（未填写）'}`,
    `背景：${input.background || '（未填写）'}`,
    `已知事实：${input.facts || '（未填写）'}`,
    `我的假设：${input.assumptions || '（未填写）'}`,
    `当前结论：${input.conclusion || '（未填写）'}`,
    `其他可能解释：${input.alternativeExplanations || '（未填写）'}`,
    `关键不确定：${input.keyUncertainties || '（未填写）'}`,
    `验证行动：${input.verificationActions || '（未填写）'}`,
    `当初信心：${input.selfConfidence}/5`,
    '证据清单：',
    evidenceLines,
    stepLines ? `向导记录：\n${stepLines}` : '',
    '',
    '请重点检查：',
    '1. 哪些内容被当作事实，其实只是推测、感受或价值判断。',
    '2. 是否存在只有一个解释、没有反对证据、或结论超出证据范围的情况。',
    '3. 提出能区分不同解释的具体观察或数据，并说明每种解释会预测什么。',
    '4. 用问题引导用户自己补全，不要直接替他改写结论。',
    '',
    jsonInstruction(OUTPUT_SHAPE),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    promptVersion: REVIEW_JOURNAL_PROMPT_VERSION,
    system: COACH_SYSTEM_PROMPT,
    systemVersion: SYSTEM_PROMPT_VERSION,
    messages: [
      { role: 'system' as const, content: COACH_SYSTEM_PROMPT },
      { role: 'user' as const, content: user },
    ],
  };
}
