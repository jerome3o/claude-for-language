/**
 * Chat e-mail opt-out (docs/CHAT.md "E-mail opt-out"): the signed token, the
 * public unsubscribe / resubscribe endpoints (incl. RFC 8058 one-click), the
 * signed-in Settings endpoint, and that no e-mail goes out once it is off.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { emailPrefs, emailPublic } from '../email-prefs';
import {
  createUnsubscribeToken,
  listUnsubscribeHeaders,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from '../../services/email-unsubscribe';
import { notifyNewChatMessage } from '../../services/chat/notify';
import type { Env, MessageWithSender } from '../../types';

const SECRET_ENV = { SESSION_SECRET: 'test-secret' };

describe('unsubscribe tokens', () => {
  it('round-trips the user id and never expires', async () => {
    const t = await createUnsubscribeToken(SECRET_ENV, 'user-42');
    expect(await verifyUnsubscribeToken(SECRET_ENV, t)).toBe('user-42');
    expect(t).not.toContain('user-42'); // the id is encoded, not readable in logs at a glance
  });

  it('refuses a tampered id, a tampered signature, another secret and junk', async () => {
    const t = await createUnsubscribeToken(SECRET_ENV, 'user-42');
    const [, sig] = t.split('.');
    const other = await createUnsubscribeToken(SECRET_ENV, 'user-43');
    expect(await verifyUnsubscribeToken(SECRET_ENV, `${other.split('.')[0]}.${sig}`)).toBeNull();
    expect(await verifyUnsubscribeToken(SECRET_ENV, `${t.slice(0, -2)}xx`)).toBeNull();
    expect(await verifyUnsubscribeToken({ SESSION_SECRET: 'other' }, t)).toBeNull();
    for (const junk of ['', 'abc', 'a.b.c', '.', '!!!.???', 'x'.repeat(600)]) {
      expect(await verifyUnsubscribeToken(SECRET_ENV, junk)).toBeNull();
    }
  });

  it('falls back to the Google secret, then the E2E dev key, else throws', async () => {
    const t = await createUnsubscribeToken({ GOOGLE_CLIENT_SECRET: 'g' }, 'u');
    expect(await verifyUnsubscribeToken({ GOOGLE_CLIENT_SECRET: 'g' }, t)).toBe('u');
    expect(await verifyUnsubscribeToken({ E2E_TEST_MODE: 'true' }, await createUnsubscribeToken({ E2E_TEST_MODE: 'true' }, 'u'))).toBe('u');
    await expect(createUnsubscribeToken({}, 'u')).rejects.toThrow();
  });

  it('builds the link and the RFC 8058 headers', () => {
    const url = unsubscribeUrl(undefined, 'a.b');
    expect(url).toBe('https://chinese-learning-api.jeromeswannack.workers.dev/api/email/unsubscribe?t=a.b');
    expect(unsubscribeUrl('http://localhost:8787/', 'a.b')).toBe('http://localhost:8787/api/email/unsubscribe?t=a.b');
    expect(listUnsubscribeHeaders(url)).toEqual({
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});

describe('email prefs routes', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    db = await createSqliteD1();
    for (const id of ['tutor-1', 'student-1']) {
      db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, id, 'student']);
    }
  });

  const pref = (id: string) => db.raw.exec(`SELECT email_chat_messages FROM users WHERE id = '${id}'`)[0].values[0][0];

  function makeApp(user: { id: string } | null = null) {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api/email', emailPublic);
    app.use('/api/*', async (c, next) => {
      if (!user) return c.json({ error: 'Not authenticated' }, 401);
      c.set('user', user as never);
      await next();
    });
    app.route('/api', emailPrefs);
    const env = { DB: db, ...SECRET_ENV } as unknown as Env;
    return (path: string, init?: RequestInit) => app.request(path, init, env);
  }

  it('defaults to on', () => {
    expect(pref('student-1')).toBe(1);
  });

  it('GET shows the page and changes nothing (mail scanners open links)', async () => {
    const t = await createUnsubscribeToken(SECRET_ENV, 'student-1');
    const res = await makeApp()(`/api/email/unsubscribe?t=${encodeURIComponent(t)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Turning off chat e-mails');
    expect(html).toContain('Turn back on');
    expect(pref('student-1')).toBe(1);
  });

  it('POST (the page, JSON) turns it off, resubscribe back on — no sign-in', async () => {
    const t = encodeURIComponent(await createUnsubscribeToken(SECRET_ENV, 'student-1'));
    const req = makeApp();
    const off = await req(`/api/email/unsubscribe?t=${t}`, { method: 'POST', headers: { Accept: 'application/json' } });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ email_chat_messages: false });
    expect(pref('student-1')).toBe(0);
    expect(pref('tutor-1')).toBe(1);
    const on = await req(`/api/email/resubscribe?t=${t}`, { method: 'POST', headers: { Accept: 'application/json' } });
    expect(await on.json()).toEqual({ email_chat_messages: true });
    expect(pref('student-1')).toBe(1);
  });

  it('RFC 8058 one-click POST (form body) turns it off and answers with the page', async () => {
    const t = encodeURIComponent(await createUnsubscribeToken(SECRET_ENV, 'student-1'));
    const res = await makeApp()(`/api/email/unsubscribe?t=${t}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Chat e-mails are off');
    expect(pref('student-1')).toBe(0);
  });

  it('a bad token changes nothing', async () => {
    const req = makeApp();
    expect((await req('/api/email/unsubscribe?t=nope')).status).toBe(400);
    expect((await req('/api/email/unsubscribe?t=nope', { method: 'POST' })).status).toBe(400);
    const forged = await createUnsubscribeToken({ SESSION_SECRET: 'attacker' }, 'student-1');
    expect((await req(`/api/email/unsubscribe?t=${encodeURIComponent(forged)}`, { method: 'POST', headers: { Accept: 'application/json' } })).status).toBe(400);
    const ghost = await createUnsubscribeToken(SECRET_ENV, 'nobody');
    expect((await req(`/api/email/unsubscribe?t=${encodeURIComponent(ghost)}`, { method: 'POST', headers: { Accept: 'application/json' } })).status).toBe(404);
    expect(pref('student-1')).toBe(1);
  });

  it('PUT /api/profile/email-prefs (Settings) needs sign-in and a boolean', async () => {
    expect((await makeApp(null)('/api/profile/email-prefs', { method: 'PUT', body: '{"email_chat_messages":false}' })).status).toBe(401);
    const req = makeApp({ id: 'student-1' });
    const put = (body: unknown) => req('/api/profile/email-prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await put({ email_chat_messages: 'no' })).status).toBe(400);
    const res = await put({ email_chat_messages: false });
    expect(await res.json()).toEqual({ email_chat_messages: false });
    expect(pref('student-1')).toBe(0);
    await put({ email_chat_messages: true });
    expect(pref('student-1')).toBe(1);
  });
});

describe('chat e-mail respects the preference', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    db = await createSqliteD1();
    for (const [id, name] of [['tutor-1', 'Minghui'], ['student-1', 'Jerome']]) {
      db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
    }
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', 'tutor-1', 'student-1', 'tutor', 'active')");
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv-1', 'rel-1')");
  });

  const message = {
    id: 'msg-1', conversation_id: 'conv-1', sender_id: 'tutor-1', content: '明天上课吗？', created_at: '2026-10-02T09:00:00.000Z',
    check_status: null, check_feedback: null, recording_url: null, reply_to_message_id: null, translation: null, segmentation: null,
    client_id: null, sender: { id: 'tutor-1', name: 'Minghui', picture_url: null }, reply_to: null, reactions: [], has_discussion: false,
  } as unknown as MessageWithSender;

  async function send() {
    const email = vi.fn(async () => true);
    const env = {
      DB: db, SENDGRID_API_KEY: 'sg', ...SECRET_ENV,
      CHAT_HUB: { idFromName: (n: string) => n, get: () => ({ broadcast: async () => 1 }) },
    } as unknown as Env;
    await notifyNewChatMessage(env, message, { id: 'conv-1', relationship_id: 'rel-1' }, { webPush: vi.fn(async () => ({ sent: 0, failed: 0, removed: 0 })) as never, email, ntfy: vi.fn(async () => {}) });
    return email;
  }

  it('on: the e-mail carries a working "Turn off" link and the List-Unsubscribe headers', async () => {
    const email = await send();
    expect(email).toHaveBeenCalledTimes(1);
    const params = (email.mock.calls[0] as unknown as [string, { unsubscribeUrl: string; headers: Record<string, string> }])[1];
    expect(params.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(params.headers['List-Unsubscribe']).toBe(`<${params.unsubscribeUrl}>`);
    const token = decodeURIComponent(new URL(params.unsubscribeUrl).searchParams.get('t')!);
    expect(await verifyUnsubscribeToken(SECRET_ENV, token)).toBe('student-1');
  });

  it('off: no e-mail at all', async () => {
    db.raw.run("UPDATE users SET email_chat_messages = 0 WHERE id = 'student-1'");
    expect(await send()).not.toHaveBeenCalled();
  });
});
