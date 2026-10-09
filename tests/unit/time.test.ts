import { describe, expect, it } from 'vitest';

import {
  addDays,
  compareDateKeys,
  dateKeyInTimeZone,
  diffDays,
  formatChineseDate,
  isValidDateKey,
  relativeDayLabel,
  startOfWeekKey,
  weekdayLabel,
  isBetween,
  formatClock,
} from '@/lib/domain/time';

describe('dateKey 与时区', () => {
  const instant = new Date(Date.UTC(2026, 2, 15, 23, 30));

  it('同一时刻在不同时区得到不同日期', () => {
    expect(dateKeyInTimeZone(instant, 'UTC')).toBe('2026-03-15');
    expect(dateKeyInTimeZone(instant, 'Asia/Shanghai')).toBe('2026-03-16');
    expect(dateKeyInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-03-15');
  });

  it('日期字符串校验拒绝非法值', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-3-1')).toBe(false);
    expect(isValidDateKey('2026-03-01')).toBe(true);
  });
});

describe('日期加减', () => {
  it('加减以日历日为单位，不受夏令时切换影响', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('跨年差值正确', () => {
    expect(diffDays('2025-12-30', '2026-01-02')).toBe(3);
    expect(diffDays('2026-01-02', '2025-12-30')).toBe(-3);
  });

  it('周起始为周一', () => {
    expect(startOfWeekKey('2026-03-15')).toBe('2026-03-09');
    expect(startOfWeekKey('2026-03-09')).toBe('2026-03-09');
    expect(weekdayLabel('2026-03-15')).toBe('周日');
  });

  it('比较与区间判断', () => {
    expect(compareDateKeys('2026-03-01', '2026-03-02')).toBe(-1);
    expect(isBetween('2026-03-05', '2026-03-01', '2026-03-10')).toBe(true);
    expect(isBetween('2026-03-15', '2026-03-01', '2026-03-10')).toBe(false);
  });

  it('相对日期标签', () => {
    expect(relativeDayLabel('2026-03-15', '2026-03-15')).toBe('今天');
    expect(relativeDayLabel('2026-03-16', '2026-03-15')).toBe('明天');
    expect(relativeDayLabel('2026-03-13', '2026-03-15')).toBe('2 天前');
    expect(formatChineseDate('2026-03-15')).toBe('2026年3月15日');
  });

  it('时间标签可以指定时区', () => {
    const ts = Date.UTC(2026, 2, 15, 23, 30);
    expect(formatClock(ts, 'Asia/Shanghai')).toBe('07:30');
  });
});
