/**
 * Homework e-mails (docs/HOMEWORK.md §12).
 *
 * 1. "<Tutor> sent you homework" — `assignHomework` (the one path every send
 *    takes: Send homework sheet, library Assign, session-notes send, drafts,
 *    MCP send tools) calls `scheduleAssignedEmail`, which puts a message on
 *    `homework-email-queue` delayed ~2 minutes. The consumer waits while the
 *    newest unnotified row is younger than the debounce (a later send's own
 *    message comes after it), then CLAIMS every unnotified row of the student
 *    with one `UPDATE … RETURNING` (so two deliveries can never e-mail the same
 *    rows) and sends ONE e-mail for the lot. The hourly cron sweeps what a lost
 *    message left (≤ 24 h old; older rows are marked told without an e-mail).
 * 2. "Due tomorrow" — the hourly cron (:37): per student with an active
 *    one-off pass due on their LOCAL tomorrow (users.time_zone, else the
 *    tutor's, else Europe/London), from 18:00 local; one per student per due
 *    day (homework_email_log's UNIQUE key = the due date).
 *
 * Never for: a student who turned them off (users.email_homework = 0, Settings or
 * the e-mail's link), no e-mail address, test accounts (@test.e2e / google_id
 * test-…, E2E_TEST_MODE), the tutor herself, or without SENDGRID_API_KEY.
 * Logs carry ids and outcomes only — no addresses, no titles.
 */

import type { Env } from '../../types';
import { APP_BASE_URL, sendEmail } from '../email';
import { createUnsubscribeToken, listUnsubscribeHeaders, unsubscribeUrl } from '../email-unsubscribe';
import {
  ASSIGNED_DEBOUNCE_MS,
  ASSIGNED_DELAY_SECONDS,
  ASSIGNED_MAX_AGE_MS,
  localParts,
  parseSqlTime,
  pickTimeZone,
  reminderRows,
  renderAssignedEmail,
  renderReminderEmail,
  sqlTime,
  type EmailAssignment,
  type RenderedEmail,
} from './copy';
import { addDays } from '@shared/homework';

export * from './copy';

export interface HomeworkEmailMessage {
  kind: 'assigned';
  student_id: string;
}

export interface HomeworkEmailDeps {
  /** The SendGrid sender (tests). */
  send?: typeof sendEmail;
  /** Clock (tests). */
  now?: () => number;
}

interface Recipient {
  id: string;
  email: string | null;
  name: string | null;
  google_id: string | null;
  time_zone: string | null;
  email_homework: number | null;
}

type Env2 = Pick<Env, 'DB' | 'SENDGRID_API_KEY' | 'PUBLIC_API_URL' | 'E2E_TEST_MODE' | 'SESSION_SECRET' | 'GOOGLE_CLIENT_SECRET'> & {
  HOMEWORK_EMAIL_QUEUE?: Env['HOMEWORK_EMAIL_QUEUE'];
};

const ROW_COLUMNS = `a.id, a.tutor_id, a.student_id, a.batch_id, a.kind, a.target_id, a.title, a.mode, a.due_date,
  a.item_count, a.done_count, a.part_index, a.part_count, a.status, a.created_at, u.name AS tutor_name, u.time_zone AS tutor_time_zone`;

type Row = EmailAssignment & { student_id: string; tutor_time_zone: string | null };

/** Why a recipient gets nothing (null = send). */
export function skipReason(env: Pick<Env, 'E2E_TEST_MODE'>, r: Recipient | null): string | null {
  if (!r) return 'no_student';
  if (env.E2E_TEST_MODE === 'true') return 'test_mode';
  if (!r.email) return 'no_email';
  if (r.email_homework === 0) return 'opted_out';
  if (r.email.toLowerCase().endsWith('@test.e2e') || (r.google_id ?? '').startsWith('test-')) return 'test_user';
  return null;
}

