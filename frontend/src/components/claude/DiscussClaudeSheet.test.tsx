/**
 * Discuss with Claude on a chat message = the message's Claude thread in a sheet over the chat
 * (components/claude/DiscussClaudeSheet.tsx; docs/CHAT.md "Discuss with Claude"): the message quoted,
 * the chat-message chips and Ask only, a new thread in the `chat_message` context made by the first
 * question, the message's earlier thread resumed whenever, and Claude's proposed cards reviewed and
 * saved here (never by the server).
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
const createNotesBatch = vi.hoisted(() => vi.fn(async (_deck: string, notes: Array<{ hanzi: string }>) => ({
  created: notes.map((n, i) => ({ id: `new-${i}`, hanzi: n.hanzi })),
  failed: [],
  deck: { id: 'src-chats', name: 'From chats', source_key: 'chats' },
})));
vi.mock('../../api/client', () => ({
  API_BASE: '', apiErrorStatus: (e: { status?: number } | null) => e?.status, backfillReaderWords: vi.fn(), setAskClaudeListening: vi.fn(),
  proposeCoachFlashcards: vi.fn(), translateCoachMessage: vi.fn(), getConversation: vi.fn(), requestCoachMistakeLesson: vi.fn(), saveCoachMistakeLesson: vi.fn(),
  createNotesBatch: (...a: unknown[]) => createNotesBatch(...(a as [string, Array<{ hanzi: string }>])),
}));
vi.mock('../../services/sync', () => ({ syncService: { syncInBackground: vi.fn(async () => undefined) } }));
const net = vi.hoisted(() => ({ online: true }));
vi.mock('../../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: net.online }) }));
vi.mock('../../services/askClaudeLanguage', () => ({ useAskLanguage: () => ['zh', vi.fn()] }));
vi.mock('../../services/askClaudeListening', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/askClaudeListening')>()),
  useAskListening: () => [false, vi.fn()],
}));
vi.mock('../../services/wordRecap', () => ({ useChatRecapCount: () => 0 }));
vi.mock('../../services/chineseSegmenter', () => ({ useSegmentedWords: () => null, preloadSegmenter: () => {} }));
vi.mock('../../services/ttsCache', () => ({ getTTSWithCache: vi.fn(async () => null) }));
vi.mock('../../services/audioCache', () => ({ speakWithBrowserTTS: vi.fn(async () => undefined) }));
vi.mock('../explorer/ExplorerContext', () => ({
  useExplorer: () => ({ open: vi.fn(), push: vi.fn(), inside: false }),
  ExplorerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MemoryRouter } from 'react-router-dom';
import { db } from '../../db/database';
import { DiscussClaudeSheet } from './DiscussClaudeSheet';

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MESSAGE = { id: 'm1', content: '明天下午三点见，别迟到！' };
function thread(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, client_id: null, title: '这是什么意思？', context_kind: 'chat_message', context: { kind: 'chat_message', message_id: 'm1', conversation_id: 'conv-1', label: '明天下午三点见' },
    badge: { icon: '💬', text: 'About a message · 明天下午三点见' }, first_intent: 'ask', preview: 'p', last_message_at: iso(40 * 86_400_000), created_at: iso(41 * 86_400_000),
    unread: 0, pending: false, failed: false, read_only: false, archived: false, tutor_visible: null, language: null, source: 'app', ...extra,
  };
}
function msg(id: string, threadId: string, role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) {
  return {
    id, thread_id: threadId, client_id: null, role, content_type: 'text', content, intent: role === 'user' ? 'ask' : null, status: null, streaming: false, error: null,
    answer_lang: role === 'assistant' ? 'en' : null, translation: null, tool_results: null, created_at: role === 'user' ? iso(60_000) : iso(59_000), updated_at: null, ...extra,
  };
}
const PROPOSED = JSON.stringify([{ tool: 'propose_flashcards', success: true, data: { flashcards: [{ hanzi: '迟到', pinyin: 'chídào', english: 'to be late', fun_facts: '迟 late + 到 arrive.' }, { hanzi: '下午', pinyin: 'xiàwǔ', english: 'afternoon' }] } }]);

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const waitFor = async (pred: () => boolean, what: string) => {
  for (let i = 0; i < 80 && !pred(); i++) await flush();
  if (!pred()) throw new Error(`timed out waiting for ${what}\n${host.innerHTML.slice(0, 2000)}`);
};

async function render() {
  await act(async () => root.render(<MemoryRouter><DiscussClaudeSheet message={MESSAGE} conversationId="conv-1" onClose={vi.fn()} /></MemoryRouter>));
  await flush();
}

beforeEach(async () => {
  await db.claudeThreads.clear();
  await db.claudeMessages.clear();
  await db.claudeOutbox.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.listClaudeThreads.mockResolvedValue({ threads: [], deleted_ids: [], server_time: iso(0) });
  track.mockClear();
  createNotesBatch.mockClear();
  net.online = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('DiscussClaudeSheet', () => {
  it('a new discussion: the message quoted, the chat-message chips, Ask only; the first question starts a chat_message thread', async () => {
    api.createClaudeThread.mockImplementation(async (body: { client_id: string; context: unknown; text: string }) => ({
      thread: thread('t-new', { client_id: body.client_id }),
      messages: [msg('u1', 't-new', 'user', body.text), msg('a1', 't-new', 'assistant', '', { status: 'pending' })],
    }));
    api.getClaudeThread.mockResolvedValue({ thread: thread('t-new'), messages: [msg('u1', 't-new', 'user', 'What does it mean?'), msg('a1', 't-new', 'assistant', 'See you at 3pm tomorrow.')], server_time: iso(0) });
    await render();
    expect(q('discuss-claude-quote')!.textContent).toBe(MESSAGE.content);
    expect(q('claude-thread')!.dataset.context).toBe('chat_message');
    expect(api.listClaudeThreads).toHaveBeenCalledWith({ contextKind: 'chat_message', limit: 100 });
    await waitFor(() => track.mock.calls.some((c) => c[0] === 'claude.discuss_open'), 'discuss_open');
    expect(track).toHaveBeenCalledWith('claude.discuss_open', { resumed: false });
    expect([...host.querySelectorAll('[data-testid^="claude-thread-chip-"]')].map((b) => b.getAttribute('data-testid'))).toEqual([
      'claude-thread-chip-meaning', 'claude-thread-chip-natural', 'claude-thread-chip-reply', 'claude-thread-chip-cards',
    ]);
    // Ask only — no Check / Explain buttons in a discussion.
    expect(host.textContent).not.toContain('✏️ Check');

    await act(async () => q('claude-thread-chip-meaning')!.click());
    await flush();
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({ context: { kind: 'chat_message', message_id: 'm1', conversation_id: 'conv-1' }, intent: 'ask', quick: true }));
    await waitFor(() => !!q('claude-chat-reply'), 'the reply');
  });

  it("resumes the message's thread whenever it was; Claude's proposed cards are reviewed and saved here", async () => {
    await db.claudeThreads.bulkPut([thread('t-old'), thread('t-other', { context: { kind: 'chat_message', message_id: 'm2' } })] as never);
    api.getClaudeThread.mockResolvedValue({
      thread: thread('t-old'),
      messages: [msg('u1', 't-old', 'user', 'Make flashcards'), msg('a1', 't-old', 'assistant', 'Here are two cards.', { tool_results: PROPOSED })],
      server_time: iso(0),
    });
    await render();
    await waitFor(() => !!q('discuss-cards'), 'the proposed cards');
    expect(api.getClaudeThread).toHaveBeenCalledWith('t-old', null);
    expect(track).toHaveBeenCalledWith('claude.discuss_open', { resumed: true });
    expect(q('discuss-cards')!.textContent).toContain('Claude suggests 2 cards');
    // Untick 下午, save 迟到 — no deck to pick: straight into "From chats".
    const cards = host.querySelectorAll('.discuss-card');
    await act(async () => (cards[1] as HTMLElement).click());
    expect(q('discuss-cards-add')!.textContent).toBe('Add 1 card to From chats');
    await act(async () => q('discuss-cards-add')!.click());
    await waitFor(() => !!q('discuss-cards-done'), 'saved');
    expect(createNotesBatch).toHaveBeenCalledTimes(1);
    expect(createNotesBatch).toHaveBeenCalledWith('source:chats', [expect.objectContaining({ hanzi: '迟到', pinyin: 'chídào', english: 'to be late', context: MESSAGE.content })], {});
    expect(q('discuss-cards-done')!.textContent).toContain('✓ Added to From chats');
    expect(q('discuss-cards-done')!.textContent).toContain('Change');
  });
});
