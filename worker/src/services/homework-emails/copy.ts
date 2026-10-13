/**
 * Homework e-mails — the pure part (docs/HOMEWORK.md §12): the student's local
 * day and hour, which rows a reminder covers, how a send's rows become lines
 * (a deck split over days is ONE line), and the two e-mails as subject + plain
 * text + HTML. No D1, no fetch — unit-tested and snapshot-tested.
 *
 * Copy (Jerome, Oct 2026): BILINGUAL — simple Chinese first, the English under
 * it, item titles as they are; short, warm, with the tutor's first name.
 */

import { addDays, daysBetween, hasOneOff, isDateString, shortDay, studentFirstName, titleParts, type HomeworkMode } from '@shared/homework';
import { isValidTimeZone } from '@shared/profile';
import { escapeHtml } from '../email';

/** Reminders go out from this local hour the evening before (hourly cron at :37 → ~18:37). */
export const REMINDER_LOCAL_HOUR = 18;
/** Rows assigned this recently are left out of a reminder: the "sent you homework" e-mail just told them. */
export const REMINDER_SKIP_FRESH_MS = 6 * 3600_000;
/** A burst of sends within this window becomes ONE "sent you homework" e-mail. */
export const ASSIGNED_DEBOUNCE_MS = 110_000;
/** The queue delay after a send (a little over the debounce). */
export const ASSIGNED_DELAY_SECONDS = 120;
/** The hourly sweep never e-mails rows older than this (a lost queue message, a missing key). */
export const ASSIGNED_MAX_AGE_MS = 24 * 3600_000;
/** When the student has no time zone and neither has the tutor. */
export const FALLBACK_TIME_ZONE = 'Europe/London';

export interface EmailAssignment {
  id: string;
  tutor_id: string;
  tutor_name: string | null;
  batch_id: string | null;
  kind: string;
  target_id: string;
  title: string;
  mode: string;
  due_date: string | null;
  item_count: number;
  done_count: number;
  part_index: number;
  part_count: number;
  status: string;
  created_at: string;
}

/** One line of the e-mail: an item (a split deck's parts together). */
export interface EmailLine {
  kind: string;
  title: string;
  /** Long-term review only (no date, nothing to finish). */
  long_term: boolean;
  words: number | null;
  first_due: string | null;
  last_due: string | null;
  parts: number;
  assignment_ids: string[];
}

// ============ Time ============

/** The first valid IANA zone of the list, else Europe/London. */
export function pickTimeZone(...zones: Array<string | null | undefined>): string {
  for (const z of zones) if (z && isValidTimeZone(z)) return z;
  return FALLBACK_TIME_ZONE;
}

