/**
 * "Listen in context" (a listening card's question side): the showing's sentences — picked fresh
 * and shuffled with the showing's seed (pinned here) — as audio-only rows: no Chinese on screen,
 * EN shows only the English, a dot on never-heard ones; each played once recorded as heard; the
 * first sentence auto-played (the word when none has a clip), "Try the sentences first?" before
 * the word, "+ More sentences" (online), offline rows without a cached clip, and the fresh top-up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sets = vi.hoisted(() => ({
  local: [] as Array<Record<string, unknown>>,
  getNoteSentenceRows: vi.fn(),
  putLocalNoteSentences: vi.fn(),
  cacheSentenceAudio: vi.fn(),
  generateAndStoreSentenceSet: vi.fn(),
  awaitSentenceAudio: vi.fn(),
  ensureSentenceAudio: vi.fn(),
  topUpListeningSentences: vi.fn(),
  getSentenceTranslation: vi.fn(),
  SENTENCE_AUDIO_COMING_LABEL: 'Audio coming…',
}));
vi.mock('../../services/sentence-sets', () => sets);
const cache = vi.hoisted(() => ({ cached: new Set<string>(), isAudioCached: vi.fn() }));
vi.mock('../../services/audioCache', () => cache);
vi.mock('../../api/client', () => ({ fetchNoteSentences: vi.fn().mockResolvedValue([]) }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../services/analytics', () => analytics);
const practice = vi.hoisted(() => ({
  stats: new Map(),
  useSentenceStats: vi.fn(),
  recordSentenceHeard: vi.fn(),
  requestMoreSentences: vi.fn(),
}));
vi.mock('../../services/sentencePractice', () => practice);
const shown = vi.hoisted(() => ({
  previous: [] as string[],
  lastShownListenKeys: vi.fn(),
  rememberShownListenKeys: vi.fn(),
  newListenSeed: vi.fn(),
}));
vi.mock('../../services/listenShown', () => shown);

import { ListenContext, type ListenContextStats } from './ListenContext';
import { listenContextRows, pickListenRows } from '@shared/study/listenContext';
import { withCardSentence, type NoteCardSentenceFields } from '@shared/study/cardSentence';

const SET = [
  { id: 's1', note_id: 'n1', position: 0, hanzi: '银行在哪儿？', pinyin: 'yínháng zài nǎr?', translation: 'Where is the bank?', audio_url: 'generated/s1.mp3' },
  { id: 's2', note_id: 'n1', position: 1, hanzi: '我去银行取钱。', pinyin: '', translation: 'I go to the bank to get money.', audio_url: null },
];

let container: HTMLDivElement;
let root: Root;
const playAudio = vi.fn();
const onPlayWord = vi.fn();
const onAutoplayWord = vi.fn();
let stats: ListenContextStats | null = null;

async function render(props: { online?: boolean; autoplay?: boolean; clue?: { hanzi: string; translation?: string; audio_url?: string | null } | null; shownKeys?: string[]; onShown?: (keys: string[]) => void } = {}) {
  await act(async () => {
    root.render(
      <ListenContext
        noteId="n1"
        word="银行"
        note={noteOf(props.clue === undefined ? CLUE : props.clue)}
        online={props.online ?? true}
        playAudio={playAudio}
        isPlaying={false}
        onPlayWord={onPlayWord}
        onAutoplayWord={onAutoplayWord}
        autoplay={props.autoplay ?? false}
        onStats={(s) => { stats = s; }}
        shownKeys={props.shownKeys}
        onShown={props.onShown}
      />,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const CLUE = { hanzi: '这是银行。', translation: 'This is a bank.', audio_url: 'generated/clue.mp3' };
/** The note as the study card passes it: its card sentence becomes the row `n1-card` (cardSentence.ts). */
function noteOf(clue: { hanzi: string; translation?: string; audio_url?: string | null } | null): NoteCardSentenceFields {
  return { id: 'n1', sentence_clue: clue?.hanzi ?? null, sentence_clue_translation: clue?.translation ?? null, sentence_clue_audio_url: clue?.audio_url ?? null };
}
/** The showing's order with the pinned seed and nothing heard. */
const order = (clue: { hanzi: string } | null = CLUE) => pickListenRows(listenContextRows(withCardSentence(noteOf(clue), SET.map((s) => ({ focus: null, focus_note: null, explanation: null, ...s })))), new Map(), { seed: 'seed-1', word: '银行' }).rows.map((r) => r.key);
const rowOf = (key: string) => container.querySelector(`[data-testid="listen-row"][data-key="${key}"]`) as HTMLElement;
const inRow = (key: string, id: string) => rowOf(key).querySelector(`[data-testid="${id}"]`) as HTMLElement;

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (id: string) => [...container.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
async function click(el: Element | null) {
  if (!el) throw new Error('missing element');
  await act(async () => { (el as HTMLElement).click(); });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  sets.local = SET;
  sets.getNoteSentenceRows.mockImplementation(async (_id: string, note: NoteCardSentenceFields) => withCardSentence(note, sets.local as never));
  sets.topUpListeningSentences.mockResolvedValue(0);
  sets.generateAndStoreSentenceSet.mockReset();
  sets.getSentenceTranslation.mockReset();
  cache.cached = new Set();
  cache.isAudioCached.mockImplementation(async (u: string) => cache.cached.has(u));
  playAudio.mockReset();
  onPlayWord.mockReset();
  onAutoplayWord.mockReset();
  analytics.track.mockReset();
  practice.stats = new Map();
  practice.useSentenceStats.mockImplementation(() => practice.stats);
  practice.recordSentenceHeard.mockReset();
  practice.requestMoreSentences.mockReset();
  shown.previous = [];
  shown.lastShownListenKeys.mockImplementation(() => shown.previous);
  shown.rememberShownListenKeys.mockReset();
  shown.newListenSeed.mockReturnValue('seed-1');
  stats = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ListenContext', () => {
  it('lists the showing\'s sentences in its shuffled order — audio only, never the Chinese, all new', async () => {
    await render();
    expect(all('listen-row')).toHaveLength(3);
    expect(all('listen-row').map((r) => r.getAttribute('data-key'))).toEqual(order());
    expect(all('listen-row-new')).toHaveLength(3);
    expect(container.textContent).not.toContain('银行');
    expect(container.textContent).not.toContain('Where is the bank?');
    expect(all('listen-row-play').map((b) => b.getAttribute('aria-label'))).toEqual(['Sentence 1', 'Sentence 2', 'Sentence 3']);
    // The set is remembered and counted.
    expect(shown.rememberShownListenKeys).toHaveBeenCalledWith('n1', order());
    expect(analytics.track).toHaveBeenCalledWith('study.listen_context_shown', { shown: 3, fresh: 3, heard_before: 0 });
    // EN shows just the English of that row.
    await click(inRow('s1', 'listen-row-en'));
    expect(q('listen-row-translation')?.textContent).toBe('Where is the bank?');
    expect(container.textContent).not.toContain('银行');
  });

  it('the card sentence row without English still has EN: the line is fetched, then shown', async () => {
    sets.getSentenceTranslation.mockResolvedValue('This is a bank.');
    await render({ clue: { hanzi: '这是银行。', audio_url: 'generated/clue.mp3' } });
    expect(all('listen-row-en')).toHaveLength(3);
    await click(inRow('n1-card', 'listen-row-en'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(sets.getSentenceTranslation).toHaveBeenCalledWith({ id: 'n1-card', translation: null, explanation: null });
    expect(q('listen-row-translation')?.textContent).toBe('This is a bank.');
    expect(container.textContent).not.toContain('银行');
  });

  it('offline and never fetched, the card sentence says the translation needs a connection', async () => {
    await render({ online: false, clue: { hanzi: '这是银行。', audio_url: 'generated/clue.mp3' } });
    await click(inRow('n1-card', 'listen-row-en'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(sets.getSentenceTranslation).not.toHaveBeenCalled();
    expect(q('listen-row-translation')?.textContent).toBe('Translation needs a connection');
  });

  it('auto-plays the first sentence with a clip, not the word', async () => {
    await render({ autoplay: true });
    const first = order().find((k) => k !== 's2')!;
    expect(playAudio).toHaveBeenCalledWith(first === 's1' ? 'generated/s1.mp3' : 'generated/clue.mp3', first === 's1' ? '银行在哪儿？' : '这是银行。');
    expect(practice.recordSentenceHeard).toHaveBeenCalledWith('n1', first);
    expect(onAutoplayWord).not.toHaveBeenCalled();
    expect(stats?.sentencesPlayed).toBe(1);
    // A sentence was heard: the word plays at once.
    await click(q('listen-word'));
    expect(onPlayWord).toHaveBeenCalledTimes(1);
    expect(q('listen-word-prompt')).toBeNull();
  });

  it('auto-plays the word when no sentence has a clip', async () => {
    sets.local = [];
    await render({ autoplay: true, clue: null });
    expect(onAutoplayWord).toHaveBeenCalledTimes(1);
    expect(playAudio).not.toHaveBeenCalled();
  });

  it('asks "Try the sentences first?" before the word, and still lets him play it', async () => {
    await render();
    await click(q('listen-word'));
    expect(onPlayWord).not.toHaveBeenCalled();
    expect(q('listen-word-prompt')?.textContent).toContain('Try the sentences first?');
    await click(q('listen-word-anyway'));
    expect(onPlayWord).toHaveBeenCalledTimes(1);
    expect(stats).toEqual({ sentencesPlayed: 0, wordFirstPromptShown: true, playedWordAnyway: true });
    // Chosen once: no second ask on this card.
    await click(q('listen-word'));
    expect(onPlayWord).toHaveBeenCalledTimes(2);
  });

  it('"Play a sentence" in the ask plays the first one and marks it heard', async () => {
    await render();
    await click(q('listen-word'));
    await click(q('listen-word-sentence'));
    expect(q('listen-word-prompt')).toBeNull();
    expect(all('listen-row-play')[0].getAttribute('aria-label')).toBe('Sentence 1, played');
    expect(practice.recordSentenceHeard).toHaveBeenCalledWith('n1', order()[0]);
  });

  it('records each sentence heard once per showing, and its dot goes', async () => {
    await render();
    await click(inRow('n1-card', 'listen-row-play'));
    await click(inRow('n1-card', 'listen-row-play'));
    expect(practice.recordSentenceHeard).toHaveBeenCalledTimes(1);
    expect(practice.recordSentenceHeard).toHaveBeenCalledWith('n1', 'n1-card');
    expect(all('listen-row-new')).toHaveLength(2);
  });

  it('fresh sentences first: heard ones wait while unheard ones are left', async () => {
    const heard = (n: number) => ({ heard: { count: n, last_at: '2026-11-01T00:00:00Z' }, hidden: null });
    practice.stats = new Map([['n1-card', heard(2)], ['s1', heard(1)]]);
    await render();
    const keys = all('listen-row').map((r) => r.getAttribute('data-key'));
    // All three still fit (four a showing), but the never-heard one is the only "new".
    expect(new Set(keys)).toEqual(new Set(['n1-card', 's1', 's2']));
    expect(all('listen-row-new').map((d) => d.closest('[data-testid="listen-row"]')?.getAttribute('data-key'))).toEqual(['s2']);
    expect(analytics.track).toHaveBeenCalledWith('study.listen_context_shown', { shown: 3, fresh: 1, heard_before: 2 });
  });

  it('offline: rows without a cached clip are unavailable, the cached ones play, no + More', async () => {
    cache.cached = new Set(['generated/s1.mp3']);
    await render({ online: false });
    const play = (key: string) => inRow(key, 'listen-row-play') as HTMLButtonElement;
    expect(play('n1-card').disabled).toBe(true);
    expect(play('n1-card').textContent).toContain('Not downloaded');
    expect(play('s1').disabled).toBe(false);
    expect(play('s2').disabled).toBe(true);
    expect(q('listen-more')).toBeNull();
    await click(play('s1'));
    expect(playAudio).toHaveBeenCalledWith('generated/s1.mp3', '银行在哪儿？');
  });

  it('+ More sentences adds to the set (keepExisting) and shows the new rows', async () => {
    // The new rows land on the device (the list then reads them, the card's own row included).
    sets.generateAndStoreSentenceSet.mockImplementation(async () => {
      sets.local = [
        ...SET,
        { id: 's3', note_id: 'n1', position: 2, hanzi: '银行几点开门？', pinyin: '', translation: 'When does the bank open?', audio_url: null },
      ];
      return sets.local;
    });
    await render();
    await click(q('listen-more'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(sets.generateAndStoreSentenceSet).toHaveBeenCalledWith('n1', { count: 5, keepExisting: true });
    expect(all('listen-row')).toHaveLength(4);
    // The new one joins the showing after the ones up, new.
    expect(all('listen-row').map((r) => r.getAttribute('data-key'))).toEqual([...order(), 's3']);
    expect(rowOf('s3').getAttribute('data-fresh')).toBe('true');
    expect(analytics.track).toHaveBeenCalledWith('study.listen_more_sentences', { before: 3, after: 4 });
  });

  it('a showing leaving fewer than four unheard asks for more (the fresh buffer)', async () => {
    await render();
    expect(practice.requestMoreSentences).toHaveBeenCalledWith('n1', { reason: 'fresh', count: 8 });
  });

  it('reports the rows it shows (the answer side follows them) and shows a kept pick again as it was', async () => {
    const onShown = vi.fn();
    await render({ onShown });
    expect(onShown).toHaveBeenLastCalledWith(order());
    // The same showing again (a peek back, the resume point): its rows in its order — not re-picked,
    // nothing remembered or tracked twice, even with a different seed and that set as "previous".
    act(() => root.unmount());
    root = createRoot(container);
    analytics.track.mockReset();
    shown.rememberShownListenKeys.mockReset();
    shown.newListenSeed.mockReturnValue('seed-2');
    shown.previous = order();
    const kept = [...order()].reverse();
    await render({ shownKeys: kept, onShown });
    expect(all('listen-row').map((r) => r.getAttribute('data-key'))).toEqual(kept);
    expect(shown.rememberShownListenKeys).not.toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalledWith('study.listen_context_shown', expect.anything());
    // A kept pick none of whose sentences is still there: picked afresh.
    act(() => root.unmount());
    root = createRoot(container);
    await render({ shownKeys: ['gone'], onShown });
    expect(all('listen-row')).toHaveLength(3);
    expect(shown.rememberShownListenKeys).toHaveBeenCalled();
  });
});
