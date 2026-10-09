import type { AiTask } from '@/lib/ai/output-schema';
import { ANALYZE_MATERIAL_PROMPT_VERSION, buildMaterialMessages } from '@/lib/ai/prompts/analyze-material';
import { ANALYZE_REASONING_PROMPT_VERSION, buildFollowUpMessages, buildReasoningMessages } from '@/lib/ai/prompts/analyze-reasoning';
import { PING_PROMPT_VERSION, WEEKLY_SUMMARY_PROMPT_VERSION, buildPingMessages, buildWeeklyMessages } from '@/lib/ai/prompts/weekly-summary';
import { RECOMMEND_PRACTICE_PROMPT_VERSION, buildPracticeMessages } from '@/lib/ai/prompts/recommend-practice';
import { REVIEW_JOURNAL_PROMPT_VERSION, buildJournalMessages } from '@/lib/ai/prompts/review-journal';
import { SYSTEM_PROMPT_VERSION } from '@/lib/ai/prompts/system';

export {
  ANALYZE_MATERIAL_PROMPT_VERSION,
  ANALYZE_REASONING_PROMPT_VERSION,
  RECOMMEND_PRACTICE_PROMPT_VERSION,
  REVIEW_JOURNAL_PROMPT_VERSION,
  WEEKLY_SUMMARY_PROMPT_VERSION,
  PING_PROMPT_VERSION,
  SYSTEM_PROMPT_VERSION,
  buildMaterialMessages,
  buildReasoningMessages,
  buildFollowUpMessages,
  buildPracticeMessages,
  buildJournalMessages,
  buildWeeklyMessages,
  buildPingMessages,
};

export interface PromptBundle {
  promptVersion: string;
  system: string;
  systemVersion: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
}

export const PROMPT_REGISTRY_VERSION = 'prompts-v1';

export function promptVersionFor(task: AiTask): string {
  switch (task) {
    case 'analyze-reasoning':
      return ANALYZE_REASONING_PROMPT_VERSION;
    case 'review-journal':
      return REVIEW_JOURNAL_PROMPT_VERSION;
    case 'analyze-material':
      return ANALYZE_MATERIAL_PROMPT_VERSION;
    case 'recommend-practice':
      return RECOMMEND_PRACTICE_PROMPT_VERSION;
    case 'weekly-summary':
      return WEEKLY_SUMMARY_PROMPT_VERSION;
    case 'ping':
      return PING_PROMPT_VERSION;
  }
}
