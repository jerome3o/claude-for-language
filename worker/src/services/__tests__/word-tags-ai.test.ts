/**
 * The AI word tags (services/word-tags-ai.ts) against a real SQLite (every migration) with a
 * mocked model: batching, what is stored, idempotence, edits, failures, token cost, the
 * hourly backfill allowance, the content-service triggers and the sync feed (word_tags_at,
 * never updated_at).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  backfillWordTagsNow,
  maybeBackfillWordTags,
  queueWordTags,
  runWordTags,
  validateTagReply,
  wordTagsProgress,
} from '../word-tags-ai';
import * as content from '../content';
import { getNotesChangedSince, insertNoteCopy } from '../../db/queries';
import { parseAiWordTags, WORD_TAGS_BACKFILL_PER_HOUR, WORD_TAGS_BATCH_SIZE } from '@shared/cards/word-tags-ai';
import type { Env } from '../../types';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

const VERDICTS: Record<string, Record<string, unknown>> = {
  告诉: { transitivity: 'transitive', register: 'neutral', confidence: 'high' },
  告知: { transitivity: 'transitive', register: 'formal', register_note: 'formal written; in speech use 告诉 — and a note far too long to keep', confidence: 'high' },
  休息: { transitivity: 'intransitive', register: 'neutral', confidence: 'medium' },
};

/** A fake model: a verdict for the words it knows, none for 沉默 (left out), n/a for the rest. */
function fakeModel() {
  const calls: string[] = [];
  const create = vi.fn(async (params: { messages: Array<{ content: string }> }) => {
    const text = params.messages[0].content;
    calls.push(text);
    const tags: unknown[] = [];
    for (const line of text.split('\n')) {
      const m = line.match(/^(\d+)\. (.+?) \| /);
      if (!m || m[2] === '沉默') continue;
      tags.push({ index: Number(m[1]), ...(VERDICTS[m[2]] ?? { transitivity: 'n/a', register: 'neutral', confidence: 'high' }) });
    }
    return { stop_reason: 'tool_use', usage: { input_tokens: 2000, output_tokens: 900 }, content: [{ type: 'tool_use', name: 'tag_words', input: { tags } }] };
  });
  return { client: { messages: { create } } as never, calls, create };
}

let db: SqliteD1;
let env: Env;

beforeEach(async () => {
  db = await createSqliteD1();
  env = { DB: db, ANTHROPIC_API_KEY: 'k' } as unknown as Env;
  exec(db, "INSERT INTO users (id, email, name, role) VALUES ('me', 'j@x', 'Jerome', 'student'), ('other', 'o@x', 'O', 'student')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d', 'me', 'HSK 1'), ('d2', 'other', 'Theirs')");
  const words: Array<[string, string, string]> = [['告诉', 'gàosu', 'to tell'], ['告知', 'gàozhī', 'to inform'], ['休息', 'xiūxi', 'to rest'], ['沉默', 'chénmò', 'silent'], ['书', 'shū', 'book']];
  words.forEach(([h, p, e], i) => {
    exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, created_at, updated_at) VALUES (?, 'd', ?, ?, ?, ?, '2026-09-01 10:00:00')", `n${i}`, h, p, e, `2026-10-01 00:00:0${i}`);
  });
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('x', 'd2', '告诉', 'gàosu', 'to tell')");
});

const stored = (id: string) => db.rows<{ word_tags: string | null; word_tags_at: string | null; updated_at: string }>('SELECT word_tags, word_tags_at, updated_at FROM notes WHERE id = ?', [id])[0];

describe('validateTagReply', () => {
  it('keeps good entries by index, drops junk, cuts the note', () => {
    const map = validateTagReply({
      tags: [
        { index: 0, transitivity: 'transitive', register: 'formal', register_note: 'x'.repeat(90), confidence: 'high' },
        { index: 1, transitivity: 'transitive' },
        { index: -1, confidence: 'high' },
        'junk',
        { index: 2, transitivity: 'sideways', register: 'neutral', confidence: 'low' },
      ],
    });
    expect([...map.keys()]).toEqual([0, 2]);
    expect(map.get(0)!.register_note).toHaveLength(60);
    expect(map.get(2)).toEqual({ v: 1, register: 'neutral', confidence: 'low' });
    expect(() => validateTagReply({ tags: 'no' })).toThrow();
  });
});

