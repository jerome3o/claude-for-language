/**
 * "⚡ Study it today" (routes/study-bumps.ts + services/study-bumps.ts) against real
 * SQLite with every migration: bump by note id / hanzi / client item (idempotent),
 * ownership, the server's lazy done (every bumped card reviewed since the bump),
 * re-opening a finished bump, clearing, the tutor variant, and bumps on /sync/changes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import studyBumps from '../study-bumps';
import { listActiveBumps } from '../../services/study-bumps';
import { executeBumpCardsTool, BUMP_CARDS_TOOL } from '../../services/ai';
import type { Env } from '../../types';

const ME = 'user-1';
const OTHER = 'user-2';
const TUTOR = 'tutor-1';

function seed(db: SqliteD1) {
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [ME, 'me@x.test', 'Jerome']);
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [OTHER, 'o@x.test', 'Other']);
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', [TUTOR, 't@x.test', 'Minghui']);
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, ME]);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-1', ?, 'HSK 2')", [ME]);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-x', ?, 'Theirs')", [OTHER]);
  const note = (id: string, deck: string, hanzi: string) =>
    db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, 'pīnyīn', 'meaning')", [id, deck, hanzi]);
  note('n-bank', 'd-1', '银行');
  note('n-apple', 'd-1', '苹果');
  note('n-x', 'd-x', '银行');
  const card = (id: string, noteId: string, type: string, queue = 0, next: string | null = null) =>
    db.raw.run('INSERT INTO cards (id, note_id, card_type, queue, next_review_at) VALUES (?, ?, ?, ?, ?)', [id, noteId, type, queue, next]);
  card('c-bank-h', 'n-bank', 'hanzi_to_meaning');
  card('c-bank-m', 'n-bank', 'meaning_to_hanzi');
  card('c-apple-h', 'n-apple', 'hanzi_to_meaning', 2, '2027-01-01T00:00:00.000Z');
  card('c-x', 'n-x', 'hanzi_to_meaning');
}

function client(env: Env, userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', studyBumps);
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

function review(db: SqliteD1, id: string, cardId: string, at: string) {
  db.raw.run('INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, 2, ?)', [id, cardId, ME, at]);
}

describe('study bumps', () => {
  let db: SqliteD1;
  let env: Env;
  let me: ReturnType<typeof client>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    env = { DB: db } as unknown as Env;
    me = client(env, ME);
  });

  it('bumps by hanzi among MY notes only, and is idempotent', async () => {
    const a = await me('POST', '/me/bumps', { hanzi: ['银 行'], source: 'mcp' });
    expect(a.status).toBe(200);
    expect(a.json.added).toEqual([{ note_id: 'n-bank', hanzi: '银行' }]);
    expect(a.json.bumps.map((b: any) => [b.note_id, b.deck_name, b.source])).toEqual([['n-bank', 'HSK 2', 'mcp']]);
    const again = await me('POST', '/me/bumps', { note_ids: ['n-bank'] });
    expect(again.json.added).toEqual([]);
    expect(again.json.already).toEqual([{ note_id: 'n-bank', hanzi: '银行' }]);
    const theirs = await me('POST', '/me/bumps', { note_ids: ['n-x'], hanzi: ['不存在'] });
    expect(theirs.status).toBe(404);
    expect(theirs.json.not_found).toEqual(['n-x', '不存在']);
    expect((await me('POST', '/me/bumps', {})).status).toBe(400);
  });

  it('offline items keep their client id and bump time', async () => {
    const r = await me('POST', '/me/bumps', { items: [{ id: 'client-1', note_id: 'n-apple', created_at: '2026-10-04T08:00:00.000Z', source: 'coach' }] });
    expect(r.json.bumps[0]).toMatchObject({ id: 'client-1', note_id: 'n-apple', created_at: '2026-10-04T08:00:00.000Z', source: 'coach', bumped_by_name: null });
    const retry = await me('POST', '/me/bumps', { items: [{ id: 'client-1', note_id: 'n-apple' }] });
    expect(retry.json.already).toHaveLength(1);
  });

  it('is done once every bumped card is reviewed since the bump; a re-bump re-opens it', async () => {
    // A device's planned whole-note bump (planned: true) is stored as sent.
    await me('POST', '/me/bumps', { items: [{ id: 'b1', note_id: 'n-bank', created_at: '2026-10-01T08:00:00.000Z', planned: true }] });
    review(db, 'e0', 'c-bank-h', '2026-09-30T08:00:00.000Z'); // before the bump: doesn't count
    review(db, 'e1', 'c-bank-h', '2026-10-01T09:00:00.000Z');
    expect((await me('GET', '/me/bumps')).json.bumps).toHaveLength(1); // m still open
    review(db, 'e2', 'c-bank-m', '2026-10-01T09:01:00.000Z');
    expect((await me('GET', '/me/bumps')).json.bumps).toEqual([]);
    expect(db.rows<{ done_at: string | null }>("SELECT done_at FROM study_bumps WHERE id = 'b1'")[0].done_at).not.toBeNull();
    // A retry of the same upload keeps it finished; a NEW bump re-opens the row.
    expect((await me('POST', '/me/bumps', { items: [{ id: 'b1', note_id: 'n-bank' }] })).json.bumps).toEqual([]);
    const re = await me('POST', '/me/bumps', { note_ids: ['n-bank'] });
    expect(re.json.added).toHaveLength(1);
    expect(re.json.bumps.map((b: any) => b.id)).toEqual(['b1']);
  });

  it('an early review: one reviewed card ends a bump of a note in review', async () => {
    await me('POST', '/me/bumps', { items: [{ id: 'b2', note_id: 'n-apple', created_at: '2026-10-04T08:00:00.000Z' }] });
    review(db, 'e3', 'c-apple-h', '2026-09-01T08:00:00.000Z');
    expect(await listActiveBumps(db, ME)).toHaveLength(1);
    review(db, 'e4', 'c-apple-h', '2026-10-04T08:30:00.000Z');
    expect(await listActiveBumps(db, ME)).toEqual([]);
  });

  it('clears by hand (idempotent)', async () => {
    await me('POST', '/me/bumps', { note_ids: ['n-bank', 'n-apple'] });
    const r = await me('DELETE', '/me/bumps/n-bank');
    expect(r.json.cleared).toBe(1);
    expect(r.json.bumps.map((b: any) => b.note_id)).toEqual(['n-apple']);
    expect((await me('DELETE', '/me/bumps/n-bank')).json.cleared).toBe(0);
  });

  it('the tutor bumps the student’s card; nobody else can', async () => {
    const tutor = client(env, TUTOR);
    const r = await tutor('POST', '/relationships/rel-1/student-bumps', { hanzi: ['苹果'] });
    expect(r.status).toBe(200);
    expect(r.json.added).toEqual([{ note_id: 'n-apple', hanzi: '苹果' }]);
    const mine = await me('GET', '/me/bumps');
    expect(mine.json.bumps[0]).toMatchObject({ note_id: 'n-apple', source: 'tutor', bumped_by_name: 'Minghui' });
    expect((await me('POST', '/relationships/rel-1/student-bumps', { hanzi: ['苹果'] })).status).toBe(403);
    expect((await client(env, OTHER)('POST', '/relationships/rel-1/student-bumps', { hanzi: ['苹果'] })).status).toBe(403);
  });

  it('a card-level bump ("Practise this word other ways…"): only those cards, done once they are reviewed', async () => {
    const r = await me('POST', '/me/bumps', {
      items: [{ id: 'c1', note_id: 'n-bank', created_at: '2026-10-04T08:00:00.000Z', source: 'study_card', card_types: ['meaning_to_hanzi', 'bogus'] }],
    });
    expect(r.json.added).toEqual([{ note_id: 'n-bank', hanzi: '银行' }]);
    expect(r.json.bumps[0]).toMatchObject({ id: 'c1', card_types: ['meaning_to_hanzi'], source: 'study_card' });
    // Reviewing the OTHER card leaves it open; the chosen one ends it.
    review(db, 'e5', 'c-bank-h', '2026-10-04T09:00:00.000Z');
    expect(await listActiveBumps(db, ME)).toHaveLength(1);
    review(db, 'e6', 'c-bank-m', '2026-10-04T09:05:00.000Z');
    expect(await listActiveBumps(db, ME)).toEqual([]);
    // Re-opened as a card-level bump of another type only.
    const re = await me('POST', '/me/bumps', { items: [{ id: 'c2', note_id: 'n-bank', card_types: ['hanzi_to_meaning'] }] });
    expect(re.json.bumps[0].card_types).toEqual(['hanzi_to_meaning']);
  });

  it('card-level meets an active bump: the device’s merged list replaces it; a whole-note request widens it; a whole-note bump covers it', async () => {
    await me('POST', '/me/bumps', { items: [{ id: 'k1', note_id: 'n-bank', created_at: '2026-10-04T08:00:00.000Z', card_types: ['meaning_to_hanzi'] }] });
    const more = await me('POST', '/me/bumps', { items: [{ id: 'k2', note_id: 'n-bank', created_at: '2026-10-04T08:10:00.000Z', card_types: ['hanzi_to_meaning', 'meaning_to_hanzi'] }] });
    expect(more.json.added).toHaveLength(1);
    expect(more.json.bumps[0]).toMatchObject({ id: 'k1', created_at: '2026-10-04T08:10:00.000Z', card_types: ['hanzi_to_meaning', 'meaning_to_hanzi'] });
    const whole = await me('POST', '/me/bumps', { items: [{ id: 'k2b', note_id: 'n-bank', planned: true }] });
    expect(whole.json.added).toHaveLength(1);
    expect(whole.json.bumps[0].card_types).toBeNull();
    const covered = await me('POST', '/me/bumps', { items: [{ id: 'k3', note_id: 'n-bank', card_types: ['meaning_to_hanzi'] }] });
    expect(covered.json.already).toHaveLength(1);
    expect(covered.json.bumps[0].card_types).toBeNull();
  });

  describe('the ONE "Study it today" rule (shared/decks/study-today.ts) for bumps without a plan', () => {
    const three = (noteId: string, queues: [number, number, number] = [0, 0, 0], next: string | null = null) => {
      ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'].forEach((t, i) =>
        db.raw.run('INSERT INTO cards (id, note_id, card_type, queue, next_review_at, stability) VALUES (?, ?, ?, ?, ?, ?)', [`${noteId}-${t[0]}`, noteId, t, queues[i], queues[i] ? next : null, queues[i] ? 30 : 0]));
    };
    const noteWithAudio = (id: string, deck: string, hanzi: string) =>
      db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url) VALUES (?, ?, ?, 'pīnyīn', 'meaning', ?)", [id, deck, hanzi, `generated/${id}.mp3`]);
    const longTerm = (id: string) => db.rows<{ long_term: number | null }>('SELECT long_term FROM notes WHERE id = ?', [id])[0].long_term;

    beforeEach(() => {
      noteWithAudio('n-train', 'd-1', '火车');
      three('n-train');
      noteWithAudio('n-old', 'd-1', '学生');
      three('n-old', [2, 2, 2], '2027-01-01T00:00:00.000Z');
      db.raw.run("INSERT INTO decks (id, user_id, name, new_cards_per_day, secondary_cards_per_day) VALUES ('d-once', ?, 'Homework', 0, 0)", [ME]);
      noteWithAudio('n-once', 'd-once', '服务员');
      three('n-once');
    });

    it('an unstarted word (MCP / Claude): ONLY its listening card; its long-term choice is left alone in a deck in review', async () => {
      const r = await me('POST', '/me/bumps', { hanzi: ['火车'], source: 'mcp' });
      expect(r.json.added).toEqual([{ note_id: 'n-train', hanzi: '火车' }]);
      expect(r.json.kinds).toEqual({ 'n-train': 'listening' });
      expect(r.json.bumps[0].card_types).toEqual(['audio_to_hanzi']);
      expect(longTerm('n-train')).toBeNull();
      // Again: already in today (its listening card is still open).
      expect((await me('POST', '/me/bumps', { note_ids: ['n-train'] })).json.already).toHaveLength(1);
    });

    it('an unstarted word of a one-off deck also goes into long-term review', async () => {
      await me('POST', '/me/bumps', { note_ids: ['n-once'] });
      expect(db.rows<{ card_types: string }>("SELECT card_types FROM study_bumps WHERE note_id = 'n-once'")[0].card_types).toBe('["audio_to_hanzi"]');
      expect(longTerm('n-once')).toBe(1);
    });

    it('a started word: only its listening card, never the whole note', async () => {
      const r = await me('POST', '/me/bumps', { note_ids: ['n-old'] });
      expect(r.json.bumps[0]).toMatchObject({ note_id: 'n-old', card_types: ['audio_to_hanzi'] });
      // Done once the listening card is reviewed since the bump; the others never count.
      review(db, 'e-o1', 'n-old-h', new Date(Date.now() + 1000).toISOString());
      expect(await listActiveBumps(db, ME)).toHaveLength(1);
      review(db, 'e-o2', 'n-old-a', new Date(Date.now() + 2000).toISOString());
      expect(await listActiveBumps(db, ME)).toEqual([]);
      // A new tap re-opens it.
      expect((await me('POST', '/me/bumps', { hanzi: ['学生'] })).json.added).toHaveLength(1);
    });

    it('an older app build’s whole-note item is planned too; a device’s card-level / planned item is stored as sent', async () => {
      const old = await me('POST', '/me/bumps', { items: [{ id: 'legacy', note_id: 'n-train', source: 'deck' }] });
      expect(old.json.bumps[0]).toMatchObject({ id: 'legacy', card_types: ['audio_to_hanzi'] });
      const chosen = await me('POST', '/me/bumps', { items: [{ id: 'chosen', note_id: 'n-old', card_types: ['meaning_to_hanzi'], planned: true }] });
      expect(chosen.json.bumps.find((b: any) => b.note_id === 'n-old').card_types).toEqual(['meaning_to_hanzi']);
      const whole = await me('POST', '/me/bumps', { items: [{ id: 'w', note_id: 'n-once', planned: true }] });
      expect(whole.json.bumps.find((b: any) => b.note_id === 'n-once').card_types).toBeNull();
      expect(longTerm('n-once')).toBeNull(); // the device sets its own long-term choice
    });

    it('the tutor’s bump and Claude’s bump_cards follow the same rule', async () => {
      const t = await client(env, TUTOR)('POST', '/relationships/rel-1/student-bumps', { hanzi: ['火车'] });
      expect(t.json.bumps[0]).toMatchObject({ note_id: 'n-train', card_types: ['audio_to_hanzi'], bumped_by_name: 'Minghui' });
      const c = await executeBumpCardsTool({ hanzi: ['学生'] }, { db, userId: ME }, 'ask_claude');
      expect(c).toMatchObject({ bumped: ['学生'], added_today: [{ hanzi: '学生', what: 'its listening card' }] });
    });
  });

  it('the in-app agents’ bump_cards tool bumps existing words and says what it could not find', async () => {
    expect(BUMP_CARDS_TOOL.name).toBe('bump_cards');
    const r = await executeBumpCardsTool({ hanzi: ['银行', '火车'] }, { db, userId: ME }, 'coach_chat');
    expect(r).toMatchObject({ bumped: ['银行'], already_bumped: [], not_found: ['火车'] });
    const again = await executeBumpCardsTool({ note_ids: ['n-bank'] }, { db, userId: ME }, 'coach_chat');
    expect(again).toMatchObject({ bumped: [], already_bumped: ['银行'] });
    expect(await executeBumpCardsTool({}, { db, userId: ME }, 'coach_chat')).toEqual({ error: 'Give note_ids or hanzi' });
    expect((await listActiveBumps(db, ME))[0].source).toBe('coach_chat');
  });
});
