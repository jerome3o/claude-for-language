import { describe, expect, it } from 'vitest';
import {
  firstAngleType,
  parsePassHardMode,
  parsePassStepId,
  passAngleLine,
  passAnglePlan,
  passAnglesLabel,
  passAnswerItemId,
  passHardApplies,
  passStepId,
  passWordMissed,
  secondAngleType,
  PASS_ANGLE_GAP,
  type PassWord,
} from './pass-angles';
import { passProgress, type PassEvent } from './pass';
import { passRetryBar } from './retry-bar';

const ALL3 = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const word = (id: string, cardTypes: string[] = ALL3, hasAudio = true): PassWord => ({ id, cardTypes, hasAudio });
let clock = 0;
const at = () => `2026-10-25T10:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock++ % 60).padStart(2, '0')}.000Z`;
const ev = (item_id: string, result: PassEvent['result'], id = `e${clock}`): PassEvent => ({ id, item_id, result, created_at: at() });

describe('the setting', () => {
  it('defaults to All for passes, keeps an explicit choice', () => {
    expect(parsePassHardMode(null)).toBe('all');
    expect(parsePassHardMode('junk')).toBe('all');
    expect(parsePassHardMode('off')).toBe('off');
    expect(parsePassHardMode('red')).toBe('red');
  });
  it('applies on reading / meaning cards; Red only to missed words', () => {
    expect(passHardApplies({ mode: 'all', cardType: 'hanzi_to_meaning', missed: false })).toBe(true);
    expect(passHardApplies({ mode: 'all', cardType: 'audio_to_hanzi', missed: true })).toBe(false);
    expect(passHardApplies({ mode: 'red', cardType: 'meaning_to_hanzi', missed: false })).toBe(false);
    expect(passHardApplies({ mode: 'red', cardType: 'meaning_to_hanzi', missed: true })).toBe(true);
    expect(passHardApplies({ mode: 'off', cardType: 'hanzi_to_meaning', missed: true })).toBe(false);
  });
});

describe('angles', () => {
  it('step ids round-trip', () => {
    expect(parsePassStepId(passStepId('n1', 'hanzi_to_meaning'))).toEqual({ noteId: 'n1', cardType: 'hanzi_to_meaning' });
    expect(parsePassStepId('n1')).toBeNull();
    expect(parsePassStepId('#x')).toBeNull();
  });
  it('reading ↔ meaning, then listening with audio', () => {
    expect(firstAngleType(word('a'))).toBe('hanzi_to_meaning');
    expect(firstAngleType(word('a', ['meaning_to_hanzi', 'audio_to_hanzi']))).toBe('meaning_to_hanzi');
    expect(firstAngleType(word('a', []))).toBe('hanzi_to_meaning');
    expect(secondAngleType(word('a'), 'hanzi_to_meaning')).toBe('meaning_to_hanzi');
    expect(secondAngleType(word('a'), 'meaning_to_hanzi')).toBe('hanzi_to_meaning');
    expect(secondAngleType(word('a'), 'hanzi_to_meaning', ['meaning_to_hanzi'])).toBe('audio_to_hanzi');
    expect(secondAngleType(word('a', ALL3, false), 'hanzi_to_meaning', ['meaning_to_hanzi'])).toBeNull();
    expect(secondAngleType(word('a', ['hanzi_to_meaning']), 'hanzi_to_meaning')).toBeNull();
    expect(secondAngleType(word('a', ['hanzi_to_meaning', 'audio_to_hanzi'], true), 'hanzi_to_meaning')).toBe('audio_to_hanzi');
  });
  it('Got it records a step only on a hard first angle owed a second', () => {
    const w = word('a');
    const first = { noteId: 'a', cardType: 'hanzi_to_meaning', angle: 1 as const, retry: false };
    expect(passAnswerItemId({ showing: first, word: w, right: true, hard: true })).toBe('a#hanzi_to_meaning');
    expect(passAnswerItemId({ showing: first, word: w, right: true, hard: false })).toBe('a');
    expect(passAnswerItemId({ showing: first, word: w, right: false, hard: true })).toBe('a');
    expect(passAnswerItemId({ showing: { ...first, angle: 2, cardType: 'meaning_to_hanzi' }, word: w, right: true, hard: true })).toBe('a');
    expect(passAnswerItemId({ showing: first, word: word('a', ['hanzi_to_meaning']), right: true, hard: true })).toBe('a');
  });
});

