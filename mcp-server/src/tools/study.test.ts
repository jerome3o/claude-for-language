import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { computeCardState, getIntervalPreviews, DEFAULT_DECK_SETTINGS, type ReviewEvent } from '../../../shared/scheduler';
import { registerStudyTools, previewsFor, audioUrl, FAMILIARITY_REFUSAL } from './study';
import type { ToolContext } from './context';
import type { ApiClient } from '../api';
import { ApiError } from '../api';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

/** A D1 stand-in that answers by SQL text and records every statement it saw. */
function fakeDb(answer: (sql: string, params: unknown[]) => unknown) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      let params: unknown[] = [];
      const stmt = {
        bind(...p: unknown[]) { params = p; return stmt; },
        async first() { return answer(sql, params) ?? null; },
        async all() { return { results: (answer(sql, params) as unknown[]) ?? [] }; },
        async run() { throw new Error(`write attempted: ${sql}`); },
      };
      return stmt;
    },
  };
  return { db, statements };
}

const EVENTS: ReviewEvent[] = [
  { id: 'e1', card_id: 'c1', rating: 2, reviewed_at: '2026-11-01T09:00:00.000Z' },
  { id: 'e2', card_id: 'c1', rating: 2, reviewed_at: '2026-11-01T09:12:00.000Z' },
  { id: 'e3', card_id: 'c1', rating: 2, reviewed_at: '2026-11-03T09:00:00.000Z' },
];

