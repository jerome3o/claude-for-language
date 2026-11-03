/**
 * The Claude thread view and the tutor (shared/claude/visibility.ts): the learner's ⋯ → Share with my
 * tutor / Hide from my tutor (the chat's own choice, back to the account's default = null) with the
 * "👁 Minghui can read this chat" line; the tutor's read-only view of a shared chat (no composer, no
 * ⋯, the card chip → her card hub view of the note).
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
  patchClaudeThread: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { id: 'u1', role: 'student', claude_tutor_visibility: 'card_only' } as Record<string, unknown> | null }));
vi.mock('../../contexts/AuthContext', () => ({ useOptionalAuth: () => (auth.user ? { user: auth.user } : null) }));
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

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../../db/database';
import { ClaudeThreadView } from './ClaudeThreadView';
import type { ComponentProps } from 'react';

const T0 = '2026-11-03T10:00:00.000Z';
function threadRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, client_id: null, title: '你好吗？', context_kind: 'general', context: { kind: 'general' }, badge: null, first_intent: 'ask', preview: null,
    last_message_at: T0, created_at: T0, unread: 0, pending: false, failed: false, read_only: false, archived: false, tutor_visible: null, language: null, source: 'app', ...extra,
  };
}
function msg(id: string, thread: string, role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) {
  return {
    id, thread_id: thread, client_id: null, role, content_type: 'text', content, intent: role === 'user' ? 'ask' : null, status: null, streaming: false, error: null,
    answer_lang: role === 'assistant' ? 'zh' : null, translation: null, tool_results: null, created_at: role === 'user' ? T0 : '2026-11-03T10:00:01.000Z', updated_at: null, ...extra,
  };
}

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const waitFor = async (pred: () => boolean, what: string) => {
  for (let i = 0; i < 80 && !pred(); i++) await flush();
  if (!pred()) throw new Error(`timed out waiting for ${what}\n${host.innerHTML.slice(0, 1500)}`);
};
const setOnline = (on: boolean) => {
  net.online = on;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
};

async function render(props: ComponentProps<typeof ClaudeThreadView>) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/chats/claude/x']}>
        <Routes>
          <Route path="/chats/claude/:id" element={<ClaudeThreadView {...props} />} />
          <Route path="/cards/:noteId" element={<div data-testid="card-hub" />} />
          <Route path="/connections/:relId/cards/:noteId" element={<div data-testid="tutor-card-hub" />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  await flush();
}

beforeEach(async () => {
  await db.claudeThreads.clear();
  await db.claudeMessages.clear();
  await db.claudeOutbox.clear();
  Object.values(api).forEach((f) => f.mockReset());
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

const click = (el: HTMLElement | null) => act(async () => { el!.click(); });

describe('ClaudeThreadView and the tutor', () => {
  it('the learner shares a practice chat with his tutor from ⋯, then hides it again', async () => {
    const practice = threadRow('t1', { context_kind: 'practice', context: { kind: 'practice', scenario: '在饭店点菜' }, title: '点菜' });
    api.getClaudeThread.mockResolvedValue({ thread: practice, messages: [msg('u1', 't1', 'user', '我要一碗米饭。'), msg('a1', 't1', 'assistant', '好的。')], server_time: T0 });
    api.patchClaudeThread.mockImplementation(async (_id: string, patch: { tutor_visible: boolean | null }) => ({ thread: { ...practice, tutor_visible: patch.tutor_visible } }));
    await render({ threadId: 't1' });
    await waitFor(() => !!q('claude-chat-reply'), 'the thread');
    // Private by default: no shared line.
    expect(q('claude-thread-shared')).toBeNull();
    await click(q('claude-thread-more'));
    expect(q('claude-thread-share')!.textContent).toBe('👁 Share with my tutor');
    await click(q('claude-thread-share'));
    await waitFor(() => !!q('claude-thread-shared'), 'the shared line');
    expect(api.patchClaudeThread).toHaveBeenLastCalledWith('t1', { tutor_visible: true });
    expect(q('claude-thread-shared')!.textContent).toBe('👁 Your tutor can read this chat');
    expect(track).toHaveBeenCalledWith('claude.share_with_tutor', { on: true, scope: 'thread', context_kind: 'practice' });

    await click(q('claude-thread-more'));
    expect(q('claude-thread-share')!.textContent).toBe('🙈 Hide from my tutor');
    await click(q('claude-thread-share'));
    await waitFor(() => !q('claude-thread-shared'), 'hidden again');
    // Back to the account's default (practice = private): null, not false.
    expect(api.patchClaudeThread).toHaveBeenLastCalledWith('t1', { tutor_visible: null });
  });

  it('a card question is visible by default; a tutor account has no Share item', async () => {
    const card = threadRow('t2', { context_kind: 'card', context: { kind: 'card', note_id: 'n1', label: '银行' }, badge: { icon: '📇', text: 'Asked on card · 银行' } });
    api.getClaudeThread.mockResolvedValue({ thread: card, messages: [msg('u1', 't2', 'user', '行怎么读？'), msg('a1', 't2', 'assistant', '这里读 háng。')], server_time: T0 });
    await render({ threadId: 't2' });
    await waitFor(() => !!q('claude-chat-reply'), 'the thread');
    expect(q('claude-thread-shared')!.textContent).toBe('👁 Your tutor can read this chat');
    await click(q('claude-thread-more'));
    expect(q('claude-thread-share')!.textContent).toBe('🙈 Hide from my tutor');

    auth.user = { id: 't9', role: 'tutor' };
    act(() => root.unmount());
    root = createRoot(host);
    await render({ threadId: 't2' });
    await waitFor(() => !!q('claude-chat-reply'), 'the thread again');
    await click(q('claude-thread-more'));
    expect(q('claude-thread-share')).toBeNull();
    expect(q('claude-thread-shared')).toBeNull();
    auth.user = { id: 'u1', role: 'student', claude_tutor_visibility: 'card_only' };
  });

  it("the tutor's read-only view: the student's words, no composer or ⋯, the card chip opens her card hub", async () => {
    await render({
      threadId: 'nq-q1',
      source: 'student_page',
      tutorView: {
        relId: 'rel-1',
        studentName: 'Jerome',
        thread: { id: 'nq-q1', title: '行怎么读？', context_kind: 'card', context: { kind: 'card', note_id: 'n1', label: '银行' }, badge: { icon: '📇', text: 'Asked on card · 银行' }, preview: null, last_message_at: T0, created_at: T0, message_count: 2, shared: false },
        messages: [
          { id: 'm1', role: 'user', content_type: 'text', content: '行怎么读？', answer_lang: null, translation: null, tool_results: null, created_at: T0 },
          { id: 'm2', role: 'assistant', content_type: 'text', content: '这里读 háng。', answer_lang: 'zh', translation: 'Here it is háng.', tool_results: null, created_at: T0 },
        ],
      },
    });
    await waitFor(() => !!q('claude-chat-reply'), 'the reply');
    expect(host.textContent).toContain('行怎么读？');
    expect(q('claude-thread-readonly')!.textContent).toBe('Read only · Jerome’s chat with Claude — only Jerome can write in it.');
    expect(host.querySelector('.claude-chat-composer')).toBeNull();
    expect(q('claude-thread-more')).toBeNull();
    expect(q('claude-thread-lang-zh')).toBeNull();
    expect(api.getClaudeThread).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('tutor.claude_thread_open', { context_kind: 'card', source: 'student_page' });
    await click(q('claude-thread-context-chip'));
    await waitFor(() => !!q('tutor-card-hub'), "her view of the student's card");
  });
});
