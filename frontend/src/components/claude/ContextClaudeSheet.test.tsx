/**
 * A Claude thread in a sheet over a graded reader's page / a mini lesson's exercise
 * (components/claude/ContextClaudeSheet.tsx): resumes the context's thread from the last 30 minutes
 * (else a new one), offers the context's chips and Ask only, sends the context's fields with every
 * question, and offline queues the question.
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
vi.mock('../../services/chineseSegmenter', () => ({ useSegmentedWords: () => null, preloadSegmenter: () => {} }));
vi.mock('../../services/ttsCache', () => ({ getTTSWithCache: vi.fn(async () => null) }));
vi.mock('../../services/audioCache', () => ({ speakWithBrowserTTS: vi.fn(async () => undefined) }));
vi.mock('../explorer/ExplorerContext', () => ({
  useExplorer: () => ({ open: vi.fn(), push: vi.fn(), inside: false }),
  ExplorerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MemoryRouter } from 'react-router-dom';
import { db } from '../../db/database';
import { ContextClaudeSheet, type ContextClaudeSheetProps } from './ContextClaudeSheet';

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
function cardThread(id: string, lastMsAgo: number, extra: Record<string, unknown> = {}) {
  return {
    id, client_id: null, title: '这一页讲的是什么？', context_kind: 'reader', context: { kind: 'reader', reader_id: 'rd1', page_id: 'pg2', page: 2, label: '成都' },
    badge: { icon: '📖', text: 'Reader · 成都 p.2' }, first_intent: 'ask', preview: `preview ${id}`, last_message_at: iso(lastMsAgo), created_at: iso(lastMsAgo + 1000),
    unread: 0, pending: false, failed: false, read_only: false, archived: false, tutor_visible: null, language: null, source: 'app', ...extra,
  };
}
function msg(id: string, thread: string, role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) {
  return {
    id, thread_id: thread, client_id: null, role, content_type: 'text', content, intent: role === 'user' ? 'ask' : null, status: null, streaming: false, error: null,
    answer_lang: role === 'assistant' ? 'zh' : null, translation: null, tool_results: null, created_at: role === 'user' ? iso(60_000) : iso(59_000), updated_at: null, ...extra,
  };
}

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


const READER_CTX = { kind: 'reader' as const, reader_id: 'rd1', page_id: 'pg2', page: 2, looked_up: ['熊猫'], label: '成都' };

function props(extra: Partial<ContextClaudeSheetProps> = {}): ContextClaudeSheetProps {
  return { context: READER_CTX, fields: { looked_up: ['熊猫'], said_wrong: null }, label: 'Ask Claude about this page', source: 'reader', onClose: vi.fn(), ...extra };
}

async function render(p: ContextClaudeSheetProps) {
  await act(async () => root.render(<MemoryRouter><ContextClaudeSheet {...p} /></MemoryRouter>));
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

describe('ContextClaudeSheet (a reader page / an exercise)', () => {
  it("a reader page: a new chat with the page's chips (the looked-up words first), Ask only; the question carries the context", async () => {
    api.createClaudeThread.mockImplementation(async (body: { client_id: string; message_client_id: string; text: string }) => ({
      thread: cardThread('s1', 0, { client_id: body.client_id, pending: true }),
      messages: [msg('su1', 's1', 'user', body.text, { client_id: body.message_client_id }), msg('sa1', 's1', 'assistant', '', { status: 'pending' })],
    }));
    api.getClaudeThread.mockResolvedValue({ thread: cardThread('s1', 0, { pending: true }), messages: [msg('sa1', 's1', 'assistant', '', { status: 'pending' })], server_time: iso(0) });
    const onResolved = vi.fn();
    await render(props({ onResolved }));
    await waitFor(() => !!q('claude-thread-empty'), 'the empty thread');
    expect(api.listClaudeThreads).toHaveBeenCalledWith({ contextKind: 'reader', contextRef: 'rd1:pg2', limit: 20 });
    expect(onResolved).toHaveBeenCalledWith(false);
    expect(q('claude-thread-reader-hint')).toBeTruthy();
    expect(q('claude-thread-title')!.textContent).toContain('Ask about this page');
    expect(q('claude-thread-context-chip')!.textContent).toContain('Reader · 成都 p.2');
    const chipIds = [...host.querySelectorAll('[data-testid^="claude-thread-chip-"]')].map((b) => b.getAttribute('data-testid'));
    expect(chipIds).toEqual(['claude-thread-chip-my_words', 'claude-thread-chip-page_meaning', 'claude-thread-chip-grammar', 'claude-thread-chip-quiz']);
    expect(q('claude-composer-intents')).toBeNull();
    await act(async () => q('claude-thread-chip-page_meaning')!.click());
    await flush();
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({
      context: { kind: 'reader', reader_id: 'rd1', page_id: 'pg2', page: 2, looked_up: ['熊猫'] },
      intent: 'ask',
      quick: true,
      text: '这一页讲的是什么？请一句一句地说一说。',
    }));
    await waitFor(() => !!q('claude-chat-pending'), 'the pending reply');
  });

  it("resumes the page's recent thread (＋ New chat starts afresh); a follow-up carries the page's words", async () => {
    await db.claudeThreads.bulkPut([cardThread('recent', 5 * 60_000), cardThread('other-page', 60_000, { context: { kind: 'reader', reader_id: 'rd1', page_id: 'pg3' } })] as never);
    api.getClaudeThread.mockImplementation(async (id: string) => ({ thread: cardThread(id, 5 * 60_000), messages: [msg('u-' + id, id, 'user', '这一页讲的是什么？'), msg('a-' + id, id, 'assistant', '小明在成都看熊猫。')], server_time: iso(0) }));
    api.sendClaudeThreadMessage.mockImplementation(async (id: string, body: { text: string }) => ({
      thread: cardThread(id, 0, { pending: true }),
      messages: [msg('u2', id, 'user', body.text), msg('a2', id, 'assistant', '', { status: 'pending' })],
    }));
    await render(props());
    await waitFor(() => !!q('claude-chat-reply'), 'the resumed thread');
    expect(api.getClaudeThread).toHaveBeenCalledWith('recent', null);
    expect(q('context-claude-new')).toBeTruthy();
    await act(async () => q('claude-thread-chip-grammar')!.click());
    await flush();
    expect(api.sendClaudeThreadMessage).toHaveBeenCalledWith('recent', expect.objectContaining({ looked_up: ['熊猫'], said_wrong: null, quick: true }));
    await act(async () => q('context-claude-new')!.click());
    await waitFor(() => !!q('claude-thread-empty'), 'a new chat');
  });

  it('an exercise: its chips follow the checked answer; offline the question waits in the outbox', async () => {
    setOnline(false);
    await render(props({
      context: { kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e1', exercise_type: 'translate', answer: { text: '我放书在桌子上。', verdict: 'wrong' }, label: 'Translate', sublabel: '把字句' },
      fields: { answer: { text: '我放书在桌子上。', verdict: 'wrong' } },
      label: 'Ask Claude about this exercise',
      source: 'lesson',
    }));
    await waitFor(() => !!q('claude-thread-exercise-hint'), 'the empty exercise thread');
    expect(q('claude-thread-context-chip')!.textContent).toContain('Exercise · Translate');
    expect(q('claude-thread-chip-why_wrong')!.textContent).toBe('为什么错了 Why is my answer wrong?');
    await act(async () => q('claude-thread-chip-why_wrong')!.click());
    await flush();
    expect(api.createClaudeThread).not.toHaveBeenCalled();
    const queued = await db.claudeOutbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].create?.context).toMatchObject({ kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e1', answer: { verdict: 'wrong' } });
  });
});
