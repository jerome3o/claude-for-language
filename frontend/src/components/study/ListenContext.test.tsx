/**
 * "Listen in context" (a listening card's question side): the sentences as audio-only rows —
 * the card's own sentence first, no Chinese on screen, EN shows only the English —, the
 * first sentence auto-played (the word when none has a clip), "Try the sentences first?"
 * before the word, "+ More sentences" (online), and offline rows without a cached clip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sets = vi.hoisted(() => ({
  local: [] as Array<Record<string, unknown>>,
  getLocalNoteSentences: vi.fn(),
  putLocalNoteSentences: vi.fn(),
  cacheSentenceAudio: vi.fn(),
  generateAndStoreSentenceSet: vi.fn(),
  awaitSentenceAudio: vi.fn(),
  ensureSentenceAudio: vi.fn(),
  topUpListeningSentences: vi.fn(),
  SENTENCE_AUDIO_COMING_LABEL: 'Audio coming…',
}));
vi.mock('../../services/sentence-sets', () => sets);
const cache = vi.hoisted(() => ({ cached: new Set<string>(), isAudioCached: vi.fn() }));
vi.mock('../../services/audioCache', () => cache);
vi.mock('../../api/client', () => ({ fetchNoteSentences: vi.fn().mockResolvedValue([]) }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../services/analytics', () => analytics);

import { ListenContext, type ListenContextStats } from './ListenContext';

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

async function render(props: { online?: boolean; autoplay?: boolean; clue?: { hanzi: string; translation?: string; audio_url?: string | null } | null } = {}) {
  await act(async () => {
    root.render(
      <ListenContext
        noteId="n1"
        cardSentence={props.clue === undefined ? { hanzi: '这是银行。', translation: 'This is a bank.', audio_url: 'generated/clue.mp3' } : props.clue}
        online={props.online ?? true}
        playAudio={playAudio}
        isPlaying={false}
        onPlayWord={onPlayWord}
        onAutoplayWord={onAutoplayWord}
        autoplay={props.autoplay ?? false}
        onStats={(s) => { stats = s; }}
      />,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

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
  sets.getLocalNoteSentences.mockImplementation(async () => sets.local);
  sets.topUpListeningSentences.mockResolvedValue(0);
  sets.generateAndStoreSentenceSet.mockReset();
  cache.cached = new Set();
  cache.isAudioCached.mockImplementation(async (u: string) => cache.cached.has(u));
  playAudio.mockReset();
  onPlayWord.mockReset();
  onAutoplayWord.mockReset();
  analytics.track.mockReset();
  stats = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ListenContext', () => {
  it('lists the card sentence first, then the set — audio only, never the Chinese', async () => {
    await render();
    expect(all('listen-row')).toHaveLength(3);
    expect(container.textContent).not.toContain('银行');
    expect(container.textContent).not.toContain('Where is the bank?');
    expect(all('listen-row-play').map((b) => b.getAttribute('aria-label'))).toEqual(['Sentence 1', 'Sentence 2', 'Sentence 3']);
    // EN shows just the English of that row.
    await click(all('listen-row-en')[1]);
    expect(q('listen-row-translation')?.textContent).toBe('Where is the bank?');
    expect(container.textContent).not.toContain('银行');
  });

  it('auto-plays the first sentence with a clip, not the word', async () => {
    await render({ autoplay: true });
    expect(playAudio).toHaveBeenCalledWith('generated/clue.mp3', '这是银行。');
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
    expect(playAudio).toHaveBeenCalledWith('generated/clue.mp3', '这是银行。');
    expect(q('listen-word-prompt')).toBeNull();
    expect(all('listen-row-play')[0].getAttribute('aria-label')).toBe('Sentence 1, played');
  });

  it('offline: rows without a cached clip are unavailable, the cached ones play, no + More', async () => {
    cache.cached = new Set(['generated/s1.mp3']);
    await render({ online: false });
    const buttons = all('listen-row-play') as HTMLButtonElement[];
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[0].textContent).toContain('Not downloaded');
    expect(buttons[1].disabled).toBe(false);
    expect(buttons[2].disabled).toBe(true);
    expect(q('listen-more')).toBeNull();
    await click(buttons[1]);
    expect(playAudio).toHaveBeenCalledWith('generated/s1.mp3', '银行在哪儿？');
  });

  it('+ More sentences adds to the set (keepExisting) and shows the new rows', async () => {
    sets.generateAndStoreSentenceSet.mockResolvedValue([
      ...SET,
      { id: 's3', note_id: 'n1', position: 2, hanzi: '银行几点开门？', pinyin: '', translation: 'When does the bank open?', audio_url: null },
    ]);
    await render();
    await click(q('listen-more'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(sets.generateAndStoreSentenceSet).toHaveBeenCalledWith('n1', { count: 5, keepExisting: true });
    expect(all('listen-row')).toHaveLength(4);
    expect(analytics.track).toHaveBeenCalledWith('study.listen_more_sentences', { before: 3, after: 4 });
  });

  it('asks for a background top-up of the note', async () => {
    await render();
    expect(sets.topUpListeningSentences).toHaveBeenCalledWith(['n1']);
  });
});
