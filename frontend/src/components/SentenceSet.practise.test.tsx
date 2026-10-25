/**
 * 🎤 on the example sentence rows (docs/STUDY_SESSION.md "Practise a sentence aloud"): no 🎤 on a
 * blank row; read mode judges the take like the Coach's practise (right / sounded right / close);
 * translate mode (EN) takes the sentence on the device, asks Claude's answer check about anything
 * else, falls back to "Check online…" without one, and reveals the Chinese; only right takes count.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeDictation {
  surface: string;
  land: (text: string) => void;
  fail: (failure: 'failed' | 'empty') => void;
  stop: ReturnType<typeof vi.fn>;
}
const fakes = vi.hoisted(() => ({ list: [] as FakeDictation[] }));
vi.mock('../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { surface: string; onSubmit: (a: { text: string; source: string; transcript: string | null }) => void }) => {
      const [phase, setPhase] = React.useState<string>('idle');
      const [failure, setFailure] = React.useState<string | null>(null);
      const latest = React.useRef(opts);
      latest.current = opts;
      const fake = React.useRef<FakeDictation | null>(null);
      const stop = React.useRef(vi.fn(() => setPhase('finishing')));
      if (!fake.current) {
        fake.current = {
          surface: opts.surface,
          land: (t) => { setPhase('idle'); latest.current.onSubmit({ text: t, source: 'spoken', transcript: t }); },
          fail: (f) => { setPhase('failed'); setFailure(f); },
          stop: stop.current,
        };
        fakes.list.push(fake.current);
      }
      return {
        state: { mode: 'voice', phase, failure, blocked: null },
        finalText: '', partialText: '', listening: phase === 'listening', busy: false, level: 0,
        say: () => { setPhase('listening'); setFailure(null); },
        stop: stop.current,
        cancel: () => setPhase('idle'),
        retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: false, reset: vi.fn(),
      };
    },
  };
});

const track = vi.fn();
vi.mock('../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
const checkLessonAnswer = vi.fn();
vi.mock('../services/answerCheck', () => ({ checkLessonAnswer: (...a: unknown[]) => checkLessonAnswer(...a) }));
vi.mock('../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: true }) }));
vi.mock('../hooks/useAudio', () => ({ useNoteAudio: () => ({ isPlaying: false, play: vi.fn() }) }));
vi.mock('../services/offlineMode', () => ({ isEffectivelyOffline: () => false }));
vi.mock('../api/client', () => ({ fetchNoteSentences: vi.fn(async () => []), deleteNoteSentenceSet: vi.fn(), API_BASE: '' }));
const history = vi.hoisted(() => ({
  stats: new Map() as Map<string, unknown>,
  record: [] as unknown[][],
  hidden: [] as unknown[][],
  unhidden: [] as unknown[][],
  more: [] as unknown[][],
}));
vi.mock('../services/sentencePractice', () => ({
  useSentenceStats: () => history.stats,
  recordSentenceAttempt: (...a: unknown[]) => { history.record.push(a); },
  hideSentence: async (...a: unknown[]) => { history.hidden.push(a); },
  unhideSentence: async (...a: unknown[]) => { history.unhidden.push(a); },
  requestMoreSentences: (...a: unknown[]) => { history.more.push(a); },
  sentencesComing: () => false,
}));
vi.mock('./upNext/UpNextBoard', () => ({ UndoToast: ({ text }: { text: string }) => <div>{text}</div> }));
const SET = [
  { id: 's1', note_id: 'n1', position: 0, hanzi: '我去银行。', pinyin: 'Wǒ qù yínháng.', translation: 'I go to the bank.', audio_url: null, focus: 'core', focus_note: null, explanation: null },
  { id: 's2', note_id: 'n1', position: 1, hanzi: '银行在哪儿？', pinyin: 'Yínháng zài nǎr?', translation: 'Where is the bank?', audio_url: null, focus: 'core', focus_note: null, explanation: null },
];
vi.mock('../services/sentence-sets', () => ({
  getLocalNoteSentences: vi.fn(async () => SET),
  generateAndStoreSentenceSet: vi.fn(), putLocalNoteSentences: vi.fn(), clearLocalNoteSentences: vi.fn(), cacheSentenceAudio: vi.fn(),
  resetSentenceSetSyncCursor: vi.fn(), getSentenceExplanation: vi.fn(), getTextExplanation: vi.fn(),
  getCachedTextExplanation: vi.fn(async () => null), getClueTranslation: vi.fn(), getCachedClueTranslation: vi.fn(async () => null),
  awaitSentenceAudio: vi.fn(), ensureSentenceAudio: vi.fn(), SENTENCE_AUDIO_COMING_LABEL: 'Audio coming…',
}));

let host: HTMLDivElement;
let root: Root;
const all = (id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const rows = () => [...host.querySelectorAll('.sentence-set-row')] as HTMLElement[];
const inRow = (i: number, id: string) => rows()[i].querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const dictation = () => fakes.list.find((f) => f.surface === 'sentence_practise')!;
const onRight = vi.fn();
const onCount = vi.fn();

async function render(practise = true) {
  const { SentenceSet } = await import('./SentenceSet');
  await act(async () => root.render(<SentenceSet noteId="n1" compact practise={practise} showingKey="c1" onPractiseRight={onRight} onRowCount={onCount} />));
  await flush();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  fakes.list.length = 0;
  track.mockClear();
  onRight.mockClear();
  onCount.mockClear();
  checkLessonAnswer.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SentenceSet 🎤', () => {
  it('has no 🎤 on a blank row, a read 🎤 once the Chinese is up', async () => {
    await render();
    expect(onCount).toHaveBeenLastCalledWith(2);
    expect(inRow(0, 'sentence-practise-mic')).toBeNull();
    act(() => (rows()[0].querySelector('.sentence-set-hidden') as HTMLElement).click());
    const mic = inRow(0, 'sentence-practise-mic')!;
    expect(mic.dataset.mode).toBe('read');
    // 🎤 sits left of ▶.
    expect(mic.nextElementSibling?.classList.contains('sentence-set-play')).toBe(true);
  });

  it('judges a read take like the Coach: right counts, a tone slip does not', async () => {
    await render();
    act(() => (rows()[0].querySelector('.sentence-set-hidden') as HTMLElement).click());
    act(() => inRow(0, 'sentence-practise-mic')!.click());
    expect(inRow(0, 'sentence-practise-live')!.textContent).toContain('read the sentence');
    act(() => dictation().land('我去银行'));
    expect(inRow(0, 'sentence-practise-result')!.dataset.result).toBe('right');
    expect(inRow(0, 'sentence-practise-said')!.dataset.state).toBe('match');
    expect(onRight).toHaveBeenCalledWith('s1');
    expect(track).toHaveBeenCalledWith('study.sentence_practise', { mode: 'read', result: 'right', via: 'local' });

    act(() => inRow(0, 'sentence-practise-mic')!.click());
    act(() => dictation().land('我去银杏'));
    expect(inRow(0, 'sentence-practise-result')!.dataset.result).not.toBe('right');
    expect(onRight).toHaveBeenCalledTimes(1);
  });

  it('translate: the sentence is right on the device and the Chinese is revealed', async () => {
    await render();
    act(() => (rows()[1].querySelector('.sentence-set-en') as HTMLElement).click());
    expect(rows()[1].querySelector('.sentence-set-hanzi')).toBeNull();
    const mic = inRow(1, 'sentence-practise-mic')!;
    expect(mic.dataset.mode).toBe('translate');
    act(() => mic.click());
    expect(inRow(1, 'sentence-practise-live')!.textContent).toContain('say it in Chinese');
    act(() => dictation().land('银行在哪儿'));
    expect(checkLessonAnswer).not.toHaveBeenCalled();
    expect(inRow(1, 'sentence-practise-result')!.dataset.result).toBe('right');
    expect(rows()[1].querySelector('.sentence-set-hanzi')!.textContent).toBe('银行在哪儿？');
    expect(onRight).toHaveBeenCalledWith('s2');
  });

  it("translate: another way of saying it goes to Claude's check", async () => {
    let resolve!: (v: unknown) => void;
    checkLessonAnswer.mockReturnValue(new Promise((r) => { resolve = r; }));
    await render();
    act(() => (rows()[1].querySelector('.sentence-set-en') as HTMLElement).click());
    act(() => inRow(1, 'sentence-practise-mic')!.click());
    act(() => dictation().land('银行在什么地方'));
    expect(checkLessonAnswer).toHaveBeenCalledWith(expect.objectContaining({
      prompt_en: 'Where is the bank?', model_answer: '银行在哪儿？', answer: '银行在什么地方', exercise_type: 'translate', input: 'spoken',
    }));
    expect(inRow(1, 'sentence-practise-checking')).not.toBeNull();
    await act(async () => resolve({ check: { verdict: 'acceptable', headline: 'Also natural.', corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it' }, cached: false }));
    expect(inRow(1, 'sentence-practise-verdict')!.dataset.verdict).toBe('acceptable');
    expect(inRow(1, 'sentence-practise-verdict')!.textContent).toContain('Also right');
    expect(inRow(1, 'sentence-practise-result')!.dataset.result).toBe('right');
    expect(onRight).toHaveBeenCalledWith('s2');
    expect(track).toHaveBeenCalledWith('study.sentence_practise', { mode: 'translate', result: 'right', via: 'claude' });
  });

  it('translate without a check: "You said" vs the sentence and "Check online…"', async () => {
    checkLessonAnswer.mockRejectedValue(new Error('offline'));
    await render();
    act(() => (rows()[0].querySelector('.sentence-set-en') as HTMLElement).click());
    act(() => inRow(0, 'sentence-practise-mic')!.click());
    act(() => dictation().land('我要去银行'));
    await flush();
    expect(inRow(0, 'sentence-practise-said')).not.toBeNull();
    expect(inRow(0, 'sentence-practise-check-online')!.textContent).toContain('Check online');
    expect(onRight).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('study.sentence_practise', { mode: 'translate', result: 'wrong', via: 'offline' });
  });

  it('one microphone: a tap elsewhere stops the take; no 🎤 in the card editor', async () => {
    await render();
    act(() => (rows()[0].querySelector('.sentence-set-hidden') as HTMLElement).click());
    act(() => inRow(0, 'sentence-practise-mic')!.click());
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(dictation().stop).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    root = createRoot(host);
    await render(false);
    act(() => (rows()[0].querySelector('.sentence-set-hidden') as HTMLElement).click());
    expect(all('sentence-practise-mic')).toHaveLength(0);
  });
});

describe('SentenceSet practice history', () => {
  it('records takes, leaves hidden rows out (Show hidden brings them back) and hides from the row tools', async () => {
    history.stats = new Map<string, unknown>([['s2', { read: { attempts: 0, rights: 0, misses: 0, last_at: null }, translate: { attempts: 0, rights: 0, misses: 0, last_at: null }, hidden: { at: '2026-10-02', reason: 'weird' } }]]);
    await render();
    expect(onCount).toHaveBeenLastCalledWith(1);
    expect(rows()).toHaveLength(1);
    act(() => (rows()[0].querySelector('.sentence-set-hidden') as HTMLElement).click());
    act(() => inRow(0, 'sentence-practise-mic')!.click());
    act(() => dictation().land('我去银行'));
    expect(history.record.at(-1)).toEqual(['n1', 's1', 'read', 'right']);
    // ⋯ → Show hidden (1) → the hidden row with Show again.
    act(() => (host.querySelector('[aria-label="Sentence options"]') as HTMLElement).click());
    act(() => all('sentence-set-show-hidden')[0].click());
    act(() => all('sentence-set-unhide')[0].click());
    expect(history.unhidden.at(-1)).toEqual(['n1', 's2', 'list']);
    // A fully open row's tools: Stop showing this sentence → a reason.
    act(() => (rows()[0].querySelector('.sentence-set-reveal') as HTMLElement).click());
    act(() => (rows()[0].querySelector('.sentence-set-reveal') as HTMLElement).click());
    act(() => inRow(0, 'sentence-set-hide')!.click());
    act(() => (host.querySelector('[data-testid="sentence-hide-too_rare"]') as HTMLElement).click());
    expect(history.hidden.at(-1)).toEqual(['n1', 's1', 'too_rare', 'list']);
    history.stats = new Map();
  });

  it("the round's sentences: on top in the round's order, opened, outlined with their result", async () => {
    const { SentenceSet } = await import('./SentenceSet');
    const { roundRowMarks } = await import('@shared/study/sentenceRound');
    const marks = roundRowMarks([{ id: 'translate:s2', result: 'wrong' }, { id: 'read:s1' }], []);
    await act(async () => root.render(<SentenceSet noteId="n1" compact practise showingKey="c1" roundRows={marks} />));
    await flush();
    expect(rows().map((r) => r.dataset.round)).toEqual(['wrong', 'untried']);
    expect(all('sentence-set-round-label').map((l) => l.textContent)).toEqual(['In the round · ✗ Not quite', 'In the round']);
    // Opened: hanzi, pinyin and English all up.
    expect(rows()[0].querySelector('.sentence-set-hanzi')!.textContent).toBe('银行在哪儿？');
    expect(rows()[0].querySelector('.sentence-set-pinyin')!.textContent).toBe('Yínháng zài nǎr?');
    expect(rows()[0].querySelector('.sentence-set-translation')!.textContent).toBe('Where is the bank?');
    expect(rows()[0].className).toContain('is-open');
    // Without a round: the list as before, blank rows.
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(rows()[0].dataset.round).toBeUndefined();
    expect(rows()[0].querySelector('.sentence-set-hanzi')).toBeNull();
  });
});
