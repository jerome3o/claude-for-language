import { describe, it, expect } from 'vitest';
import {
  isInReviewQueue,
  reviewQueueReasons,
  queueReasonLabels,
  weakChars,
  parseCharScores,
  LOW_PRONUNCIATION_SCORE,
  WEAK_CHAR_SCORE,
  type RecordingCheck,
} from './queue';
import { deriveMixUps, substitutions } from './mixups';
import { transcriptMatches, compareTranscription } from './transcript';

const clean: RecordingCheck = { status: 'done', transcript: '银行', transcript_match: true, score: 95, char_scores: [
  { char: '银', score: 96, error: 'None' },
  { char: '行', score: 94, error: 'None' },
] };

describe('review queue membership', () => {
  it('leaves a clean Good recording out', () => {
    expect(isInReviewQueue({ rating: 2, check: clean, flagged: false, marked: false })).toBe(false);
  });
  it('a transcript mismatch puts it in', () => {
    const check = { ...clean, transcript: '音响', transcript_match: false };
    expect(reviewQueueReasons({ rating: 2, check, flagged: false })).toEqual(['heard_different']);
  });
  it('an empty transcript reads as nothing heard', () => {
    const check = { ...clean, transcript: '', transcript_match: false };
    expect(reviewQueueReasons({ rating: 3, check, flagged: false })).toEqual(['nothing_heard']);
  });
  it('Again / Hard ratings put it in, even unchecked', () => {
    expect(reviewQueueReasons({ rating: 0, check: null, flagged: false })).toEqual(['rated_again']);
    expect(reviewQueueReasons({ rating: 1, check: null, flagged: false })).toEqual(['rated_hard']);
    expect(isInReviewQueue({ rating: 2, check: null, flagged: false, marked: false })).toBe(false);
  });
  it('a low score or a weak character puts it in (thresholds are exclusive)', () => {
    expect(reviewQueueReasons({ rating: 2, check: { ...clean, score: LOW_PRONUNCIATION_SCORE - 0.1 }, flagged: false })).toEqual(['low_score']);
    expect(reviewQueueReasons({ rating: 2, check: { ...clean, score: LOW_PRONUNCIATION_SCORE }, flagged: false })).toEqual([]);
    const weak = { ...clean, char_scores: [{ char: '银', score: WEAK_CHAR_SCORE - 1, error: 'None' as const, tone_suspect: true }, clean.char_scores[1]] };
    expect(reviewQueueReasons({ rating: 2, check: weak, flagged: false })).toEqual(['sounded_off']);
    expect(queueReasonLabels(['sounded_off'], weak)).toEqual(['Sounded off: 银 (tone)']);
  });
  it('a flag puts it in; a mark takes it out whatever the reasons', () => {
    expect(reviewQueueReasons({ rating: 2, check: clean, flagged: true })).toEqual(['flagged']);
    expect(isInReviewQueue({ rating: 0, check: { ...clean, transcript_match: false }, flagged: true, marked: true })).toBe(false);
  });
  it('an inserted extra character alone does not count as sounded off', () => {
    const check = { ...clean, char_scores: [...clean.char_scores, { char: '了', score: null, error: 'Insertion' as const }] };
    expect(reviewQueueReasons({ rating: 2, check, flagged: false })).toEqual([]);
    expect(weakChars(check.char_scores)).toEqual([{ char: '了', score: null, kind: 'extra' }]);
  });
  it('labels each reason', () => {
    const check = { ...clean, transcript: '音响', transcript_match: false, score: 61.6 };
    expect(queueReasonLabels(reviewQueueReasons({ rating: 0, check, flagged: true }), check)).toEqual([
      'Heard: 音响', 'Rated Again', 'Pronunciation score 62', 'Flagged for you',
    ]);
  });
  it('omissions read as missed; mispronunciation without a low score still counts', () => {
    expect(weakChars([
      { char: '银', score: null, error: 'Omission' },
      { char: '行', score: 88, error: 'Mispronunciation' },
    ])).toEqual([{ char: '银', score: null, kind: 'missing' }, { char: '行', score: 88, kind: 'sound' }]);
  });
  it('parses stored JSON defensively', () => {
    expect(parseCharScores('not json')).toEqual([]);
    expect(parseCharScores(JSON.stringify([{ char: '银', score: 50, error: 'Weird' }, 3]))).toEqual([{ char: '银', score: 50, error: 'None' }]);
  });
});

describe('transcript match', () => {
  it('matches homophones and numbers, not other tones', () => {
    expect(transcriptMatches('再见', '再见')).toBe(true);
    expect(transcriptMatches('3个', '三个')).toBe(true);
    expect(transcriptMatches('我说银行这个词', '银行')).toBe(true); // said inside a sentence
    expect(transcriptMatches('音响', '银行')).toBe(false);
    expect(transcriptMatches('买', '卖')).toBe(false); // mǎi vs mài
    expect(transcriptMatches('', '银行')).toBe(false);
  });
  it('keeps the card comparison shape', () => {
    const c = compareTranscription('两百', '200', '');
    expect(c.isMatch).toBe(true);
  });
});

describe('mix-ups', () => {
  it('reads same-length gaps as substitutions', () => {
    expect(substitutions('买东西', '卖东西')).toEqual([['买', '卖']]);
    expect(substitutions('我买了', '我卖')).toEqual([]); // different lengths: nothing to pair
    expect(substitutions('银行', '银行')).toEqual([]);
    expect(substitutions('你好。', 'ni好')).toEqual([]); // latin never pairs
    expect(substitutions('他们在', '她们再')).toEqual([['他', '她'], ['在', '再']]);
  });
  it('counts pairs both ways, once per review, newest first', () => {
    const mix = deriveMixUps([
      { hanzi: '买东西', user_answer: '卖东西', reviewed_at: '2026-10-01T10:00:00Z' },
      { hanzi: '卖', user_answer: '买', reviewed_at: '2026-10-02T10:00:00Z' },
      { hanzi: '买买', user_answer: '卖卖', reviewed_at: '2026-10-03T10:00:00Z' },
      { hanzi: '在', user_answer: '再', reviewed_at: '2026-09-30T10:00:00Z' },
      { hanzi: '银行', user_answer: null, reviewed_at: '2026-10-03T10:00:00Z' },
    ]);
    expect(mix.map((m) => [m.a, m.b, m.count])).toEqual([['买', '卖', 3], ['在', '再', 1]]);
    expect(mix[0].last_at).toBe('2026-10-03T10:00:00Z');
    expect(mix[0].examples.map((e) => e.expected)).toEqual(['买买', '卖', '买东西']);
  });
});
