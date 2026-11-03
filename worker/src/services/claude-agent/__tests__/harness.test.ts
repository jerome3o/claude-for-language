/**
 * The Claude agent harness (services/claude-agent) with a fake model and real SQLite (every migration):
 * the tool loop (read tools run, write tools collected, a lesson validated inline, tools a context
 * doesn't offer never run), the round cap, the round hook + checkpointed actions, cache breakpoints
 * (≤ 4 in every round of every context), each context's prompt carrying its context, the per-context
 * tool allow-list, the chat_message access check, and the runtime seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1, type SqliteD1 } from '../../__tests__/sqlite-d1';
import { SONNET_MODEL } from '../../models';
import {
  applyCheckpointed,
  bindTools,
  ClaudeContextError,
  CONTEXT_KINDS,
  CONTEXT_PROVIDERS,
  prepareClaudeTurn,
  runClaudeTurn,
  TOOL_REGISTRY,
  toolAllowed,
  type AgentRuntime,
  type ClaudeContext,
  type ContextKind,
  type TurnInput,
} from '..';
import { CARD_TOOLS } from '../contexts/card';
import { COACH_TOOLS } from '../contexts/coach';
import { CHAT_MESSAGE_TOOLS } from '../contexts/chat_message';
import { GENERAL_TOOLS } from '../contexts/general';
import { READER_TOOLS, readerWindow } from '../contexts/reader';
import { EXERCISE_TOOLS, exerciseAt, exerciseJson } from '../contexts/exercise';
import { seedReaderAndLesson } from './context-seed';

type Params = Anthropic.MessageCreateParamsNonStreaming;
type Reply = { model: string; stop_reason: string; content: unknown[]; usage: Record<string, number> };

const USER = 'u1';
const text = (t: string): Reply => ({ model: SONNET_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: { input_tokens: 5, output_tokens: 5 } });
const toolUse = (...calls: Array<[name: string, input: unknown]>): Reply => ({
  model: SONNET_MODEL,
  stop_reason: 'tool_use',
  content: [{ type: 'text', text: 'Let me look.' }, ...calls.map(([name, input], i) => ({ type: 'tool_use', id: `t${i}-${name}`, name, input }))],
  usage: { input_tokens: 5, output_tokens: 5 },
});

/** A fake model replaying `script` (the last reply repeats); every request deep-copied. */
function fakeModel(script: Reply[]) {
  const seen: Params[] = [];
  let i = 0;
  const create = vi.fn(async (p: Params) => {
    seen.push(JSON.parse(JSON.stringify(p)));
    return script[Math.min(i++, script.length - 1)];
  });
  return { client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, seen, create };
}

/** Cache breakpoints anywhere in a request. */
function breakpoints(p: Params): number {
  let n = 0;
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === 'cache_control' && x ? n++ : visit(x));
  };
  visit(p.tools);
  visit(p.system);
  visit(p.messages);
  return n;
}

const sysText = (p: Params) => (p.system as Anthropic.TextBlockParam[]).map((b) => b.text).join('\n\n');
const msgText = (c: unknown) => (typeof c === 'string' ? c : (c as Array<{ text?: string }>).map((b) => b.text ?? '').join(''));

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role, bio) VALUES ('u1', 'a@x.test', 'Jerome', 'student', 'Likes trains')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('t1', 't@x.test', 'Minghui', 'tutor')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('x1', 'x@x.test', 'Stranger', 'student')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
  db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c1', 'n1', 'hanzi_to_meaning', 2)");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r1', 't1', 'u1', 'tutor', 'active')");
  db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('cv1', 'r1')");
  db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content) VALUES ('m1', 'cv1', 't1', '你去过银行吗？')");
  seedReaderAndLesson(db);
}