describe('runWordTags', () => {
  it('stores a verdict on every note, a low stub for one the model skipped, and never touches updated_at', async () => {
    const m = fakeModel();
    const r = await runWordTags(env, 'me', ['n0', 'n1', 'n2', 'n3', 'n4'], { client: m.client });
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ tagged: 5, shown: 5 - 1, failed: 0, input_tokens: 2000, output_tokens: 900 });
    expect(parseAiWordTags(stored('n0').word_tags)).toEqual({ v: 1, transitivity: 'transitive', register: 'neutral', confidence: 'high' });
    expect(parseAiWordTags(stored('n1').word_tags)).toMatchObject({ register: 'formal', confidence: 'high' });
    expect(parseAiWordTags(stored('n1').word_tags)!.register_note!.length).toBeLessThanOrEqual(60);
    expect(parseAiWordTags(stored('n3').word_tags)).toEqual({ v: 1, confidence: 'low' });
    expect(stored('n0').word_tags_at).toBeTruthy();
    expect(stored('n0').updated_at).toBe('2026-09-01 10:00:00');
  });

  it('is idempotent and only tags the caller’s notes', async () => {
    const m = fakeModel();
    await runWordTags(env, 'me', ['n0', 'x'], { client: m.client });
    expect(m.calls[0]).toContain('0. 告诉 | gàosu | to tell');
    expect(m.calls[0]).not.toContain('\n1.');
    expect(stored('x').word_tags).toBeNull();
    const again = await runWordTags(env, 'me', ['n0'], { client: m.client });
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(again.tagged).toBe(0);
  });

  it(`batches by ${WORD_TAGS_BATCH_SIZE}`, async () => {
    for (let i = 0; i < WORD_TAGS_BATCH_SIZE + 3; i++) {
      exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, 'd', '书', 'shū', 'book')", `b${i}`);
    }
    const ids = Array.from({ length: WORD_TAGS_BATCH_SIZE + 3 }, (_, i) => `b${i}`);
    const m = fakeModel();
    const r = await runWordTags(env, 'me', ids, { client: m.client });
    expect(m.create).toHaveBeenCalledTimes(2);
    expect(r.tagged).toBe(WORD_TAGS_BATCH_SIZE + 3);
  });

  it('a failed call writes nothing (the backfill tries again later)', async () => {
    const failing = { messages: { create: vi.fn(async () => { throw new Error('overloaded'); }) } } as never;
    const r = await runWordTags(env, 'me', ['n0', 'n1'], { client: failing, sleep: async () => {} });
    expect(r).toMatchObject({ tagged: 0, failed: 2 });
    expect(stored('n0').word_tags).toBeNull();
    expect(stored('n0').word_tags_at).toBeNull();
  });

  it('skips a note edited while its batch ran', async () => {
    const m = fakeModel();
    const create = m.create.getMockImplementation()!;
    m.create.mockImplementationOnce(async (p) => {
      exec(db, "UPDATE notes SET english = 'to let know' WHERE id = 'n0'");
      return create(p);
    });
    const r = await runWordTags(env, 'me', ['n0', 'n2'], { client: m.client });
    expect(r.tagged).toBe(1);
    expect(stored('n0').word_tags).toBeNull();
  });

  it('adds up tokens and cost per user', async () => {
    const m = fakeModel();
    await runWordTags(env, 'me', ['n0', 'n1'], { client: m.client });
    await runWordTags(env, 'me', ['n2'], { client: m.client });
    const p = await wordTagsProgress(db, 'me');
    expect(p).toMatchObject({ total: 5, tagged: 3, untagged: 2, input_tokens: 4000, output_tokens: 1800 });
    expect(p.cost_usd).toBeCloseTo((4000 * 1 + 1800 * 5) / 1_000_000, 6);
  });

  it('does nothing without a model', async () => {
    const r = await runWordTags({ ...env, ANTHROPIC_API_KEY: '' } as Env, 'me', ['n0']);
    expect(r.tagged).toBe(0);
  });
});

