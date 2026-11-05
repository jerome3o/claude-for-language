/**
 * A Claude chat's thread (components/claudeChat): Claude's Chinese answer is word chips with
 * ▶ / 拼 / EN / 🎤 Read it back under it, an English answer is Markdown with no tools, a tapped word
 * is kept as a word to recap for the thread, a Read it back marks the message in place and adds the
 * words with a real mistake, a pending reply thinks and a failed one offers Retry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ current: null as null | { land: (t: string) => void } }));
vi.mock('../../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { onSubmit: (a: { text: string; source: string; transcript: string | null; via?: string }) => void }) => {
      const [phase, setPhase] = React.useState<string>('idle');
      const latest = React.useRef(opts);
      latest.current = opts;
      fake.current = { land: (t) => { setPhase('idle'); latest.current.onSubmit({ text: t, source: 'spoken', transcript: t, via: 'live' }); } };
      return {
        state: { mode: 'voice', phase, failure: null, blocked: null },
        finalText: '', partialText: '', listening: phase === 'listening', busy: false, level: 0,
        say: () => setPhase('listening'), stop: () => setPhase('finishing'), cancel: vi.fn(),
        retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: false, reset: vi.fn(),
      };
    },
  };
});
const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
vi.mock('../../api/client', () => ({ API_BASE: '', backfillReaderWords: vi.fn(), apiErrorStatus: () => undefined, setAskClaudeListening: vi.fn() }));
const SEGMENTS: Record<string, string[]> = {
  '成都的火锅很辣。': ['成都', '的', '火锅', '很', '辣', '。'],
  '成都有什么好吃的？': ['成都', '有', '什么', '好吃', '的', '？'],
  '我已经把说明改成英文了。': ['我', '已经', '把', '说明', '改成', '英文', '了', '。'],
};
vi.mock('../../services/chineseSegmenter', () => ({
  useSegmentedWords: (text: string, enabled = true) => (enabled && SEGMENTS[text] ? SEGMENTS[text].map((t) => ({ text: t, pinyin: '', gloss: '' })) : null),
  preloadSegmenter: () => {},
}));
vi.mock('../../services/ttsCache', () => ({ getTTSWithCache: vi.fn(async () => null) }));
vi.mock('../../services/audioCache', () => ({ speakWithBrowserTTS: vi.fn(async () => undefined) }));

import { MemoryRouter } from 'react-router-dom';
import { ExplorerProvider } from '../explorer/ExplorerContext';
import { ClaudeChatThread, type ClaudeChatMessage } from './ClaudeChatThread';
import { getRecapWords, clearRecapWords } from '../../services/claudeChatRecap';

const MESSAGES: ClaudeChatMessage[] = [
  { id: 'u1', role: 'user', text: '成都有什么好吃的？' },
  { id: 'a1', role: 'assistant', text: '成都的火锅很辣。', answer_lang: 'zh' },
  { id: 'u2', role: 'user', text: 'In English please' },
  { id: 'a2', role: 'assistant', text: 'Hot pot is **spicy**.', answer_lang: 'en' },
];

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const onRetry = vi.fn();

async function render(messages: ClaudeChatMessage[]) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ExplorerProvider>
          <ClaudeChatThread threadId="t1" messages={messages} listening={false} thinkingLabel="Thinking…" onTranslate={async () => 'Chengdu hot pot is spicy.'} onRetry={onRetry} />
        </ExplorerProvider>
      </MemoryRouter>,
    ),
  );
  await flush();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
  clearRecapWords('t1');
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('ClaudeChatThread', () => {
  it('Chinese answers: chips + ▶ / 拼 / EN / 🎤; English answers: Markdown, no tools', async () => {
    await render(MESSAGES);
    const replies = host.querySelectorAll('[data-testid="claude-chat-reply"]');
    expect(replies).toHaveLength(2);
    expect([...replies[0].querySelectorAll('.chat-word')].map((c) => c.textContent)).toEqual(['成都', '的', '火锅', '很', '辣']);
    expect(replies[0].querySelector('[data-testid="claude-chat-read-back"]')?.getAttribute('aria-label')).toBe('Read it back');
    expect(replies[1].querySelector('strong')?.textContent).toBe('spicy');
    expect(replies[1].querySelector('[data-testid="claude-chat-play"]')).toBeNull();
    // EN: the translation under the bubble.
    await act(async () => q('claude-chat-translate')!.click());
    await flush();
    expect(q('chat-translation')?.textContent).toBe('Chengdu hot pot is spicy.');
  });

  it('a tapped word is kept to recap (mine and Claude’s)', async () => {
    await render(MESSAGES);
    const chip = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="claude-chat-reply"] .chat-word')].find((c) => c.textContent === '火锅')!;
    await act(async () => chip.click());
    expect(getRecapWords('t1')).toEqual([{ hanzi: '火锅', sentence: '成都的火锅很辣。', reasons: ['tapped'] }]);
    expect(track).toHaveBeenCalledWith('coach.ask_tool', { action: 'word', role: 'claude' });
  });

  it('🎤 Read it back: marks the message in place and keeps the words said wrong', async () => {
    await render(MESSAGES);
    await act(async () => q('claude-chat-read-back')!.click());
    await act(async () => fake.current!.land('成都的活过很拉'));
    await flush();
    const marked = [...host.querySelectorAll<HTMLElement>('.ra-char')].map((e) => [e.textContent, e.dataset.mark]);
    expect(marked).toContainEqual(['辣', 'close']);
    expect(q('reader-read-aloud-line')?.textContent).toMatch(/to check/);
    expect(getRecapWords('t1').map((w) => [w.hanzi, w.reasons])).toEqual([['火锅', ['said_wrong']], ['辣', ['said_wrong']]]);
    expect(track).toHaveBeenCalledWith('coach.ask_read_back', expect.objectContaining({ wrong_words: 2, via: 'live' }));
  });

  it('my checked Chinese: ✎ + Open in Coach; a right-click opens the menu with How to say it better first', async () => {
    const onOpenInCoach = vi.fn();
    const check = {
      text: '成都有什么好吃的？', status: 'improvable', corrected: '成都有什么好吃的东西？', corrected_pinyin: '', corrected_english: '', mistakes: [{ quote: '好吃的', fix: '好吃的东西', why: 'x', card: null }],
      alternative: null, severity: 'moderate', card: null, checked_at: '2026-11-03T10:00:00.000Z',
    } as unknown as import('@shared/chats/autoCheck').AutoCheckResult;
    await act(async () =>
      root.render(
        <MemoryRouter>
          <ExplorerProvider>
            <ClaudeChatThread threadId="t1" messages={[{ ...MESSAGES[0], auto_check: check }, MESSAGES[1]]} listening={false} thinkingLabel="Thinking…" onTranslate={async () => null} onRetry={onRetry} onOpenInCoach={onOpenInCoach} />
          </ExplorerProvider>
        </MemoryRouter>,
      ),
    );
    await flush();
    const mine = q('claude-chat-mine')!;
    expect(mine.querySelector('[data-testid="chat-saybetter-mark"]')).toBeTruthy();
    await act(async () => (mine.querySelector('[data-testid="chat-open-in-coach"]') as HTMLElement).click());
    expect(onOpenInCoach).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'chip');
    await act(async () => mine.querySelector('.chat-bubble')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })));
    await flush();
    const tools = [...document.querySelectorAll('[data-testid="message-menu"] [data-tool]')].map((b) => b.getAttribute('data-tool'));
    expect(tools[0]).toBe('say_better');
    expect(tools).toContain('open_coach');
    // Claude's Chinese reply: Copy · Translate · Pinyin · Explain · Save as flashcard · Read aloud (no Open in Coach without a check).
    await act(async () => (document.querySelector('[data-testid="message-menu"] [data-tool="copy"]') as HTMLElement).click());
    const reply = host.querySelector('[data-testid="claude-chat-reply"] .chat-bubble')!;
    await act(async () => reply.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })));
    await flush();
    expect([...document.querySelectorAll('[data-testid="message-menu"] [data-tool]')].map((b) => b.getAttribute('data-tool'))).toEqual(expect.arrayContaining(['copy', 'translate', 'pinyin', 'play']));
  });

  it('a Chinese reply to a turn asked for English (stored "en") or with no language still gets word chips + tools', async () => {
    // Jerome, Nov 2026: the reply after "change the notes to English" (Claude edited the card, then
    // answered in Chinese) was drawn as Markdown — not tappable.
    for (const lang of ['en', null] as const) {
      await render([MESSAGES[0], { id: 'a9', role: 'assistant', text: '我已经把说明改成英文了。', answer_lang: lang }]);
      const reply = q('claude-chat-reply')!;
      expect([...reply.querySelectorAll('.chat-word')].map((c) => c.textContent)).toEqual(['我', '已经', '把', '说明', '改成', '英文', '了']);
      expect(reply.querySelector('[data-testid="claude-chat-play"]')).toBeTruthy();
    }
  });

  it('a pending reply thinks; a failed one offers Retry', async () => {
    await render([MESSAGES[0], { id: 'a1', role: 'assistant', text: '', status: 'pending' }]);
    expect(q('claude-chat-pending')?.textContent).toContain('Thinking…');
    await render([MESSAGES[0], { id: 'a1', role: 'assistant', text: '', status: 'failed', error: 'Claude is busy right now — try again in a moment.' }]);
    expect(q('claude-chat-failed')?.textContent).toContain('Claude is busy');
    await act(async () => q('claude-chat-retry')!.click());
    expect(onRetry).toHaveBeenCalled();
  });
});
