import { COACH_SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, jsonInstruction } from '@/lib/ai/prompts/system';

export const WEEKLY_SUMMARY_PROMPT_VERSION = 'weekly-summary-v2';

const OUTPUT_SHAPE =
  '{argumentStructure:[{text,role}],strengths:[string],issues:[{description,errorType,reason}],supportingEvidence:[string],opposingEvidence:[string],alternativeExplanations:[string],nextVerification:[{action,distinguishes}],uncertainty:string,recommendedKnowledgePoints:[string],observations:[string],suggestions:[string],caution:string}';

export function buildWeeklyMessages(input: {
  activeDays: number;
  attempts: number;
  accuracy: number;
  errorDistribution: string;
  journalCount: number;
  opposingEvidenceRate: number;
  reviewEffect: string;
  trendReliable: boolean;
}) {
  const user = [
    '任务：根据本周的行为与作答数据，写一段阶段性反馈。',
    `活跃天数：${input.activeDays}/7`,
    `作答数量：${input.attempts}`,
    `正确率：${input.accuracy}`,
    `错因分布：${input.errorDistribution}`,
    `思考日志：${input.journalCount} 篇，其中记录反面证据的比例 ${input.opposingEvidenceRate}`,
    `复习前后表现：${input.reviewEffect}`,
    `趋势样本是否足够：${input.trendReliable ? '足够' : '不足（不要下变化结论）'}`,
    '',
    '要求：',
    '1. 只描述能由这些数据支持的事实，区分“练习表现”和“现实中的判断质量”。',
    '2. 不要给出“智力/逻辑能力提升 X%”这类结论；样本不足时明确说不足。',
    '3. observations 写事实，suggestions 写下一步可执行的一两件小事。',
    '4. caution 写这段反馈可能误导用户的地方。',
    '',
    jsonInstruction(OUTPUT_SHAPE),
  ].join('\n');

  return {
    promptVersion: WEEKLY_SUMMARY_PROMPT_VERSION,
    system: COACH_SYSTEM_PROMPT,
    systemVersion: SYSTEM_PROMPT_VERSION,
    messages: [
      { role: 'system' as const, content: COACH_SYSTEM_PROMPT },
      { role: 'user' as const, content: user },
    ],
  };
}

export const PING_PROMPT_VERSION = 'ping-v1';

export function buildPingMessages(note: string) {
  return {
    promptVersion: PING_PROMPT_VERSION,
    system: COACH_SYSTEM_PROMPT,
    systemVersion: SYSTEM_PROMPT_VERSION,
    messages: [
      { role: 'system' as const, content: COACH_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: `连接测试。请只输出 JSON：{"reply":"<不超过 20 字的中文确认>","echo":"<原样返回下面这个词>"}`.replace(
          '<原样返回下面这个词>',
          note || 'logicdaily',
        ),
      },
    ],
  };
}
