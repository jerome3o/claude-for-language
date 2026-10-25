/**
 * The Sentence round (docs/STUDY_SESSION.md "Sentence round"; shared/study/sentenceRound.ts): four
 * exercises from the card's sentences — read / translate alternating, the translate ones' Chinese and
 * ▶ only once answered — any two right finish it (the answer opens), a miss offers Try again, Skip
 * always goes to the answer and says the gate still applies there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeDictation {
  surface: string;
  land: (text: string) => void;
  fail: (failure: 'failed' | 'empty') => void;
  stop: ReturnType<typeof vi.fn>;
}
const fakes = vi.hoisted(() => ({ list: [] as FakeDictation[] }));
vi.mock('../../hooks/useVoiceDictation', async () => {
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
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
const checkLessonAnswer = vi.fn();
vi.mock('../../services/answerCheck', () => ({ checkLessonAnswer: (...a: unknown[]) => checkLessonAnswer(...a) }));
vi.mock('../../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: true }) }));
vi.mock('../../hooks/useAudio', () => ({ useNoteAudio: () => ({ isPlaying: false, play: vi.fn() }) }));
vi.mock('../../services/offlineMode', () => ({ isEffectivelyOffline: () => false }));
vi.mock('../../api/client', () => ({ fetchNoteSentences: vi.fn(async () => []), deleteNoteSentenceSet: vi.fn(), API_BASE: '' }));
vi.mock('../Confetti', () => ({ Confetti: () => null }));
const history = vi.hoisted(() => ({
  stats: new Map() as Map<string, unknown>,
  record: [] as unknown[][],
  hidden: [] as unknown[][],
  unhidden: [] as unknown[][],
  more: [] as unknown[][],
}));
vi.mock('../../services/sentencePractice', () => ({
  useSentenceStats: () => history.stats,
  recordSentenceAttempt: (...a: unknown[]) => { history.record.push(a); },
  hideSentence: async (...a: unknown[]) => { history.hidden.push(a); },
  unhideSentence: async (...a: unknown[]) => { history.unhidden.push(a); },
  requestMoreSentences: (...a: unknown[]) => { history.more.push(a); },
  sentencesComing: () => false,
}));

const SET = [
  { id: 's1', note_id: 'n1', position: 0, hanzi: '我去银行。', pinyin: 'Wǒ qù yínháng.', translation: 'I go to the bank.', audio_url: null, focus: 'core', focus_note: null, explanation: null },
  { id: 's2', note_id: 'n1', position: 1, hanzi: '银行在哪儿？', pinyin: 'Yínháng zài nǎr?', translation: 'Where is the bank?', audio_url: null, focus: 'core', focus_note: null, explanation: null },
];
vi.mock('../../services/sentence-sets', () => ({
  getLocalNoteSentences: vi.fn(async () => SET),
  generateAndStoreSentenceSet: vi.fn(), putLocalNoteSentences: vi.fn(), clearLocalNoteSentences: vi.fn(), cacheSentenceAudio: vi.fn(),
  resetSentenceSetSyncCursor: vi.fn(), getSentenceExplanation: vi.fn(), getTextExplanation: vi.fn(),
  getCachedTextExplanation: vi.fn(async () => null), getClueTranslation: vi.fn(), getCachedClueTranslation: vi.fn(async () => null),
  awaitSentenceAudio: vi.fn(), ensureSentenceAudio: vi.fn(), SENTENCE_AUDIO_COMING_LABEL: 'Audio coming…',
}));


let host: HTMLDivElement;
let root: Root;
const all = (id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const ex = (i: number) => all('sentence-round-exercise')[i];
const inEx = (i: number, id: string) => ex(i).querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const dictation = () => fakes.list.find((f) => f.surface === 'sentence_practise')!;
const NOTE = { id: 'n1', sentence_clue: '我去银行取钱。', sentence_clue_pinyin: 'Wǒ qù yínháng qǔ qián.', sentence_clue_translation: 'I go to the bank to get money.', sentence_clue_audio_url: null };

async function render(opts: { onDone?: () => void; onSkip?: () => void; initialIds?: string[]; onPicked?: (ids: string[]) => void; onResult?: (id: string, r: string) => void } = {}) {
  const { SentenceRound, useRoundSentences } = await import('./SentenceRound');
  function Harness() {
    const sentences = useRoundSentences(NOTE, true);
    const [right, setRight] = React.useState<string[]>([]);
    return (
      <SentenceRound
        showingKey="c1" noteId="n1" question="银行" questionIsChinese sentences={sentences} right={right}
        onRight={(id) => setRight((p) => (p.includes(id) ? p : [...p, id]))}
        onDone={opts.onDone ?? vi.fn()} onSkip={opts.onSkip ?? vi.fn()}
        initialIds={opts.initialIds} onPicked={opts.onPicked} onResult={opts.onResult}
      />
    );
  }
  await act(async () => root.render(<Harness />));
  await flush();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  fakes.list.length = 0;
  track.mockClear();
  checkLessonAnswer.mockReset();
  history.stats = new Map();
  history.record.length = 0;
  history.hidden.length = 0;
  history.unhidden.length = 0;
  history.more.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('SentenceRound', () => {
  it('shows the question small, three sentences → three exercises (one each), translate Chinese hidden', async () => {
    await render();
    expect(all('sentence-round-question')[0].textContent).toBe('银行');
    expect(all('sentence-round-exercise').map((e) => e.dataset.mode)).toEqual(['read', 'translate', 'read']);
    // A sentence is in one exercise only: its English never answers another one.
    expect(host.textContent!.split('我去银行。').length - 1).toBe(0);
    expect(inEx(0, 'sentence-round-chinese')!.textContent).toBe('我去银行取钱。');
    expect(inEx(1, 'sentence-round-english')!.textContent).toBe('I go to the bank.');
    expect(inEx(1, 'sentence-round-chinese')).toBeNull();
    expect(inEx(1, 'sentence-round-play')).toBeNull();
    expect(inEx(0, 'sentence-round-play')).toBeNull();
    expect(all('sentence-round-counter')[0].textContent).toContain('0 / 2');
    expect(host.textContent).toContain('Get any 2 of these 3 right');
  });

  it('a miss offers Try again; two right finish the round', async () => {
    const onDone = vi.fn();
    await render({ onDone });
    act(() => inEx(0, 'sentence-practise-mic')!.click());
    act(() => dictation().land('我去学校'));
    expect(ex(0).dataset.status).toMatch(/close|wrong/);
    expect(inEx(0, 'sentence-round-retry')).not.toBeNull();
    expect(track).toHaveBeenCalledWith('study.sentence_round', expect.objectContaining({ action: 'miss', index: 0, mode: 'read' }));
    act(() => inEx(0, 'sentence-round-retry')!.click());
    expect(track).toHaveBeenCalledWith('study.sentence_round', expect.objectContaining({ action: 'retry', index: 0 }));
    act(() => dictation().land('我去银行取钱'));
    expect(ex(0).dataset.status).toBe('right');
    expect(all('sentence-round-cheer')[0].textContent).toBe('🎉 Nice — 1 / 2');
    // The translate exercise: said exactly — right on the device, its Chinese and ▶ appear.
    act(() => inEx(1, 'sentence-practise-mic')!.click());
    vi.useFakeTimers();
    act(() => dictation().land('我去银行'));
    expect(ex(1).dataset.status).toBe('right');
    expect(inEx(1, 'sentence-round-chinese')!.textContent).toBe('我去银行。');
    expect(inEx(1, 'sentence-round-play')).not.toBeNull();
    expect(all('sentence-round-cheer')[0].textContent).toContain('Good and Easy unlocked');
    expect(track).toHaveBeenCalledWith('study.sentence_round', expect.objectContaining({ action: 'done', got: 2, needed: 2 }));
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(onDone).toHaveBeenCalled();
  });

  it('a read exercise right shows its English at once (Hide English keeps it hideable); a miss keeps Show English', async () => {
    await render();
    act(() => inEx(0, 'sentence-practise-mic')!.click());
    act(() => dictation().land('我去学校'));
    expect(ex(0).dataset.status).toMatch(/close|wrong/);
    expect(inEx(0, 'sentence-round-read-english')).toBeNull();
    expect(inEx(0, 'sentence-round-english-toggle')!.textContent).toBe('Show English');
    act(() => inEx(0, 'sentence-round-retry')!.click());
    act(() => dictation().land('我去银行取钱'));
    expect(ex(0).dataset.status).toBe('right');
    expect(inEx(0, 'sentence-round-read-english')!.textContent).toBe('I go to the bank to get money.');
    expect(inEx(0, 'sentence-round-english-toggle')!.textContent).toBe('Hide English');
    act(() => inEx(0, 'sentence-round-english-toggle')!.click());
    expect(inEx(0, 'sentence-round-read-english')).toBeNull();
    expect(inEx(0, 'sentence-round-english-toggle')!.textContent).toBe('Show English');
  });

  it('records every judged take in the sentence history', async () => {
    await render();
    act(() => inEx(0, 'sentence-practise-mic')!.click());
    act(() => dictation().land('我去学校'));
    expect(history.record[0]).toEqual(['n1', 'clue:n1', 'read', expect.stringMatching(/close|wrong/)]);
  });

  it('prefers what he knows least and leaves hidden sentences out; ⋯ hides one', async () => {
    const st = (read: number) => ({ read: { attempts: read, rights: read, misses: 0, last_at: read ? '2026-10-01' : null }, translate: { attempts: 0, rights: 0, misses: 0, last_at: null }, hidden: null });
    history.stats = new Map<string, unknown>([['clue', st(3)], ['s2', { ...st(0), hidden: { at: '2026-10-02', reason: 'weird' } }]]);
    await render();
    // Two sentences left in rotation: s1 never read → read; the clue (read 3×) → translate. Two exercises, no reuse.
    expect(all('sentence-round-exercise').map((e) => `${e.dataset.mode}`)).toEqual(['translate', 'read']);
    expect(host.textContent).toContain('Get any 2 of these 2 right');
    expect(host.textContent).not.toContain('银行在哪儿？');
    // Fewer than four in rotation: more sentences were asked for.
    expect(history.more).toEqual([['n1', 'few']]);
    act(() => inEx(0, 'sentence-round-more')!.click());
    act(() => (host.querySelector('[data-testid="sentence-hide-wrong"]') as HTMLElement).click());
    expect(history.hidden[0]).toEqual(['n1', 'clue:n1', 'wrong', 'round']);
    expect(host.textContent).toContain('Sentence hidden');
  });

  it('Skip is always there and says the gate stays', async () => {
    const onSkip = vi.fn();
    await render({ onSkip });
    expect(host.textContent).toContain('Good and Easy stay locked until 2 more sentences are right');
    act(() => all('sentence-round-skip')[0].click());
    expect(onSkip).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('study.sentence_round', expect.objectContaining({ action: 'skip', got: 0, needed: 2 }));
  });

  it('reports the exercises as picked and each judged take (the answer side marks them); a resumed round shows the same ones', async () => {
    const onPicked = vi.fn();
    const onResult = vi.fn();
    await render({ onPicked, onResult });
    expect(onPicked).toHaveBeenCalledWith(['read:clue:n1', 'translate:s1', 'read:s2']);
    act(() => inEx(0, 'sentence-practise-mic')!.click());
    act(() => dictation().land('我去学校'));
    expect(onResult).toHaveBeenCalledWith('read:clue:n1', expect.stringMatching(/close|wrong/));
    act(() => root.unmount());
    root = createRoot(host);
    const again = vi.fn();
    await render({ initialIds: ['translate:s2', 'read:s1'], onPicked: again });
    expect(again).toHaveBeenCalledWith(['read:s1', 'translate:s2']);
    expect(all('sentence-round-exercise').map((e) => e.dataset.mode)).toEqual(['read', 'translate']);
  });
});