describe('the backfill', () => {
  const queueEnv = () => {
    const send = vi.fn(async (_body: unknown) => {});
    return { send, env: { ...env, CARD_CHECK_QUEUE: { send } } as unknown as Env };
  };

  it('the sync queues untagged notes newest first, then waits 15 minutes before looking again', async () => {
    const q = queueEnv();
    expect(await maybeBackfillWordTags(q.env, 'me')).toBe(5);
    expect(q.send).toHaveBeenCalledWith({ kind: 'word_tags', userId: 'me', noteIds: ['n4', 'n3', 'n2', 'n1', 'n0'], via: 'backfill' });
    expect(await maybeBackfillWordTags(q.env, 'me')).toBe(0);
    expect(q.send).toHaveBeenCalledTimes(1);
    expect((await wordTagsProgress(db, 'me')).queued_this_hour).toBe(5);
  });

  it(`queues at most ${WORD_TAGS_BACKFILL_PER_HOUR} an hour`, async () => {
    for (let i = 0; i < WORD_TAGS_BACKFILL_PER_HOUR + 50; i++) {
      exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, 'd', '书', 'shū', 'book')", `b${i}`);
    }
    const q = queueEnv();
    expect(await maybeBackfillWordTags(q.env, 'me')).toBe(WORD_TAGS_BACKFILL_PER_HOUR);
    expect(q.send).toHaveBeenCalledTimes(WORD_TAGS_BACKFILL_PER_HOUR / WORD_TAGS_BATCH_SIZE);
    // 20 minutes later: the hour's allowance is spent.
    exec(db, "UPDATE word_tag_runs SET checked_at = datetime('now', '-20 minutes')");
    expect(await maybeBackfillWordTags(q.env, 'me')).toBe(0);
    // The next hour: room again.
    exec(db, "UPDATE word_tag_runs SET checked_at = datetime('now', '-70 minutes'), window_start = datetime('now', '-70 minutes')");
    expect(await maybeBackfillWordTags(q.env, 'me')).toBe(WORD_TAGS_BACKFILL_PER_HOUR);
  });

  it('does not run at all without a model', async () => {
    expect(await maybeBackfillWordTags({ ...env, ANTHROPIC_API_KEY: '' } as Env, 'me')).toBe(0);
    expect(db.rows('SELECT * FROM word_tag_runs')).toEqual([]);
  });

  it('the on-demand backfill queues now and reports progress', async () => {
    const q = queueEnv();
    const r = await backfillWordTagsNow(q.env, 'me', 3);
    expect(r).toMatchObject({ queued: 3, total: 5, tagged: 0, untagged: 5 });
    expect(q.send).toHaveBeenCalledWith({ kind: 'word_tags', userId: 'me', noteIds: ['n4', 'n3', 'n2'], via: 'backfill' });
  });
});

describe('triggers and sync', () => {
  it('a new note is queued for tags (every account), but not with check: false', async () => {
    const send = vi.fn(async (_body: unknown) => {});
    const qenv = { ...env, CARD_CHECK_QUEUE: { send } } as unknown as Env;
    const note = await content.createNote(qenv, 'me', 'd', { hanzi: '散步', pinyin: 'sànbù', english: 'to take a walk' }, { audio: 'none', sentences: false });
    expect(send).toHaveBeenCalledWith({ kind: 'word_tags', userId: 'me', noteIds: [note.id], via: 'create' });
    send.mockClear();
    await content.createNote(qenv, 'me', 'd', { hanzi: '跑步', pinyin: 'pǎobù', english: 'to run' }, { audio: 'none', sentences: false, check: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('a new hanzi or English clears the tags and re-tags; a pinyin fix keeps them', async () => {
    const m = fakeModel();
    await runWordTags(env, 'me', ['n0'], { client: m.client });
    const send = vi.fn(async (_body: unknown) => {});
    const qenv = { ...env, CARD_CHECK_QUEUE: { send } } as unknown as Env;
    await content.updateNote(qenv, 'me', 'n0', { pinyin: 'gàosù' });
    expect(stored('n0').word_tags).not.toBeNull();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'word_tags' }));
    await content.updateNote(qenv, 'me', 'n0', { english: 'to let know' });
    expect(stored('n0').word_tags).toBeNull();
    expect(send).toHaveBeenCalledWith({ kind: 'word_tags', userId: 'me', noteIds: ['n0'], via: 'edit' });
  });

  it('new tags reach the devices through /api/sync/changes by word_tags_at', async () => {
    expect((await getNotesChangedSince(db, 'me', '2026-09-02 00:00:00')).results).toHaveLength(0);
    await runWordTags(env, 'me', ['n2'], { client: fakeModel().client });
    const after = (await getNotesChangedSince(db, 'me', '2026-09-02 00:00:00')).results;
    expect(after.map((n) => n.id)).toEqual(['n2']);
    expect(parseAiWordTags(after[0].word_tags)).toMatchObject({ transitivity: 'intransitive' });
  });

  it("a tutor's copy carries the tags", async () => {
    await runWordTags(env, 'me', ['n0'], { client: fakeModel().client });
    const [source] = db.rows<Record<string, unknown>>("SELECT * FROM notes WHERE id = 'n0'");
    const copyId = await insertNoteCopy(db, 'd2', source);
    expect(stored(copyId).word_tags).toBe(source.word_tags);
  });

  it('queueWordTags never throws', async () => {
    const send = vi.fn(async () => { throw new Error('queue down'); });
    await expect(queueWordTags({ ...env, CARD_CHECK_QUEUE: { send } } as unknown as Env, 'me', ['n0'])).resolves.toBeUndefined();
  });
});