describe('passAnglePlan', () => {
  it('without steps and Off it is passProgress + passRetryBar', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const events = [ev('a', 'wrong'), ev('b', 'right'), ev('c', 'wrong'), ev('a', 'wrong')];
    const plan = passAnglePlan(ids.map((id) => word(id)), events, 'off');
    const progress = passProgress(ids, events);
    expect(plan.remaining.map((s) => s.noteId)).toEqual(progress.remaining);
    expect(plan.done).toBe(progress.done);
    expect(plan.bar).toEqual(passRetryBar(ids, events));
  });

  it('All: a word got right on its first angle comes back on another card type after the gap', () => {
    clock = 0;
    const words = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => word(id));
    let plan = passAnglePlan(words, [], 'all');
    // Two showings planned per word in the bar.
    expect(plan.bar.slots).toBe(12);
    expect(plan.next).toEqual({ noteId: 'a', cardType: 'hanzi_to_meaning', angle: 1, retry: false });
    const events: PassEvent[] = [ev('a#hanzi_to_meaning', 'right')];
    plan = passAnglePlan(words, events, 'all');
    expect(plan.done).toBe(0);
    expect(plan.anglesOwed).toBe(1);
    expect(plan.next?.noteId).toBe('b');
    expect(plan.remaining[plan.remaining.length - 1]).toEqual({ noteId: 'a', cardType: 'meaning_to_hanzi', angle: 2, retry: false });
    expect(plan.bar.answered).toBe(1);
    expect(plan.bar.slots).toBe(12);
    // After PASS_ANGLE_GAP more words were started, a's second angle comes first.
    for (const id of ['b', 'c', 'd'].slice(0, PASS_ANGLE_GAP)) events.push(ev(`${id}#hanzi_to_meaning`, 'right'));
    plan = passAnglePlan(words, events, 'all');
    expect(plan.next).toEqual({ noteId: 'a', cardType: 'meaning_to_hanzi', angle: 2, retry: false });
    events.push(ev('a', 'right'));
    plan = passAnglePlan(words, events, 'all');
    expect(plan.done).toBe(1);
    expect(plan.bar.itemsDone).toBe(1);
    expect(plan.bar.answered).toBe(5);
    expect(plan.next?.noteId).toBe('e');
  });

  it('a Not yet on the second angle brings that angle back as a retry', () => {
    clock = 100;
    const words = [word('a'), word('b')];
    const events = [ev('a#hanzi_to_meaning', 'right'), ev('b', 'wrong'), ev('a', 'wrong')];
    const plan = passAnglePlan(words, events, 'all');
    expect(plan.remaining).toEqual([
      { noteId: 'b', cardType: 'hanzi_to_meaning', angle: 1, retry: true },
      { noteId: 'a', cardType: 'meaning_to_hanzi', angle: 2, retry: true },
    ]);
    expect(plan.retrying).toBe(2);
    // b: orange + its own second angle in the track; a: orange.
    expect(plan.bar.retries).toBe(2);
    expect(plan.bar.fresh).toBe(1);
  });

  it('Red: only missed words get a second angle in the bar', () => {
    clock = 200;
    const words = [word('a'), word('b')];
    const plan = passAnglePlan(words, [ev('a', 'wrong')], 'red');
    expect(plan.bar.slots).toBe(1 /* a's Not yet */ + 1 /* a again */ + 1 /* a's second angle */ + 1 /* b */);
    expect(passWordMissed('a', [ev('a', 'wrong')])).toBe(true);
    expect(passWordMissed('b', [ev('a', 'wrong')])).toBe(false);
  });

  it('undoing a step gives the first angle back', () => {
    clock = 300;
    const step = ev('a#hanzi_to_meaning', 'right', 'x1');
    const undo: PassEvent = { id: 'u1', item_id: 'a#hanzi_to_meaning', result: 'undo', undoes: 'x1', created_at: at() };
    const plan = passAnglePlan([word('a')], [step, undo], 'all');
    expect(plan.next).toEqual({ noteId: 'a', cardType: 'hanzi_to_meaning', angle: 1, retry: false });
    expect(plan.bar.answered).toBe(0);
  });

  it('ignores other items, dedupes words, is complete when every word is done', () => {
    clock = 400;
    const plan = passAnglePlan([word('a'), word('a')], [ev('zz#hanzi_to_meaning', 'right'), ev('a#hanzi_to_meaning', 'right'), ev('a', 'right')], 'all');
    expect(plan.total).toBe(1);
    expect(plan.complete).toBe(true);
    expect(plan.bar.complete).toBe(true);
  });

  it('words', () => {
    expect(passAnglesLabel('all')).toBe('🎯 2 angles per word');
    expect(passAnglesLabel('off')).toBeNull();
    expect(passAngleLine({ angle: 2, cardType: 'meaning_to_hanzi' })).toBe('🔄 Second angle · English → Chinese');
    expect(passAngleLine({ angle: 1, cardType: 'meaning_to_hanzi' })).toBeNull();
  });
});