/** The calendar day and hour (0–23) at `now` in `timeZone`. */
export function localParts(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

/** D1's datetime('now') format ('YYYY-MM-DD HH:MM:SS', UTC) for a moment. */
export function sqlTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** created_at ('YYYY-MM-DD HH:MM:SS' UTC, or ISO) → epoch ms. */
export function parseSqlTime(value: string): number {
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

/**
 * Which rows tomorrow's reminder covers for one student, or null when it is not
 * the evening yet / nothing is due: active one-off passes (one_off / both) due
 * on the student's local tomorrow, not assigned in the last few hours.
 */
export function reminderRows<T extends Pick<EmailAssignment, 'status' | 'mode' | 'due_date' | 'created_at'>>(
  rows: readonly T[],
  now: Date,
  timeZone: string,
): { due: string; rows: T[] } | null {
  const local = localParts(now, timeZone);
  if (local.hour < REMINDER_LOCAL_HOUR) return null;
  const due = addDays(local.date, 1);
  const picked = rows.filter(
    (r) =>
      r.status === 'active' &&
      hasOneOff(r.mode as HomeworkMode) &&
      r.due_date === due &&
      now.getTime() - parseSqlTime(r.created_at) >= REMINDER_SKIP_FRESH_MS,
  );
  return picked.length ? { due, rows: picked } : null;
}

// ============ Lines ============

/** A send's rows as lines: grouped by batch + item, a split deck's days together, in send order. */
export function groupLines(rows: readonly EmailAssignment[]): EmailLine[] {
  const byKey = new Map<string, EmailLine>();
  for (const r of rows) {
    const key = `${r.batch_id ?? ''}|${r.kind}|${r.target_id}|${r.mode}`;
    const line = byKey.get(key);
    const due = r.due_date && isDateString(r.due_date) ? r.due_date : null;
    if (!line) {
      byKey.set(key, {
        kind: r.kind,
        title: titleParts(r).base,
        long_term: r.mode === 'fsrs',
        words: r.kind === 'deck' ? r.item_count : null,
        first_due: due,
        last_due: due,
        parts: 1,
        assignment_ids: [r.id],
      });
      continue;
    }
    line.parts += 1;
    line.assignment_ids.push(r.id);
    if (line.words !== null) line.words += r.item_count;
    if (due && (!line.first_due || due < line.first_due)) line.first_due = due;
    if (due && (!line.last_due || due > line.last_due)) line.last_due = due;
  }
  return [...byKey.values()];
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZH_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** "Thursday 16 Oct". */
export function longDay(date: string): string {
  if (!isDateString(date)) return date;
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${shortDay(date).split(' ').slice(1).join(' ')}`;
}

/** "10月16日". */
export function zhDate(date: string): string {
  if (!isDateString(date)) return date;
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/** "周四". */
export function zhWeekday(date: string): string {
  return isDateString(date) ? ZH_DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] : '';
}

/** A bit of copy in both languages: Chinese first, English under it. */
export interface Bi {
  zh: string;
  en: string;
}

/**
 * The due label in both languages (both '' without a date):
 * 明天 (周四) 到期 · due tomorrow, Thu 16 Oct — 10月16日 (周五) 到期 · due Friday 16 Oct —
 * 今天到期 · due today — 分 3 天：10月16日 – 10月18日 · over 3 days, Fri 16 Oct – Sun 18 Oct.
 */
export function dueText(line: Pick<EmailLine, 'first_due' | 'last_due' | 'parts'>, today: string): Bi {
  const due = line.first_due;
  if (!due) return { zh: '', en: '' };
  if (line.parts > 1 && line.last_due && line.last_due !== due) {
    return {
      zh: `分 ${line.parts} 天：${zhDate(due)} – ${zhDate(line.last_due)}`,
      en: `over ${line.parts} days, ${shortDay(due)} – ${shortDay(line.last_due)}`,
    };
  }
  const days = daysBetween(today, due);
  if (days < 0) return { zh: `${zhDate(due)}已到期`, en: `was due ${longDay(due)}` };
  if (days === 0) return { zh: '今天到期', en: 'due today' };
  if (days === 1) return { zh: `明天 (${zhWeekday(due)}) 到期`, en: `due tomorrow, ${shortDay(due)}` };
  return { zh: `${zhDate(due)} (${zhWeekday(due)}) 到期`, en: `due ${longDay(due)}` };
}

/** 12 个词 · 12 words / 小课 · Mini lesson / 故事 · Story / 链接 · Link. */
export function kindText(line: Pick<EmailLine, 'kind' | 'words'>): Bi {
  if (line.kind === 'deck') return { zh: `${line.words ?? 0} 个词`, en: `${line.words ?? 0} ${line.words === 1 ? 'word' : 'words'}` };
  if (line.kind === 'lesson') return { zh: '小课', en: 'Mini lesson' };
  if (line.kind === 'reader') return { zh: '故事', en: 'Story' };
  if (line.kind === 'link') return { zh: '链接', en: 'Link' };
  return { zh: '作业', en: 'Homework' };
}

/** Join the non-empty parts of each language with " · ". */
function joinBi(parts: Bi[]): Bi {
  return {
    zh: parts.map((p) => p.zh).filter(Boolean).join(' · '),
    en: parts.map((p) => p.en).filter(Boolean).join(' · '),
  };
}

// ============ The e-mails ============

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface Common {
  studentName: string | null;
  appUrl: string;
  unsubscribeUrl: string;
}

/** "Minghui", "Minghui and Wei", "Minghui, Wei and Lan". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'Your tutor';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function firstNameOr(name: string | null | undefined, fallback: string): string {
  return name?.trim() ? studentFirstName(name) : fallback;
}

/** The tutors' first names, once each (null = no name: the copy says 老师 / your tutor). */
function tutorNames(rows: readonly Pick<EmailAssignment, 'tutor_id' | 'tutor_name'>[]): Array<string | null> {
  const seen = new Map<string, string | null>();
  for (const r of rows) if (!seen.has(r.tutor_id)) seen.set(r.tutor_id, r.tutor_name?.trim() ? studentFirstName(r.tutor_name) : null);
  return [...seen.values()];
}

/** "Minghui老师" / "老师" (no name) / "Minghui老师和Wei老师". */
function zhTutors(names: Array<string | null>): string {
  return names.map((n) => (n ? `${n}老师` : '老师')).join('和');
}

function enTutors(names: Array<string | null>): string {
  return joinNames(names.map((n) => n ?? 'Your tutor'));
}

/** Where the button goes: the pass when the e-mail is about one assignment, else the homework list. */
export function homeworkLink(appUrl: string, assignmentIds: readonly string[]): string {
  const base = appUrl.replace(/\/+$/, '');
  return assignmentIds.length === 1 ? `${base}/homework/${assignmentIds[0]}` : `${base}/homework`;
}

const C = {
  text: '#1f2937',
  muted: '#6b7280',
  accent: '#2563eb',
  card: '#f3f4f6',
  rule: '#e5e7eb',
};

function shell(inner: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Noto Sans SC',sans-serif;font-size:16px;line-height:1.55;color:${C.text};">
${inner}
<div style="margin-top:28px;padding-top:16px;border-top:1px solid ${C.rule};color:${C.muted};font-size:13px;">
${footerHtml}
</div>
</div>
</body>
</html>`;
}

/** A paragraph: the Chinese, the English under it in a quieter grey. */
function biPara(b: Bi, margin = '0 0 14px'): string {
  return `<p style="margin:${margin};">${escapeHtml(b.zh)}<br><span lang="en" style="color:${C.muted};font-size:15px;">${escapeHtml(b.en)}</span></p>`;
}

function lineHtml(title: string, meta: Bi): string {
  return `<tr><td style="padding:10px 14px;border-bottom:2px solid #ffffff;">
<div style="font-weight:600;font-size:16px;">${escapeHtml(title)}</div>
${meta.zh ? `<div style="color:${C.text};font-size:14px;">${escapeHtml(meta.zh)}</div>` : ''}
${meta.en ? `<div lang="en" style="color:${C.muted};font-size:14px;">${escapeHtml(meta.en)}</div>` : ''}
</td></tr>`;
}

function button(href: string, label: Bi): string {
  return `<p style="margin:22px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">${escapeHtml(`${label.zh} · ${label.en}`)}</a></p>`;
}

function footer(c: Common): { html: string; text: string } {
  return {
    html: `<p style="margin:0 0 6px;">汉语学习 · Chinese Learning App</p>
<p style="margin:0;"><a href="${escapeHtml(c.unsubscribeUrl)}" style="color:${C.muted};">关闭作业邮件 · Turn off homework emails</a><br>作业仍在应用里 · your homework stays in the app</p>`,
    text: `---\n汉语学习 · Chinese Learning App\n关闭作业邮件 · Turn off homework emails: ${c.unsubscribeUrl}`,
  };
}

function table(rows: string[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:${C.card};border-radius:10px;">
${rows.join('\n')}
</table>`;
}

/** One item in the plain-text part: "• title", then the Chinese and the English meta line, indented. */
function textItem(title: string, meta: Bi): string[] {
  return [`• ${title}`, ...(meta.zh ? [`  ${meta.zh}`] : []), ...(meta.en ? [`  ${meta.en}`] : [])];
}

function greeting(studentName: string | null): Bi {
  const name = firstNameOr(studentName, '');
  return name ? { zh: `${name}，你好！`, en: `Hi ${name},` } : { zh: '你好！', en: 'Hi there,' };
}

/**
 * "<Tutor> sent you homework" (Chinese + English): the one-off items with
 * their due dates, then a quieter line for decks sent for long-term review
 * only. null when the rows hold nothing to do by a date (a long-term-only send
 * gets no e-mail).
 */
export function renderAssignedEmail(input: Common & { rows: readonly EmailAssignment[]; today: string }): RenderedEmail | null {
  const live = input.rows.filter((r) => r.status !== 'cancelled');
  const lines = groupLines(live);
  const todo = lines.filter((l) => !l.long_term);
  if (todo.length === 0) return null;
  const longTerm = lines.filter((l) => l.long_term);
  const names = tutorNames(live);
  const zhWho = zhTutors(names);
  const enWho = enTutors(names);
  const hi = greeting(input.studentName);
  const n = todo.length;
  const intro: Bi = {
    zh: `${zhWho}给你留了${n === 1 ? '新作业' : ` ${n} 项新作业`}：`,
    en: `${enWho} sent you ${n === 1 ? 'something new' : `${n} new things`} to do:`,
  };
  const link = homeworkLink(input.appUrl, todo.flatMap((l) => l.assignment_ids));
  const meta = (l: EmailLine) => joinBi([kindText(l), dueText(l, input.today)]);
  const quiet: Bi | null = longTerm.length
    ? {
        zh: `另外加入了每日复习：${longTerm.map((l) => `${l.title} (${kindText(l).zh})`).join('、')}——每天几张卡，不用赶日期。`,
        en: `Also added to your daily reviews: ${longTerm.map((l) => `${l.title} (${kindText(l).en})`).join(', ')} — a few cards a day, nothing to finish by a date.`,
      }
    : null;
  const label: Bi = { zh: '打开作业', en: n === 1 ? 'Open it' : 'Open your homework' };
  const f = footer(input);

  const subject = `${zhWho}给你留了作业 · ${enWho} sent you homework`;
  const text = [
    hi.zh,
    hi.en,
    '',
    intro.zh,
    intro.en,
    '',
    ...todo.flatMap((l) => [...textItem(l.title, meta(l)), '']),
    ...(quiet ? [quiet.zh, quiet.en, ''] : []),
    `${label.zh} · ${label.en}: ${link}`,
    '',
    '加油！',
    '',
    f.text,
  ].join('\n');

  const html = shell(
    `${biPara(hi, '0 0 12px')}
${biPara(intro)}
${table(todo.map((l) => lineHtml(l.title, meta(l))))}
${quiet ? `<p style="margin:14px 0 0;color:${C.muted};font-size:14px;">${escapeHtml(quiet.zh)}<br><span lang="en">${escapeHtml(quiet.en)}</span></p>` : ''}
${button(link, label)}
<p style="margin:0;">加油！</p>`,
    f.html,
  );
  return { subject, text, html };
}

/** "Due tomorrow" (Chinese + English): everything still open that is due on the student's local tomorrow. */
export function renderReminderEmail(input: Common & { rows: readonly EmailAssignment[]; due: string }): RenderedEmail {
  const hi = greeting(input.studentName);
  const n = input.rows.length;
  const intro: Bi = {
    zh: `提醒一下：明天 (${zhDate(input.due)}，${zhWeekday(input.due)}) 要交${n === 1 ? '这项作业' : ` ${n} 项作业`}：`,
    en: `A quick reminder — ${n === 1 ? 'this is' : `these ${n} are`} due tomorrow, ${longDay(input.due)}:`,
  };
  const meta = (r: EmailAssignment): Bi => {
    const parts: Bi[] = [kindText({ kind: r.kind, words: r.kind === 'deck' ? r.item_count : null })];
    if (r.kind === 'deck' && r.done_count > 0) {
      const done = Math.min(r.done_count, r.item_count);
      parts.push({ zh: `已完成 ${done}/${r.item_count}`, en: `${done} of ${r.item_count} done` });
    }
    const name = r.tutor_name?.trim() ? studentFirstName(r.tutor_name) : null;
    parts.push({ zh: name ? `${name}老师` : '老师', en: `from ${name ?? 'your tutor'}` });
    return joinBi(parts);
  };
  const link = homeworkLink(input.appUrl, input.rows.map((r) => r.id));
  const label: Bi = n === 1 ? { zh: '现在就做', en: 'Do it now' } : { zh: '打开作业', en: 'Open your homework' };
  const f = footer(input);
  const subject = n === 1 ? `明天要交作业 · Due tomorrow: ${input.rows[0].title}` : `明天要交 ${n} 项作业 · ${n} homework items due tomorrow`;
  const text = [
    hi.zh,
    hi.en,
    '',
    intro.zh,
    intro.en,
    '',
    ...input.rows.flatMap((r) => [...textItem(r.title, meta(r)), '']),
    `${label.zh} · ${label.en}: ${link}`,
    '',
    '加油！',
    '',
    f.text,
  ].join('\n');
  const html = shell(
    `${biPara(hi, '0 0 12px')}
${biPara(intro)}
${table(input.rows.map((r) => lineHtml(r.title, meta(r))))}
${button(link, label)}
<p style="margin:0;">加油！</p>`,
    f.html,
  );
  return { subject, text, html };
}
