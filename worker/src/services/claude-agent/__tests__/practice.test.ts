/**
 * Practice with Claude — the `practice` context (contexts/practice.ts) and a role-play's replies
 * (thread-turn.ts), against REAL SQLite with every migration and a recording fake model:
 * - the prompt: the static role-play rules cached, the known-words sample, the situation / roles /
 *   level / a card's word in the context block; NO tools; the practice model policy (Sonnet, thinking off);
 * - Claude speaks first (a pending reply with no learner message: the PRACTICE_OPENER turn), the
 *   history alternates and opens with the learner's turn;
 * - the persona's clip is made after the reply in the background (never awaited), in its voice;
 * - a card's role-play: another learner's card is a 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { LESSON_VOICE_IDS } from '@shared/lesson/voices';
import { PRACTICE_VOICE_SPEED, practiceVoiceFor } from '@shared/claude/practice';
import { createSqliteD1, type SqliteD1 } from '../../__tests__/sqlite-d1';
import type { Env } from '../../../types';
import { fakeStreamingClient, FAKE_PRACTICE_CHUNKS } from '../fake';
import { prepareClaudeTurn, MODEL_POLICY, ClaudeContextError } from '../index';
import { PRACTICE_OPENER, practiceSystemBlock, practiceTurns } from '../contexts/practice';
import { PRACTICE_SYSTEM_PROMPT } from '../persona';
import { runThreadTurn } from '../thread-turn';
import * as store from '../store';

const U = 'u1';

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'j@x.test', 'Jerome', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('x1', 'x@x.test', 'Someone', 'student')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c1', 'n1', 'hanzi_to_meaning', 2)");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('dx', 'x1', 'Theirs')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('nx', 'dx', '学生', 'xuésheng', 'student')");
}

type Params = Anthropic.MessageCreateParams;

/** The stand-in model, recording what each round was sent. */
function recordingClient(variant?: 'practice') {
  const seen: Params[] = [];
  const inner = fakeStreamingClient('zh', 0, variant) as unknown as { messages: { create: (p: Params) => unknown; stream: (p: Params) => unknown } };
  const client = {
    messages: {
      create: (p: Params) => (seen.push(JSON.parse(JSON.stringify(p))), inner.messages.create(p)),
      stream: (p: Params) => (seen.push(JSON.parse(JSON.stringify(p))), inner.messages.stream(p)),
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, seen };
}

const sysText = (p: Params) => (p.system as Anthropic.TextBlockParam[]).map((b) => b.text).join('\n\n');

const SCENE = { kind: 'practice' as const, scenario: '在饭店点菜', ai_role: '服务员 (a waiter)', user_role: '客人 (a customer)', level: 'beginner' };

describe('the practice context', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('prompt: static rules cached, the known words, then the situation; no tools; Sonnet with thinking off', async () => {
    const p = await prepareClaudeTurn({ DB: db, ANTHROPIC_API_KEY: 'k' }, SCENE, { userId: U, language: 'zh', turns: [{ role: 'user', content: '你好！' }] }, { client: recordingClient().client });
    expect(p.policy).toBe('practice');
    expect(p.surface).toBe('practice');
    expect(p.maxRounds).toBe(1);
    expect(p.tools).toEqual([]);
    expect(MODEL_POLICY.practice.thinking).toEqual({ type: 'disabled' });
    expect(p.system[0]).toMatchObject({ text: PRACTICE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } });
    expect(p.system[1].text).toContain('银行'); // the known-words sample (a reviewed card)
    expect(p.system[1].cache_control).toEqual({ type: 'ephemeral' });
    const scene = p.system[2].text;
    expect(scene).toContain('Situation: 在饭店点菜');
    expect(scene).toContain('You play: 服务员 (a waiter)');
    expect(scene).toContain('The learner plays: 客人 (a customer)');
    expect(scene).toMatch(/Level: Beginner/);
    expect(p.system[2].cache_control).toBeUndefined();
  });

  it("a card's role-play weaves its word in; another learner's card is a 404", async () => {
    const p = await prepareClaudeTurn({ DB: db, ANTHROPIC_API_KEY: 'k' }, { kind: 'practice', note_id: 'n1', scenario: '用「银行」聊天' }, { userId: U, language: 'zh', turns: [{ role: 'user', content: PRACTICE_OPENER }] }, { client: recordingClient().client });
    expect(sysText(p as unknown as Params)).toContain('The word they are practising: 银行 (yínháng) — bank');
    await expect(prepareClaudeTurn({ DB: db, ANTHROPIC_API_KEY: 'k' }, { kind: 'practice', note_id: 'nx' }, { userId: U, turns: [{ role: 'user', content: 'hi' }] }, { client: recordingClient().client })).rejects.toBeInstanceOf(ClaudeContextError);
    // Defaults: no roles given → a friendly person, the learner as themselves, intermediate.
    expect(practiceSystemBlock({ ctx: { kind: 'practice', scenario: '问路' }, word: null })).toMatch(/You play: a friendly person[\s\S]*The learner plays: themselves[\s\S]*Level: Intermediate/);
  });

  it('turns: the opener when Claude speaks first, the same role merged, failed / pending / empty rows left out', () => {
    expect(practiceTurns([])).toEqual([{ role: 'user', content: PRACTICE_OPENER }]);
    expect(
      practiceTurns([
        { role: 'assistant', content: '欢迎光临！几位？', content_type: 'text', status: null },
        { role: 'user', content: '两位。', content_type: 'text', status: null },
        { role: 'user', content: '有菜单吗？', content_type: 'text', status: null },
        { role: 'assistant', content: '', content_type: 'text', status: 'failed' },
        { role: 'assistant', content: '', content_type: 'text', status: 'pending' },
      ]),
    ).toEqual([
      { role: 'user', content: PRACTICE_OPENER },
      { role: 'assistant', content: '欢迎光临！几位？' },
      { role: 'user', content: '两位。\n\n有菜单吗？' },
    ]);
  });
});