function setup(opts: { orphan?: boolean; forgetStatus?: number } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    post: async (path: string, body: { events?: Array<{ id: string }>; note_ids?: string[] }) => {
      calls.push({ method: 'POST', path, body });
      if (path === '/api/reviews') {
        const id = body.events![0].id;
        return { created: opts.orphan ? 0 : 1, skipped: 0, orphan_event_ids: opts.orphan ? [id] : [] };
      }
      if (path === '/api/me/card-forgets') {
        if (opts.forgetStatus === 404) throw new ApiError(404, 'None of those cards are in your decks', null);
        return { added: (body.note_ids ?? []).flatMap((n) => [`${n}-a`, `${n}-b`, `${n}-c`]), already: [], not_found: [] };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
  const { db, statements } = fakeDb((sql) => {
    if (sql.includes('FROM users')) return { time_zone: 'Europe/London', day_rollover_hour: 4 };
    if (sql.includes('FROM decks WHERE id')) return { id: 'd1', name: 'HSK 2' };
    if (sql.includes('LIMIT 50')) {
      return [
        { id: 'c1', card_type: 'hanzi_to_meaning', note_id: 'n1', hanzi: '银行', pinyin: 'yínháng', english: 'bank', audio_url: 'generated/n1.mp3', fun_facts: null },
        { id: 'c2', card_type: 'audio_to_hanzi', note_id: 'n2', hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple', audio_url: null, fun_facts: null },
      ];
    }
    if (sql.includes('FROM review_events')) return EVENTS;
    if (sql.includes('FROM card_forgets')) return [];
    if (sql.includes('new_count')) return { new_count: 4, learning_count: 1, review_count: 2 };
    if (sql.includes('SELECT n.deck_id')) return { deck_id: 'd1' };
    return null;
  });
  const tools = new Map<string, Handler>();
  const server = {
    tool: (name: string, _d: string, _s: unknown, handler: Handler) => { tools.set(name, handler); },
    registerTool: (name: string, _c: unknown, handler: Handler) => { tools.set(name, handler); },
    registerResource: () => undefined,
  };
  registerStudyTools({
    server, api: api as unknown as ApiClient, env: { DB: db, ENVIRONMENT: 'production' }, userId: 'u1',
  } as unknown as ToolContext);
  return { tools, calls, statements };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('study tools — one scheduler', () => {
  it('submit_review posts the review EVENT to /api/reviews and writes nothing itself', async () => {
    const { tools, calls, statements } = setup();
    const out = await tools.get('submit_review')!({ card_id: 'c1', rating: 2, time_spent_ms: 4200.4, user_answer: '银行' });
    expect(out.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/reviews');
    const ev = (calls[0].body as { events: Array<Record<string, unknown>> }).events[0];
    expect(ev).toMatchObject({ card_id: 'c1', rating: 2, time_spent_ms: 4200, user_answer: '银行' });
    expect(typeof ev.id).toBe('string');
    expect(new Date(ev.reviewed_at as string).toISOString()).toBe(ev.reviewed_at);
    expect(out.structuredContent).toEqual({ counts: { new: 4, learning: 1, review: 2 } });
    for (const sql of statements) expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });

  it('submit_review says not found when the API refuses the card', async () => {
    const { tools } = setup({ orphan: true });
    const out = await tools.get('submit_review')!({ card_id: 'nope', rating: 0 });
    expect(out.isError).toBe(true);
    expect(text(out)).toContain('Card not found');
  });

  it('study gives every card its own FSRS previews from its replayed events', async () => {
    const { tools } = setup();
    const out = await tools.get('study')!({ deck_id: 'd1' });
    const data = out.structuredContent as { cards: Array<{ id: string; queue: number; previews: Record<number, { intervalText: string; queue: number }>; note: { audio_url: string | null } }> };
    expect(data.cards).toHaveLength(2);
    const [c1] = data.cards;
    const state = computeCardState(EVENTS, DEFAULT_DECK_SETTINGS);
    expect(c1.queue).toBe(state.queue);
    // The shared scheduler's previews (the web's rating buttons): long intervals are fuzzed, so compare the
    // unfuzzed Again step and each button's next state.
    const expected = getIntervalPreviews(state, DEFAULT_DECK_SETTINGS, new Date());
    expect(c1.previews[0].intervalText).toBe(expected[0].intervalText);
    for (const r of [0, 1, 2, 3]) {
      expect(c1.previews[r].queue).toBe(expected[r].nextState);
      expect(c1.previews[r].intervalText).toMatch(/^[\d.]+(m|h|d|w|mo|y)$/);
    }
    expect(c1.note.audio_url).toBe('https://chinese-learning-api.jeromeswannack.workers.dev/api/audio/generated/n1.mp3');
    expect(data.cards[1].note.audio_url).toBeNull();
  });

  it('familiarity "new" is a forget event; every other level is refused', async () => {
    const { tools, calls } = setup();
    const one = await tools.get('set_card_familiarity')!({ note_id: 'n1', familiarity: 'new', card_types: ['hanzi_to_meaning'] });
    expect(one.isError).toBeFalsy();
    expect(calls[0]).toEqual({ method: 'POST', path: '/api/me/card-forgets', body: { note_ids: ['n1'], card_types: ['hanzi_to_meaning'], source: 'mcp' } });
    for (const level of ['seen', 'familiar', 'well_known', 'mastered']) {
      const r = await tools.get('set_card_familiarity')!({ note_id: 'n1', familiarity: level });
      expect(r.isError).toBe(true);
      expect(text(r)).toBe(FAMILIARITY_REFUSAL);
      const b = await tools.get('batch_set_familiarity')!({ note_ids: ['n1'], familiarity: level });
      expect(b.isError).toBe(true);
    }
    expect(calls).toHaveLength(1);
  });

  it('batch_set_familiarity forgets in chunks the API accepts', async () => {
    const { tools, calls } = setup();
    const ids = Array.from({ length: 130 }, (_, i) => `n${i}`);
    const out = await tools.get('batch_set_familiarity')!({ note_ids: ids, familiarity: 'new' });
    expect(calls.map((c) => (c.body as { note_ids: string[] }).note_ids.length)).toEqual([60, 60, 10]);
    expect(text(out)).toContain('Reset 390 card(s) of 130 note(s)');
  });

  it('update_card_settings no longer exists', () => {
    const { tools } = setup();
    expect(tools.has('update_card_settings')).toBe(false);
    expect([...tools.keys()].sort()).toEqual(['batch_set_familiarity', 'set_card_familiarity', 'study', 'submit_review']);
  });

  it('previewsFor / audioUrl are pure', () => {
    const p = previewsFor([], []);
    expect(p.queue).toBe(0);
    expect(Object.keys(p.previews)).toEqual(['0', '1', '2', '3']);
    expect(audioUrl('https://api.x', '/api/audio/generated/a.mp3')).toBe('https://api.x/api/audio/generated/a.mp3');
    expect(audioUrl('https://api.x', 'https://cdn/a.mp3')).toBe('https://cdn/a.mp3');
    expect(audioUrl('https://api.x', null)).toBeNull();
  });
});

// Every .ts under mcp-server/src except tests and the generated app bundle, as text (Vite's glob).
declare global {
  interface ImportMeta {
    glob(pattern: string[], options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
  }
}
const SOURCES = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../app-html.ts'], { query: '?raw', import: 'default', eager: true });

describe('guard: the MCP server never writes card state or review events', () => {
  it('no source writes cards / review_events / card_checkpoints directly', () => {
    const offenders: string[] = [];
    const write = /\b(UPDATE\s+cards\b|INSERT\s+(OR\s+\w+\s+)?INTO\s+(cards|review_events|card_checkpoints)\b|DELETE\s+FROM\s+(cards|review_events|card_checkpoints)\b)/i;
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    expect(Object.keys(SOURCES)).toContain('../index.ts');
    for (const [file, source] of Object.entries(SOURCES)) {
      source.split('\n').forEach((line, i) => {
        if (write.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
