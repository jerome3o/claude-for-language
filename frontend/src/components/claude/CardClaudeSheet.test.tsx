/**
 * Ask Claude on a study card = the card's Claude thread in a sheet (components/claude/CardClaudeSheet.tsx;
 * docs/STUDY_SESSION.md "Ask Claude"): it resumes the card's thread from the last 30 minutes (else a
 * new one), lists the earlier ones, offers the card's chips and Ask only (no Check / Explain), sends
 * the typed answer with a question, hands a finished reply's card tools to the study page ONCE (with
 * "✓ Claude edited this card · Undo"), and offline queues the question ("Will send when you're online").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ current: null as null | { land: (t: string) => void } }));
vi.mock('../../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { onSubmit: (a: { text: string; source: string; transcript: string | null }) => void }) => {
      const latest = React.useRef(opts);
      latest.current = opts;
      fake.current = { land: (t) => latest.current.onSubmit({ text: t, source: 'typed', transcript: null }) };
      return {
        state: { mode: 'typing', phase: 'idle', failure: null, blocked: null },
        finalText: '', partialText: '', listening: false, busy: false, level: 0,
        say: vi.fn(), stop: vi.fn(), cancel: vi.fn(), retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: true, reset: vi.fn(),
      };
    },
  };
});
const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));

// The live socket: tests push frames.
const live = vi.hoisted(() => {
  const events = new Set<(e: unknown) => void>();
  return {
    events,
    emit: (e: unknown) => events.forEach((l) => l(e)),
    chatLive: {
      acquire: () => () => {},
      onEvent: (l: (e: unknown) => void) => {
        events.add(l);
        return () => events.delete(l);
      },
      onStatus: () => () => {},
      getStatus: () => 'open',
    },
  };
});
vi.mock('../../services/chatLive', () => ({ chatLive: live.chatLive }));

const api = vi.hoisted(() => ({
  getClaudeThread: vi.fn(),
  createClaudeThread: vi.fn(),
  sendClaudeThreadMessage: vi.fn(),
  retryClaudeThreadMessage: vi.fn(),
  listClaudeThreads: vi.fn(),
}));
vi.mock('../../api/claudeThreads', () => api);
vi.mock('../../api/client', () => ({
  API_BASE: '', apiErrorStatus: (e: { status?: number } | null) => e?.status, backfillReaderWords: vi.fn(), setAskClaudeListening: vi.fn(),
  proposeCoachFlashcards: vi.fn(), translateCoachMessage: vi.fn(), getConversation: vi.fn(), requestCoachMistakeLesson: vi.fn(), saveCoachMistakeLesson: vi.fn(),
}));
const net = vi.hoisted(() => ({ online: true }));
vi.mock('../../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: net.online }) }));
vi.mock('../../services/askClaudeLanguage', () => ({ useAskLanguage: () => ['zh', vi.fn()] }));
vi.mock('../../services/askClaudeListening', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/askClaudeListening')>()),
  useAskListening: () => [false, vi.fn()],
}));
vi.mock('../../services/wordRecap', () => ({ useChatRecapCount: () => 0 }));
const SEGMENTS: Record<string, string[]> = { '好的，我加了一个小知识。': ['好的', '，', '我', '加', '了', '一个', '小知识', '。'] };
vi.mock('../../services/chineseSegmenter', () => ({
  useSegmentedWords: (text: string, enabled = true) => (enabled && SEGMENTS[text] ? SEGMENTS[text].map((t) => ({ text: t, pinyin: '', gloss: '' })) : null),
  preloadSegmenter: () => {},
}));
vi.mock('../../services/ttsCache', () => ({ getTTSWithCache: vi.fn(async () => null) }));
vi.mock('../../services/audioCache', () => ({ speakWithBrowserTTS: vi.fn(async () => undefined) }));
vi.mock('../explorer/ExplorerContext', () => ({
  useExplorer: () => ({ open: vi.fn(), push: vi.fn(), inside: false }),
  ExplorerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MemoryRouter } from 'react-router-dom';
import { db } from '../../db/database';
import { CardClaudeSheet, type CardClaudeSheetProps } from './CardClaudeSheet';

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
function cardThread(id: string, lastMsAgo: number, extra: Record<string, unknown> = {}) {
  return {
    id, client_id: null, title: '银行是什么意思？', context_kind: 'card', context: { kind: 'card', note_id: 'n1', label: '银行', sublabel: 'HSK 2' },
    badge: { icon: '📇', text: 'Asked on card · 银行' }, first_intent: 'ask', preview: `preview ${id}`, last_message_at: iso(lastMsAgo), created_at: iso(lastMsAgo + 1000),
    unread: 0, pending: false, failed: false, read_only: false, archived: false, tutor_visible: null, language: null, source: 'app', ...extra,
  };
}
function msg(id: string, thread: string, role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) {
  return {
    id, thread_id: thread, client_id: null, role, content_type: 'text', content, intent: role === 'user' ? 'ask' : null, status: null, streaming: false, error: null,
    answer_lang: role === 'assistant' ? 'zh' : null, translation: null, tool_results: null, created_at: role === 'user' ? iso(60_000) : iso(59_000), updated_at: null, ...extra,
  };
}
const EDIT_RESULTS = JSON.stringify([{ tool: 'edit_current_card', success: true, data: { note: { id: 'n1', hanzi: '银行', fun_facts: '(E2E) 小知识', updated_at: 'u2' }, changes: { fun_facts: '(E2E) 小知识' } } }]);

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const waitFor = async (pred: () => boolean, what: string) => {
  for (let i = 0; i < 80 && !pred(); i++) await flush();
  if (!pred()) throw new Error(`timed out waiting for ${what}\n${host.innerHTML.slice(0, 2000)}`);
};
const setOnline = (on: boolean) => {
  net.online = on;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
};

function props(extra: Partial<CardClaudeSheetProps> = {}): CardClaudeSheetProps {
  return {
    open: true, noteId: 'n1', hanzi: '银行', deckName: 'HSK 2', cardType: 'meaning_to_hanzi', typed: null, hasSentence: true, cardDeleted: false,
    onClose: vi.fn(), onToolResults: vi.fn(), canUndo: () => false, onUndoEdit: vi.fn(async () => undefined), ...extra,
  };
}

async function render(p: CardClaudeSheetProps) {
  await act(async () => root.render(<MemoryRouter><CardClaudeSheet {...p} /></MemoryRouter>));
  await flush();
}

beforeEach(async () => {
  await db.claudeThreads.clear();
  await db.claudeMessages.clear();
  await db.claudeOutbox.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.listClaudeThreads.mockResolvedValue({ threads: [], deleted_ids: [], server_time: iso(0) });
  track.mockClear();
  live.events.clear();
  try { localStorage.removeItem('claude-card-effects-v1'); } catch { /* */ }
  setOnline(true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setOnline(true);
});

