/**
 * Word checks against a real SQLite (every migration) with a mocked model:
 * batching, what gets stored, deck jobs with progress + source matching, and
 * that NOTHING changes a note's text until an explicit apply.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  applyDeckCheck,
  batchPrompt,
  cardCheckEnabled,
  checkWords,
  getDeckCheckJob,
  jobToApi,
  queueNoteCheck,
  removeNoteIssue,
  runDeckCheckJob,
  runNotesCheck,
  startDeckCheck,
} from '../card-check';
import { CHECK_BATCH_SIZE, parseCheckIssues } from '@shared/cards/check';
import type { Env } from '../../types';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

/** A fake Anthropic client: reports 行 → háng for 银行 and banana → apple for 苹果, records every call. */
function fakeModel() {
  const calls: string[] = [];
  const client = {
    messages: {
      create: vi.fn(async (params: { messages: Array<{ content: string }> }) => {
        const text = params.messages[0].content;
        calls.push(text);
        const issues: unknown[] = [];
        for (const line of text.split('\n')) {
          const m = line.match(/^(\d+)\. (.+?) \| (.*?) \| (.*)$/);
          if (!m) continue;
          if (m[2] === '银行' && /xíng/.test(m[3])) issues.push({ index: Number(m[1]), field: 'pinyin', kind: 'reading', proposed: 'yínháng', reason: '行 reads háng in 银行' });
          if (m[2] === '苹果' && /banana/.test(m[4])) issues.push({ index: Number(m[1]), field: 'english', kind: 'gloss', proposed: 'apple', reason: '苹果 is apple' });
        }
        return { stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 50 }, content: [{ type: 'tool_use', name: 'report_issues', input: { issues } }] };
      }),
    },
  };
  return { client: client as never, calls, create: client.messages.create };
}

let db: SqliteD1;
let env: Env;

beforeEach(async () => {
  db = await createSqliteD1();
  env = { DB: db, ANTHROPIC_API_KEY: 'k' } as unknown as Env;
  exec(db, "INSERT INTO users (id, email, name, role) VALUES ('tutor', 't@x', 'Minghui', 'tutor'), ('student', 's@x', 'Jerome', 'student')");
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'student', 'tutor', 'student', 'active')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('src', 'tutor', 'Lesson 8'), ('copy', 'student', 'Lesson 8')");
  const words: Array<[string, string, string]> = [['银行', 'yínxíng', 'bank'], ['苹果', 'píngguǒ', 'banana'], ['一样', 'yī yàng', 'the same'], ['你好', 'nǐ hǎo', 'hello']];
  words.forEach(([h, p, e], i) => {
    exec(db, 'INSERT INTO notes (id, deck_id, hanzi, pinyin, english, created_at) VALUES (?, ?, ?, ?, ?, ?)', `s${i}`, 'src', h, p, e, `2026-10-01 00:00:0${i}`);
    exec(db, 'INSERT INTO notes (id, deck_id, hanzi, pinyin, english, created_at) VALUES (?, ?, ?, ?, ?, ?)', `c${i}`, 'copy', h, p, e, `2026-10-01 00:00:0${i}`);
  });
  exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share', 'rel', 'src', 'copy')");
});

const notesText = () => db.rows<{ id: string; pinyin: string; english: string }>('SELECT id, pinyin, english FROM notes ORDER BY id');