describe('a role-play reply', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  async function newPractice() {
    const ctx = { ...SCENE, voice_id: practiceVoiceFor(SCENE) };
    const { thread } = await store.createThread(db, { userId: U, context: ctx, snapshot: { label: SCENE.scenario }, title: 'Practice: 在饭店点菜', source: 'practice' });
    return { threadId: thread.id, voiceId: ctx.voice_id };
  }

  it('Claude opens the scene, the learner answers, Claude carries on — the clip in the persona voice, never awaited', async () => {
    const { threadId, voiceId } = await newPractice();
    expect(LESSON_VOICE_IDS.has(voiceId)).toBe(true);
    const opener = await store.appendOpener(db, threadId, 'zh');
    const m = recordingClient('practice');
    const clips: Array<{ text: string; voiceId: string; speed: number }> = [];
    const background: Promise<unknown>[] = [];
    const clip = vi.fn(async (_e: Env, text: string, v: { voiceId: string; speed: number }) => (clips.push({ text, ...v }), true));
    const env = { DB: db, ANTHROPIC_API_KEY: 'k' } as unknown as Env;
    const live = { push: async () => undefined, pushIntervalMs: 0, writeIntervalMs: 0 };

    expect(await runThreadTurn(env, opener.id, { client: m.client, live, clip, waitUntil: (p) => void background.push(p), memory: null })).toBe('done');
    const line = FAKE_PRACTICE_CHUNKS.join('');
    expect(db.rows<store.MessageRow>('SELECT * FROM coach_messages WHERE id = ?', [opener.id])[0]).toMatchObject({ status: null, content: line, answer_lang: 'zh' });
    // The model was asked with the opener as the learner's turn, no tools, the practice policy.
    expect(m.seen[0].messages).toEqual([{ role: 'user', content: [{ type: 'text', text: PRACTICE_OPENER, cache_control: { type: 'ephemeral' } }] }]);
    expect(m.seen[0].tools).toBeUndefined();
    expect(m.seen[0].model).toBe(MODEL_POLICY.practice.model);
    expect(m.seen[0].thinking).toEqual({ type: 'disabled' });
    expect(sysText(m.seen[0])).toContain('Situation: 在饭店点菜');
    // The clip was handed to waitUntil, not awaited by the reply.
    expect(background).toHaveLength(1);
    await Promise.all(background);
    expect(clips).toEqual([{ text: line, voiceId, speed: PRACTICE_VOICE_SPEED }]);

    // The learner answers: the history alternates, opening with the opener turn.
    const turn = await store.appendTurn(db, { threadId, role: 'user', content: '两位，谢谢。', intent: 'ask' }, { contentType: 'text', answerLang: 'zh' });
    expect(await runThreadTurn(env, turn.reply!.id, { client: m.client, live, clip, waitUntil: (p) => void background.push(p), memory: null })).toBe('done');
    const second = m.seen[1].messages.map((x) => [x.role, typeof x.content === 'string' ? x.content : (x.content as Array<{ text: string }>).map((b) => b.text).join('')]);
    expect(second).toEqual([
      ['user', PRACTICE_OPENER],
      ['assistant', line],
      ['user', '两位，谢谢。'],
    ]);
  });

  it('a help request answered in English is stored as English (no clip); an old copied practice chat stays read-only', async () => {
    const { threadId } = await newPractice();
    const turn = await store.appendTurn(db, { threadId, role: 'user', content: '💡 Give me a hint: what could I say next?', intent: 'ask' }, { contentType: 'text', answerLang: 'en' });
    const clip = vi.fn(async () => true);
    const env = { DB: db, ANTHROPIC_API_KEY: 'k' } as unknown as Env;
    const out = await runThreadTurn(env, turn.reply!.id, { client: fakeStreamingClient('en', 0), live: { push: async () => undefined, pushIntervalMs: 0, writeIntervalMs: 0 }, clip, memory: null });
    expect(out).toBe('done');
    expect(db.rows<store.MessageRow>('SELECT answer_lang FROM coach_messages WHERE id = ?', [turn.reply!.id])[0].answer_lang).toBe('en');
    expect(clip).not.toHaveBeenCalled();

    // An old practice chat copied in (its conversation, read-only): its reply fails with the readable reason.
    const { thread } = await store.createThread(db, { id: 'pc-old', userId: U, context: { kind: 'practice', conversation_id: 'old' }, title: 'Old', source: 'practice', readOnly: true });
    const old = await store.appendTurn(db, { threadId: thread.id, role: 'user', content: '你好', intent: 'ask' }, { contentType: 'text', answerLang: 'zh' });
    expect(await runThreadTurn(env, old.reply!.id, { client: fakeStreamingClient('zh', 0), live: { push: async () => undefined, pushIntervalMs: 0, writeIntervalMs: 0 }, clip, memory: null })).toBe('failed');
    expect(db.rows<store.MessageRow>('SELECT error FROM coach_messages WHERE id = ?', [old.reply!.id])[0].error).toMatch(/can’t continue/);
  });
});
