/**
 * Chat replies (services/chat-turn.ts): Ask Claude, Coach follow-ups and Discuss with Claude
 * run on SONNET_MODEL with thinking off and prompt caching (at most 4 breakpoints in any round
 * of the tool loop), the known-words sample is deterministic per user and day, and the
 * usage capture prices cache reads / writes.
 */
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { cachedSystem, cachedTools, chatTurnParams, ChatTurnMeter, withCachedTail, CHAT_TOOL_RULE } from '../chat-turn';
import { SONNET_MODEL, modelTier } from '../models';
import { coachChatWithTools, discussMessage, knownWordsSeed, sampleKnownWords } from '../ai';
import { estimateCost, parseAiUsage } from '../analytics/ai-usage';
import { createSqliteD1 } from './sqlite-d1';

type Params = Anthropic.MessageCreateParamsNonStreaming;

/** Counts cache breakpoints anywhere in a request. */
function breakpoints(p: Params): number {
  let n = 0;
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'cache_control' && x) n++;
        else visit(x);
      }
    }
  };
  visit(p.tools);
  visit(p.system);
  visit(p.messages);
  return n;
}

/** A fake model: one search_cards round, then text. Copies each request (the loop keeps going). */
function fakeClient(toolName = 'search_cards') {
  const seen: Params[] = [];
  let turn = 0;
  const create = vi.fn(async (p: Params) => {
    seen.push(JSON.parse(JSON.stringify(p)));
    turn++;
    if (turn === 1) {
      return { model: SONNET_MODEL, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: toolName, input: { query: '银行' } }], usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 3000, cache_read_input_tokens: 0 } };
    }
    return { model: SONNET_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: '好的。' }], usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 3100 } };
  });
  return { client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, seen };
}

describe('chat turn request shape', () => {
  it('chatTurnParams: SONNET_MODEL, thinking disabled, no effort, the tail cached without touching the caller', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];
    const p = chatTurnParams({ system: cachedSystem('rules'), tools: cachedTools([{ name: 'x', input_schema: { type: 'object' } }]), messages });
    expect(p.model).toBe(SONNET_MODEL);
    expect(p.thinking).toEqual({ type: 'disabled' });
    expect((p as unknown as { output_config?: unknown }).output_config).toBeUndefined();
    expect(p.messages.at(-1)!.content).toEqual([{ type: 'text', text: 'c', cache_control: { type: 'ephemeral' } }]);
    expect(messages[2].content).toBe('c');
    expect(breakpoints(p)).toBe(3);
  });

  it('withCachedTail marks a tool_result tail, never more than one message', () => {
    const msgs: Anthropic.MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }] },
    ];
    const out = withCachedTail(msgs);
    expect((out[2].content as Array<{ cache_control?: unknown }>)[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((out[0].content as Array<{ cache_control?: unknown }>)[0].cache_control).toBeUndefined();
    expect((msgs[2].content as Array<{ cache_control?: unknown }>)[0].cache_control).toBeUndefined();
  });

  it('cachedSystem keeps at most two blocks and drops empty ones', () => {
    expect(cachedSystem('a', '')).toHaveLength(1);
    expect(() => cachedSystem('a', 'b', 'c')).toThrow();
  });

  it('model tiers carry no ids', () => {
    expect(modelTier(SONNET_MODEL)).toBe('sonnet');
    expect(modelTier('claude-opus-5-5')).toBe('opus');
    expect(modelTier('claude-haiku-4-5')).toBe('haiku');
  });

  it('ChatTurnMeter sums the rounds (input = uncached + cache writes)', () => {
    const m = new ChatTurnMeter('coach', 'u1');
    m.add({ model: SONNET_MODEL, usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 3000, cache_read_input_tokens: 0 } as Anthropic.Usage });
    m.add({ model: SONNET_MODEL, usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 3100 } as Anthropic.Usage });
    const p = m.props();
    expect(p).toMatchObject({ surface: 'coach', model_tier: 'sonnet', rounds: 2, input_tokens: 3150, output_tokens: 30, cache_read_tokens: 3100, cache_write_tokens: 3000 });
    expect(typeof p.total_ms).toBe('number');
  });
});

