import { describe, expect, it } from 'vitest';

import { defaultSettings, type AppSettings } from '@/lib/domain/settings';
import { decideReminder, isInQuietHours, minutesOfDay, nextReminderOccurrence } from '@/lib/services/reminders';

function withReminders(overrides: Partial<AppSettings['reminders']>): AppSettings {
  return { ...defaultSettings('p1'), reminders: { ...defaultSettings('p1').reminders, ...overrides } };
}

describe('时间工具', () => {
  it('HH:MM 换算为当天分钟数', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('07:30')).toBe(450);
    expect(minutesOfDay('22:30')).toBe(1350);
    expect(minutesOfDay('坏数据')).toBe(0);
  });

  it('免打扰时段支持跨午夜', () => {
    const reminders = withReminders({ quietStart: '22:30', quietEnd: '07:30' }).reminders;
    expect(isInQuietHours(1400, reminders)).toBe(true); // 23:20
    expect(isInQuietHours(300, reminders)).toBe(true); // 05:00
    expect(isInQuietHours(800, reminders)).toBe(false); // 13:20
    expect(isInQuietHours(1350, reminders)).toBe(true); // 起点包含
    expect(isInQuietHours(450, reminders)).toBe(false); // 终点不包含
  });

  it('起止相同表示不设免打扰', () => {
    const reminders = withReminders({ quietStart: '22:30', quietEnd: '22:30' }).reminders;
    expect(isInQuietHours(1400, reminders)).toBe(false);
  });

  it('不跨午夜的时段按普通区间判断', () => {
    const reminders = withReminders({ quietStart: '12:00', quietEnd: '14:00' }).reminders;
    expect(isInQuietHours(700, reminders)).toBe(false); // 11:40，时段开始之前
    expect(isInQuietHours(800, reminders)).toBe(true); // 13:20
    expect(isInQuietHours(900, reminders)).toBe(false); // 15:00，时段结束之后
  });
});

describe('当日提醒决策', () => {
  const base = {
    nowMinutes: minutesOfDay('20:00'),
    weekday: 2,
    dateKey: '2026-03-17',
    lastNotifiedDateKey: null,
    pendingRequiredItems: 0,
    overdueDays: 0,
  } as const;

  it('关闭或暂停时不打扰', () => {
    expect(decideReminder({ settings: withReminders({ enabled: false }), ...base })).toEqual({
      action: 'none',
      reason: '提醒已关闭或暂停。',
    });
    expect(decideReminder({ settings: withReminders({ enabled: true, paused: true }), ...base }).action).toBe('none');
  });

  it('同一天只提醒一次', () => {
    expect(decideReminder({ settings: withReminders({ enabled: true }), ...base, lastNotifiedDateKey: '2026-03-17' })).toEqual({
      action: 'none',
      reason: '今天已经提醒过。',
    });
  });

  it('休息日不打扰', () => {
    const settings = { ...withReminders({ enabled: true }), restWeekdays: [2] };
    expect(decideReminder({ settings, ...base })).toEqual({ action: 'none', reason: '今天是你的休息日，不打扰。' });
  });

  it('未到时间与超过 2 小时窗口都不提醒', () => {
    const settings = withReminders({ enabled: true, time: '20:00' });
    const early = decideReminder({ settings, ...base, nowMinutes: minutesOfDay('19:00') });
    const late = decideReminder({ settings, ...base, nowMinutes: minutesOfDay('23:00') });
    expect(early).toEqual({ action: 'none', reason: '还没到设定时间 20:00。' });
    expect(late.action).toBe('none');
    if (late.action === 'none') expect(late.reason).toContain('已超过提醒窗口');
  });

  it('设定时间落在免打扰时段内时不提醒', () => {
    const settings = withReminders({ enabled: true, time: '23:00', quietStart: '22:30', quietEnd: '07:30' });
    const decision = decideReminder({ settings, ...base, nowMinutes: minutesOfDay('23:00') });
    expect(decision.action).toBe('none');
    if (decision.action === 'none') expect(decision.reason).toContain('免打扰');
  });

  it('有必做项或逾期项时改用待办文案', () => {
    const settings = withReminders({ enabled: true });
    const pending = decideReminder({ settings, ...base, pendingRequiredItems: 3 });
    expect(pending.action).toBe('pending-task');
    if (pending.action === 'pending-task') expect(pending.body).toContain('3 项');

    const overdue = decideReminder({ settings, ...base, pendingRequiredItems: 2, overdueDays: 1 });
    expect(overdue.action).toBe('pending-task');
    if (overdue.action === 'pending-task') expect(overdue.body).toContain('逾期');
  });

  it('每周复盘日在周末到达时优先于普通提醒', () => {
    const settings = withReminders({ enabled: true, weeklyReviewDay: 0 });
    // 2026-03-22 是周日，且已经是本周第 7 天。
    const decision = decideReminder({ settings, ...base, dateKey: '2026-03-22', weekday: 0 });
    expect(decision.action).toBe('weekly');
    if (decision.action === 'weekly') expect(decision.title).toBe('每周复盘');
  });

  it('普通情况下给出每日提醒', () => {
    const decision = decideReminder({ settings: withReminders({ enabled: true }), ...base });
    expect(decision.action).toBe('daily');
    if (decision.action === 'daily') {
      expect(decision.fireAtMinutes).toBe(1200);
      expect(decision.title).toBe('LogicDaily');
    }
  });
});

describe('下一次提醒日期', () => {
  it('关闭时没有下一次', () => {
    expect(nextReminderOccurrence('2026-03-17', 2, withReminders({ enabled: false }))).toBeNull();
    expect(nextReminderOccurrence('2026-03-17', 2, withReminders({ enabled: true, paused: true }))).toBeNull();
  });

  it('跳过休息日', () => {
    // 2026-03-17 是周二（weekday 2），休息周二、周三，下一次落在周四。
    const settings = { ...withReminders({ enabled: true }), restWeekdays: [2, 3] };
    expect(nextReminderOccurrence('2026-03-17', 2, settings)).toBe('2026-03-19');
  });

  it('一周内全是休息日时返回 null', () => {
    const settings = { ...withReminders({ enabled: true }), restWeekdays: [0, 1, 2, 3, 4, 5, 6] };
    expect(nextReminderOccurrence('2026-03-17', 2, settings)).toBeNull();
  });
});
