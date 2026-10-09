import { z } from 'zod';

import { EXERCISE_CATEGORIES } from '@/lib/domain/taxonomy';

export const AI_PROVIDER_PRESETS = ['openai', 'openai-compatible', 'deepseek', 'moonshot', 'zhipu', 'qwen', 'local', 'custom'] as const;

const REMINDER_DEFAULTS = {
  enabled: false,
  time: '20:00',
  quietStart: '22:30',
  quietEnd: '07:30',
  weeklyReviewDay: 0,
  paused: false,
} as const;

const AI_DEFAULTS = {
  enabled: false,
  provider: 'openai-compatible',
  model: '',
  baseUrlLabel: '',
  temperature: 0.4,
  timeoutMs: 25_000,
  maxOutputTokens: 900,
  dailyCallLimit: 20,
} as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MSG = '时间格式必须是 HH:MM';

export const settingsSchema = z
  .object({
    profileId: z.string().min(1),
    displayName: z.string().min(1).max(40).default('我'),
    onboarded: z.boolean().default(false),

    dailyBudgetMinutes: z.number().int().min(3).max(60).default(10),
    newToReviewRatio: z.number().min(0).max(1).default(0.4),
    preferredCategories: z.array(z.enum(EXERCISE_CATEGORIES)).default([]),
    /** 0=周日 … 6=周六。休息日只是减轻任务，不会中断连续训练。 */
    restWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
    difficultyBias: z.number().min(0).max(1).default(0.5),
    timezone: z.string().min(1).default('UTC'),

    journalDailyReminder: z.boolean().default(true),
    reminders: z
      .object({
        enabled: z.boolean().default(false),
        time: z.string().regex(TIME_RE, TIME_MSG).default('20:00'),
        quietStart: z.string().regex(TIME_RE, TIME_MSG).default('22:30'),
        quietEnd: z.string().regex(TIME_RE, TIME_MSG).default('07:30'),
        weeklyReviewDay: z.number().int().min(0).max(6).default(0),
        paused: z.boolean().default(false),
      })
      .default({ ...REMINDER_DEFAULTS }),

    theme: z.enum(['system', 'light', 'dark']).default('system'),

    ai: z
      .object({
        enabled: z.boolean().default(false),
        provider: z.enum(AI_PROVIDER_PRESETS).default('openai-compatible'),
        model: z.string().max(80).default(''),
        /** 只保存用于展示的 Base URL 标签；API Key 永不进入客户端设置。 */
        baseUrlLabel: z.string().max(120).default(''),
        temperature: z.number().min(0).max(2).default(0.4),
        timeoutMs: z.number().int().min(3_000).max(120_000).default(25_000),
        maxOutputTokens: z.number().int().min(128).max(4_000).default(900),
        dailyCallLimit: z.number().int().min(0).max(200).default(20),
      })
      .default({ ...AI_DEFAULTS }),
  })
  .strict();

export type AppSettings = z.infer<typeof settingsSchema>;

export function defaultSettings(profileId: string): AppSettings {
  return settingsSchema.parse({ profileId });
}

/** 旧版本设置升级到当前版本；导入备份时也会经过这里。 */
export function migrateSettings(raw: unknown): AppSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const candidate: Record<string, unknown> = { ...source };

  if (typeof candidate.targetMinutes === 'number' && candidate.dailyBudgetMinutes === undefined) {
    candidate.dailyBudgetMinutes = candidate.targetMinutes;
  }
  delete candidate.targetMinutes;
  delete candidate.mode;
  if (typeof candidate.profileId !== 'string' || candidate.profileId.length === 0) {
    candidate.profileId = 'local';
  }
  // 嵌套对象做浅合并，否则旧备份缺少新增字段会整份解析失败。
  if (candidate.ai && typeof candidate.ai === 'object') {
    const ai: Record<string, unknown> = { ...AI_DEFAULTS, ...(candidate.ai as object) };
    // 备份里即使出现密钥字段也一律丢弃：密钥不属于可导出的公开配置。
    delete ai.apiKey;
    delete ai.key;
    delete ai.token;
    candidate.ai = ai;
  }
  if (candidate.reminders && typeof candidate.reminders === 'object') {
    candidate.reminders = { ...REMINDER_DEFAULTS, ...(candidate.reminders as object) };
  }

  return settingsSchema.parse(candidate);
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function settingsSummary(settings: AppSettings): string {
  const rest = settings.restWeekdays.length ? `，休息日：${settings.restWeekdays.map((d) => WEEKDAY_NAMES[d]).join('、')}` : '';
  return `每天 ${settings.dailyBudgetMinutes} 分钟，新题约 ${Math.round(
    settings.newToReviewRatio * 100,
  )}%、复习约 ${Math.round((1 - settings.newToReviewRatio) * 100)}%${rest}。`;
}