describe('checkWords', () => {
  it('batches by CHECK_BATCH_SIZE and shifts indexes back', async () => {
    const m = fakeModel();
    const words = Array.from({ length: CHECK_BATCH_SIZE + 5 }, () => ({ hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' }));
    words[CHECK_BATCH_SIZE + 2] = { hanzi: '银行', pinyin: 'yínxíng', english: 'bank' };
    const issues = await checkWords(env, words, { client: m.client });
    expect(m.create).toHaveBeenCalledTimes(2);
    expect(issues).toEqual([expect.objectContaining({ index: CHECK_BATCH_SIZE + 2, field: 'pinyin', proposed: 'yínháng', current: 'yínxíng' })]);
  });

  it('falls back to the 一/不 rule when the model fails, and without a key', async () => {
    const failing = { messages: { create: vi.fn(async () => { throw new Error('overloaded'); }) } } as never;
    const words = [{ hanzi: '一样', pinyin: 'yī yàng', english: 'same' }, { hanzi: '银行', pinyin: 'yínxíng', english: 'bank' }];
    const issues = await checkWords(env, words, { client: failing, sleep: async () => {} });
    expect(issues.map(i => [i.index, i.kind, i.proposed])).toEqual([[0, 'tone_change', 'yí yàng']]);
    const noKey = await checkWords({ ...env, ANTHROPIC_API_KEY: '' } as Env, words);
    expect(noKey).toHaveLength(1);
  });

  it('numbers the cards in the prompt', () => {
    expect(batchPrompt([{ hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' }])).toContain('0. 你好 | nǐ hǎo | hello');
  });
});

describe('notes checks', () => {
  it('stores issues on the notes, never changes their text', async () => {
    const before = notesText();
    const m = fakeModel();
    const result = await runNotesCheck(env, 'tutor', ['s0', 's1', 's2', 's3'], { client: m.client });
    expect(notesText()).toEqual(before);
    expect(result.get('s0')?.[0]).toMatchObject({ field: 'pinyin', proposed: 'yínháng' });
    expect(result.get('s3')).toEqual([]);
    const stored = db.rows<{ id: string; check_issues: string | null; check_at: string | null }>("SELECT id, check_issues, check_at FROM notes WHERE deck_id = 'src' ORDER BY id");
    expect(parseCheckIssues(stored[0].check_issues)[0].proposed).toBe('yínháng');
    expect(parseCheckIssues(stored[1].check_issues)[0]).toMatchObject({ field: 'english', proposed: 'apple' });
    expect(parseCheckIssues(stored[2].check_issues)[0]).toMatchObject({ kind: 'tone_change', proposed: 'yí yàng' });
    expect(stored[3].check_issues).toBeNull();
    expect(stored[3].check_at).toBeNull(); // nothing to sync for a clean word
    expect(stored[0].check_at).not.toBeNull();
  });

  it("only checks the caller's own notes", async () => {
    const m = fakeModel();
    const result = await runNotesCheck(env, 'tutor', ['c0'], { client: m.client });
    expect(result.size).toBe(0);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('dismiss removes one issue', async () => {
    const m = fakeModel();
    const result = await runNotesCheck(env, 'tutor', ['s0'], { client: m.client });
    const id = result.get('s0')![0].id;
    const { remaining } = await removeNoteIssue(db, 'tutor', 's0', id);
    expect(remaining).toEqual([]);
    expect(db.rows<{ check_issues: string | null }>("SELECT check_issues FROM notes WHERE id = 's0'")[0].check_issues).toBeNull();
    await expect(removeNoteIssue(db, 'tutor', 's0', id)).rejects.toThrow(/already handled/);
  });

  it('the switch defaults to on for tutors only, and the queue respects it', async () => {
    expect(await cardCheckEnabled(db, 'tutor')).toBe(true);
    expect(await cardCheckEnabled(db, 'student')).toBe(false);
    exec(db, "UPDATE users SET card_check = 1 WHERE id = 'student'");
    expect(await cardCheckEnabled(db, 'student')).toBe(true);
    exec(db, "UPDATE users SET card_check = 0 WHERE id = 'tutor'");
    const send = vi.fn(async () => {});
    await queueNoteCheck({ ...env, CARD_CHECK_QUEUE: { send } } as unknown as Env, 'tutor', ['s0']);
    expect(send).not.toHaveBeenCalled();
    await queueNoteCheck({ ...env, CARD_CHECK_QUEUE: { send } } as unknown as Env, 'student', ['c0']);
    expect(send).toHaveBeenCalledWith({ kind: 'notes', userId: 'student', noteIds: ['c0'] });
  });
});

describe('deck checks', () => {
  it("runs over the student's copy, matches the tutor's source notes, saves progress and cost", async () => {
    const m = fakeModel();
    const job = await startDeckCheck({ ...env, CARD_CHECK_QUEUE: { send: async () => {} } } as unknown as Env, { userId: 'tutor', deckId: 'copy', deckOwnerId: 'student', relationshipId: 'rel', sourceDeckId: 'src' });
    expect(job.status).toBe('queued');
    expect(await runDeckCheckJob(env, job.id, { client: m.client })).toBe('done');
    const api = jobToApi((await getDeckCheckJob(db, job.id))!);
    expect(api.checked).toBe(4);
    expect(api.proposals.map(p => [p.hanzi, p.field, p.proposed, p.source_note_id])).toEqual([
      ['银行', 'pinyin', 'yínháng', 's0'],
      ['苹果', 'english', 'apple', 's1'],
      ['一样', 'pinyin', 'yí yàng', 's2'],
    ]);
    expect(api.cost_usd).toBeCloseTo(1000 / 1e6 + 50 * 5 / 1e6);
    expect(notesText().find(n => n.id === 'c0')!.pinyin).toBe('yínxíng'); // nothing applied yet
  });

  it('applies only the selected proposals, skips edited words, and fixes the source when asked', async () => {
    const m = fakeModel();
    const job = await startDeckCheck({ ...env, CARD_CHECK_QUEUE: { send: async () => {} } } as unknown as Env, { userId: 'tutor', deckId: 'copy', deckOwnerId: 'student', relationshipId: 'rel', sourceDeckId: 'src' });
    await runDeckCheckJob(env, job.id, { client: m.client });
    const row = (await getDeckCheckJob(db, job.id))!;
    const [bank, apple, same] = jobToApi(row).proposals;
    exec(db, "UPDATE notes SET english = 'pear' WHERE id = 'c1'"); // edited since the check
    const writes: Array<[string, string, Record<string, string>]> = [];
    const update = async (owner: string, noteId: string, patch: Record<string, string>) => {
      writes.push([owner, noteId, patch]);
      const [field, value] = Object.entries(patch)[0];
      exec(db, `UPDATE notes SET ${field} = ? WHERE id = ?`, value, noteId);
    };
    const res = await applyDeckCheck(env, row, [bank.id, apple.id], true, update);
    expect(res.applied).toEqual([bank.id]);
    expect(res.source_applied).toEqual([bank.id]);
    expect(res.failed).toEqual([{ id: apple.id, error: 'The word was edited since the check' }]);
    expect(writes).toEqual([['student', 'c0', { pinyin: 'yínháng' }], ['tutor', 's0', { pinyin: 'yínháng' }]]);
    expect(notesText().find(n => n.id === 'c2')!.pinyin).toBe('yī yàng'); // not selected → untouched
    const after = jobToApi((await getDeckCheckJob(db, job.id))!).proposals;
    expect(after.find(p => p.id === bank.id)).toMatchObject({ applied: true, source_applied: true });
    expect(after.find(p => p.id === same.id)?.applied).toBeUndefined();
    // Applying again does nothing.
    expect((await applyDeckCheck(env, (await getDeckCheckJob(db, job.id))!, [bank.id], true, update)).applied).toEqual([]);
  });

  it('resumes from the saved progress', async () => {
    const m = fakeModel();
    const job = await startDeckCheck({ ...env, CARD_CHECK_QUEUE: { send: async () => {} } } as unknown as Env, { userId: 'tutor', deckId: 'src', deckOwnerId: 'tutor' });
    exec(db, "UPDATE deck_check_jobs SET checked = 4, status = 'running' WHERE id = ?", job.id);
    expect(await runDeckCheckJob(env, job.id, { client: m.client })).toBe('done');
    expect(m.create).not.toHaveBeenCalled();
  });

  it('refuses an empty deck', async () => {
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('empty', 'tutor', 'Empty')");
    await expect(startDeckCheck(env, { userId: 'tutor', deckId: 'empty', deckOwnerId: 'tutor' })).rejects.toThrow(/no words/);
  });
});
