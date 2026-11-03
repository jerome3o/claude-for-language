/**
 * The unified Chats tab (pages/ChatsPage.tsx; docs/CHAT.md "Chats tab — one list for people and
 * Claude"): the people first (a learner's unread tutor chat on top), a thin divider, then Claude —
 * compact one-line rows, no previews, no filter chips; a Claude row's ONE context emoji (→ a popover
 * with the full text + "Open card ›"); the bottom box (always to Claude; Ask, and ✏️ Check / 🔍 Explain
 * for Chinese or Translate for English only once there is text), offline (the cached list, a queued
 * send) and the tutor's view (the same layout).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ current: null as null | { land: (t: string) => void } }));
vi.mock('../hooks/useVoiceDictation', async () => {
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
vi.mock('../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
vi.mock('../services/chatLive', () => ({
  chatLive: { acquire: () => () => {}, onEvent: () => () => {}, onStatus: () => () => {}, getStatus: () => 'idle' },
}));

const chatList = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('../hooks/useChatList', () => ({
  useChatList: () => ({ rows: chatList.rows, isLoading: false, error: null, markOpened: vi.fn(), isFetching: false, refetch: vi.fn() }),
}));
const role = vi.hoisted(() => ({ value: { hasStudents: false, hasTutor: true, isTutorOnly: false, loaded: true, isTutorAccount: false } }));
vi.mock('../components/nav/useNavRole', () => ({ useNavRole: () => role.value }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', name: 'Jerome' }, isAuthenticated: true }) }));
const net = vi.hoisted(() => ({ online: true }));
vi.mock('../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: net.online }) }));
vi.mock('../services/askClaudeLanguage', () => ({ useAskLanguage: () => ['zh', vi.fn()] }));
vi.mock('../services/chatListening', () => ({
  useAllChatListening: () => ({ conversations: {}, default_on: false }),
  loadRevealed: () => new Set(),
  refreshChatListening: vi.fn(async () => {}),
}));
const api = vi.hoisted(() => ({
  listClaudeThreads: vi.fn(),
  createClaudeThread: vi.fn(),
  getClaudeThread: vi.fn(),
  sendClaudeThreadMessage: vi.fn(),
  retryClaudeThreadMessage: vi.fn(),
}));
vi.mock('../api/claudeThreads', () => api);
vi.mock('../api/client', () => ({
  API_BASE: '',
  apiErrorStatus: (e: { status?: number } | null) => e?.status,
  getMyRelationships: vi.fn(async () => ({ tutors: [], students: [] })),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { db } from '../db/database';
import { ChatsPage } from './ChatsPage';

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function person(conv: string, over: Record<string, unknown> = {}) {
  return {
    conversation_id: conv,
    relationship_id: `rel-${conv}`,
    title: null,
    is_ai: false,
    other_user: { id: `u-${conv}`, name: 'Minghui', picture_url: null },
    other_role: 'tutor',
    last_message: { id: `m-${conv}`, sender_id: `u-${conv}`, preview: '明天上课见！', created_at: ago(60) },
    unread: 0,
    last_activity_at: ago(60),
    ...over,
  };
}
function thread(id: string, over: Record<string, unknown> = {}) {
  return {
    id, client_id: null, title: '我昨天去了商店买东西了', context_kind: 'general', context: { kind: 'general' }, badge: null, first_intent: 'ask',
    preview: '很好！', last_message_at: ago(5), created_at: ago(6), unread: 0, pending: false, failed: false, read_only: false, archived: false,
    tutor_visible: null, language: null, source: 'app', ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
let location = '';
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const qa = (id: string) => Array.from(host.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const waitFor = async (pred: () => boolean, what: string) => {
  for (let i = 0; i < 80 && !pred(); i++) await flush();
  if (!pred()) throw new Error(`timed out waiting for ${what}\n${host.innerHTML.slice(0, 2000)}`);
};
const setOnline = (on: boolean) => {
  net.online = on;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
};
const kinds = () => qa('chats-item').map((el) => `${el.dataset.kind}:${el.querySelector('.chats-row-name')?.textContent}`);

function Where() {
  location = useLocation().pathname + useLocation().search;
  return null;
}

async function render(path = '/chats') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Routes>
            <Route path="/chats" element={<ChatsPage />} />
            <Route path="/chats/claude/:id" element={<div data-testid="thread-page" />} />
            <Route path="/cards/:noteId" element={<div data-testid="card-hub" />} />
            <Route path="/connections/:relId/chat/:convId" element={<div data-testid="person-chat" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await flush();
}

function typeInto(el: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  await db.claudeThreads.clear();
  await db.claudeMessages.clear();
  await db.claudeOutbox.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.listClaudeThreads.mockResolvedValue({ threads: [], deleted_ids: [], server_time: new Date().toISOString() });
  track.mockClear();
  chatList.rows = [];
  role.value = { hasStudents: false, hasTutor: true, isTutorOnly: false, loaded: true, isTutorAccount: false };
  setOnline(true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('ChatsPage — the learner', () => {
  it('people first (unread tutor on top), a divider, then Claude — one line each, no previews', async () => {
    chatList.rows = [person('c1', { unread: 2, last_activity_at: ago(120) })];
    api.listClaudeThreads.mockResolvedValue({
      threads: [
        thread('t1'),
        thread('t2', { title: '银行 和 行 的读音', context_kind: 'card', context: { kind: 'card', note_id: 'n1', label: '银行' }, last_message_at: ago(30) }),
        thread('t3', { title: '你好', first_intent: 'check', last_message_at: ago(200) }),
      ],
      deleted_ids: [],
      server_time: new Date().toISOString(),
    });
    await render();
    await waitFor(() => qa('chats-item').length === 4, 'four rows');
    expect(kinds()).toEqual(['tutor:Minghui', 'claude:我昨天去了商店买东西了', 'claude:银行 和 行 的读音', 'claude:你好']);
    // Two sections with the divider between them; the kind in words for screen readers only.
    expect(q('chats-people')!.querySelectorAll('[data-testid="chats-item"]')).toHaveLength(1);
    expect(q('chats-claude')!.querySelectorAll('[data-testid="chats-item"]')).toHaveLength(3);
    expect(q('chats-divider')).not.toBeNull();
    expect(qa('chats-row-kind').map((el) => el.textContent)).toEqual([', Tutor']);
    expect(qa('chats-item')[0].className).toContain('chats-row-pinned');
    // No previews, no filter chips, no "To:".
    expect(host.textContent).not.toContain('很好！');
    expect(host.textContent).not.toContain('明天上课见');
    expect(q('chats-filter-all')).toBeNull();
    expect(q('chats-compose-to')).toBeNull();
    // A Claude row's context is ONE emoji.
    expect(qa('chats-context-chip').map((el) => el.textContent?.trim())).toEqual(['📇', '✏️']);
    expect(qa('chats-context-chip')[0].getAttribute('aria-label')).toBe('Asked on card · 银行 — more');
  });

  it('the context emoji: a popover with the full text and "Open card ›"; the row still opens the thread', async () => {
    api.listClaudeThreads.mockResolvedValue({
      threads: [
        thread('t2', { title: '栋 怎么用', context_kind: 'card', context: { kind: 'card', note_id: 'n1', label: '栋' } }),
        thread('t3', { title: '你好', first_intent: 'check', last_message_at: ago(200) }),
      ],
      deleted_ids: [],
      server_time: new Date().toISOString(),
    });
    await render();
    await waitFor(() => qa('chats-item').length === 2, 'two rows');
    expect(q('chats-context-pop')).toBeNull();
    await act(async () => qa('chats-context-chip')[0].click());
    expect(location).toBe('/chats');
    expect(q('chats-context-pop')!.textContent).toContain('Asked on card · 栋');
    expect(q('chats-context-open')!.textContent).toBe('Open card ›');
    expect(track).toHaveBeenCalledWith('chats.context_info', { context_kind: 'card', action: 'show' });
    // A Check chat has no target: the text only.
    await act(async () => qa('chats-context-chip')[1].click());
    expect(q('chats-context-pop')!.textContent).toContain('Check');
    expect(q('chats-context-open')).toBeNull();
    // Escape closes it.
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(q('chats-context-pop')).toBeNull();
    await act(async () => qa('chats-context-chip')[0].click());
    await act(async () => q('chats-context-open')!.click());
    expect(location).toBe('/cards/n1');
    expect(track).toHaveBeenCalledWith('chats.context_info', { context_kind: 'card', action: 'open' });
  });

  it('a Claude row says "Writing…" / "Failed" where the time goes', async () => {
    api.listClaudeThreads.mockResolvedValue({
      threads: [thread('t1', { pending: true }), thread('t2', { title: '失败了', failed: true, last_message_at: ago(50) })],
      deleted_ids: [],
      server_time: new Date().toISOString(),
    });
    await render();
    await waitFor(() => qa('chats-row-status').length === 2, 'two statuses');
    expect(qa('chats-row-status').map((el) => el.getAttribute('aria-label'))).toEqual(['Claude is writing a reply', 'The reply failed — open to retry']);
    expect(qa('chats-row-status')[0].textContent).toContain('Writing…');
  });

  it('no divider with only one kind', async () => {
    chatList.rows = [person('c1')];
    await render();
    await waitFor(() => qa('chats-item').length === 1, 'one row');
    expect(q('chats-divider')).toBeNull();
  });

  it('an old practice chat shows once, as its thread', async () => {
    chatList.rows = [person('c1'), person('p1', { is_ai: true, title: '点菜', other_user: { id: 'claude-ai', name: 'Claude', picture_url: null } })];
    api.listClaudeThreads.mockResolvedValue({
      threads: [thread('pc-p1', { title: '点菜', context_kind: 'practice', context: { kind: 'practice', conversation_id: 'p1', scenario: '点菜' } })],
      deleted_ids: [],
      server_time: new Date().toISOString(),
    });
    await render();
    await waitFor(() => qa('chats-item').length === 2, 'two rows');
    expect(kinds()).toEqual(['tutor:Minghui', 'claude:点菜']);
    expect(q('chats-context-chip')!.getAttribute('aria-label')).toBe('Practice · 点菜 — more');
  });

  it('the box: Chinese → Ask · ✏️ Check · 🔍 Explain; Check starts a thread with that intent and opens it', async () => {
    api.createClaudeThread.mockImplementation(async (body: { client_id: string; intent: string; text: string }) => ({
      thread: thread('srv-1', { client_id: body.client_id, first_intent: body.intent, title: body.text }),
      messages: [],
      server_time: new Date().toISOString(),
    }));
    await render();
    const box = host.querySelector('[data-testid="claude-chat-voice-text"]') as HTMLTextAreaElement;
    expect(box.placeholder).toBe('Ask Claude anything…');
    expect(q('claude-chat-voice-submit')!.textContent).toContain('Ask');
    // Nothing typed yet: no Check / Explain.
    expect(q('claude-composer-check')).toBeNull();
    expect(q('claude-composer-explain')).toBeNull();
    typeInto(box, '我昨天去了商店买东西了');
    await flush();
    // Typed: beside Ask, in its row.
    expect(q('claude-composer-check')!.closest('.voice-input-row')).not.toBeNull();
    expect(q('claude-composer-check')!.textContent).toBe('✏️ Check');
    expect(q('claude-composer-explain')!.textContent).toBe('🔍 Explain');
    expect(q('claude-composer-translate')).toBeNull();
    await act(async () => q('claude-composer-check')!.click());
    await waitFor(() => location.startsWith('/chats/claude/'), 'the thread');
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({ context: { kind: 'general' }, intent: 'check', text: '我昨天去了商店买东西了' }));
    expect(location).toBe('/chats/claude/srv-1?source=chats');
    expect(track).toHaveBeenCalledWith('chats.compose_send', { intent: 'check', offline: false, spoken: false });
  });

  it('the box: English offers Translate; Enter / Ask sends an Ask', async () => {
    api.createClaudeThread.mockImplementation(async (body: { client_id: string; intent: string; text: string }) => ({
      thread: thread('srv-2', { client_id: body.client_id }),
      messages: [],
      server_time: new Date().toISOString(),
    }));
    await render();
    const box = host.querySelector('[data-testid="claude-chat-voice-text"]') as HTMLTextAreaElement;
    typeInto(box, 'How do I say hello?');
    await flush();
    expect(q('claude-composer-translate')!.textContent).toBe('🔤 Translate');
    expect(q('claude-composer-check')).toBeNull();
    await act(async () => fake.current!.land('How do I say hello?'));
    await waitFor(() => location.startsWith('/chats/claude/'), 'the thread');
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({ intent: 'ask' }));
  });

  it('offline: the list comes from the device and a send is queued, then opened', async () => {
    setOnline(false);
    await db.claudeThreads.put({ ...thread('t1', { title: '离线的聊天' }), local: false } as never);
    await render();
    await waitFor(() => qa('chats-item').length === 1, 'the cached row');
    expect(api.listClaudeThreads).not.toHaveBeenCalled();
    const box = host.querySelector('[data-testid="claude-chat-voice-text"]') as HTMLTextAreaElement;
    typeInto(box, '你好');
    await act(async () => fake.current!.land('你好'));
    await waitFor(() => location.startsWith('/chats/claude/'), 'the queued thread');
    expect(api.createClaudeThread).not.toHaveBeenCalled();
    expect(await db.claudeOutbox.count()).toBe(1);
    expect(track).toHaveBeenCalledWith('chats.compose_send', { intent: 'ask', offline: true, spoken: false });
  });
});

describe('ChatsPage — the tutor', () => {
  it('the same layout: students first (no pinning), the divider, her Claude chats; a box with Ask · Translate only', async () => {
    role.value = { hasStudents: true, hasTutor: false, isTutorOnly: true, loaded: true, isTutorAccount: true };
    chatList.rows = [
      person('s1', { other_role: 'student', other_user: { id: 'u-j', name: 'Jerome', picture_url: null }, unread: 1, last_activity_at: ago(300) }),
      person('s2', { other_role: 'student', other_user: { id: 'u-l', name: 'Lily', picture_url: null }, last_activity_at: ago(10) }),
    ];
    api.listClaudeThreads.mockResolvedValue({ threads: [thread('t1', { last_message_at: ago(1) })], deleted_ids: [], server_time: new Date().toISOString() });
    await render();
    await waitFor(() => qa('chats-item').length === 3, 'three rows');
    // No pinning in her view: newest first, then Claude below the divider (the Claude chat is newest).
    expect(kinds()).toEqual(['student:Lily', 'student:Jerome', 'claude:我昨天去了商店买东西了']);
    expect(q('chats-people')!.getAttribute('aria-label')).toBe('Students');
    expect(q('chats-divider')).not.toBeNull();
    expect(qa('chats-row-kind').map((el) => el.textContent)).toEqual([', Student', ', Student']);
    expect(q('chats-filter-all')).toBeNull();

    const box = host.querySelector('[data-testid="claude-chat-voice-text"]') as HTMLTextAreaElement;
    typeInto(box, '这个句子对吗');
    await flush();
    expect(q('claude-composer-check')).toBeNull();
    typeInto(box, 'Good morning');
    await flush();
    expect(q('claude-composer-translate')).not.toBeNull();
  });
});