async function getRecipients(db: D1Database, ids: string[]): Promise<Map<string, Recipient>> {
  const out = new Map<string, Recipient>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await db
      .prepare(`SELECT id, email, name, google_id, time_zone, email_homework FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<Recipient>();
    for (const row of r.results) out.set(row.id, row);
  }
  return out;
}

async function deliver(
  env: Env2,
  to: Recipient,
  email: RenderedEmail,
  kind: 'homework_assigned' | 'homework_reminder',
  url: string,
  deps: HomeworkEmailDeps,
): Promise<boolean> {
  return (deps.send ?? sendEmail)(env.SENDGRID_API_KEY, {
    kind,
    to: to.email!,
    toName: to.name || undefined,
    subject: email.subject,
    textContent: email.text,
    htmlContent: email.html,
    headers: listUnsubscribeHeaders(url),
  });
}

async function unsubscribeLink(env: Env2, studentId: string): Promise<string> {
  return unsubscribeUrl(env.PUBLIC_API_URL, await createUnsubscribeToken(env, studentId, 'homework'), 'homework');
}

// ============ "Sent you homework" ============

/** After a send: the delayed queue message (the hourly sweep is the fallback). Never throws. */
export async function scheduleAssignedEmail(env: Env2, studentId: string): Promise<void> {
  try {
    await env.HOMEWORK_EMAIL_QUEUE?.send({ kind: 'assigned', student_id: studentId }, { delaySeconds: ASSIGNED_DELAY_SECONDS });
  } catch (err) {
    console.error('[homework-email] could not queue the assigned e-mail:', err);
  }
}

export type AssignedOutcome = 'sent' | 'failed' | 'nothing' | 'wait' | 'no_key' | 'long_term_only' | `skip:${string}`;

/** One student's unnotified rows → at most one e-mail. Idempotent (rows are claimed first). */
export async function runAssignedEmail(env: Env2, studentId: string, deps: HomeworkEmailDeps = {}): Promise<AssignedOutcome> {
  if (!env.SENDGRID_API_KEY) return 'no_key';
  const db = env.DB;
  const now = deps.now?.() ?? Date.now();
  const newest = await db
    .prepare('SELECT created_at FROM assignments WHERE student_id = ? AND notified_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .bind(studentId)
    .first<{ created_at: string }>();
  if (!newest) return 'nothing';
  // A send in the last ~2 minutes: its own message will come and take these rows too.
  if (now - parseSqlTime(newest.created_at) < ASSIGNED_DEBOUNCE_MS) return 'wait';

  const stamp = sqlTime(now);
  const claimed = await db
    .prepare('UPDATE assignments SET notified_at = ? WHERE student_id = ? AND notified_at IS NULL AND created_at >= ? RETURNING id')
    .bind(stamp, studentId, sqlTime(now - ASSIGNED_MAX_AGE_MS))
    .all<{ id: string }>();
  const ids = claimed.results.map((r) => r.id);
  if (ids.length === 0) return 'nothing';

  const rows = await rowsByIds(db, ids);
  const student = (await getRecipients(db, [studentId])).get(studentId) ?? null;
  const skip = skipReason(env, student);
  if (skip) return `skip:${skip}`;
  // Never the tutor herself (a solo account can't be its own student, but be sure).
  const mine = rows.filter((r) => r.tutor_id !== studentId);
  const tz = pickTimeZone(student!.time_zone, mine[0]?.tutor_time_zone);
  const unsubscribe = await unsubscribeLink(env, studentId);
  const email = renderAssignedEmail({
    rows: mine,
    today: localParts(new Date(now), tz).date,
    studentName: student!.name,
    appUrl: APP_BASE_URL,
    unsubscribeUrl: unsubscribe,
  });
  if (!email) return 'long_term_only';

  const logId = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO homework_email_log (id, student_id, kind, key, assignment_ids) VALUES (?, ?, 'assigned', ?, ?)`)
    .bind(logId, studentId, logId, JSON.stringify(ids))
    .run();
  const ok = await deliver(env, student!, email, 'homework_assigned', unsubscribe, deps);
  if (ok) {
    await db.prepare(`UPDATE homework_email_log SET status = 'sent', sent_at = ? WHERE id = ?`).bind(sqlTime(Date.now()), logId).run();
    return 'sent';
  }
  // Not sent: give the rows back so the hourly sweep tries again (within 24 h of the send).
  await db.prepare(`UPDATE homework_email_log SET status = 'failed' WHERE id = ?`).bind(logId).run();
  await db
    .prepare(`UPDATE assignments SET notified_at = NULL WHERE notified_at = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(stamp, ...ids)
    .run();
  return 'failed';
}

async function rowsByIds(db: D1Database, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await db
      .prepare(`SELECT ${ROW_COLUMNS}, a.rowid AS _r FROM assignments a LEFT JOIN users u ON u.id = a.tutor_id WHERE a.id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<Row & { _r: number }>();
    out.push(...r.results);
  }
  return (out as Array<Row & { _r: number }>).sort((a, b) => a.created_at.localeCompare(b.created_at) || a._r - b._r);
}

