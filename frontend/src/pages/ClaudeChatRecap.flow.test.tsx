/**
 * 📝 "N words to recap" in a "💬 Ask Claude" chat, end to end on the web: words tapped in Claude's
 * answer are kept for the thread → the ⋯ menu shows "📝 2 words to recap" (none before) → the
 * readers' word recap pass with the chat as its source (the message's sentence as the cue, "from
 * your chat with Claude") → every switch OFF by default → Done adds ONLY the switched-on new word as
 * a card in "From my chats" (+ Up next, source chat_recap) and bumps the switched-on word he already
 * has → back in the chat the entry is gone (nothing left to recap).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../hooks/useVoiceDictation', () => ({
  useVoiceDictation: () => ({
    state: { mode: 'voice', phase: 'idle', failure: null, blocked: null },
    finalText: '', partialText: '', listening: false, busy: false, level: 0,
    say: vi.fn(), stop: vi.fn(), cancel: vi.fn(), retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: false, reset: vi.fn(),
  }),
}));
const track = vi.fn();
vi.mock('../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
const msg = (id: string, role: 'user' | 'assistant', content: string, extra: Record<string, unknown> = {}) => ({
  id, thread_id: 't1', client_id: null, role, content_type: 'text', content, intent: role === 'user' ? 'ask' : null, status: null, streaming: false,
  error: null, answer_lang: null, translation: null, tool_results: null, created_at: `2026-11-03T10:00:0${role === 'user' ? 1 : 2}.000Z`, updated_at: null, ...extra,
});
const api = vi.hoisted(() => ({
  getClaudeThread: vi.fn(async () => ({
    thread: {
      id: 't1', client_id: null, title: '成都有什么好吃的？', context_kind: 'general', context: { kind: 'general' }, badge: null, first_intent: 'ask', preview: '成都的火锅很辣。',
      last_message_at: '2026-11-03T10:00:02.000Z', created_at: '2026-11-03T10:00:01.000Z', unread: 0, pending: false, failed: false, read_only: false, archived: false,
      tutor_visible: null, language: null, source: 'coach',
    },
    messages: [msg('u1', 'user', '成都有什么好吃的？'), msg('a1', 'assistant', '成都的火锅很辣。', { answer_lang: 'zh' })],
    server_time: '2026-11-03T10:00:03.000Z',
  })),
  createDeck: vi.fn(async (name: string) => ({ id: 'deck-chats', name })),
  getDecks: vi.fn(async () => []),
  moveDeck: vi.fn(async () => ({})),
  glossWords: vi.fn(async (w: Array<{ hanzi: string; pinyin?: string; english?: string }>) => w.map((x) => ({ hanzi: x.hanzi, pinyin: x.pinyin || 'huǒguō', english: x.english || 'hot pot' }))),
  enrichWords: vi.fn(async (w: Array<{ hanzi: string }>) => w.map((x) => ({ hanzi: x.hanzi, fun_facts: `${x.hanzi} explained`, sentence_clue: '', sentence_clue_pinyin: '', sentence_clue_translation: '' }))),
  createNotesBatch: vi.fn(async (_deck: string, notes: Array<{ hanzi: string }>) => ({ created: notes.map((n, i) => ({ id: `new-${i}`, hanzi: n.hanzi })), failed: [] })),
  addUpNextApi: vi.fn(async () => ({})),
  bumpNotes: vi.fn(async (ids: string[]) => ({ added: ids, already: [], message: '' })),
}));
vi.mock('../api/claudeThreads', () => ({ getClaudeThread: api.getClaudeThread, createClaudeThread: vi.fn(), sendClaudeThreadMessage: vi.fn(), retryClaudeThreadMessage: vi.fn() }));
vi.mock('../services/chatLive', () => ({ chatLive: { acquire: () => () => {}, onEvent: () => () => {}, onStatus: () => () => {}, getStatus: () => 'idle' } }));
vi.mock('../api/client', () => ({
  API_BASE: '', apiErrorStatus: () => undefined, backfillReaderWords: vi.fn(), setAskClaudeListening: vi.fn(),
  proposeCoachFlashcards: vi.fn(), translateCoachMessage: vi.fn(), getConversation: vi.fn(), requestCoachMistakeLesson: vi.fn(), saveCoachMistakeLesson: vi.fn(),
  createDeck: api.createDeck, getDecks: api.getDecks, moveDeck: api.moveDeck, glossWords: api.glossWords,
  enrichWords: api.enrichWords, createNotesBatch: api.createNotesBatch,
}));
vi.mock('../api/upNext', () => ({ addUpNextApi: api.addUpNextApi }));
vi.mock('../services/studyBumps', () => ({ bumpNotes: api.bumpNotes }));
vi.mock('../services/askClaudeLanguage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/askClaudeLanguage')>()),
  useAskLanguage: () => ['zh', vi.fn()],
}));
vi.mock('../services/askClaudeListening', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/askClaudeListening')>()),
  useAskListening: () => [false, vi.fn()],
}));
vi.mock('../services/wordDict', () => ({ lookupWords: vi.fn(async () => new Map()) }));
vi.mock('../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: true }) }));
vi.mock('../services/chineseSegmenter', () => ({
  useSegmentedWords: (text: string, enabled = true) =>
    enabled && text === '成都的火锅很辣。' ? ['成都', '的', '火锅', '很', '辣', '。'].map((t) => ({ text: t, pinyin: '', gloss: '' })) : null,
  preloadSegmenter: () => {},
}));
vi.mock('../services/ttsCache', () => ({ getTTSWithCache: vi.fn(async () => null) }));
vi.mock('../services/audioCache', () => ({ speakWithBrowserTTS: vi.fn(async () => undefined) }));
vi.mock('../components/editor/useLessonSpeak', () => ({ useLessonSpeak: () => vi.fn() }));
vi.mock('../components/Confetti', () => ({ Confetti: () => <div data-testid="confetti" /> }));
const explorerOpen = vi.fn();
vi.mock('../components/explorer/ExplorerContext', () => ({
  useExplorer: () => ({ open: explorerOpen, push: vi.fn(), inside: false }),
  ExplorerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db } from '../db/database';
import { ClaudeThreadPage } from './ClaudeThreadPage';
import { ClaudeChatRecapPage } from './ClaudeChatRecapPage';
import { clearRecapWords, resetRecapMemory } from '../services/claudeChatRecap';
import { recapDb } from '../services/wordRecap';

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const waitFor = async (id: string) => {
  for (let i = 0; i < 50 && !q(id); i++) await flush();
  expect(q(id)).toBeTruthy();
};
const chip = (text: string) => [...host.querySelectorAll('[data-testid="claude-chat-reply"] .chat-word')].find((c) => c.textContent === text) ?? null;

beforeEach(async () => {
  await recapDb().runs.clear();
  await recapDb().adds.clear();
  clearRecapWords('t1');
  resetRecapMemory();
  // 成都 is already one of his cards: its switch is ⚡ Study it today.
  await db.notes.clear();
  await db.claudeThreads.clear();
  await db.claudeMessages.clear();
  await db.notes.put({ id: 'note-chengdu', deck_id: 'd1', hanzi: '成都', pinyin: 'Chéngdū', english: 'Chengdu' } as never);
  Object.values(api).forEach((f) => f.mockClear());
  track.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/chats/claude/t1']}>
        <Routes>
          <Route path="/chats/claude/:id" element={<ClaudeThreadPage />} />
          <Route path="/chats/claude/:id/recap" element={<ClaudeChatRecapPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Ask Claude chat → 📝 words to recap', () => {
  it('opens the readers’ recap pass on the chat’s words and adds only the switched-on ones', async () => {
    // Nothing tapped yet: no recap row in the menu.
    await waitFor('claude-chat-reply');
    await click(q('claude-thread-more'));
    expect(q('claude-thread-menu')).toBeTruthy();
    expect(q('claude-thread-recap')).toBeNull();
    await click(q('claude-thread-menu')?.parentElement);

    // Tap 成都 and 火锅 in Claude's answer (→ the explorer, and kept to recap).
    await click(chip('成都'));
    await click(chip('火锅'));
    expect(explorerOpen).toHaveBeenCalledTimes(2);

    await click(q('claude-thread-more'));
    const entry = q('claude-thread-recap') as HTMLButtonElement;
    expect(entry.textContent).toBe('📝 2 words to recap');
    expect(entry.disabled).toBe(false);
    await click(entry);
    await waitFor('recap-card');
    expect(track).toHaveBeenCalledWith('coach.ask_recap_start', { from: 'menu', words: 2 });

    // The pass: chat order, the message's sentence as the cue, the chat as the source.
    expect(q('recap-source')?.textContent).toBe('from your chat with Claude');
    expect(q('recap-card')?.textContent).toContain('成都');
    expect(q('recap-sentence')?.textContent).toBe('成都的火锅很辣。');
    await click(q('recap-show'));
    expect(q('recap-why')?.textContent).toBe('You tapped it in the chat');
    expect(q('recap-keep')?.textContent).toContain('⚡ Study it today');
    expect((q('recap-keep-switch') as HTMLInputElement).checked).toBe(false);
    await click(q('recap-keep-switch'));
    await click(q('recap-got-it'));

    expect(q('recap-card')?.textContent).toContain('火锅');
    await click(q('recap-show'));
    expect(q('recap-keep')?.textContent).toContain('Add to my long-term review');
    await click(q('recap-not-yet'));
    // 火锅 comes back until Got it; switch it on on the second showing.
    expect(q('recap-card')?.textContent).toContain('火锅');
    await click(q('recap-show'));
    await click(q('recap-keep-switch'));
    await click(q('recap-got-it'));

    expect(q('recap-summary')?.textContent).toContain('Recap done');
    expect(q('recap-summary')?.textContent).toContain('the rest were just for this chat');
    await click(q('recap-done'));
    await flush();
    expect(q('recap-done-line')?.textContent).toBe('1 word added to your long-term review · 1 for today ⚡');
    expect(api.createDeck).toHaveBeenCalledWith('From my chats', 'Words you chose to keep from your chats with Claude.');
    expect(api.moveDeck).toHaveBeenCalledWith('deck-chats', 'bottom');
    expect(api.createNotesBatch).toHaveBeenCalledTimes(1);
    const [deckId, notes] = api.createNotesBatch.mock.calls[0] as unknown as [string, Array<Record<string, string>>];
    expect(deckId).toBe('deck-chats');
    expect(notes.map((n) => n.hanzi)).toEqual(['火锅']);
    expect(notes[0]).toMatchObject({ english: 'hot pot', sentence_clue: '成都的火锅很辣。', fun_facts: '火锅 explained' });
    expect(api.addUpNextApi).toHaveBeenCalledWith({ note_ids: ['new-0'], position: 'bottom', source: 'chat_recap' });
    expect(api.bumpNotes).toHaveBeenCalledWith(['note-chengdu'], 'coach_chat');
    expect(track).toHaveBeenCalledWith('coach.ask_recap_finish', { words: 2, got_it_first_time: 1, added: 1, bumped: 1 });
    expect(await recapDb().adds.count()).toBe(0);

    // Back in the chat (Done leaves): nothing left to recap — the entry is gone.
    await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });
    await waitFor('claude-thread');
    await waitFor('claude-chat-reply');
    await click(q('claude-thread-more'));
    expect(q('claude-thread-recap')).toBeNull();
  });
});