describe('CardClaudeSheet', () => {
  it("resumes the card's thread from the last 30 minutes; ⋯ lists the earlier ones and starts a new chat", async () => {
    await db.claudeThreads.bulkPut([cardThread('recent', 10 * 60_000), cardThread('old', 3 * 3600_000), cardThread('other-card', 60_000, { context: { kind: 'card', note_id: 'n2' } })] as never);
    api.getClaudeThread.mockImplementation(async (id: string) => ({ thread: cardThread(id, 10 * 60_000), messages: [msg('u-' + id, id, 'user', '行怎么读？'), msg('a-' + id, id, 'assistant', '这里读 háng。')], server_time: iso(0) }));
    await render(props());
    await waitFor(() => !!q('claude-chat-reply'), 'the resumed thread');
    expect(api.getClaudeThread).toHaveBeenCalledWith('recent', null);
    expect(api.listClaudeThreads).toHaveBeenCalledWith({ contextKind: 'card', noteId: 'n1', limit: 50 });
    expect(track).toHaveBeenCalledWith('claude.thread_open', { context_kind: 'card', source: 'study_card', resumed: true });
    // Compact (Jerome, Nov 2026): no ✕ (the grab handle closes), no "Asked on card" chip, no tutor
    // line, no Earlier / New chat row, no chips once the thread has a message.
    expect(host.querySelector('[aria-label="Close"]')!.className).toBe('claude-sheet-handle');
    expect(q('claude-thread-context-chip')).toBeNull();
    expect(q('claude-thread-shared')).toBeNull();
    expect(q('card-claude-earlier')).toBeNull();
    expect(q('card-claude-new')).toBeNull();
    expect(q('claude-thread-chips')).toBeNull();

    // ⋯ → Earlier → the old one; ⋯ → ＋ New chat → a fresh, empty thread with the card's chips.
    await act(async () => q('claude-thread-more')!.click());
    expect(q('card-claude-earlier')!.textContent).toBe('🕘 Earlier about 银行 · 1 chat');
    expect(q('card-claude-new')!.textContent).toBe('＋ New chat');
    await act(async () => q('card-claude-earlier')!.click());
    expect(host.querySelectorAll('[data-testid="card-claude-earlier-row"]')).toHaveLength(1);
    await act(async () => (host.querySelector('[data-testid="card-claude-earlier-row"]') as HTMLElement).click());
    await waitFor(() => api.getClaudeThread.mock.calls.some((c) => c[0] === 'old'), 'the earlier thread');
    expect(q('card-claude-earlier-list')).toBeNull();
    await act(async () => q('claude-thread-more')!.click());
    await act(async () => q('card-claude-new')!.click());
    await waitFor(() => !!q('claude-thread-empty'), 'a new chat');
    expect(q('claude-thread-chip-sentences')).toBeTruthy();
    await act(async () => q('claude-thread-more')!.click());
    expect(q('card-claude-earlier')!.textContent).toContain('2 chats');
    expect(q('card-claude-new')).toBeNull();
  });

  it('the grab handle closes the sheet (tap, drag down, Escape)', async () => {
    const onClose = vi.fn();
    await render(props({ onClose }));
    const handle = q('claude-thread-close')!;
    await act(async () => handle.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(2);
    // Drag down past 80px: closes; a short drag doesn't (and the click after it doesn't either).
    const drag = async (dy: number) => {
      await act(async () => {
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 100 }));
        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 100 + dy }));
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 100 + dy }));
        handle.click();
      });
      await flush();
    };
    await drag(30);
    expect(onClose).toHaveBeenCalledTimes(2);
    await drag(120);
    expect(onClose).toHaveBeenCalledTimes(3);
    // Closed (the sheet stays mounted, hidden): Escape does nothing.
    await render(props({ onClose, open: false }));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("an older thread isn't resumed: a new chat with the card's chips, Ask only; the question carries the typed answer", async () => {
    await db.claudeThreads.put(cardThread('old', 2 * 3600_000) as never);
    api.createClaudeThread.mockImplementation(async (body: { client_id: string; message_client_id: string; text: string }) => ({
      thread: cardThread('s1', 0, { client_id: body.client_id, pending: true }),
      messages: [msg('su1', 's1', 'user', body.text, { client_id: body.message_client_id }), msg('sa1', 's1', 'assistant', '', { status: 'pending' })],
    }));
    api.getClaudeThread.mockResolvedValue({ thread: cardThread('s1', 0, { pending: true }), messages: [msg('sa1', 's1', 'assistant', '', { status: 'pending' })], server_time: iso(0) });
    await render(props({ typed: { answer: '很行', correct: '银行' } }));
    expect(q('claude-thread-empty')).toBeTruthy();
    expect(q('claude-thread-card-hint')!.textContent).toContain('simple Chinese');
    expect(q('claude-thread-chip-check_answer')).toBeTruthy();
    expect(q('claude-thread-chip-sentence')).toBeTruthy();
    expect(q('claude-composer-intents')).toBeNull();
    await act(async () => q('claude-thread-chip-check_answer')!.click());
    await flush();
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({
      context: { kind: 'card', note_id: 'n1', card_type: 'meaning_to_hanzi', typed: { answer: '很行', correct: '银行' } },
      intent: 'ask',
      quick: true,
      language: 'zh',
    }));
    expect(track).toHaveBeenCalledWith('study.ask_claude', { card_type: 'meaning_to_hanzi', language: 'zh', quick: true, via: 'thread' });
    await waitFor(() => !!q('claude-chat-pending'), 'the pending reply');
  });

  it("a reply's card tools reach the study page once, with ✓ Claude edited this card · Undo", async () => {
    await db.claudeThreads.put(cardThread('t1', 60_000, { pending: true }) as never);
    const pending = msg('a1', 't1', 'assistant', '', { status: 'pending' });
    api.getClaudeThread.mockResolvedValue({ thread: cardThread('t1', 60_000, { pending: true }), messages: [msg('u1', 't1', 'user', '请给这张卡片加一个有意思的小知识。'), pending], server_time: iso(0) });
    const onToolResults = vi.fn();
    const onUndoEdit = vi.fn(async () => undefined);
    await render(props({ onToolResults, onUndoEdit, canUndo: (id) => id === 'a1' }));
    await waitFor(() => !!q('claude-chat-pending'), 'the pending reply');

    // Stored 'en' (the turn asked for English) but written in Chinese — it must still be word chips.
    const done = msg('a1', 't1', 'assistant', '好的，我加了一个小知识。', { tool_results: EDIT_RESULTS, answer_lang: 'en' });
    api.getClaudeThread.mockResolvedValue({ thread: cardThread('t1', 0), messages: [done], server_time: iso(0) });
    await act(async () => live.emit({ type: 'claude_turn', thread_id: 't1', message_id: 'a1', seq: 2, status: 'done', text: done.content }));
    await waitFor(() => !!q('card-claude-tool-edited'), 'the edit line');
    expect(onToolResults).toHaveBeenCalledTimes(1);
    expect(onToolResults.mock.calls[0][0]).toEqual([expect.objectContaining({ tool: 'edit_current_card', success: true })]);
    expect(q('card-claude-tool-edited')!.textContent).toContain('✓ Claude edited this card · notes');
    // The streamed reply that finished with a card edit: tappable word chips (Jerome, Nov 2026: "the text isn't clickable").
    const reply = host.querySelector('[data-testid="claude-chat-reply"]')!;
    expect([...reply.querySelectorAll('.chat-word')].map((c) => c.textContent)).toEqual(['好的', '我', '加', '了', '一个', '小知识']);

    await act(async () => q('card-claude-undo')!.click());
    await waitFor(() => q('card-claude-tool-edited')!.textContent!.includes('Undone'), 'undone');
    expect(onUndoEdit).toHaveBeenCalledWith('a1');
    expect(track).toHaveBeenCalledWith('claude.undo_card_edit', { context_kind: 'card' });

    // Opened again later (the reply already applied on this device): never twice.
    act(() => root.unmount());
    root = createRoot(host);
    await render(props({ onToolResults }));
    await flush();
    expect(onToolResults).toHaveBeenCalledTimes(1);
  });

  it('the leech sheet\'s memory hook asks into the card\'s thread at once (once)', async () => {
    api.createClaudeThread.mockImplementation(async (body: { client_id: string; message_client_id: string; text: string }) => ({
      thread: cardThread('s1', 0, { client_id: body.client_id }),
      messages: [msg('su1', 's1', 'user', body.text, { client_id: body.message_client_id }), msg('sa1', 's1', 'assistant', '', { status: 'pending' })],
    }));
    api.getClaudeThread.mockResolvedValue({ thread: cardThread('s1', 0), messages: [], server_time: iso(0) });
    await render(props({ autoAsk: { text: 'Give me a memory hook for 银行', key: 'k1' } }));
    await waitFor(() => api.createClaudeThread.mock.calls.length > 0, 'the auto question');
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({ text: 'Give me a memory hook for 银行', intent: 'ask' }));
    await flush();
    expect(api.createClaudeThread).toHaveBeenCalledTimes(1);
  });

  it("offline: the question is queued with the card's context and says it will send when online", async () => {
    setOnline(false);
    await render(props());
    await act(async () => fake.current!.land('银行和很行有什么不同？'));
    await waitFor(() => !!q('claude-chat-queued'), 'the queued bubble');
    expect(q('claude-chat-queued')!.textContent).toContain('Will send when you’re online');
    expect(api.createClaudeThread).not.toHaveBeenCalled();
    const [entry] = await db.claudeOutbox.toArray();
    expect(entry.create!.context).toEqual({ kind: 'card', note_id: 'n1', card_type: 'meaning_to_hanzi' });
    expect(track).toHaveBeenCalledWith('study.ask_claude', expect.objectContaining({ via: 'thread', quick: false }));
    // The thread is the card's on this device already (the Chats tab lists it with its 📇 chip).
    const local = await db.claudeThreads.toArray();
    expect(local).toEqual([expect.objectContaining({ context_kind: 'card', badge: { icon: '📇', text: 'Asked on card · 银行' }, local: true })]);
  });
});
