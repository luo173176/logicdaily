import { z } from 'zod';

import { EXERCISE_CATEGORIES } from '@/lib/domain/taxonomy';

export const AI_PROVIDER_PRESETS = ['openai', 'openai-compatible', 'deepseek', 'moonshot', 'zhipu', 'qwen', 'local', 'custom'] as const;

/**
 * 预设只是**快捷方式**：点一下把 base_url 和常用模型名填进输入框，
 * 之后那两个值仍然由用户自由编辑。不拿它约束任何取值。
 * baseUrl 留空表示「按 OpenAI 兼容规则自行拼接 /chat/completions」。
 */
export const AI_PROVIDER_SHORTCUTS: Array<{ id: (typeof AI_PROVIDER_PRESETS)[number]; label: string; baseUrl: string; model: string }> = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'moonshot', label: 'Kimi / Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'local', label: '本机 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5' },
  { id: 'openai-compatible', label: '其他 OpenAI 兼容服务', baseUrl: '', model: '' },
  { id: 'custom', label: '自定义', baseUrl: '', model: '' },
];

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
  mode: 'server',
  provider: 'openai-compatible',
  model: '',
  baseUrl: '',
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
        /** 'server' 走本站 /api/ai/*（密钥留在服务端）；'direct' 由本机直连模型服务商。 */
        mode: z.enum(['server', 'direct']).default('server'),
        /** 仅作快捷方式使用，不约束任何取值。 */
        provider: z.enum(AI_PROVIDER_PRESETS).default('openai-compatible'),
        model: z.string().max(80).default(''),
        /** 直连模式下用户自由填写；服务端模式忽略此值。 */
        baseUrl: z.string().max(300).default(''),
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
