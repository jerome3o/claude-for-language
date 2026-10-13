/**
 * Homework e-mails (docs/HOMEWORK.md §12) against real SQLite with every
 * migration: one "sent you homework" e-mail per burst of sends (claimed rows,
 * never twice), the evening-before reminder in the student's time zone
 * (incl. the October / March DST changes), opt-out, done / cancelled rows left
 * out, test accounts and the tutor herself never e-mailed, and the templates.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  groupLines,
  localParts,
  pickTimeZone,
  reminderRows,
  renderAssignedEmail,
  renderReminderEmail,
  runAssignedEmail,
  runHomeworkReminders,
  scheduleAssignedEmail,
  sqlTime,
  sweepAssignedEmails,
  dueText,
  type EmailAssignment,
} from '../homework-emails';
import { verifyUnsubscribeToken } from '../email-unsubscribe';
import type { sendEmail } from '../email';
import type { Env } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const REL = 'rel-1';

type Sent = Parameters<typeof sendEmail>[1];

function setup(db: SqliteD1, opts: { studentTz?: string | null; tutorTz?: string | null } = {}) {
  db.raw.run('INSERT INTO users (id, email, name, role, time_zone) VALUES (?, ?, ?, ?, ?)', [TUTOR, 'tutor@x.test', 'Minghui Wang', 'tutor', opts.tutorTz ?? null]);
  db.raw.run('INSERT INTO users (id, email, name, role, time_zone) VALUES (?, ?, ?, ?, ?)', [STUDENT, 'student@x.test', 'Jerome Swannack', 'student', opts.studentTz === undefined ? 'Europe/London' : opts.studentTz]);
}

let seq = 0;
function addAssignment(
  db: SqliteD1,
  a: Partial<EmailAssignment> & { created_at: string; student_id?: string },
): string {
  const id = a.id ?? `a-${++seq}`;
  db.raw.run(
    `INSERT INTO assignments (id, relationship_id, tutor_id, student_id, batch_id, kind, target_id, source_id, title, mode, due_date, item_count, done_count, part_index, part_count, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      REL,
      a.tutor_id ?? TUTOR,
      a.student_id ?? STUDENT,
      a.batch_id ?? 'b-1',
      a.kind ?? 'deck',
      a.target_id ?? `t-${id}`,
      'src',
      a.title ?? '餐厅 Restaurant words',
      a.mode ?? 'both',
      a.due_date === undefined ? '2026-10-16' : a.due_date,
      a.item_count ?? 12,
      a.done_count ?? 0,
      a.part_index ?? 0,
      a.part_count ?? 1,
      a.status ?? 'active',
      a.created_at,
    ],
  );
  return id;
}

function makeEnv(db: SqliteD1, extra: Partial<Env> = {}) {
  return { DB: db, SENDGRID_API_KEY: 'sg-test', SESSION_SECRET: 's', ...extra } as unknown as Env;
}

function fakeSend(ok = true) {
  const sent: Sent[] = [];
  const send = vi.fn(async (_key: string, p: Sent) => {
    sent.push(p);
    return ok;
  });
  return { sent, send: send as unknown as typeof sendEmail };
}

const at = (iso: string) => () => Date.parse(iso);

describe('time zones', () => {
  it('local day and hour, incl. the DST changes', () => {
    // London: BST until 25 Oct 2026 01:00 UTC.
    expect(localParts(new Date('2026-10-24T17:37:00Z'), 'Europe/London')).toEqual({ date: '2026-10-24', hour: 18 });
    expect(localParts(new Date('2026-10-25T17:37:00Z'), 'Europe/London')).toEqual({ date: '2026-10-25', hour: 17 });
    expect(localParts(new Date('2026-10-25T18:37:00Z'), 'Europe/London')).toEqual({ date: '2026-10-25', hour: 18 });
    // Shanghai has no DST: 18:37 local = 10:37 UTC.
    expect(localParts(new Date('2026-10-15T10:37:00Z'), 'Asia/Shanghai')).toEqual({ date: '2026-10-15', hour: 18 });
    // New York after its own change (1 Nov 2026): 18:37 EST = 23:37 UTC.
    expect(localParts(new Date('2026-11-02T23:37:00Z'), 'America/New_York')).toEqual({ date: '2026-11-02', hour: 18 });
    // Midnight is hour 0, never 24.
    expect(localParts(new Date('2026-10-15T23:30:00Z'), 'Europe/London').hour).toBe(0);
  });

  it('falls back student → tutor → Europe/London', () => {
    expect(pickTimeZone('Asia/Shanghai', 'Europe/London')).toBe('Asia/Shanghai');
    expect(pickTimeZone(null, 'America/New_York')).toBe('America/New_York');
    expect(pickTimeZone('Not/AZone', '')).toBe('Europe/London');
  });

  it('reminderRows: from 18:00 local the evening before, one-off passes only, fresh rows left out', () => {
    const rows = [
      { id: 'due', status: 'active', mode: 'both', due_date: '2026-10-25', created_at: '2026-10-20 09:00:00' },
      { id: 'fsrs', status: 'active', mode: 'fsrs', due_date: '2026-10-25', created_at: '2026-10-20 09:00:00' },
      { id: 'done', status: 'done', mode: 'one_off', due_date: '2026-10-25', created_at: '2026-10-20 09:00:00' },
      { id: 'later', status: 'active', mode: 'one_off', due_date: '2026-10-26', created_at: '2026-10-20 09:00:00' },
      { id: 'fresh', status: 'active', mode: 'one_off', due_date: '2026-10-25', created_at: '2026-10-24 15:00:00' },
    ];
    // 16:37 UTC on the 24th = 17:37 BST: not yet.
    expect(reminderRows(rows, new Date('2026-10-24T16:37:00Z'), 'Europe/London')).toBeNull();
    const pick = reminderRows(rows, new Date('2026-10-24T17:37:00Z'), 'Europe/London');
    expect(pick?.due).toBe('2026-10-25');
    expect(pick?.rows.map((r) => r.id)).toEqual(['due']);
    // Across the March change (29 Mar 2027 due, BST starts 28 Mar 01:00 UTC): 17:37 UTC on the 28th = 18:37 BST.
    const march = [{ id: 'm', status: 'active', mode: 'one_off', due_date: '2027-03-29', created_at: '2027-03-20 09:00:00' }];
    expect(reminderRows(march, new Date('2027-03-28T16:37:00Z'), 'Europe/London')).toBeNull();
    expect(reminderRows(march, new Date('2027-03-28T17:37:00Z'), 'Europe/London')?.due).toBe('2027-03-29');
  });
});

describe('lines and copy', () => {
  const base: EmailAssignment = {
    id: 'x',
    tutor_id: TUTOR,
    tutor_name: 'Minghui Wang',
    batch_id: 'b',
    kind: 'deck',
    target_id: 'deck-copy',
    title: 'Restaurant',
    mode: 'both',
    due_date: '2026-10-16',
    item_count: 10,
    done_count: 0,
    part_index: 0,
    part_count: 1,
    status: 'active',
    created_at: '2026-10-13 09:00:00',
  };

  it('a deck split over days is one line with its range; due texts', () => {
    const rows = [0, 1, 2].map((i) => ({ ...base, id: `p${i}`, title: `Restaurant · day ${i + 1} of 3`, part_index: i, part_count: 3, due_date: `2026-10-1${6 + i}`, item_count: 4 }));
    const lines = groupLines(rows);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ title: 'Restaurant', words: 12, parts: 3, first_due: '2026-10-16', last_due: '2026-10-18' });
    expect(dueText(lines[0], '2026-10-13')).toEqual({ zh: '分 3 天：10月16日 – 10月18日', en: 'over 3 days, Fri 16 Oct – Sun 18 Oct' });
    expect(dueText({ first_due: '2026-10-15', last_due: '2026-10-15', parts: 1 }, '2026-10-14')).toEqual({ zh: '明天 (周四) 到期', en: 'due tomorrow, Thu 15 Oct' });
    expect(dueText({ first_due: '2026-10-13', last_due: '2026-10-13', parts: 1 }, '2026-10-13')).toEqual({ zh: '今天到期', en: 'due today' });
    expect(dueText({ first_due: '2026-10-16', last_due: '2026-10-16', parts: 1 }, '2026-10-13')).toEqual({ zh: '10月16日 (周五) 到期', en: 'due Friday 16 Oct' });
    expect(dueText({ first_due: null, last_due: null, parts: 1 }, '2026-10-13')).toEqual({ zh: '', en: '' });
  });

  it('assigned e-mail: items, a quiet long-term line, the unsubscribe link (text + HTML snapshot)', async () => {
    const email = renderAssignedEmail({
      rows: [
        { ...base, id: 'a1', title: '餐厅 Restaurant words', item_count: 12 },
        { ...base, id: 'a2', kind: 'lesson', title: '了 after verbs', item_count: 1, target_id: 'l1', mode: 'one_off' },
        { ...base, id: 'a3', kind: 'link', title: 'Peppa Pig 小猪佩奇', due_date: null, target_id: 'k1', mode: 'one_off' },
        { ...base, id: 'a4', title: 'HSK 2 core', due_date: null, mode: 'fsrs', item_count: 80, target_id: 'd2' },
        { ...base, id: 'a5', title: 'Cancelled one', status: 'cancelled', target_id: 'c1' },
      ],
      today: '2026-10-13',
      studentName: 'Jerome Swannack',
      appUrl: 'https://app.example',
      unsubscribeUrl: 'https://api.example/api/email/unsubscribe?t=tok&k=homework',
    })!;
    expect(email.subject).toBe('Minghui老师给你留了作业 · Minghui sent you homework');
    expect(email.text).toMatchInlineSnapshot(`
      "Jerome，你好！
      Hi Jerome,

      Minghui老师给你留了 3 项新作业：
      Minghui sent you 3 new things to do:

      • 餐厅 Restaurant words
        12 个词 · 10月16日 (周五) 到期
        12 words · due Friday 16 Oct

      • 了 after verbs
        小课 · 10月16日 (周五) 到期
        Mini lesson · due Friday 16 Oct

      • Peppa Pig 小猪佩奇
        链接
        Link

      另外加入了每日复习：HSK 2 core (80 个词)——每天几张卡，不用赶日期。
      Also added to your daily reviews: HSK 2 core (80 words) — a few cards a day, nothing to finish by a date.

      打开作业 · Open your homework: https://app.example/homework

      加油！

      ---
      汉语学习 · Chinese Learning App
      关闭作业邮件 · Turn off homework emails: https://api.example/api/email/unsubscribe?t=tok&k=homework"
    `);
    expect(email.text).not.toContain('Cancelled one');
    await expect(email.html).toMatchFileSnapshot('./__snapshots__/homework-email-assigned.html');
  });

  it('one item links straight to its pass; a long-term-only send is no e-mail; HTML is escaped', () => {
    const one = renderAssignedEmail({ rows: [{ ...base, id: 'only', title: '<b>Tea & 茶</b>', due_date: '2026-10-14' }], today: '2026-10-13', studentName: null, appUrl: 'https://app.example/', unsubscribeUrl: 'u' })!;
    expect(one.subject).toBe('Minghui老师给你留了作业 · Minghui sent you homework');
    expect(one.text).toContain('Hi there,');
    expect(one.text).toContain('https://app.example/homework/only');
    expect(one.text).toContain('10 个词 · 明天 (周三) 到期');
    expect(one.text).toContain('10 words · due tomorrow, Wed 14 Oct');
    expect(one.text).toContain('你好！');
    expect(one.text).toContain('<b>Tea & 茶</b>');
    expect(one.html).toContain('&lt;b&gt;Tea &amp; 茶&lt;/b&gt;');
    expect(one.html).not.toContain('<b>Tea');
    expect(renderAssignedEmail({ rows: [{ ...base, mode: 'fsrs', due_date: null }], today: '2026-10-13', studentName: 'J', appUrl: 'a', unsubscribeUrl: 'u' })).toBeNull();
  });

  it('reminder e-mail (text + HTML snapshot)', async () => {
    const email = renderReminderEmail({
      rows: [
        { ...base, id: 'r1', title: '餐厅 Restaurant words · day 2 of 3', item_count: 12, done_count: 5 },
        { ...base, id: 'r2', kind: 'reader', title: '小明在巴黎', item_count: 1, target_id: 'rd' },
      ],
      due: '2026-10-16',
      studentName: 'Jerome Swannack',
      appUrl: 'https://app.example',
      unsubscribeUrl: 'https://api.example/api/email/unsubscribe?t=tok&k=homework',
    });
    expect(email.subject).toBe('明天要交 2 项作业 · 2 homework items due tomorrow');
    expect(email.text).toMatchInlineSnapshot(`
      "Jerome，你好！
      Hi Jerome,

      提醒一下：明天 (10月16日，周五) 要交 2 项作业：
      A quick reminder — these 2 are due tomorrow, Friday 16 Oct:

      • 餐厅 Restaurant words · day 2 of 3
        12 个词 · 已完成 5/12 · Minghui老师
        12 words · 5 of 12 done · from Minghui

      • 小明在巴黎
        故事 · Minghui老师
        Story · from Minghui

      打开作业 · Open your homework: https://app.example/homework

      加油！

      ---
      汉语学习 · Chinese Learning App
      关闭作业邮件 · Turn off homework emails: https://api.example/api/email/unsubscribe?t=tok&k=homework"
    `);
    await expect(email.html).toMatchFileSnapshot('./__snapshots__/homework-email-reminder.html');
  });
});

describe('"sent you homework" e-mail', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    setup(db);
  });

  const notified = () => db.rows<{ id: string; notified_at: string | null }>('SELECT id, notified_at FROM assignments ORDER BY id');

  it('waits out a burst, then ONE e-mail for every send in it — never twice', async () => {
    addAssignment(db, { id: 'a-1', batch_id: 'b-1', created_at: '2026-10-13 09:00:00' });
    addAssignment(db, { id: 'a-2', batch_id: 'b-2', kind: 'lesson', title: '了', target_id: 'l', created_at: '2026-10-13 09:01:00' });
    const { sent, send } = fakeSend();
    const env = makeEnv(db);
    // 09:02:00 — the second send is only 60 s old: its own message will come.
    expect(await runAssignedEmail(env, STUDENT, { send, now: at('2026-10-13T09:02:00Z') })).toBe('wait');
    expect(sent).toHaveLength(0);
    expect(await runAssignedEmail(env, STUDENT, { send, now: at('2026-10-13T09:03:05Z') })).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('homework_assigned');
    expect(sent[0].to).toBe('student@x.test');
    expect(sent[0].subject).toBe('Minghui老师给你留了作业 · Minghui sent you homework');
    expect(sent[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const link = /<(.+)>/.exec(sent[0].headers!['List-Unsubscribe'])![1];
    expect(link).toContain('k=homework');
    const token = decodeURIComponent(/t=([^&]+)/.exec(link)![1]);
    expect(await verifyUnsubscribeToken({ SESSION_SECRET: 's' }, token, 'homework')).toBe(STUDENT);
    expect(await verifyUnsubscribeToken({ SESSION_SECRET: 's' }, token, 'chat')).toBeNull();
    expect(notified().every((r) => r.notified_at)).toBe(true);
    // A redelivery and the hourly sweep find nothing.
    expect(await runAssignedEmail(env, STUDENT, { send, now: at('2026-10-13T09:05:00Z') })).toBe('nothing');
    expect(await sweepAssignedEmails(env, { send, now: at('2026-10-13T09:37:00Z') })).toEqual({});
    expect(sent).toHaveLength(1);
    expect(db.rows('SELECT kind, status FROM homework_email_log')).toEqual([{ kind: 'assigned', status: 'sent' }]);
  });

  it('two deliveries at once: the rows are claimed by one of them', async () => {
    addAssignment(db, { id: 'a-1', created_at: '2026-10-13 09:00:00' });
    const { sent, send } = fakeSend();
    const env = makeEnv(db);
    const outcomes = await Promise.all([
      runAssignedEmail(env, STUDENT, { send, now: at('2026-10-13T09:03:00Z') }),
      runAssignedEmail(env, STUDENT, { send, now: at('2026-10-13T09:03:00Z') }),
    ]);
    expect(outcomes.sort()).toEqual(['nothing', 'sent']);
    expect(sent).toHaveLength(1);
  });

  it('opted out, a test account, no key, long-term only: nothing sent (rows taken except without a key)', async () => {
    addAssignment(db, { id: 'a-1', created_at: '2026-10-13 09:00:00' });
    const { sent, send } = fakeSend();
    expect(await runAssignedEmail(makeEnv(db, { SENDGRID_API_KEY: '' as never }), STUDENT, { send, now: at('2026-10-13T09:03:00Z') })).toBe('no_key');
    expect(notified()[0].notified_at).toBeNull();
    db.raw.run('UPDATE users SET email_homework = 0 WHERE id = ?', [STUDENT]);
    expect(await runAssignedEmail(makeEnv(db), STUDENT, { send, now: at('2026-10-13T09:03:00Z') })).toBe('skip:opted_out');
    // Turning it back on later never sends the old ones.
    db.raw.run('UPDATE users SET email_homework = 1, email = ? WHERE id = ?', ['x@test.e2e', STUDENT]);
    addAssignment(db, { id: 'a-2', created_at: '2026-10-13 10:00:00' });
    expect(await runAssignedEmail(makeEnv(db), STUDENT, { send, now: at('2026-10-13T10:03:00Z') })).toBe('skip:test_user');
    db.raw.run('UPDATE users SET email = ? WHERE id = ?', ['student@x.test', STUDENT]);
    addAssignment(db, { id: 'a-3', created_at: '2026-10-13 11:00:00' });
    expect(await runAssignedEmail(makeEnv(db, { E2E_TEST_MODE: 'true' }), STUDENT, { send, now: at('2026-10-13T11:03:00Z') })).toBe('skip:test_mode');
    addAssignment(db, { id: 'a-4', mode: 'fsrs', due_date: null, created_at: '2026-10-13 12:00:00' });
    expect(await runAssignedEmail(makeEnv(db), STUDENT, { send, now: at('2026-10-13T12:03:00Z') })).toBe('long_term_only');
    expect(sent).toHaveLength(0);
  });

  it('a failed send gives the rows back for the hourly sweep', async () => {
    addAssignment(db, { id: 'a-1', created_at: '2026-10-13 09:00:00' });
    const env = makeEnv(db);
    expect(await runAssignedEmail(env, STUDENT, { send: fakeSend(false).send, now: at('2026-10-13T09:03:00Z') })).toBe('failed');
    expect(notified()[0].notified_at).toBeNull();
    const { sent, send } = fakeSend();
    expect(await sweepAssignedEmails(env, { send, now: at('2026-10-13T09:37:00Z') })).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it('the sweep never e-mails rows older than a day, and existing rows were marked by the migration', async () => {
    addAssignment(db, { id: 'old', created_at: '2026-10-10 09:00:00' });
    const { sent, send } = fakeSend();
    expect(await sweepAssignedEmails(makeEnv(db), { send, now: at('2026-10-13T09:37:00Z') })).toEqual({});
    expect(notified()[0].notified_at).toBe('2026-10-10 09:00:00');
    expect(sent).toHaveLength(0);
  });

  it('assignHomework schedules the delayed message (and a missing queue is fine)', async () => {
    const queue = { send: vi.fn(async () => undefined) };
    await scheduleAssignedEmail({ ...makeEnv(db), HOMEWORK_EMAIL_QUEUE: queue as never }, STUDENT);
    expect(queue.send).toHaveBeenCalledWith({ kind: 'assigned', student_id: STUDENT }, { delaySeconds: 120 });
    await expect(scheduleAssignedEmail(makeEnv(db), STUDENT)).resolves.toBeUndefined();
    const broken = { send: vi.fn(async () => { throw new Error('down'); }) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(scheduleAssignedEmail({ ...makeEnv(db), HOMEWORK_EMAIL_QUEUE: broken as never }, STUDENT)).resolves.toBeUndefined();
  });
});

describe('"due tomorrow" reminder', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
  });

  it('one per student per day at 18:00 local, open one-off passes only', async () => {
    setup(db, { studentTz: 'Asia/Shanghai' });
    addAssignment(db, { id: 'due', title: 'Restaurant', due_date: '2026-10-16', created_at: '2026-10-13 09:00:00', done_count: 3 });
    addAssignment(db, { id: 'done', title: 'Finished', due_date: '2026-10-16', status: 'done', created_at: '2026-10-13 09:00:00' });
    addAssignment(db, { id: 'cancel', title: 'Cancelled', due_date: '2026-10-16', status: 'cancelled', created_at: '2026-10-13 09:00:00' });
    addAssignment(db, { id: 'fsrs', title: 'Long term', mode: 'fsrs', due_date: null, created_at: '2026-10-13 09:00:00' });
    addAssignment(db, { id: 'later', title: 'Later', due_date: '2026-10-17', created_at: '2026-10-13 09:00:00' });
    const env = makeEnv(db);
    const { sent, send } = fakeSend();
    // 09:37 UTC = 17:37 in Shanghai: not yet.
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-15T09:37:00Z') })).toEqual({ not_due: 1 });
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-15T10:37:00Z') })).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('homework_reminder');
    expect(sent[0].subject).toBe('明天要交作业 · Due tomorrow: Restaurant');
    expect(sent[0].textContent).toContain('已完成 3/12 · Minghui老师');
    expect(sent[0].textContent).toContain('3 of 12 done');
    expect(sent[0].textContent).not.toMatch(/Finished|Cancelled|Long term|Later/);
    expect(sent[0].textContent).toContain('/homework/due');
    // The next hours: already sent.
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-15T11:37:00Z') })).toEqual({ already: 1 });
    expect(sent).toHaveLength(1);
    // Done before the evening → no reminder the next time.
    db.raw.run("UPDATE assignments SET status = 'done' WHERE id = 'later'");
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-16T10:37:00Z') })).toEqual({ not_due: 1 });
    expect(sent).toHaveLength(1);
  });

  it('no time zone → the tutor\'s, else London; DST in October', async () => {
    setup(db, { studentTz: null, tutorTz: null });
    addAssignment(db, { id: 'due', due_date: '2026-10-26', created_at: '2026-10-20 09:00:00' });
    const env = makeEnv(db);
    const { sent, send } = fakeSend();
    // 25 Oct (GMT again): 17:37 UTC = 17:37 London → not yet; 18:37 UTC → yes.
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-25T17:37:00Z') })).toEqual({ not_due: 1 });
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-25T18:37:00Z') })).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it('the tutor\'s zone when the student has none', async () => {
    setup(db, { studentTz: null, tutorTz: 'America/New_York' });
    addAssignment(db, { id: 'due', due_date: '2026-10-16', created_at: '2026-10-13 09:00:00' });
    const { sent, send } = fakeSend();
    // 18:37 London is 13:37 in New York.
    expect(await runHomeworkReminders(makeEnv(db), { send, now: at('2026-10-15T17:37:00Z') })).toEqual({ not_due: 1 });
    expect(await runHomeworkReminders(makeEnv(db), { send, now: at('2026-10-15T22:37:00Z') })).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it('opted out / test account / just assigned → nothing; a failed send tries again next hour', async () => {
    setup(db);
    addAssignment(db, { id: 'fresh', due_date: '2026-10-16', created_at: '2026-10-15 15:00:00' });
    const env = makeEnv(db);
    const { sent, send } = fakeSend();
    // Assigned 2 h 37 min ago — the "sent you homework" e-mail just told them.
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-15T17:37:00Z') })).toEqual({ not_due: 1 });
    addAssignment(db, { id: 'due', due_date: '2026-10-16', created_at: '2026-10-13 09:00:00' });
    db.raw.run('UPDATE users SET email_homework = 0 WHERE id = ?', [STUDENT]);
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-15T17:37:00Z') })).toEqual({ 'skip:opted_out': 1 });
    db.raw.run("UPDATE users SET email_homework = 1, google_id = 'test-123' WHERE id = ?", [STUDENT]);
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-15T17:37:00Z') })).toEqual({ 'skip:test_user': 1 });
    db.raw.run('UPDATE users SET google_id = NULL WHERE id = ?', [STUDENT]);
    expect(await runHomeworkReminders(env, { send: fakeSend(false).send, now: at('2026-10-15T17:37:00Z') })).toEqual({ failed: 1 });
    expect(db.rows('SELECT * FROM homework_email_log')).toEqual([]);
    expect(await runHomeworkReminders(env, { send, now: at('2026-10-15T18:37:00Z') })).toEqual({ sent: 1 });
    expect(sent[0].textContent).not.toContain('/homework/fresh');
  });

  it('never e-mails the tutor herself', async () => {
    setup(db);
    addAssignment(db, { id: 'self', student_id: TUTOR, due_date: '2026-10-16', created_at: '2026-10-13 09:00:00' });
    const { sent, send } = fakeSend();
    expect(await runHomeworkReminders(makeEnv(db), { send, now: at('2026-10-15T17:37:00Z') })).toEqual({});
    expect(sent).toHaveLength(0);
  });

  it('sqlTime matches datetime(now)', () => {
    expect(sqlTime(Date.parse('2026-10-13T09:03:05.123Z'))).toBe('2026-10-13 09:03:05');
  });
});
