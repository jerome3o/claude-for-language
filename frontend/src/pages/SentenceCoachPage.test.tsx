/**
 * The Sentence Coach conversation (docs/CHAT.md "Chat ↔ Coach"): no quick-action chips and no
 * "Cards go to" deck picker; the follow-up composer's 🎤 says "Respond"; every Chinese word of the
 * answer (the big sentence, the alternatives, Claude's Markdown reply) opens the language explorer;
 * and "🎤 Practise saying it" records a take and checks it against that sentence (listening →
 * the compact "You said" row → 🔁 Try again; Enter / a tap anywhere stops; failed / empty /
 * offline states).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- a controllable voice-first box (the real one needs a microphone)
interface FakeDictation {
  surface: string;
  push: (final: string, partial?: string) => void;
  land: (text: string) => void;
  fail: (failure: 'failed' | 'empty') => void;
  block: (b: string | null) => void;
  stop: ReturnType<typeof vi.fn>;
  retryUpload: ReturnType<typeof vi.fn>;
}
const fakes = vi.hoisted(() => ({ list: [] as FakeDictation[] }));
vi.mock('../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { surface: string; autoSubmit?: boolean; onSubmit: (a: { text: string; source: string; transcript: string | null }) => void }) => {
      const [phase, setPhase] = React.useState<string>('idle');
      const [failure, setFailure] = React.useState<string | null>(null);
      const [blocked, setBlocked] = React.useState<string | null>(null);
      const [text, setText] = React.useState({ final: '', partial: '' });
      const latest = React.useRef(opts);
      latest.current = opts;
      const fake = React.useRef<FakeDictation | null>(null);
      const stop = React.useRef(vi.fn(() => setPhase('finishing')));
      const retryUpload = React.useRef(vi.fn());
      if (!fake.current) {
        fake.current = {
          surface: opts.surface,
          push: (final, partial = '') => setText({ final, partial }),
          land: (t) => { setPhase('idle'); latest.current.onSubmit({ text: t, source: 'spoken', transcript: t }); },
          fail: (f) => { setPhase('failed'); setFailure(f); },
          block: (b) => setBlocked(b),
          stop: stop.current,
          retryUpload: retryUpload.current,
        };
        fakes.list.push(fake.current);
      }
      return {
        state: { mode: blocked ? 'type' : 'voice', phase, failure, blocked },
        finalText: text.final,
        partialText: text.partial,
        listening: phase === 'listening',
        busy: phase === 'listening' || phase === 'finishing',
        level: 0,
        say: () => { setPhase('listening'); setFailure(null); setText({ final: '', partial: '' }); },
        stop: stop.current,
        cancel: () => setPhase('idle'),
        retake: () => setPhase('listening'),
        retryUpload: retryUpload.current,
        edit: () => {},
        type: () => {},
        submit: () => {},
        canSubmit: false,
        reset: () => setPhase('idle'),
      };
    },
  };
});

const track = vi.fn();
vi.mock('../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
const explorerOpen = vi.fn();
vi.mock('../components/explorer/ExplorerContext', () => ({ useExplorer: () => ({ inside: false, open: explorerOpen, push: vi.fn() }) }));
// Words by the device segmenter: 沙发 / 很多 as words, the rest one by one.
vi.mock('../services/chineseSegmenter', () => ({
  preloadSegmenter: vi.fn(),
  useSegmentedWords: (text: string, enabled = true) => {
    if (!enabled) return null;
    const out: Array<{ text: string; pinyin: string; gloss: string }> = [];
    for (let i = 0; i < text.length; ) {
      const two = text.slice(i, i + 2);
      if (two === '沙发' || two === '很多') { out.push({ text: two, pinyin: '', gloss: '' }); i += 2; } else { out.push({ text: text[i], pinyin: '', gloss: '' }); i += 1; }
    }
    return out;
  },
}));
vi.mock('../components/editor/useLessonSpeak', () => ({ useLessonSpeak: () => speak }));
const speak = vi.fn();
vi.mock('../services/studyResume', () => ({ coachReturnPath: () => null, setCoachReturn: vi.fn() }));
vi.mock('../services/coachLessons', () => ({ cachedCoachLesson: () => null, rememberCoachLesson: vi.fn() }));
vi.mock('../services/sentence-sets', () => ({ cacheTextExplanation: vi.fn(), getCachedTextExplanation: vi.fn(async () => null) }));
vi.mock('../services/custom-lesson-study', () => ({ syncCustomLessons: vi.fn(async () => {}), prefetchCustomLessonMedia: vi.fn() }));
vi.mock('../services/studyBumps', () => ({ syncBumps: vi.fn(async () => {}) }));
vi.mock('../db/database', () => ({ db: { customLessons: { get: vi.fn(async () => undefined) } } }));

const SENTENCE = '他在沙发上占了很多地方。';
const analysis = {
  kind: 'english',
  translation: {
    primary: { hanzi: SENTENCE, pinyin: 'Tā zài shāfā shang zhàn le hěn duō dìfang.', english: 'He took up a lot of room on the couch.', note: null },
    alternatives: [{ hanzi: '他占了半个沙发。', pinyin: 'Tā zhàn le bàn gè shāfā.', english: 'He took up half the couch.', note: null }],
    usage_note: '占 is "to occupy".',
  },
};
const conversation = {
  conversation: { id: 'c1', user_id: 'u', title: 'he took up a lot of room', input_language: 'en', action: 'translate', created_at: '2026-10-22T09:00:00Z', updated_at: '2026-10-22T09:00:00Z' },
  messages: [
    { id: 'm1', conversation_id: 'c1', role: 'user', content_type: 'text', content: 'he took up a lot of room on the couch', tool_results: null, created_at: '2026-10-22T09:00:00Z' },
    { id: 'm2', conversation_id: 'c1', role: 'assistant', content_type: 'analysis', content: JSON.stringify(analysis), tool_results: null, created_at: '2026-10-22T09:00:01Z' },
    { id: 'm3', conversation_id: 'c1', role: 'assistant', content_type: 'text', content: '**占地方** means *to take up room*: 这个沙发很占地方。', tool_results: null, created_at: '2026-10-22T09:01:00Z' },
  ],
};
vi.mock('../api/client', () => ({
  startCoachConversation: vi.fn(),
  getCoachConversations: vi.fn(async () => []),
  getCoachConversation: vi.fn(async () => conversation),
  sendCoachMessage: vi.fn(),
  retryCoachReply: vi.fn(),
  requestCoachMistakeLesson: vi.fn(),
  saveCoachMistakeLesson: vi.fn(),
  deleteCoachConversation: vi.fn(),
  getDecks: vi.fn(async () => [{ id: 'd1', name: 'HSK 2' }]),
  apiErrorStatus: () => undefined,
}));

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function renderConversation() {
  const { SentenceCoachPage } = await import('./SentenceCoachPage');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/coach?c=c1']}>
          <SentenceCoachPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await flush();
  await flush();
}

const practiseFake = () => fakes.list.find((f) => f.surface === 'coach_practise')!;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  fakes.list.length = 0;
  track.mockReset();
  explorerOpen.mockReset();
  speak.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SentenceCoachPage conversation', () => {
  it('has no quick-action chips and no "Cards go to" deck picker', async () => {
    await renderConversation();
    expect(host.textContent).toContain('He took up a lot of room on the couch.');
    expect(q('coach-quick-actions')).toBeNull();
    expect(host.querySelector('[data-testid^="coach-quick-"]')).toBeNull();
    expect(host.textContent).not.toContain('Cards go to');
    expect(host.querySelector('select')).toBeNull();
    expect(host.textContent).not.toContain('Card for this sentence');
    expect(host.textContent).not.toContain('Study words from this today');
  });

  it('the follow-up composer’s 🎤 says Respond', async () => {
    await renderConversation();
    const say = q('coach-followup-say')!;
    expect(say.textContent).toContain('Respond');
    expect(say.textContent).not.toContain('Say it');
  });

  it('a word of the big sentence, an alternative and Claude’s reply opens the explorer', async () => {
    await renderConversation();
    const sentence = host.querySelector('.coach-sentence [data-testid="explorable-text"]')!;
    expect(sentence.textContent).toBe(SENTENCE);
    const sofa = [...sentence.querySelectorAll('[role="button"]')].find((el) => el.textContent === '沙发') as HTMLElement;
    act(() => sofa.click());
    expect(explorerOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'word', hanzi: '沙发' }), expect.objectContaining({ source: 'coach' }));

    const alt = host.querySelector('.coach-alternative-item [data-testid="explorable-text"]')!;
    expect(alt.textContent).toBe('他占了半个沙发。');
    const reply = host.querySelector('.claude-response')!;
    const couch = [...reply.querySelectorAll('[role="button"]')].find((el) => el.textContent === '沙发') as HTMLElement;
    expect(couch).toBeTruthy();
    act(() => couch.click());
    expect(explorerOpen).toHaveBeenCalledTimes(2);
    // Markdown is kept around the tappable Chinese (bold included).
    const bold = reply.querySelector('strong')!;
    expect(bold.textContent).toBe('占地方');
    expect(bold.querySelector('[data-testid="explorable-text"]')).not.toBeNull();
  });

  it('▶ plays the sentence; 🎤 Practise saying it → live words → a match in the You said row', async () => {
    await renderConversation();
    act(() => q('coach-practise-listen')!.click());
    expect(speak).toHaveBeenCalledWith(SENTENCE);

    const mic = q('coach-practise-mic')!;
    expect(mic.textContent).toContain('Practise saying it');
    act(() => mic.click());
    expect(q('coach-practise')!.dataset.phase).toBe('listening');
    expect(q('coach-practise-live')!.textContent).toContain('Listening');
    act(() => practiseFake().push('他在沙发上', '占了'));
    expect(q('coach-practise-live')!.textContent).toBe('他在沙发上占了');
    expect(q('coach-practise-mic')!.textContent).toContain('Stop');

    // Tap again → stop.
    act(() => q('coach-practise-mic')!.click());
    expect(practiseFake().stop).toHaveBeenCalledTimes(1);
    act(() => practiseFake().land('他在沙发上占了很多地方'));
    expect(q('coach-practise')!.dataset.phase).toBe('result');
    expect(q('coach-practise-result')!.dataset.state).toBe('match');
    expect(q('coach-practise-mic')!.textContent).toContain('Try again');
    expect(track).toHaveBeenCalledWith('coach.practise_say', { result: 'match' });
  });

  it('a homophone sounds right; a different sentence marks what differs', async () => {
    await renderConversation();
    act(() => q('coach-practise-mic')!.click());
    act(() => practiseFake().land('他在沙发上站了很多地方。'));
    expect(q('coach-practise-result')!.dataset.state).toBe('sound');
    expect([...q('coach-practise-result')!.querySelectorAll('[data-mark="differs"]')].map((e) => e.textContent).join('')).toBe('站');

    act(() => q('coach-practise-mic')!.click());
    expect(q('coach-practise-result')).toBeNull();
    act(() => practiseFake().land('他在沙发上放了很多东西'));
    expect(q('coach-practise-result')!.dataset.state).toBe('wrong');
    expect([...q('coach-practise-result')!.querySelectorAll('[data-mark="wrong"]')].map((e) => e.textContent).join('')).toBe('放东西');
    expect(track).toHaveBeenLastCalledWith('coach.practise_say', { result: 'wrong' });
  });

  it('Enter or a tap on the card stops the take', async () => {
    await renderConversation();
    act(() => q('coach-practise-mic')!.click());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
    expect(practiseFake().stop).toHaveBeenCalledTimes(1);

    act(() => practiseFake().land('他'));
    act(() => q('coach-practise-mic')!.click());
    const card = host.querySelector('.coach-sentence')!;
    act(() => { card.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(practiseFake().stop).toHaveBeenCalledTimes(2);
  });

  it('a take that failed offers the same take again; nothing heard says so; offline says practising needs a connection', async () => {
    await renderConversation();
    act(() => q('coach-practise-mic')!.click());
    act(() => practiseFake().fail('failed'));
    act(() => q('coach-practise-retry')!.click());
    expect(practiseFake().retryUpload).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('coach.practise_say', { result: 'failed' });

    act(() => q('coach-practise-mic')!.click());
    act(() => practiseFake().fail('empty'));
    expect(q('coach-practise-empty')!.textContent).toContain('Didn’t catch that');

    act(() => practiseFake().block('offline'));
    expect(q('coach-practise-blocked')!.textContent).toBe('Practising needs a connection.');
    expect((q('coach-practise-mic') as HTMLButtonElement).disabled).toBe(true);
  });
});
