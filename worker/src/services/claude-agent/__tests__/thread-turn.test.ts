/**
 * Claude threads — a reply (claude-agent/thread-turn.ts + live.ts + store.ts) against REAL SQLite with
 * every migration and a fake streaming model: the text streams to the owner's socket (`claude_turn`,
 * seq growing, the whole text each time) and into the pending row (the poll fallback), the row is
 * finished with meta and the thread's inbox fields; the lease keeps a second runner out until it
 * expires (the watchdog then resumes); a busy model is retried then failed with a readable reason; a
 * checkpoint is never re-asked; a card turn also lands in note_questions; practice threads are
 * read-only; E2E_TEST_MODE takes the stand-in first; startThreadTurn schedules the watchdog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeTurnEvent } from '@shared/claude/api';
import { createSqliteD1, type SqliteD1 } from '../../__tests__/sqlite-d1';
import type { Env } from '../../../types';
import { FAKE_STREAM_CHUNKS, fakeStreamingClient } from '../fake';
import { runThreadTurn, startThreadTurn, WATCHDOG_DELAY_SECONDS } from '../thread-turn';
import * as store from '../store';
import { backfillClaudeThreads } from '../backfill';
import { seedReaderAndLesson } from './context-seed';
import { cardToolLines, parseCardToolResults } from '@shared/claude/cardTools';
import { toolRecord } from '../tool-record';
import { TOOL_RECORD_RULE } from '../persona';

const U = 'u1';

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'j@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c1', 'n1', 'hanzi_to_meaning', 2)");
}

async function newTurn(db: SqliteD1, context: Parameters<typeof store.createThread>[1]['context'], text: string, answerLang: 'zh' | 'en' | null = 'zh') {
  const { thread } = await store.createThread(db, { userId: U, context, title: text, source: 'app', ...(context.kind === 'card' ? { snapshot: { label: '银行' } } : {}) });
  const turn = await store.appendTurn(db, { threadId: thread.id, role: 'user', content: text, intent: 'ask' }, { contentType: 'text', answerLang });
  return { threadId: thread.id, userMessageId: turn.user.id, replyId: turn.reply!.id };
}

function envOf(db: SqliteD1, extra: Partial<Env> = {}): Env {
  return { DB: db, ANTHROPIC_API_KEY: 'test-key', ...extra } as unknown as Env;
}

/** Live options that record every event and write / push at once (no throttle). */
function recorder() {
  const events: ClaudeTurnEvent[] = [];
  return { events, live: { push: async (e: ClaudeTurnEvent) => void events.push(e), pushIntervalMs: 0, writeIntervalMs: 0 } };
}

/** A streaming client answering each round from `create` (no deltas: the final message only). */
function scripted(create: (p: never) => Promise<unknown>): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create,
      stream: (p: never) => {
        const s = { on: () => s, finalMessage: () => create(p) };
        return s;
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}

const reply = (db: SqliteD1, id: string) => db.rows<store.MessageRow>('SELECT * FROM coach_messages WHERE id = ?', [id])[0];

