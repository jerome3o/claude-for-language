import { describe, expect, it } from 'vitest';
import {
  listenAutoplay,
  listenContextProps,
  listenContextRows,
  listenRowLabel,
  listenRowState,
  moreSentencesCount,
  needsSentenceTopUp,
  topUpCount,
  wordTapAction,
} from './listenContext';

const set = [
  { id: 's2', hanzi: '我去银行取钱。', translation: 'I go to the bank to get money.', audio_url: 'generated/s2.mp3', position: 1 },
  { id: 's1', hanzi: '银行在哪儿？', translation: 'Where is the bank?', audio_url: null, position: 0 },
];

describe('listenContextRows', () => {
  it('puts the card sentence first, then the set by position', () => {
    const rows = listenContextRows('n1', { hanzi: '这是银行。', translation: ' ', audio_url: 'generated/c.mp3' }, set);
    expect(rows.map((r) => r.key)).toEqual(['clue:n1', 's1', 's2']);
    expect(rows[0]).toMatchObject({ fromCard: true, sentenceId: null, translation: null, audioUrl: 'generated/c.mp3' });
    expect(rows[1]).toMatchObject({ fromCard: false, sentenceId: 's1', audioUrl: null });
  });

  it('shows a card sentence the set repeats only once', () => {
    const rows = listenContextRows('n1', { hanzi: '银行在哪儿？' }, set);
    expect(rows.map((r) => r.key)).toEqual(['s1', 's2']);
  });

  it('works with no card sentence and no set', () => {
    expect(listenContextRows('n1', null, [])).toEqual([]);
    expect(listenContextRows('n1', { hanzi: '  ' }, [])).toEqual([]);
  });
});

describe('listenRowState', () => {
  it('plays a clip online or cached, waits for a missing set clip, uses the device voice for the card sentence', () => {
    expect(listenRowState({ audioUrl: 'a.mp3', sentenceId: 's' }, { online: true, cached: false })).toBe('ready');
    expect(listenRowState({ audioUrl: 'a.mp3', sentenceId: 's' }, { online: false, cached: true })).toBe('ready');
    expect(listenRowState({ audioUrl: 'a.mp3', sentenceId: 's' }, { online: false, cached: false })).toBe('unavailable');
    expect(listenRowState({ audioUrl: null, sentenceId: 's' }, { online: true, cached: false })).toBe('fetch');
    expect(listenRowState({ audioUrl: null, sentenceId: null }, { online: true, cached: false })).toBe('device');
    expect(listenRowState({ audioUrl: null, sentenceId: 's' }, { online: false, cached: false })).toBe('unavailable');
  });
});

describe('listenAutoplay', () => {
  it('plays the first ready sentence, else the word', () => {
    expect(listenAutoplay(true, ['fetch', 'ready', 'ready'])).toEqual({ kind: 'sentence', index: 1 });
    expect(listenAutoplay(true, ['fetch', 'device', 'unavailable'])).toEqual({ kind: 'word' });
    expect(listenAutoplay(true, [])).toEqual({ kind: 'word' });
    expect(listenAutoplay(false, ['ready'])).toEqual({ kind: 'none' });
  });
});

describe('wordTapAction', () => {
  it('asks only before any sentence was played, when one can be', () => {
    expect(wordTapAction({ sentencesPlayed: 0, playableSentences: 3, playedWordAnyway: false })).toBe('prompt');
    expect(wordTapAction({ sentencesPlayed: 1, playableSentences: 3, playedWordAnyway: false })).toBe('play');
    expect(wordTapAction({ sentencesPlayed: 0, playableSentences: 0, playedWordAnyway: false })).toBe('play');
    expect(wordTapAction({ sentencesPlayed: 0, playableSentences: 3, playedWordAnyway: true })).toBe('play');
  });
});

describe('top-up and more', () => {
  it('tops up under five, asking for what is missing within 3–10', () => {
    expect(needsSentenceTopUp(4)).toBe(true);
    expect(needsSentenceTopUp(5)).toBe(false);
    expect(topUpCount(0)).toBe(5);
    expect(topUpCount(4)).toBe(3);
    expect(moreSentencesCount(1)).toBe(7);
    expect(moreSentencesCount(6)).toBe(3);
    expect(moreSentencesCount(20)).toBe(3);
    expect(moreSentencesCount(-5)).toBe(10);
  });
});

describe('labels and analytics', () => {
  it('labels rows and shapes the event', () => {
    expect(listenRowLabel(1, false)).toBe('Sentence 2');
    expect(listenRowLabel(0, true)).toBe('Sentence 1, played');
    expect(listenContextProps({ sentencesPlayed: 2, wordFirstPromptShown: true, playedWordAnyway: false })).toEqual({
      sentences_played: 2,
      word_first_prompt_shown: true,
      played_word_anyway: false,
    });
  });
});
