import { COACH_SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, jsonInstruction } from '@/lib/ai/prompts/system';

export const ANALYZE_REASONING_PROMPT_VERSION = 'analyze-reasoning-v2';

export interface ReasoningPromptInput {
  categoryLabel: string;
  stem: string;
  userAnswerText: string;
  correctAnswerText: string;
  reasoning: string;
  confidence: number;
  detectedErrorTypes: string[];
  explanationSteps: string[];
}

const OUTPUT_SHAPE =
  '{argumentStructure:[{text,role}],strengths:[string],issues:[{description,errorType,reason}],supportingEvidence:[string],opposingEvidence:[string],alternativeExplanations:[string],nextVerification:[{action,distinguishes}],uncertainty:string,recommendedKnowledgePoints:[string],questions:[string],missingPremise:string|null}';

export function buildReasoningMessages(input: ReasoningPromptInput) {
  const user = [
    '任务：分析用户这道题的推理过程。',
    `题型：${input.categoryLabel}`,
    `题目：${input.stem}`,
    `用户的答案：${input.userAnswerText}`,
    `参考答案：${input.correctAnswerText}`,
    `用户写下的推理：${input.reasoning || '（用户没有写推理过程）'}`,
    `用户自评信心：${input.confidence}/5`,
    `系统按选项标记检测到的典型错误：${input.detectedErrorTypes.join('、') || '无'}`,
    '',
    '请按下面顺序完成：',
    '1. 拆出用户论证的结构（结论/前提/假设/证据）。',
    '2. 先指出他做对了什么，再指出问题；问题要说清“错在哪一步”，不要只给结论。',
    '3. 如果用户没有写出推理过程，把它当作最重要的缺口来提问。',
    '4. 给出 1～3 个追问，让他自己修正；本轮不要直接复述参考解析。',
    '5. recommendedKnowledgePoints 只能使用中文知识点名称，最多 3 个。',
    '',
    jsonInstruction(OUTPUT_SHAPE),
  ].join('\n');

  return {
    promptVersion: ANALYZE_REASONING_PROMPT_VERSION,
    system: COACH_SYSTEM_PROMPT,
    systemVersion: SYSTEM_PROMPT_VERSION,
    messages: [
      { role: 'system' as const, content: COACH_SYSTEM_PROMPT },
      { role: 'user' as const, content: user },
    ],
  };
}

export function buildFollowUpMessages(input: ReasoningPromptInput & { history: { role: 'user' | 'assistant'; content: string }[] }) {
  const base = buildReasoningMessages(input);
  return {
    promptVersion: `${ANALYZE_REASONING_PROMPT_VERSION}-followup`,
    system: base.system,
    systemVersion: base.systemVersion,
    messages: [
      ...base.messages,
      ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
      {
        role: 'user' as const,
        content: `用户补充说明：${input.reasoning}\n请继续追问或在他已完成尝试后给出完整示范。${jsonInstruction(OUTPUT_SHAPE)}`,
      },
    ],
  };
}
