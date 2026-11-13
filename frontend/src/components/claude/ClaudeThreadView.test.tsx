/**
 * The Claude thread view (components/claude/ClaudeThreadView.tsx): a reply streams in from the live
 * socket (`claude_turn`, highest seq wins) and lands whole when it's done; a message written offline
 * is queued with client ids, shown at once ("Waiting for a connection") and sent by the outbox when
 * the connection is back; a new general chat offers ✏️ Check / 🔍 Explain for Chinese; a card thread
 * shows its header chip (→ the card hub) and the card's suggestion chips.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ current: null as null | { land: (t: string) => void }, mode: 'typing', blocked: null as string | null, say: null as null | (() => void) }));
vi.mock('../../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { onSubmit: (a: { text: string; source: string; transcript: string | null }) => void }) => {
      const latest = React.useRef(opts);
      latest.current = opts;
      fake.current = { land: (t) => latest.current.onSubmit({ text: t, source: 'typed', transcript: null }) };
      return {
        state: { mode: fake.blocked ? 'type' : fake.mode, phase: 'idle', failure: null, blocked: fake.blocked },
        finalText: '', partialText: '', listening: false, busy: false, level: 0,
        say: () => fake.say?.(), stop: vi.fn(), cancel: vi.fn(), retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: true, reset: vi.fn(),
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
const explorerOpen = vi.hoisted(() => vi.fn());
vi.mock('../explorer/ExplorerContext', () => ({
  useExplorer: () => ({ open: explorerOpen, push: vi.fn(), inside: false }),
  ExplorerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../../db/database';
import { ClaudeThreadView } from './ClaudeThreadView';
import { flushClaudeOutbox } from '../../services/claudeThreads';
import type { ClaudeContextSnapshot, ClaudeThreadContext } from '@shared/claude/context';

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

async function render(props: { threadId: string; newContext?: ClaudeThreadContext & ClaudeContextSnapshot; initialDraft?: string; onThreadCreated?: (id: string) => void; autoListen?: boolean; onAutoListen?: (l: boolean) => void; hideBack?: boolean }) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/chats/claude/x']}>
        <Routes>
          <Route path="/chats/claude/:id" element={<ClaudeThreadView {...props} />} />
          <Route path="/cards/:noteId" element={<div data-testid="card-hub" />} />
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
  fake.mode = 'typing';
  fake.blocked = null;
  fake.say = null;
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

describe('ClaudeThreadView', () => {
  it('"✓ Added 2 cards": each word is a chip that opens the explorer on it, the cards marked as just added', async () => {
    explorerOpen.mockClear();
    const results = JSON.stringify([
      { tool: 'create_flashcards', success: true, data: { deck_id: 'src-claude', deck_name: 'From Claude', deck_source_key: 'claude', notes: [{ id: 'n1', hanzi: '机会', pinyin: 'jīhuì', english: 'opportunity' }, { id: 'n2', hanzi: '这次机会很难得。', pinyin: 'zhè cì jīhuì hěn nándé.', english: 'This chance is rare.' }] } },
    ]);
    api.getClaudeThread.mockResolvedValue({ thread: threadRow('t1'), messages: [msg('u1', 't1', 'user', '帮我做两张卡片'), msg('a1', 't1', 'assistant', '好的，我做了两张卡片。', { tool_results: results })], server_time: T0 });
    await render({ threadId: 't1' });
    await waitFor(() => host.querySelectorAll('[data-testid="added-card-chip"]').length === 2, 'the word chips');
    expect(q('claude-added-cards')!.textContent).toContain('✓ 2 cards added to From Claude');
    const chips = [...host.querySelectorAll('[data-testid="added-card-chip"]')] as HTMLButtonElement[];
    expect(chips.map((c) => c.textContent)).toEqual(['机会›', '这次机会很难得。›']);
    await act(async () => chips[1].click());
    const justAdded = [
      { noteId: 'n1', hanzi: '机会', deckId: 'src-claude', deckName: 'From Claude' },
      { noteId: 'n2', hanzi: '这次机会很难得。', deckId: 'src-claude', deckName: 'From Claude' },
    ];
    // A sentence card opens the Word view on its characters (punctuation dropped), with its pinyin / meaning.
    expect(explorerOpen).toHaveBeenCalledWith({ kind: 'word', hanzi: '这次机会很难得', pinyin: 'zhè cì jīhuì hěn nándé.', gloss: 'This chance is rare.' }, { source: 'claude_card', justAdded });
    expect(track).toHaveBeenCalledWith('claude.added_card_open', { surface: 'thread', count: 2 });
  });

  it('a card thread\'s "✓ Added 1 card" (the server\'s created notes) is a chip too', async () => {
    explorerOpen.mockClear();
    const results = JSON.stringify([{ tool: 'create_flashcards', success: true, data: { created: [{ id: 'n9', hanzi: '取钱', pinyin: 'qǔqián', english: 'withdraw money' }], count: 1, targetDeckId: 'src-claude', deck_name: 'From Claude', deck_source_key: 'claude' } }]);
    api.getClaudeThread.mockResolvedValue({ thread: threadRow('t2', { context_kind: 'card', context: { kind: 'card', note_id: 'n0' } }), messages: [msg('u1', 't2', 'user', '做一张卡'), msg('a1', 't2', 'assistant', '好的。', { tool_results: results })], server_time: T0 });
    await render({ threadId: 't2' });
    await waitFor(() => host.querySelectorAll('[data-testid="added-card-chip"]').length === 1, 'the word chip');
    expect(q('claude-added-cards')!.textContent).toContain('✓ Added to From Claude');
    await act(async () => (host.querySelector('[data-testid="added-card-chip"]') as HTMLButtonElement).click());
    expect(explorerOpen).toHaveBeenCalledWith({ kind: 'word', hanzi: '取钱', pinyin: 'qǔqián', gloss: 'withdraw money' }, { source: 'claude_card', justAdded: [{ noteId: 'n9', hanzi: '取钱', deckId: 'src-claude', deckName: 'From Claude' }] });
  });

  it('the ✦ Claude tab: 🎤 starts at once, once, and no ← on the tab root', async () => {
    fake.mode = 'voice';
    const say = vi.fn();
    fake.say = say;
    const heard: boolean[] = [];
    await render({ threadId: 'new', newContext: { kind: 'general' }, autoListen: true, hideBack: true, onAutoListen: (l) => heard.push(l) });
    await flush();
    expect(say).toHaveBeenCalledTimes(1);
    expect(heard).toEqual([true]);
    expect(q('claude-thread-back')).toBeNull();
    expect(q('claude-thread-empty')).toBeTruthy();
  });

  it('the ✦ Claude tab offline: stays on typing (the box says why), no 🎤', async () => {
    fake.mode = 'voice';
    fake.blocked = 'offline';
    const say = vi.fn();
    fake.say = say;
    const heard: boolean[] = [];
    await render({ threadId: 'new', newContext: { kind: 'general' }, autoListen: true, onAutoListen: (l) => heard.push(l) });
    expect(say).not.toHaveBeenCalled();
    expect(heard).toEqual([false]);
  });

  it('a thread opened any other way never starts the 🎤 by itself', async () => {
    fake.mode = 'voice';
    const say = vi.fn();
    fake.say = say;
    await render({ threadId: 'new', newContext: { kind: 'general' } });
    expect(say).not.toHaveBeenCalled();
    expect(q('claude-thread-back')).toBeTruthy();
  });

  it('streams a reply from the live socket, then shows it whole', async () => {
    const pending = msg('a1', 't1', 'assistant', '', { status: 'pending' });
    api.getClaudeThread.mockResolvedValue({ thread: threadRow('t1', { pending: true }), messages: [msg('u1', 't1', 'user', '你好吗？'), pending], server_time: T0 });
    await render({ threadId: 't1' });
    await waitFor(() => !!q('claude-chat-pending'), 'the pending reply');

    await act(async () => live.emit({ type: 'claude_turn', thread_id: 't1', message_id: 'a1', seq: 1, status: 'streaming', text: '这是一个好问题。' }));
    await waitFor(() => !!q('claude-chat-streaming'), 'the streaming bubble');
    expect(q('claude-chat-streaming')!.textContent).toContain('这是一个好问题。');
    await act(async () => live.emit({ type: 'claude_turn', thread_id: 't1', message_id: 'a1', seq: 3, status: 'streaming', text: '这是一个好问题。我用简单的中文回答你。' }));
    // An older frame arriving late changes nothing.
    await act(async () => live.emit({ type: 'claude_turn', thread_id: 't1', message_id: 'a1', seq: 2, status: 'streaming', text: '这是一个好问题。我' }));
    await waitFor(() => q('claude-chat-streaming')?.textContent?.includes('回答你') ?? false, 'the longer text');
    // Another thread's frames are ignored.
    await act(async () => live.emit({ type: 'claude_turn', thread_id: 'other', message_id: 'a1', seq: 9, status: 'streaming', text: 'x' }));

    const done = msg('a1', 't1', 'assistant', '这是一个好问题。我用简单的中文回答你。');
    api.getClaudeThread.mockResolvedValue({ thread: threadRow('t1'), messages: [done], server_time: '2026-11-03T10:00:05.000Z' });
    await act(async () => live.emit({ type: 'claude_turn', thread_id: 't1', message_id: 'a1', seq: 4, status: 'done', text: done.content }));
    await waitFor(() => !!q('claude-chat-reply') && !q('claude-chat-streaming'), 'the finished reply');
    expect(q('claude-chat-reply')!.textContent).toContain('回答你');
    expect(api.getClaudeThread).toHaveBeenLastCalledWith('t1', T0);
    expect(track).toHaveBeenCalledWith('claude.reply_shown', expect.objectContaining({ via: 'socket', intent: 'ask', context_kind: 'general' }));
    // Once the thread has a message: no suggestion chips.
    expect(q('claude-thread-chips')).toBeNull();
  });

  it('offline: the first message is queued, shown at once, and sent when the connection is back', async () => {
    setOnline(false);
    const created: string[] = [];
    await render({ threadId: 'new', newContext: { kind: 'general' }, onThreadCreated: (id) => created.push(id) });
    expect(q('claude-thread-empty')).toBeTruthy();
    await act(async () => fake.current!.land('成都有什么好吃的？'));
    await flush();
    expect(created).toHaveLength(1);
    expect(api.createClaudeThread).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('claude.message_send', expect.objectContaining({ intent: 'ask', offline: true, context_kind: 'general' }));
    expect(await db.claudeOutbox.count()).toBe(1);

    // The page moves to the thread's (client) id: my bubble, waiting for a connection.
    await render({ threadId: created[0] });
    await waitFor(() => !!q('claude-chat-queued'), 'the queued bubble');
    expect(q('claude-chat-mine')!.textContent).toContain('成都有什么好吃的？');

    // Back online: the outbox creates the thread with the same client ids.
    setOnline(true);
    const [entry] = await db.claudeOutbox.toArray();
    api.createClaudeThread.mockImplementation(async (body: { client_id: string; message_client_id: string }) => ({
      thread: threadRow('s1', { client_id: body.client_id, pending: true }),
      messages: [msg('su1', 's1', 'user', '成都有什么好吃的？', { client_id: body.message_client_id }), msg('sa1', 's1', 'assistant', '', { status: 'pending' })],
    }));
    await act(async () => { await flushClaudeOutbox(); });
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({ client_id: created[0], message_client_id: entry.client_id, intent: 'ask', context: { kind: 'general' } }));
    expect(await db.claudeOutbox.count()).toBe(0);
    expect(await db.claudeThreads.get(created[0])).toBeUndefined();
    expect((await db.claudeMessages.where('thread_id').equals('s1').toArray()).map((m) => m.id).sort()).toEqual(['sa1', 'su1']);
    // The screen follows the thread to its server id.
    api.getClaudeThread.mockResolvedValue({
      thread: threadRow('s1', { client_id: created[0], pending: true }),
      messages: [msg('su1', 's1', 'user', '成都有什么好吃的？', { client_id: entry.client_id }), msg('sa1', 's1', 'assistant', '', { status: 'pending' })],
      server_time: T0,
    });
    await waitFor(() => !q('claude-chat-queued') && !!q('claude-chat-pending'), 'the sent message and its pending reply');
  });

  it('a new general chat offers ✏️ Check / 🔍 Explain for Chinese and starts the thread with that intent', async () => {
    api.createClaudeThread.mockImplementation(async (body: { client_id: string }) => ({
      thread: threadRow('s2', { client_id: body.client_id, first_intent: 'check' }),
      messages: [msg('u', 's2', 'user', '我昨天去了商店', { intent: 'check' }), msg('a', 's2', 'assistant', '', { status: 'pending', content_type: 'analysis' })],
    }));
    const created: string[] = [];
    await render({ threadId: 'new', initialDraft: '我昨天去了商店', onThreadCreated: (id) => created.push(id) });
    expect(q('claude-composer-check')).toBeTruthy();
    expect(q('claude-composer-explain')).toBeTruthy();
    expect(q('claude-composer-translate')).toBeNull();
    await act(async () => q('claude-composer-check')!.click());
    await flush();
    expect(api.createClaudeThread).toHaveBeenCalledWith(expect.objectContaining({ intent: 'check', text: '我昨天去了商店' }));
    expect(created).toEqual(['s2']);
    expect(track).toHaveBeenCalledWith('claude.message_send', expect.objectContaining({ intent: 'check', offline: false }));
  });

  it('a card thread: the header chip opens the card hub; no chips once started; Ask only', async () => {
    api.getClaudeThread.mockResolvedValue({
      thread: threadRow('c1', { context_kind: 'card', context: { kind: 'card', note_id: 'n1', label: '银行' }, title: '银行和很行有什么不同？' }),
      messages: [msg('u1', 'c1', 'user', '银行和很行有什么不同？'), msg('a1', 'c1', 'assistant', '银行是 bank。')],
      server_time: T0,
    });
    await render({ threadId: 'c1' });
    await waitFor(() => !!q('claude-thread-context-chip'), 'the context chip');
    expect(q('claude-thread-context-chip')!.textContent).toContain('Asked on card · 银行');
    // A started thread: no suggestion chips.
    expect(q('claude-thread-chips')).toBeNull();
    expect(q('claude-composer-intents')).toBeNull();
    await act(async () => q('claude-thread-context-chip')!.click());
    await flush();
    expect(q('card-hub')).toBeTruthy();
  });

  it('a practice chat is read-only', async () => {
    api.getClaudeThread.mockResolvedValue({
      thread: threadRow('p1', { context_kind: 'practice', context: { kind: 'practice', conversation_id: 'c9', scenario: '点菜' }, read_only: true }),
      messages: [msg('a1', 'p1', 'assistant', '你好，想吃点什么？')],
      server_time: T0,
    });
    await render({ threadId: 'p1' });
    await waitFor(() => !!q('claude-thread-readonly'), 'the read-only note');
    expect(q('claude-thread-context-chip')!.textContent).toContain('Practice · 点菜');
    expect(q('claude-chat-composer')).toBeNull();
  });
});