/** Hourly: students whose rows no message took (lost / no queue); rows older than 24 h are marked told, never e-mailed. */
export async function sweepAssignedEmails(env: Env2, deps: HomeworkEmailDeps = {}): Promise<Record<string, number>> {
  const now = deps.now?.() ?? Date.now();
  const counts: Record<string, number> = {};
  await env.DB
    .prepare('UPDATE assignments SET notified_at = created_at WHERE notified_at IS NULL AND created_at < ?')
    .bind(sqlTime(now - ASSIGNED_MAX_AGE_MS))
    .run();
  if (!env.SENDGRID_API_KEY) return counts;
  const students = await env.DB
    .prepare('SELECT DISTINCT student_id FROM assignments WHERE notified_at IS NULL AND created_at <= ? LIMIT 200')
    .bind(sqlTime(now - ASSIGNED_DEBOUNCE_MS))
    .all<{ student_id: string }>();
  for (const { student_id } of students.results) {
    try {
      const outcome = await runAssignedEmail(env, student_id, deps);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (err) {
      console.error('[homework-email] sweep failed for a student:', err);
      counts.error = (counts.error ?? 0) + 1;
    }
  }
  return counts;
}

// ============ "Due tomorrow" ============

/** Hourly: the evening-before reminders. Returns outcome counts (for the cron log). */
export async function runHomeworkReminders(env: Env2, deps: HomeworkEmailDeps = {}): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  if (!env.SENDGRID_API_KEY) return counts;
  const db = env.DB;
  const now = new Date(deps.now?.() ?? Date.now());
  // Every zone's "tomorrow" lies within [UTC today − 1, UTC today + 2].
  const utcToday = now.toISOString().slice(0, 10);
  const r = await db
    .prepare(
      `SELECT ${ROW_COLUMNS} FROM assignments a LEFT JOIN users u ON u.id = a.tutor_id
       WHERE a.status = 'active' AND a.skipped_at IS NULL AND a.mode IN ('one_off', 'both') AND a.due_date BETWEEN ? AND ?
       ORDER BY a.due_date, a.created_at, a.rowid`,
    )
    .bind(addDays(utcToday, -1), addDays(utcToday, 2))
    .all<Row>();
  const byStudent = new Map<string, Row[]>();
  for (const row of r.results) {
    if (row.tutor_id === row.student_id) continue;
    const list = byStudent.get(row.student_id) ?? [];
    list.push(row);
    byStudent.set(row.student_id, list);
  }
  if (byStudent.size === 0) return counts;
  const students = await getRecipients(db, [...byStudent.keys()]);

  for (const [studentId, rows] of byStudent) {
    try {
      const student = students.get(studentId) ?? null;
      const skip = skipReason(env, student);
      if (skip) {
        bump(`skip:${skip}`);
        continue;
      }
      const tz = pickTimeZone(student!.time_zone, rows[0].tutor_time_zone);
      const pick = reminderRows(rows, now, tz);
      if (!pick) {
        bump('not_due');
        continue;
      }
      const logId = crypto.randomUUID();
      const claim = await db
        .prepare(`INSERT OR IGNORE INTO homework_email_log (id, student_id, kind, key, assignment_ids) VALUES (?, ?, 'reminder', ?, ?)`)
        .bind(logId, studentId, pick.due, JSON.stringify(pick.rows.map((x) => x.id)))
        .run();
      if ((claim.meta?.changes ?? 0) === 0) {
        bump('already');
        continue;
      }
      const unsubscribe = await unsubscribeLink(env, studentId);
      const email = renderReminderEmail({ rows: pick.rows, due: pick.due, studentName: student!.name, appUrl: APP_BASE_URL, unsubscribeUrl: unsubscribe });
      const ok = await deliver(env, student!, email, 'homework_reminder', unsubscribe, deps);
      if (ok) {
        await db.prepare(`UPDATE homework_email_log SET status = 'sent', sent_at = ? WHERE id = ?`).bind(sqlTime(Date.now()), logId).run();
        bump('sent');
      } else {
        // Free the day's key: the next hourly run (still evening) tries again.
        await db.prepare('DELETE FROM homework_email_log WHERE id = ?').bind(logId).run();
        bump('failed');
      }
    } catch (err) {
      console.error('[homework-email] reminder failed for a student:', err);
      bump('error');
    }
  }
  return counts;
}

/** The cron that runs both (hourly at :37, shared with the audio pump's keep-alive). */
export const HOMEWORK_EMAIL_CRON = '37 * * * *';

export async function runHomeworkEmailCron(env: Env2, deps: HomeworkEmailDeps = {}): Promise<{ assigned: Record<string, number>; reminders: Record<string, number> }> {
  const assigned = await sweepAssignedEmails(env, deps).catch((err) => {
    console.error('[homework-email] sweep failed:', err);
    return { error: 1 };
  });
  const reminders = await runHomeworkReminders(env, deps).catch((err) => {
    console.error('[homework-email] reminders failed:', err);
    return { error: 1 };
  });
  return { assigned, reminders };
}