describe('Coach follow-ups and Discuss with Claude', () => {
  it('coach: SONNET_MODEL, thinking off, cached tools + system, ≤ 4 breakpoints in every round', async () => {
    const db = await createSqliteD1();
    const { client, seen } = fakeClient();
    const r = await coachChatWithTools('k', [{ role: 'user', content: '为什么用了？' }], { db, userId: 'u1' }, { client });
    expect(r.answer).toBe('好的。');
    expect(seen).toHaveLength(2);
    for (const p of seen) {
      expect(p.model).toBe(SONNET_MODEL);
      expect(p.thinking).toEqual({ type: 'disabled' });
      expect(breakpoints(p)).toBeLessThanOrEqual(4);
      expect((p.tools as Array<{ cache_control?: unknown }>).at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
      const system = p.system as Anthropic.TextBlockParam[];
      expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(system[0].text).toContain(CHAT_TOOL_RULE);
    }
    // Round 2's tail is the tool result (cached); round 1's question has lost its breakpoint.
    const r2 = seen[1].messages;
    expect((r2.at(-1)!.content as Array<{ type: string; cache_control?: unknown }>).at(-1)).toMatchObject({ type: 'tool_result', cache_control: { type: 'ephemeral' } });
    expect(typeof r2[0].content).toBe('string');
  });

  it('discuss: the same request shape; create_flashcards still comes back for review', async () => {
    const db = await createSqliteD1();
    const { client, seen } = fakeClient('create_flashcards');
    const create = (client.messages.create as unknown as ReturnType<typeof vi.fn>);
    create.mockImplementationOnce(async (p: Params) => {
      seen.push(JSON.parse(JSON.stringify(p)));
      return { model: SONNET_MODEL, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'create_flashcards', input: { flashcards: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank', fun_facts: '银 silver; 行 business.' }] } }], usage: { input_tokens: 10, output_tokens: 5 } };
    });
    const r = await discussMessage('k', '我去银行。', 'What is 银行?', '', undefined, { db, userId: 'u1' }, { client });
    expect(r.flashcards).toHaveLength(1);
    for (const p of seen) {
      expect(p.model).toBe(SONNET_MODEL);
      expect(p.thinking).toEqual({ type: 'disabled' });
      expect(breakpoints(p)).toBeLessThanOrEqual(4);
    }
  });
});

describe('known-words sample', () => {
  it('is the same all day for one learner and changes with the day', async () => {
    expect(knownWordsSeed('u1', '2026-11-03')).toBe(knownWordsSeed('u1', '2026-11-03'));
    expect(knownWordsSeed('u1', '2026-11-03')).not.toBe(knownWordsSeed('u1', '2026-11-04'));
    expect(knownWordsSeed('u1', '2026-11-03')).not.toBe(knownWordsSeed('u2', '2026-11-03'));

    const db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'a@x.test', 'J', 'student')");
    db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'D')");
    for (let i = 0; i < 40; i++) {
      db.raw.run('INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', [`n${i}`, 'd1', `词${i}`, 'cí', 'word']);
      db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES (?, ?, 'hanzi_to_meaning', 2)", [`c${i}`, `n${i}`]);
    }
    const a = await sampleKnownWords(db, 'u1', 10);
    const b = await sampleKnownWords(db, 'u1', 10);
    expect(a).toHaveLength(10);
    expect(b).toEqual(a);
  });
});

describe('usage capture prices the prompt cache', () => {
  it('cache writes at 1.25× input, reads at 0.1×', () => {
    const u = parseAiUsage('anthropic', '', { model: SONNET_MODEL, usage: { input_tokens: 1000, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 } }, 200)!;
    expect(u).toMatchObject({ input_tokens: 1_001_000, cache_write_tokens: 1_000_000, cache_read_tokens: 1_000_000 });
    // $2 / M input: 1,000 uncached ($0.002) + 1 M written ($2.50) + 1 M read ($0.20).
    expect(u.cost_usd).toBeCloseTo(2.702, 6);
    expect(estimateCost(SONNET_MODEL, 1_000_000, 0)).toBe(2);
  });
});
