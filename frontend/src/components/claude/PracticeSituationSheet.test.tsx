/**
 * Practice with Claude on the web (docs/CHAT.md "Practice with Claude"): the "Practice a situation" sheet
 * (components/claude/PracticeSituationSheet.tsx) starts a practice thread with no message — Claude
 * speaks first — and opens it; the thread screen gives a role-play the help chips (🆘 goes into the box),
 * Ask only, the roles under the chip, the persona's voice; an old copied practice chat stays read-only.
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
        state: { mode: 'type', phase: 'idle', failure: null, blocked: null },
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

import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { db } from '../../db/database';
import { PracticeSituationSheet } from './PracticeSituationSheet';
import { ClaudeThreadView } from './ClaudeThreadView';

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
function practiceThread(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, client_id: null, title: 'Practice: 在饭店点菜', context_kind: 'practice',
    context: { kind: 'practice', scenario: '在饭店点菜', ai_role: '服务员 (a waiter)', user_role: '客人 (a customer)', level: 'intermediate', voice_id: 'Chinese (Mandarin)_Radio_Host', label: '在饭店点菜', sublabel: '服务员 (a waiter)' },
    badge: { icon: '🎭', text: 'Practice · 在饭店点菜' }, first_intent: null, preview: null, last_message_at: iso(1000), created_at: iso(2000),
    unread: 0, pending: true, failed: false, read_only: false, archived: false, tutor_visible: null, language: null, source: 'practice', ...extra,
  };
}
function msg(id: string, threadId: string, role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) {
  return {
    id, thread_id: threadId, client_id: null, role, content_type: 'text', content, intent: role === 'user' ? 'ask' : null, status: null, streaming: false, error: null,
    answer_lang: role === 'assistant' ? 'zh' : null, translation: null, tool_results: null, created_at: iso(1000), updated_at: null, ...extra,
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
function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

beforeEach(async () => {
  await db.claudeThreads.clear();
  await db.claudeMessages.clear();
  await db.claudeOutbox.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.listClaudeThreads.mockResolvedValue({ threads: [], deleted_ids: [], server_time: iso(0) });
  track.mockClear();
  net.online = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('PracticeSituationSheet', () => {
  it('a preset fills the form; Start makes a practice thread with no message and opens it', async () => {
    api.createClaudeThread.mockResolvedValue({ thread: practiceThread('t-p'), messages: [msg('a0', 't-p', 'assistant', '', { status: 'pending' })] });
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/chats']}>
          <Routes>
            <Route path="/chats" element={<PracticeSituationSheet source="chats" onClose={vi.fn()} />} />
            <Route path="/chats/claude/:id" element={<Where />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    expect((q('practice-start') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => q('practice-preset-restaurant')!.click());
    expect((q('practice-scenario') as HTMLTextAreaElement).value).toBe('在饭店点菜');
    expect((q('practice-ai-role') as HTMLInputElement).value).toBe('服务员 (a waiter)');
    await act(async () => q('practice-level-beginner')!.click());
    await act(async () => q('practice-start')!.click());
    await waitFor(() => !!q('where'), 'the thread screen');
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({
      text: '',
      context: { kind: 'practice', scenario: '在饭店点菜', ai_role: '服务员 (a waiter)', user_role: '客人 (a customer)', level: 'beginner' },
    }));
    expect(q('where')!.textContent).toBe('/chats/claude/t-p?source=practice');
    expect(track).toHaveBeenCalledWith('claude.practice_start', { source: 'chats', preset: 'restaurant', level: 'beginner' });
    expect(await db.claudeThreads.get('t-p')).toBeTruthy();
  });

  it('his own situation is "custom"; offline it cannot start', async () => {
    net.online = false;
    await act(async () => root.render(<MemoryRouter><PracticeSituationSheet source="claude_page" onClose={vi.fn()} /></MemoryRouter>));
    expect(host.textContent).toContain('needs a connection');
    expect((q('practice-start') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a practice thread on screen', () => {
  it('the help chips (🆘 goes into the box), the roles line, Ask only; the opener streams in', async () => {
    await db.claudeThreads.put(practiceThread('t-p') as never);
    api.getClaudeThread.mockResolvedValue({ thread: practiceThread('t-p', { pending: false }), messages: [msg('a0', 't-p', 'assistant', '你好！欢迎光临。请问几位？')], server_time: iso(0) });
    await act(async () => root.render(<MemoryRouter><ClaudeThreadView threadId="t-p" /></MemoryRouter>));
    await waitFor(() => !!q('claude-chat-reply'), 'the opener');
    expect(q('claude-thread-context-chip')!.textContent).toContain('Practice · 在饭店点菜');
    expect(q('claude-thread-roles')!.textContent).toBe('✦ Claude plays 服务员 (a waiter) · You: 客人 (a customer)');
    expect([...host.querySelectorAll('[data-testid^="claude-thread-chip-"]')].map((b) => b.getAttribute('data-testid'))).toEqual(['claude-thread-chip-hint', 'claude-thread-chip-say', 'claude-thread-chip-correct']);
    expect(q('claude-thread-readonly')).toBeNull();
    // 🆘 How do I say…: into the box, nothing sent.
    await act(async () => q('claude-thread-chip-say')!.click());
    await flush();
    expect(api.sendClaudeThreadMessage).not.toHaveBeenCalled();
    expect((host.querySelector('.claude-chat-composer textarea, .claude-chat-composer input') as HTMLTextAreaElement | null)?.value).toBe('🆘 怎么说：');
  });

  it('an old practice chat copied in stays read-only', async () => {
    const old = practiceThread('pc-c9', { read_only: true, pending: false, context: { kind: 'practice', conversation_id: 'c9', scenario: '点菜' } });
    await db.claudeThreads.put(old as never);
    api.getClaudeThread.mockResolvedValue({ thread: old, messages: [msg('pc-1', 'pc-c9', 'assistant', '欢迎！')], server_time: iso(0) });
    await act(async () => root.render(<MemoryRouter><ClaudeThreadView threadId="pc-c9" /></MemoryRouter>));
    await waitFor(() => !!q('claude-thread-readonly'), 'the read-only note');
    expect(q('claude-thread-readonly')!.textContent).toContain('Practice a situation');
    expect(host.querySelector('.claude-chat-composer')).toBeNull();
  });
});
