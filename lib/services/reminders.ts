import type { AppSettings } from '@/lib/domain/settings';
import { addDays, diffDays, type DateKey } from '@/lib/domain/time';

export interface ReminderState {
  enabled: boolean;
  paused: boolean;
  time: string;
  quietStart: string;
  quietEnd: string;
  weeklyReviewDay: number;
}

export type ReminderDecision =
  | { action: 'none'; reason: string }
  | { action: 'daily'; fireAtMinutes: number; title: string; body: string }
  | { action: 'weekly'; fireAtMinutes: number; title: string; body: string }
  | { action: 'pending-task'; fireAtMinutes: number; title: string; body: string };

/** HH:MM → 当天分钟数 */
export function minutesOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

export function isInQuietHours(atMinutes: number, settings: ReminderState): boolean {
  const start = minutesOfDay(settings.quietStart);
  const end = minutesOfDay(settings.quietEnd);
  if (start === end) return false;
  // 免打扰跨午夜（22:30–07:30）
  return start < end ? atMinutes >= start && atMinutes < end : atMinutes >= start || atMinutes < end;
}

/**
 * PWA 无法保证后台准时唤醒（浏览器与系统都会限制），因此这里只做“应用处于打开状态时的当日提醒”。
 * 真正的可靠后台提醒需要原生包装层，见 docs/ANDROID.md 的说明。
 */
export function decideReminder(options: {
  settings: AppSettings;
  nowMinutes: number;
  weekday: number;
  dateKey: DateKey;
  lastNotifiedDateKey: DateKey | null;
  pendingRequiredItems: number;
  overdueDays: number;
}): ReminderDecision {
  const { settings, nowMinutes, weekday, dateKey, lastNotifiedDateKey, pendingRequiredItems, overdueDays } = options;
  const state: ReminderState = { ...settings.reminders, enabled: settings.reminders.enabled && !settings.reminders.paused };

  if (!state.enabled) return { action: 'none', reason: '提醒已关闭或暂停。' };
  if (lastNotifiedDateKey === dateKey) return { action: 'none', reason: '今天已经提醒过。' };
  if (settings.restWeekdays.includes(weekday)) return { action: 'none', reason: '今天是你的休息日，不打扰。' };

  const target = minutesOfDay(state.time);
  if (nowMinutes < target) return { action: 'none', reason: `还没到设定时间 ${state.time}。` };
  if (nowMinutes - target > 120) return { action: 'none', reason: '已超过提醒窗口 2 小时，今天不再打扰。' };
  if (isInQuietHours(target, state)) return { action: 'none', reason: '设定时间落在免打扰时段内。' };

  const weeklyDue = weekday === state.weeklyReviewDay && diffDays(startOfWeekKeyLocal(dateKey), dateKey) >= 5;
  if (weeklyDue) {
    return {
      action: 'weekly',
      fireAtMinutes: target,
      title: '每周复盘',
      body: '花 5 分钟回顾这一周的判断：哪一次猜对了，哪一次其实是在猜。',
    };
  }

  if (pendingRequiredItems > 0 || overdueDays > 0) {
    return {
      action: 'pending-task',
      fireAtMinutes: target,
      title: 'LogicDaily',
      body:
        overdueDays > 0
          ? `有 ${overdueDays > 0 ? pendingRequiredItems : 0} 项任务逾期，今天先从复习开始。`
          : `今天还有 ${pendingRequiredItems} 项任务，通常 5 分钟就能开始。`,
    };
  }

  return {
    action: 'daily',
    fireAtMinutes: target,
    title: 'LogicDaily',
    body: '今天的一道题和一篇日志还没写。打开就能开始，不需要准备好状态。',
  };
}

function startOfWeekKeyLocal(dateKey: DateKey): DateKey {
  const [y, m, d] = dateKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return addDays(dateKey, -((weekday + 6) % 7));
}

export function nextReminderOccurrence(dateKey: DateKey, weekday: number, settings: AppSettings): DateKey | null {
  if (!settings.reminders.enabled || settings.reminders.paused) return null;
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(dateKey, offset);
    const candidateWeekday = (weekday + offset) % 7;
    if (settings.restWeekdays.includes(candidateWeekday)) continue;
    return candidate;
  }
  return null;
}