const CONTEXTS: Record<ContextKind, { ctx: ClaudeContext; input: TurnInput }> = {
  general: { ctx: { kind: 'general' }, input: { userId: USER, language: 'zh', turns: [{ role: 'user', content: '成都有什么好吃的？' }] } },
  card: { ctx: { kind: 'card', note_id: 'n1' }, input: { userId: USER, language: 'zh', turns: [{ role: 'user', content: '这个词怎么用？' }] } },
  coach: {
    ctx: { kind: 'coach' },
    input: { userId: USER, turns: [{ role: 'user', content: 'The user submitted this sentence to the Sentence Coach: "我去银行。"' }, { role: 'assistant', content: 'analysis' }, { role: 'user', content: 'Why 去?' }] },
  },
  chat_message: { ctx: { kind: 'chat_message', message_id: 'm1' }, input: { userId: USER, turns: [{ role: 'user', content: 'What does it mean?' }] } },
  reader: {
    ctx: { kind: 'reader', reader_id: 'rd1', page_id: 'pg2', looked_up: ['熊猫'], said_wrong: ['可爱'] },
    input: { userId: USER, language: 'zh', turns: [{ role: 'user', content: '这页讲什么？' }] },
  },
  exercise: {
    ctx: { kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e1', answer: { text: '我放书在桌子上。', verdict: 'almost', corrected: '我把书放在桌子上。', tips: ['Use 把 to move the object before the verb'] } },
    input: { userId: USER, language: 'en', turns: [{ role: 'user', content: 'Why is my answer wrong?' }] },
  },
  practice: {
    ctx: { kind: 'practice', scenario: '在饭店点菜', ai_role: '服务员', user_role: '客人', level: 'beginner' },
    input: { userId: USER, language: 'zh', turns: [{ role: 'user', content: '你好，我想点菜。' }] },
  },
};

describe('Claude agent harness', () => {
  let db: SqliteD1;
  let env: { DB: D1Database; ANTHROPIC_API_KEY: string };
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    env = { DB: db, ANTHROPIC_API_KEY: 'k' };
  });

  describe('the tool loop', () => {
    it('runs read tools, collects write tools, validates a lesson inline, refuses tools the context does not offer', async () => {
      const { client, seen } = fakeModel([
        toolUse(
          ['search_cards', { query: '银' }],
          ['create_flashcards', { flashcards: [{ hanzi: '火车', pinyin: 'huǒchē', english: 'train', fun_facts: '火 fire + 车 vehicle.' }] }],
          ['create_custom_lesson', { title: 'not a lesson' }],
          ['list_student_decks', {}],
        ),
        text('好的。'),
      ]);
      const r = await runClaudeTurn(env, CONTEXTS.card.ctx, CONTEXTS.card.input, { client });
      expect(r.answer).toBe('Let me look.\n好的。');
      expect(r.rounds).toBe(2);
      expect(r.readOnlyToolCalls.map((c) => c.tool)).toEqual(['search_cards']);
      expect((r.readOnlyToolCalls[0].result as { count: number }).count).toBe(1);
      expect(r.toolActions.map((a) => a.tool)).toEqual(['create_flashcards']);

      const results = seen[1].messages.at(-1)!.content as Array<{ tool_use_id: string; is_error?: boolean; content: string }>;
      const byTool = (name: string) => results.find((x) => x.tool_use_id.endsWith(name))!;
      expect(JSON.parse(byTool('search_cards').content).count).toBe(1);
      expect(JSON.parse(byTool('create_flashcards').content).message).toBe('Tool create_flashcards will be executed after user approval');
      expect(byTool('create_custom_lesson').is_error).toBe(true);
      expect(JSON.parse(byTool('create_custom_lesson').content).problems.length).toBeGreaterThan(0);
      // Not a card tool: never run, never collected.
      expect(byTool('list_student_decks')).toMatchObject({ is_error: true });
    });

    it('streams when asked (TurnOptions.stream): the whole answer so far across rounds, the read tool named; the same answer as unstreamed', async () => {
      const script = [toolUse(['search_cards', { query: '银' }]), text('好的。')];
      let i = 0;
      const streamed: Params[] = [];
      // A fake streaming API: each text block arrives as two deltas, the snapshot growing.
      const stream = vi.fn((p: Params) => {
        streamed.push(JSON.parse(JSON.stringify(p)));
        const reply = script[Math.min(i++, script.length - 1)];
        const listeners: Array<(e: unknown, s: unknown) => void> = [];
        return {
          on(ev: string, fn: (e: unknown, s: unknown) => void) {
            if (ev === 'streamEvent') listeners.push(fn);
            return this;
          },
          async finalMessage() {
            const snapshot = { ...reply, content: [] as Array<Record<string, unknown>> };
            for (const block of reply.content as Array<Record<string, unknown>>) {
              if (block.type !== 'text') {
                snapshot.content.push(block);
                continue;
              }
              const t = String(block.text);
              const live = { type: 'text', text: '' };
              snapshot.content.push(live);
              for (const part of [t.slice(0, 1), t.slice(1)]) {
                live.text += part;
                for (const l of listeners) l({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } }, snapshot);
              }
            }
            return reply;
          },
        };
      });
      const client = { messages: { create: vi.fn(), stream } } as unknown as Pick<Anthropic, 'messages'>;
      const texts: string[] = [];
      const tools: string[] = [];
      const r = await runClaudeTurn(env, CONTEXTS.card.ctx, CONTEXTS.card.input, { client, stream: { onText: (t) => texts.push(t), onTool: (t) => tools.push(t) } });
      expect(r.answer).toBe('Let me look.\n好的。');
      expect(texts.at(-1)).toBe(r.answer);
      expect(texts).toContain('L');
      expect(texts).toContain('Let me look.\n好');
      expect(tools).toEqual(['search_cards']);
      expect(stream).toHaveBeenCalledTimes(2);
      expect((client.messages.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
      // The request is the same as an unstreamed one (cache breakpoints included).
      expect(breakpoints(streamed[1])).toBeLessThanOrEqual(4);
      expect(streamed[0].thinking).toEqual({ type: 'disabled' });
    });

    it('get_deck_info reads the current deck with its note and card counts (cards counted through their notes)', async () => {
      const { client } = fakeModel([toolUse(['get_deck_info', {}]), text('好的。')]);
      const r = await runClaudeTurn(env, CONTEXTS.card.ctx, CONTEXTS.card.input, { client });
      expect(r.readOnlyToolCalls[0]).toMatchObject({ tool: 'get_deck_info', result: { deck: { id: 'd1', name: 'HSK 2', note_count: 1, card_count: 1 } } });
    });

    it('stops at the round cap, even when the model keeps asking for tools', async () => {
      const { client, create } = fakeModel([toolUse(['search_cards', { query: '银' }])]);
      const r = await runClaudeTurn(env, CONTEXTS.card.ctx, CONTEXTS.card.input, { client });
      expect(create).toHaveBeenCalledTimes(CONTEXT_PROVIDERS.card.maxRounds);
      expect(r.rounds).toBe(5);
      expect(r.readOnlyToolCalls).toHaveLength(5);
    });

    it('general = only the memory look-ups as tools; an empty answer is a retryable failure', async () => {
      const { client, create } = fakeModel([text('   ')]);
      await expect(runClaudeTurn(env, CONTEXTS.general.ctx, CONTEXTS.general.input, { client })).rejects.toMatchObject({ retryable: true });
      expect(create).toHaveBeenCalledTimes(1);
      expect(((create.mock.calls[0][0] as Params).tools ?? []).map((t) => (t as { name: string }).name)).toEqual(['search_my_chats', 'read_chat']);
    });

    it('the round hook sees every round; applyCheckpointed resumes after the last applied action', async () => {
      const rounds: number[] = [];
      const { client } = fakeModel([toolUse(['bump_cards', { hanzi: ['银行'] }]), text('⚡')]);
      await runClaudeTurn(env, CONTEXTS.coach.ctx, CONTEXTS.coach.input, { client, onRound: (s) => void rounds.push(s.round) });
      expect(rounds).toEqual([1, 2]);

      const applied: string[] = [];
      const saves: number[] = [];
      const cp = { answer: 'a', actions: ['x', 'y', 'z'], applied: 1, results: ['X'] };
      await applyCheckpointed(cp, async (a) => (applied.push(a), a.toUpperCase()), async (next) => void saves.push(next.applied));
      expect(applied).toEqual(['y', 'z']);
      expect(saves).toEqual([2, 3]);
      expect(cp.results).toEqual(['X', 'Y', 'Z']);
    });

    it('the runtime seam: a custom runtime gets the prepared turn and its answer is finished by the context', async () => {
      const runtime: AgentRuntime = { runTurn: vi.fn(async () => ({ text: '**银行**', toolActions: [], readOnlyToolCalls: [], rounds: 1 })) };
      const r = await runClaudeTurn(env, CONTEXTS.card.ctx, CONTEXTS.card.input, { client: fakeModel([]).client, runtime });
      const prepared = vi.mocked(runtime.runTurn).mock.calls[0][0];
      expect(prepared.surface).toBe('ask');
      expect(prepared.tools.map((t) => t.name)).toEqual(CARD_TOOLS);
      // A Chinese card answer is stored as plain text.
      expect(r.answer).toBe('银行');
    });
  });

  describe('every context', () => {
    it.each(CONTEXT_KINDS)('%s: SONNET_MODEL, thinking off, ≤ 4 cache breakpoints in every round, tools + static system cached', async (kind) => {
      const { ctx, input } = CONTEXTS[kind];
      const tools = CONTEXT_PROVIDERS[kind].tools({} as never);
      const { client, seen } = fakeModel(tools.length ? [toolUse(['search_cards', { query: '银' }]), text('ok')] : [text('ok')]);
      await runClaudeTurn(env, ctx, input, { client });
      expect(seen.length).toBe(tools.length ? 2 : 1);
      for (const p of seen) {
        expect(p.model).toBe(SONNET_MODEL);
        expect(p.thinking).toEqual({ type: 'disabled' });
        expect(breakpoints(p)).toBeLessThanOrEqual(4);
        const system = p.system as Anthropic.TextBlockParam[];
        expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
        if (tools.length) {
          expect((p.tools as Array<{ cache_control?: unknown }>).at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
          expect((p.tools as Array<{ cache_control?: unknown }>).slice(0, -1).every((t) => !t.cache_control)).toBe(true);
        }
        // Exactly one message carries the tail breakpoint: the last.
        const marked = p.messages.filter((m) => Array.isArray(m.content) && (m.content as Array<{ cache_control?: unknown }>).some((b) => b.cache_control));
        expect(marked).toEqual([p.messages.at(-1)]);
      }
    });

    it('each prompt carries its own context', async () => {
      const prompts: Record<string, { system: string; first: string }> = {};
      for (const kind of CONTEXT_KINDS) {
        const p = await prepareClaudeTurn(env, CONTEXTS[kind].ctx, CONTEXTS[kind].input, { client: fakeModel([]).client });
        prompts[kind] = { system: p.system.map((b) => b.text).join('\n\n'), first: msgText(p.messages[0].content) };
      }
      // card: the card's facts + its deck in the first message; known words in the learner block.
      expect(prompts.card.first).toContain('The user is studying this vocabulary:\n- Chinese: 银行');
      expect(prompts.card.first).toContain('- Deck: HSK 2');
      expect(prompts.card.first).toContain('- Learner bio: Likes trains');
      expect(prompts.card.first.endsWith("User's question: 这个词怎么用？")).toBe(true);
      expect(prompts.card.system).toContain('answer ENTIRELY in simple Chinese');
      expect(prompts.card.system).toContain('Words the learner already knows');
      // general: the chat's persona + the known words.
      expect(prompts.general.system).toContain('"Ask Claude" chat');
      expect(prompts.general.system).toContain('银行');
      // coach: the Sentence Coach persona; the sentence rides in the history.
      expect(prompts.coach.system).toContain("flashcard app's Sentence Coach");
      expect(prompts.coach.first).toContain('我去银行。');
      // chat_message: the discussed message and the chat around it.
      expect(prompts.chat_message.system).toContain('looking at a specific message');
      expect(prompts.chat_message.first).toContain('"你去过银行吗？"');
      expect(prompts.chat_message.first).toContain('Minghui: 你去过银行吗？');
      // reader: the story, the page in full, the window around it, the looked-up words, the decks — in the context block.
      expect(prompts.reader.system).toContain('graded reader');
      expect(prompts.reader.system).toContain('《成都》 (Chengdu) — level: elementary, topic: travel');
      expect(prompts.reader.system).toContain('The page they asked on (page 2 of 3):\n- Chinese: 成都的熊猫很可爱。');
      expect(prompts.reader.system).toContain('- Page 1: 小明去成都。');
      expect(prompts.reader.system).toContain('- Page 3: 他吃了很辣的火锅。');
      expect(prompts.reader.system).toContain('Words they tapped to look up on this page: 熊猫');
      expect(prompts.reader.system).toContain('Words they read aloud wrong on this page: 可爱');
      expect(prompts.reader.system).toContain('HSK 2 (id: d1)');
      expect(prompts.reader.system).toContain('answer ENTIRELY in simple Chinese');
      expect(prompts.reader.first).toBe('这页讲什么？');
      // exercise: the lesson, the exercise with its answer key, his answer and its check.
      expect(prompts.exercise.system).toContain('mini lesson "把字句" (section: Practice)');
      expect(prompts.exercise.system).toContain('Translate (type translate)');
      expect(prompts.exercise.system).toContain('"reference_hanzi":"我把书放在桌子上。"');
      expect(prompts.exercise.system).toContain('Their answer: 我放书在桌子上。');
      expect(prompts.exercise.system).toContain("The app's check of it: almost");
      expect(prompts.exercise.system).toContain('- Tip: Use 把 to move the object before the verb');
      expect(prompts.exercise.system).toContain('Answer in clear, friendly English');
    });

    it('reader / exercise: the context block comes after the two cached blocks, uncached; the static block is the same for every page / exercise', async () => {
      const a = await prepareClaudeTurn(env, CONTEXTS.reader.ctx, CONTEXTS.reader.input, { client: fakeModel([]).client });
      const b = await prepareClaudeTurn(env, { kind: 'reader', reader_id: 'rd1', page_id: 'pg3' }, CONTEXTS.reader.input, { client: fakeModel([]).client });
      expect(a.system).toHaveLength(3);
      expect(a.system[2].cache_control).toBeUndefined();
      expect(b.system[0].text).toBe(a.system[0].text);
      expect(b.system[2].text).toContain('page 3 of 3');
      expect(JSON.stringify(a.tools.map((t) => t.schema))).toBe(JSON.stringify(b.tools.map((t) => t.schema)));
      // No page id: the first page.
      const first = await prepareClaudeTurn(env, { kind: 'reader', reader_id: 'rd1' }, CONTEXTS.reader.input, { client: fakeModel([]).client });
      expect(first.system[2].text).toContain('page 1 of 3');
      // create_flashcards as the Coach words it: a deck from the list.
      expect(a.tools.find((t) => t.name === 'create_flashcards')!.schema.input_schema).toMatchObject({ required: ['deck_id', 'flashcards'] });
      const e = await prepareClaudeTurn(env, { kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e0' }, CONTEXTS.exercise.input, { client: fakeModel([]).client });
      expect(e.system.at(-1)!.text).toContain('Note (type note)');
      expect(e.system.at(-1)!.text).toContain('They have not answered it yet');
    });

    it('the reader window: nearest pages first within the budget, in story order; the exercise JSON drops media fields', () => {
      const pages = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, page_number: i + 1, content_chinese: '字'.repeat(300), content_pinyin: '', content_english: 'w'.repeat(300) }));
      const lines = readerWindow(pages, 4, { chars: 900 });
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(4);
      expect(lines.join('').length).toBeLessThanOrEqual(900);
      expect(lines.some((l) => l.startsWith('Page 4:')) && lines.some((l) => l.startsWith('Page 6:'))).toBe(true);
      expect(lines.map((l) => Number(/^Page (\d+)/.exec(l)![1]))).toEqual([...lines.map((l) => Number(/^Page (\d+)/.exec(l)![1]))].sort((a, b) => a - b));
      expect(readerWindow(pages, 0).every((l) => !l.startsWith('Page 1:'))).toBe(true);
      expect(exerciseJson({ type: 'describe_image', image_url: 'lesson-images/x.png', task: '说说' })).toBe('{"type":"describe_image","task":"说说"}');
      expect(exerciseAt('{bad', 's0e0')).toBeNull();
      expect(exerciseAt({ sections: [{ exercises: [{ type: 'note' }] }] }, 's0e1')).toBeNull();
      expect(exerciseAt({ sections: [{ exercises: [{ type: 'note' }] }] }, 's0e0')).toMatchObject({ exercise: { type: 'note' } });
    });

    it('the typed answer of a card rides in the first message', async () => {
      const p = await prepareClaudeTurn(env, { kind: 'card', note_id: 'n1', typed: { answer: '银航' } }, CONTEXTS.card.input, { client: fakeModel([]).client });
      expect(msgText(p.messages[0].content)).toContain("User's answer: 银航\nCorrect answer: 银行");
    });
  });

  describe('the tool registry', () => {
    it('every context lists only tools the registry allows it, in a stable order', () => {
      const lists: Record<ContextKind, readonly string[]> = { card: CARD_TOOLS, coach: COACH_TOOLS, chat_message: CHAT_MESSAGE_TOOLS, general: GENERAL_TOOLS, practice: [], reader: READER_TOOLS, exercise: EXERCISE_TOOLS };
      for (const kind of CONTEXT_KINDS) {
        expect(CONTEXT_PROVIDERS[kind].tools({} as never)).toEqual(lists[kind]);
        for (const name of lists[kind]) expect(toolAllowed(kind, name)).toBe(true);
      }
      // The write tools on the current card exist on a card only.
      expect(toolAllowed('coach', 'edit_current_card')).toBe(false);
      expect(toolAllowed('chat_message', 'delete_current_card')).toBe(false);
      expect(toolAllowed('general', 'search_cards')).toBe(false);
      // A reader page / an exercise: read-only look-ups + create_flashcards + bump_cards — nothing on a card, no lessons.
      for (const kind of ['reader', 'exercise'] as const) {
        for (const name of ['edit_current_card', 'delete_current_card', 'create_custom_lesson', 'get_overall_stats', 'list_student_decks']) expect(toolAllowed(kind, name)).toBe(false);
      }
      // Claude memory's look-ups: every context with tools (a role-play has none — one round, in character).
      for (const kind of CONTEXT_KINDS.filter((k) => k !== 'practice')) for (const name of ['search_my_chats', 'read_chat']) expect(toolAllowed(kind, name)).toBe(true);
      expect(toolAllowed('practice', 'search_cards')).toBe(false);
      expect(() => bindTools('coach', ['edit_current_card'], { db, userId: USER, deckId: '', bumpSource: 'x', context: 'coach' })).toThrow(/not allowed/);
    });

    it('each tool is declared once, with a known kind and at least one context', () => {
      for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
        expect(['read', 'write', 'lesson']).toContain(entry.kind);
        expect(entry.contexts.length).toBeGreaterThan(0);
        expect(entry.schema.name).toBe(name);
        for (const w of Object.values(entry.wording ?? {})) expect(w!.name).toBe(name);
      }
    });

    it('the prefix is the same for every card: no card text in the tools or the static system block', async () => {
      db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n2', 'd1', '火车', 'huǒchē', 'train')");
      const a = await prepareClaudeTurn(env, { kind: 'card', note_id: 'n1' }, CONTEXTS.card.input, { client: fakeModel([]).client });
      const b = await prepareClaudeTurn(env, { kind: 'card', note_id: 'n2' }, CONTEXTS.card.input, { client: fakeModel([]).client });
      expect(JSON.stringify(b.tools.map((t) => t.schema))).toBe(JSON.stringify(a.tools.map((t) => t.schema)));
      expect(b.system[0].text).toBe(a.system[0].text);
      expect(JSON.stringify(a.tools.map((t) => t.schema))).not.toContain('银行');
    });
  });

  describe('context access', () => {
    it('card: a note that is not mine is a 404', async () => {
      db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('dx', 'x1', 'Theirs')");
      db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('nx', 'dx', '秘密', 'mìmì', 'secret')");
      await expect(runClaudeTurn(env, { kind: 'card', note_id: 'nx' }, CONTEXTS.card.input, { client: fakeModel([text('x')]).client })).rejects.toMatchObject({ status: 404 });
    });

    it('chat_message: missing message 404, a chat I am not in 403, an inactive relationship 403', async () => {
      const client = fakeModel([text('x')]).client;
      const run = (userId: string, id: string) => runClaudeTurn(env, { kind: 'chat_message', message_id: id }, { ...CONTEXTS.chat_message.input, userId }, { client });
      await expect(run(USER, 'nope')).rejects.toBeInstanceOf(ClaudeContextError);
      await expect(run(USER, 'nope')).rejects.toMatchObject({ status: 404, message: 'Message not found' });
      await expect(run('x1', 'm1')).rejects.toMatchObject({ status: 403, message: 'Access denied' });
      db.raw.run("UPDATE tutor_relationships SET status = 'removed' WHERE id = 'r1'");
      await expect(run(USER, 'm1')).rejects.toMatchObject({ status: 403 });
    });

    it('reader: missing 404, someone else’s 403, a page of another reader 404', async () => {
      const client = fakeModel([text('x')]).client;
      const run = (ctx: ClaudeContext) => runClaudeTurn(env, ctx, CONTEXTS.reader.input, { client });
      await expect(run({ kind: 'reader', reader_id: 'nope' })).rejects.toMatchObject({ status: 404, message: 'Reader not found' });
      await expect(run({ kind: 'reader', reader_id: 'rdx' })).rejects.toMatchObject({ status: 403 });
      await expect(run({ kind: 'reader', reader_id: 'rd1', page_id: 'elsewhere' })).rejects.toMatchObject({ status: 404 });
    });

    it('exercise: missing lesson 404, someone else’s 403, a key past the end 404', async () => {
      const client = fakeModel([text('x')]).client;
      const run = (ctx: ClaudeContext) => runClaudeTurn(env, ctx, CONTEXTS.exercise.input, { client });
      await expect(run({ kind: 'exercise', lesson_id: 'nope', exercise_key: 's0e0' })).rejects.toMatchObject({ status: 404 });
      await expect(run({ kind: 'exercise', lesson_id: 'lsx', exercise_key: 's0e0' })).rejects.toMatchObject({ status: 403 });
      await expect(run({ kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e9' })).rejects.toMatchObject({ status: 404, message: 'Exercise not found' });
    });
  });
});