describe('a Claude thread reply', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('streams to the owner (whole text, seq growing) and the row, then finishes the row and the inbox', async () => {
    const { threadId, replyId } = await newTurn(db, { kind: 'general' }, '成都有什么好吃的？');
    const rec = recorder();
    const partials: string[] = [];
    const spy = vi.spyOn(store, 'writePartial').mockImplementation(async (d, id, text, lease) => {
      partials.push(text);
      await d.prepare('UPDATE coach_messages SET content = ? WHERE id = ?').bind(text, id).run();
      void lease;
    });
    const out = await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: rec.live, inline: true, clip: null });
    spy.mockRestore();
    expect(out).toBe('done');

    const full = FAKE_STREAM_CHUNKS.zh.join('');
    const row = reply(db, replyId);
    expect(row).toMatchObject({ status: null, content: full, lease_until: null, checkpoint: null, answer_lang: 'zh' });
    expect(JSON.parse(row.meta!)).toMatchObject({ inline: true, attempt: 1, rounds: 1 });
    expect(JSON.parse(row.meta!).first_token_ms).toBeGreaterThanOrEqual(0);
    // The poll fallback saw the text grow.
    expect(partials.length).toBeGreaterThanOrEqual(1);
    expect(full.startsWith(partials[0])).toBe(true);

    expect(rec.events[0]).toMatchObject({ type: 'claude_turn', thread_id: threadId, message_id: replyId, status: 'thinking' });
    expect(rec.events.at(-1)).toMatchObject({ status: 'done', text: full });
    const seqs = rec.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(rec.events.filter((e) => e.status === 'streaming').every((e) => full.startsWith(e.text ?? '∅'))).toBe(true);

    const summary = (await store.getThreadSummary(db, U, threadId))!;
    expect(summary).toMatchObject({ unread: 1, pending: false, preview: full.replace(/\n/g, ' ').slice(0, 120) });
  });

  it('the lease keeps a second runner out; once it lapses the watchdog resumes the reply', async () => {
    const { replyId } = await newTurn(db, { kind: 'general' }, '你好');
    expect(await store.claimTurn(db, replyId)).toBe(true);
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live, clip: null })).toBe('busy');
    // The first runner died (isolate gone): its lease lapses.
    db.raw.run("UPDATE coach_messages SET lease_until = '2000-01-01T00:00:00.000Z' WHERE id = ?", [replyId]);
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live, clip: null })).toBe('done');
    expect(reply(db, replyId).attempts).toBe(2);
    // A late watchdog delivery finds nothing to do.
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live })).toBe('skipped');
  });

  it('a busy model is retried (row pending, lease released), the last attempt fails with a readable reason', async () => {
    const { replyId } = await newTurn(db, { kind: 'general' }, '你好');
    const busy = { messages: { stream: () => { throw Object.assign(new Error('overloaded'), { status: 529 }); }, create: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
    const rec = recorder();
    expect(await runThreadTurn(envOf(db), replyId, { client: busy, live: rec.live })).toBe('retry');
    expect(reply(db, replyId)).toMatchObject({ status: 'pending', lease_until: null, content: '' });
    expect(rec.events.at(-1)).toMatchObject({ status: 'thinking', text: '' });
    expect(await runThreadTurn(envOf(db), replyId, { client: busy, live: rec.live })).toBe('retry');
    expect(await runThreadTurn(envOf(db), replyId, { client: busy, live: rec.live })).toBe('failed');
    expect(reply(db, replyId)).toMatchObject({ status: 'failed', error: 'Claude is busy right now — try again in a moment.' });
    expect(rec.events.at(-1)).toMatchObject({ status: 'failed', error: 'Claude is busy right now — try again in a moment.' });
    // Retry: back to pending, and it runs.
    expect(await store.reopenTurn(db, replyId)).toBe(true);
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live, clip: null })).toBe('done');
  });

  it('a checkpointed answer is never asked again: only the remaining actions run', async () => {
    const { replyId } = await newTurn(db, { kind: 'card', note_id: 'n1' }, 'Make a card for 银行卡', 'en');
    db.raw.run('UPDATE coach_messages SET checkpoint = ? WHERE id = ?', [
      JSON.stringify({ answer: 'Done — I made two cards.', actions: [{ tool: 'create_flashcards', input: { flashcards: [] } }, { tool: 'create_flashcards', input: { flashcards: [] } }], applied: 1, results: [{ tool: 'create_flashcards', success: true }] }),
      replyId,
    ]);
    const model = { messages: { stream: vi.fn(), create: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
    const applyCard = vi.fn(async () => ({ tool: 'create_flashcards', success: true, data: { count: 1 } }));
    expect(await runThreadTurn(envOf(db), replyId, { client: model, applyCard, live: recorder().live, clip: null })).toBe('done');
    expect(model.messages.stream).not.toHaveBeenCalled();
    expect(applyCard).toHaveBeenCalledTimes(1);
    const row = reply(db, replyId);
    expect(row.content).toBe('Done — I made two cards.');
    expect(JSON.parse(row.tool_results!)).toHaveLength(2);
  });

  it('a turn asked for English that Claude answers in Chinese is stored zh (word chips) and its 🎧 clip is made', async () => {
    // Jerome, Nov 2026: "把说明改成英文" asks for English (the pending reply is 'en'); Claude edits the card
    // and answers in Chinese. Stored in the language it is WRITTEN in (replyLanguage), so the apps draw
    // word chips and Listen first has its clip.
    db.raw.run("UPDATE users SET ask_claude_listening = 1 WHERE id = 'u1'");
    const { replyId } = await newTurn(db, { kind: 'card', note_id: 'n1' }, '请把说明用英文写', 'en');
    const clip = vi.fn(async () => true);
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live, clip, memory: null })).toBe('done');
    const zh = FAKE_STREAM_CHUNKS.zh.join('');
    expect(reply(db, replyId)).toMatchObject({ status: null, answer_lang: 'zh' });
    expect(clip).toHaveBeenCalledTimes(1);
    expect((clip.mock.calls[0] as unknown[])[1]).toBe(zh);
    expect(db.rows<{ answer_lang: string }>('SELECT answer_lang FROM note_questions')).toEqual([{ answer_lang: 'zh' }]);
    // An English answer to an English turn stays 'en', no clip.
    const en = await newTurn(db, { kind: 'card', note_id: 'n1' }, 'In English please', 'en');
    const clip2 = vi.fn(async () => true);
    expect(await runThreadTurn(envOf(db), en.replyId, { client: fakeStreamingClient('en', 0), live: recorder().live, clip: clip2, memory: null })).toBe('done');
    expect(reply(db, en.replyId)).toMatchObject({ answer_lang: 'en' });
    expect(clip2).not.toHaveBeenCalled();
  });

  it('a card turn answers with the card in the first message, and lands in note_questions (no double copy later)', async () => {
    const { replyId, userMessageId } = await newTurn(db, { kind: 'card', note_id: 'n1' }, '行 has two readings?', 'en');
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const base = fakeStreamingClient('en', 0);
    const client = { messages: { create: base.messages.create, stream: (p: Anthropic.MessageCreateParamsNonStreaming) => (seen.push(p), base.messages.stream(p)) } } as unknown as Pick<Anthropic, 'messages'>;
    expect(await runThreadTurn(envOf(db), replyId, { client, live: recorder().live, clip: null })).toBe('done');
    const first = seen[0].messages[0].content;
    expect(typeof first === 'string' ? first : JSON.stringify(first)).toContain('银行');
    const qs = db.rows<{ id: string; question: string; answer: string; answer_lang: string }>('SELECT id, question, answer, answer_lang FROM note_questions');
    expect(qs).toEqual([{ id: expect.any(String), question: '行 has two readings?', answer: FAKE_STREAM_CHUNKS.en.join(''), answer_lang: 'en' }]);
    expect(db.rows('SELECT legacy_id FROM coach_messages WHERE id IN (?, ?)', [userMessageId, replyId]).map((r) => (r as { legacy_id: string }).legacy_id)).toEqual([qs[0].id, qs[0].id]);
    // The backfill sees it is there already.
    const before = db.rows('SELECT COUNT(*) AS n FROM coach_messages')[0];
    await backfillClaudeThreads(db, U);
    expect(db.rows('SELECT COUNT(*) AS n FROM coach_messages')[0]).toEqual(before);
  });

  it('a reader page turn: its create_flashcards saved into the deck Claude picked (like the Coach), the page in the prompt, the bump source "reader"', async () => {
    seedReaderAndLesson(db, U, null);
    const { replyId } = await newTurn(db, { kind: 'reader', reader_id: 'rd1', page_id: 'pg2', looked_up: ['熊猫'] }, 'Make a card for 熊猫', 'en');
    const seen: Array<{ system: Array<{ text: string }>; tools: Array<{ name: string }> }> = [];
    let round = 0;
    const create = vi.fn(async (p: (typeof seen)[number]) => {
      seen.push(JSON.parse(JSON.stringify(p)));
      round++;
      return round === 1
        ? {
            model: 'm',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 't1', name: 'create_flashcards', input: { deck_id: 'd1', flashcards: [{ hanzi: '熊猫', pinyin: 'xióngmāo', english: 'panda', fun_facts: '熊 (xióng) bear + 猫 (māo) cat.' }] } }],
            usage: {},
          }
        : { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Added 熊猫 to HSK 2.' }], usage: {} };
    });
    const out = await runThreadTurn(envOf(db), replyId, { client: scripted(create as never), live: recorder().live, clip: null, memory: null });
    expect(out).toBe('done');
    expect(seen[0].system.map((b) => b.text).join('\n')).toContain('The page they asked on (page 2 of 3)');
    expect(seen[0].tools.map((t) => t.name)).toEqual(['create_flashcards', 'search_cards', 'bump_cards', 'get_note_cards', 'search_my_chats', 'read_chat']);
    const row = reply(db, replyId);
    expect(row).toMatchObject({ status: null, content: 'Added 熊猫 to HSK 2.' });
    expect(JSON.parse(row.tool_results!)).toEqual([
      { tool: 'create_flashcards', success: true, data: { deck_name: 'HSK 2', deck_id: 'd1', deck_source_key: null, notes: [{ id: expect.any(String), hanzi: '熊猫', pinyin: 'xióngmāo', english: 'panda' }] } },
    ]);
    expect(db.rows("SELECT hanzi FROM notes WHERE deck_id = 'd1' ORDER BY hanzi")).toEqual([{ hanzi: '熊猫' }, { hanzi: '银行' }]);
  });

  it('a follow-up turn SEES what the earlier reply’s tools did — the same record the app’s "✓ Added" line is built from', async () => {
    // Jerome, Nov 2026: "✓ Added 1 card: 这次机会很难得，你要好好把握。" under Claude's reply, then one turn later
    // Claude said "I didn't actually create anything yet — my last reply was just text". The history
    // replayed text only, so Claude never saw its own create_flashcards call.
    const { threadId, replyId } = await newTurn(db, { kind: 'card', note_id: 'n1' }, '请你加一张卡片，关于机会。');
    const seen: Array<{ messages: Anthropic.MessageParam[]; system: Array<{ text: string }> }> = [];
    const sentence = '这次机会很难得，你要好好把握。';
    let round = 0;
    const create = vi.fn(async (p: (typeof seen)[number]) => {
      seen.push(JSON.parse(JSON.stringify(p)));
      round++;
      if (round === 1) {
        return {
          model: 'm',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'create_flashcards',
              input: { flashcards: [{ hanzi: sentence, pinyin: 'zhè cì jīhuì hěn nándé, nǐ yào hǎohāo bǎwò.', english: 'This chance is rare, you should seize it.', fun_facts: '机会 (jīhuì) chance' }] },
            },
          ],
          usage: {},
        };
      }
      if (round === 2) return { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: `我已经加了一张新卡片：「${sentence}」` }], usage: {} };
      // The follow-ups: Claude copies the record format into its answer — the app takes it out.
      return { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: `I added one card: ${sentence}\n\n⟦app record — fake⟧` }], usage: {} };
    });
    const client = scripted(create as never);
    expect(await runThreadTurn(envOf(db), replyId, { client, live: recorder().live, clip: null, memory: null })).toBe('done');
    // What Claude heard while the turn ran is the truth now — never "after user approval".
    const ack = JSON.stringify(seen[1].messages.at(-1));
    expect(ack).toContain('no approval step');
    expect(ack).not.toContain('after user approval');

    // The card exists — no deck named, so in his "From Claude" source deck (made on first use; source
    // decks, Nov 2026: before, the card's own deck) — and the reply's tool_results say so.
    expect(db.rows("SELECT n.hanzi FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.source_key = 'claude' ORDER BY n.hanzi")).toEqual([{ hanzi: sentence }]);
    expect(db.rows("SELECT name FROM decks WHERE source_key = 'claude'")).toEqual([{ name: 'From Claude' }]);
    const results = reply(db, replyId).tool_results;
    const lines = cardToolLines(parseCardToolResults(results));
    expect(lines).toMatchObject([{ kind: 'added', text: `✓ Added 1 card: ${sentence}`, undo: false, head: '✓ Added 1 card' }]);
    // The card with its note id — the line's tappable word (→ the explorer).
    const noteId = db.rows("SELECT n.id FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.source_key = 'claude'")[0].id;
    expect(lines[0].cards).toMatchObject([{ note_id: noteId, hanzi: sentence, deck_name: 'From Claude' }]);

    // The follow-up turn: the earlier reply is replayed WITH its record (deck and card named).
    const next = await store.appendTurn(db, { threadId, role: 'user', content: 'What did you do? I only want the card about chance.', intent: 'ask' }, { contentType: 'text', answerLang: 'en' });
    expect(await runThreadTurn(envOf(db), next.reply!.id, { client, live: recorder().live, clip: null, memory: null })).toBe('done');
    const history = seen[2].messages;
    const earlier = history[1];
    expect(earlier.role).toBe('assistant');
    expect(earlier.content).toBe(`我已经加了一张新卡片：「${sentence}」\n\n${toolRecord(results)}`);
    expect(earlier.content).toContain(`create_flashcards: added 1 card to the deck “From Claude”: ${sentence}.`);
    expect(history.at(-1)).toMatchObject({ role: 'user' });
    // Claude is told what the record is (static rules), and its own copy of one never reaches the learner.
    expect(seen[2].system[0].text).toContain(TOOL_RECORD_RULE);
    expect(reply(db, next.reply!.id).content).toBe(`I added one card: ${sentence}`);

    // The record is the same every turn (stored results never change): the replayed prefix stays byte-identical.
    const third = await store.appendTurn(db, { threadId, role: 'user', content: 'OK, thanks.', intent: 'ask' }, { contentType: 'text', answerLang: 'en' });
    expect(await runThreadTurn(envOf(db), third.reply!.id, { client, live: recorder().live, clip: null, memory: null })).toBe('done');
    expect(seen[3].messages.slice(0, 2)).toEqual(history.slice(0, 2));
  });

  it("an exercise turn: the learner's answer and its check in the prompt; someone else's lesson fails readably", async () => {
    seedReaderAndLesson(db, U, null);
    const { replyId } = await newTurn(db, { kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e1', answer: { text: '我放书在桌子上。', verdict: 'wrong' } }, 'Why is my answer wrong?', 'en');
    const seen: Array<{ system: Array<{ text: string }> }> = [];
    const create = vi.fn(async (p: (typeof seen)[number]) => (seen.push(JSON.parse(JSON.stringify(p))), { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Use 把.' }], usage: {} }));
    expect(await runThreadTurn(envOf(db), replyId, { client: scripted(create as never), live: recorder().live, clip: null, memory: null })).toBe('done');
    const sys = seen[0].system.map((b) => b.text).join('\n');
    expect(sys).toContain('Their answer: 我放书在桌子上。');
    expect(sys).toContain('"reference_hanzi":"我把书放在桌子上。"');

    db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('x2', 'x2@x.test', 'Someone', 'student')");
    db.raw.run("UPDATE custom_lessons SET user_id = 'x2' WHERE id = 'ls1'");
    const again = await newTurn(db, { kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e1' }, 'And now?', 'en');
    expect(await runThreadTurn(envOf(db), again.replyId, { client: scripted(create as never), live: recorder().live, clip: null, memory: null })).toBe('failed');
    expect(reply(db, again.replyId)).toMatchObject({ status: 'failed', error: 'You can’t continue this chat any more.' });
  });

  it('practice threads are read-only: the reply fails with why', async () => {
    const { replyId } = await newTurn(db, { kind: 'practice', conversation_id: 'pc1' }, '我要一碗面');
    db.raw.run("UPDATE coach_conversations SET read_only = 1 WHERE context_kind = 'practice'");
    expect(await runThreadTurn(envOf(db), replyId, { client: fakeStreamingClient('zh', 0), live: recorder().live })).toBe('failed');
    expect(reply(db, replyId).error).toBe('This chat can’t continue here yet');
  });

  it('E2E_TEST_MODE takes the stand-in first, whatever key is set; startThreadTurn schedules the watchdog', async () => {
    const { replyId } = await newTurn(db, { kind: 'general' }, '你好');
    const sent: Array<{ body: unknown; opts: unknown }> = [];
    const env = envOf(db, { E2E_TEST_MODE: 'true', COACH_REPLY_QUEUE: { send: async (body: unknown, opts: unknown) => void sent.push({ body, opts }) } } as never);
    const real = { messages: { stream: vi.fn(), create: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
    await startThreadTurn(env, replyId, { client: real, live: recorder().live });
    expect(real.messages.stream).not.toHaveBeenCalled();
    expect(sent).toEqual([{ body: { kind: 'claude_turn', messageId: replyId }, opts: { delaySeconds: WATCHDOG_DELAY_SECONDS } }]);
    expect(reply(db, replyId)).toMatchObject({ status: null, content: FAKE_STREAM_CHUNKS.zh.join('') });
  });
});
