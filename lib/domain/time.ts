/**
 * 日期以本地时区的 YYYY-MM-DD 字符串（DateKey）为唯一存储形式，
 * 所有比较与加减都在 UTC 正午基准上进行，避免夏令时与跨时区造成的偏移。
 */

export type DateKey = string;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidDateKey(value: string): value is DateKey {
  if (!DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const ts = Date.UTC(y, m - 1, d);
  const back = new Date(ts);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

export function dateKeyInTimeZone(at: Date, timeZone: string): DateKey {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  const normalized = parts.replace(/\//g, '-');
  return isValidDateKey(normalized) ? normalized : at.toISOString().slice(0, 10);
}

export function todayKey(at: Date = new Date(), timeZone: string = detectTimeZone()): DateKey {
  return dateKeyInTimeZone(at, timeZone);
}

function toUtcNoon(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

export function addDays(key: DateKey, days: number): DateKey {
  const shifted = new Date(toUtcNoon(key) + days * 86_400_000);
  return [shifted.getUTCFullYear(), String(shifted.getUTCMonth() + 1).padStart(2, '0'), String(shifted.getUTCDate()).padStart(2, '0')].join('-');
}

export function diffDays(from: DateKey, to: DateKey): number {
  return Math.round((toUtcNoon(to) - toUtcNoon(from)) / 86_400_000);
}

export function compareDateKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBetween(key: DateKey, start: DateKey, end: DateKey): boolean {
  return compareDateKeys(key, start) >= 0 && compareDateKeys(key, end) <= 0;
}

/** 返回该日期所在周的周一（ISO 周起始）。 */
export function startOfWeekKey(key: DateKey): DateKey {
  const [y, m, d] = key.split('-').map(Number);
  const weekday = new Date(toUtcNoon(key)).getUTCDay();
  const offset = (weekday + 6) % 7;
  void y;
  void m;
  void d;
  return addDays(key, -offset);
}

export function rangeKeys(start: DateKey, count: number): DateKey[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(key: DateKey): string {
  return WEEKDAYS[new Date(toUtcNoon(key)).getUTCDay()];
}

export function formatChineseDate(key: DateKey): string {
  const [y, m, d] = key.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export function formatChineseDateWithWeekday(key: DateKey): string {
  return `${formatChineseDate(key)} ${weekdayLabel(key)}`;
}

export function relativeDayLabel(key: DateKey, reference: DateKey): string {
  const delta = diffDays(reference, key);
  if (delta === 0) return '今天';
  if (delta === 1) return '明天';
  if (delta === -1) return '昨天';
  if (delta > 1 && delta <= 7) return `${delta} 天后`;
  if (delta < -1 && delta >= -7) return `${-delta} 天前`;
  return formatChineseDate(key);
}

/** 毫秒时间戳 → 本地时区的分钟级时间标签。 */
export function formatClock(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

export function formatDateTime(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}
