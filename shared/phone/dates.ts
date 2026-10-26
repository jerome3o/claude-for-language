/** Dates and times on the simulated phone (pure; "YYYY-MM-DD" + "HH:MM", no time zones). */

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_XQ = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function parseDate(d: string): { y: number; m: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), day: Number(m[3]) };
}

export function isDate(d: unknown): d is string {
  if (typeof d !== 'string') return false;
  const p = parseDate(d);
  if (!p) return false;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.day));
  return t.getUTCFullYear() === p.y && t.getUTCMonth() === p.m - 1 && t.getUTCDate() === p.day;
}

export function isTime(t: unknown): t is string {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function toUtc(d: string): number {
  const p = parseDate(d)!;
  return Date.UTC(p.y, p.m - 1, p.day);
}

export function weekday(d: string): number {
  return new Date(toUtc(d)).getUTCDay();
}

export function addDays(d: string, n: number): string {
  const t = new Date(toUtc(d) + n * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** 10月31日 */
export function zhMonthDay(d: string): string {
  const p = parseDate(d);
  return p ? `${p.m}月${p.day}日` : d;
}

/** 周六 */
export function zhWeekday(d: string): string {
  return WEEKDAYS_ZH[weekday(d)];
}

/** 星期六 */
export function zhWeekdayLong(d: string): string {
  return WEEKDAYS_XQ[weekday(d)];
}

/** 今天 / 明天 / 后天 / 周六, relative to `today`. */
export function zhRelativeDay(d: string, today: string): string {
  const n = daysBetween(today, d);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '后天';
  return zhWeekday(d);
}

/** 10月31日 周六 */
export function zhDateLabel(d: string): string {
  return `${zhMonthDay(d)} ${zhWeekday(d)}`;
}

export function minutesOf(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function timeOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes from `depart` to `arrive` (an earlier arrival is the next day). */
export function spanMinutes(depart: string, arrive: string): number {
  const d = minutesOf(arrive) - minutesOf(depart);
  return d >= 0 ? d : d + 1440;
}

/** 历时 0小时53分 / 1小时05分 */
export function zhDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}小时${String(m).padStart(2, '0')}分`;
}

/** Minutes from (today, now) to (date, time); negative when in the past. */
export function minutesUntil(today: string, now: string, date: string, time: string): number {
  return daysBetween(today, date) * 1440 + minutesOf(time) - minutesOf(now);
}

/** ¥73.0 → "73" / 18.5 → "18.50" (prices as the apps print them). */
export function yuan(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Always two decimals (payment screens: ¥86.00). */
export function yuan2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
