import { describe, it, expect } from 'vitest';
import {
  applyControl,
  answerQuiz,
  cleanGroupName,
  EMPTY_ROOM_STATE,
  galleryGrid,
  galleryOrder,
  groupCameraConstraints,
  isAudible,
  isPolite,
  memberProblem,
  nextSpeaker,
  personLeft,
  quizViewFor,
  revealQuiz,
  sanitizeControl,
  sanitizePeerState,
  sanitizeQuizSpec,
  stageOf,
  startQuiz,
  SPEAKER_HOLD_MS,
  type ControlContext,
  type GroupRoomState,
} from './index';

const ctx = (actor: string, present = ['t', 'a', 'b', 'c']): ControlContext => ({ actor, tutorId: 't', present, now: 1000 });

describe('group room controls', () => {
  it('only the tutor mutes, unmutes and spotlights; never herself', () => {
    expect(applyControl(EMPTY_ROOM_STATE, { kind: 'mute', user_id: 'b', muted: true }, ctx('a'))).toBeNull();
    const muted = applyControl(EMPTY_ROOM_STATE, { kind: 'mute', user_id: 'b', muted: true }, ctx('t'))!;
    expect(muted.muted).toEqual(['b']);
    expect(applyControl(muted, { kind: 'mute', user_id: 'b', muted: true }, ctx('t'))).toBeNull(); // no change
    expect(applyControl(muted, { kind: 'mute', user_id: 't', muted: true }, ctx('t'))).toBeNull();
    expect(applyControl(muted, { kind: 'mute', user_id: 'b', muted: false }, ctx('b'))).toBeNull(); // can't unmute yourself
    expect(applyControl(muted, { kind: 'mute', user_id: 'b', muted: false }, ctx('t'))!.muted).toEqual([]);
    expect(applyControl(EMPTY_ROOM_STATE, { kind: 'spotlight', user_id: 'a' }, ctx('a'))).toBeNull();
    expect(applyControl(EMPTY_ROOM_STATE, { kind: 'spotlight', user_id: 'a' }, ctx('t'))!.spotlight).toBe('a');
    expect(applyControl(EMPTY_ROOM_STATE, { kind: 'spotlight', user_id: 'gone' }, ctx('t'))).toBeNull(); // not in the room
  });

  it('mute all mutes every present student, keeps earlier mutes', () => {
    const s: GroupRoomState = { ...EMPTY_ROOM_STATE, muted: ['z'] };
    expect(applyControl(s, { kind: 'mute_all' }, ctx('t'))!.muted).toEqual(['a', 'b', 'c', 'z']);
    expect(applyControl(s, { kind: 'mute_all' }, ctx('a'))).toBeNull();
  });

  it('students raise and lower their own hand; the tutor lowers anyone’s', () => {
    const up = applyControl(EMPTY_ROOM_STATE, { kind: 'hand', up: true }, ctx('a'))!;
    expect(up.hands).toEqual([{ user_id: 'a', at: 1000 }]);
    expect(applyControl(up, { kind: 'hand', up: true }, ctx('a'))).toBeNull();
    expect(applyControl(EMPTY_ROOM_STATE, { kind: 'hand', up: true }, ctx('t'))).toBeNull();
    expect(applyControl(up, { kind: 'lower_hand', user_id: 'a' }, ctx('b'))).toBeNull();
    expect(applyControl(up, { kind: 'lower_hand', user_id: 'a' }, ctx('t'))!.hands).toEqual([]);
    expect(applyControl(up, { kind: 'hand', up: false }, ctx('a'))!.hands).toEqual([]);
  });

  it('leaving drops the hand and the spotlight but keeps the mute', () => {
    const s: GroupRoomState = { muted: ['a'], spotlight: 'a', hands: [{ user_id: 'a', at: 1 }, { user_id: 'b', at: 2 }] };
    expect(personLeft(s, 'a')).toEqual({ muted: ['a'], spotlight: null, hands: [{ user_id: 'b', at: 2 }] });
    expect(personLeft(s, 'nobody')).toBe(s);
  });

  it('sanitizes controls and peer state; a muted student’s mic reads off', () => {
    expect(sanitizeControl({ kind: 'mute', user_id: 'a', muted: 'yes' })).toBeNull();
    expect(sanitizeControl({ kind: 'spotlight', user_id: null })).toEqual({ kind: 'spotlight', user_id: null });
    expect(sanitizeControl({ kind: 'nuke' })).toBeNull();
    expect(sanitizePeerState({ mic: true, cam: true, screen: 'x' }, true)).toEqual({ mic: false, cam: true, screen: false });
    expect(isAudible({ user_id: 'a', state: { mic: true, cam: true, screen: false } }, { ...EMPTY_ROOM_STATE, muted: ['a'] })).toBe(false);
    expect(isAudible({ user_id: 'b', state: { mic: true, cam: true, screen: false } }, { ...EMPTY_ROOM_STATE, muted: ['a'] })).toBe(true);
  });

  it('group names and member counts', () => {
    expect(cleanGroupName('  Tuesday   HSK 3 ')).toEqual({ name: 'Tuesday HSK 3' });
    expect(cleanGroupName('')).toHaveProperty('problem');
    expect(cleanGroupName('x'.repeat(61))).toHaveProperty('problem');
    expect(memberProblem(['a'])).toMatch(/at least 2/);
    expect(memberProblem(['a', 'a'])).toMatch(/at least 2/);
    expect(memberProblem(['a', 'b', 'c', 'd', 'e', 'f'])).toBeNull();
    expect(memberProblem(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toMatch(/at most 6/);
  });

  it('exactly one side of every pair offers', () => {
    expect(isPolite('b', 'a')).toBe(true);
    expect(isPolite('a', 'b')).toBe(false);
  });
});

describe('quick quiz', () => {
  const spec = sanitizeQuizSpec({ question: ' 他___北京人。 ', options: ['是', '有', ' ', '在'], correct: 0 })!;
  it('cleans the form', () => {
    expect(spec).toEqual({ question: '他___北京人。', options: ['是', '有', '在'], correct: 0 });
    expect(sanitizeQuizSpec({ question: 'Q', options: ['only one'] })).toBeNull();
    expect(sanitizeQuizSpec({ question: 'Q', options: ['a', 'b'], correct: 5 })!.correct).toBeNull();
  });

  it('students see only the count until the reveal; the tutor sees who answered what', () => {
    let q = startQuiz(spec, 'q1', 0);
    q = answerQuiz(q, 'a', 'Anna', 0, 1)!;
    q = answerQuiz(q, 'b', 'Ben', 1, 2)!;
    expect(answerQuiz(q, 'b', 'Ben', 1, 3)).toBeNull(); // unchanged
    q = answerQuiz(q, 'b', 'Ben', 2, 4)!; // changed their mind
    expect(answerQuiz(q, 'c', 'C', 9, 5)).toBeNull();
    const student = quizViewFor(q, 'a', false);
    expect(student).toMatchObject({ answered: 2, mine: 0, counts: null, answers: null, correct: null });
    const tutor = quizViewFor(q, 't', true);
    expect(tutor.counts).toEqual([1, 0, 1]);
    expect(tutor.answers).toEqual([{ user_id: 'a', name: 'Anna', choice: 0 }, { user_id: 'b', name: 'Ben', choice: 2 }]);
    expect(tutor.correct).toBe(0);
    const revealed = revealQuiz(q)!;
    expect(revealQuiz(revealed)).toBeNull();
    expect(answerQuiz(revealed, 'c', 'C', 0, 6)).toBeNull();
    expect(quizViewFor(revealed, 'a', false)).toMatchObject({ correct: 0, counts: [1, 0, 1] });
  });
});

describe('stage and gallery', () => {
  it('picks the grid with the biggest 16:9 tiles', () => {
    expect(galleryGrid(4, 1280, 720)).toMatchObject({ cols: 2, rows: 2 });
    expect(galleryGrid(6, 1280, 720)).toMatchObject({ cols: 3, rows: 2 });
    expect(galleryGrid(7, 400, 900)).toMatchObject({ cols: 1 }); // a tall phone: one column…
    expect(galleryGrid(7, 400, 600).cols).toBeGreaterThanOrEqual(1);
    expect(galleryGrid(0, 100, 100)).toMatchObject({ cols: 1, rows: 1 });
  });

  it('orders tutor first, me last, the spotlight out of the gallery', () => {
    const people = [
      { user_id: 'me', name: 'Ann', role: 'student' as const },
      { user_id: 'b', name: 'Zoe', role: 'student' as const },
      { user_id: 't', name: 'Teacher', role: 'tutor' as const },
      { user_id: 'c', name: 'Bo', role: 'student' as const },
    ];
    expect(galleryOrder(people, { spotlight: null }, 'me').map((p) => p.user_id)).toEqual(['t', 'c', 'b', 'me']);
    expect(galleryOrder(people, { spotlight: 'c' }, 'me').map((p) => p.user_id)).toEqual(['t', 'b', 'me']);
  });

  it('a shared screen beats the spotlight', () => {
    const p = (user_id: string, screen = false) => ({ user_id, state: { mic: true, cam: true, screen } });
    expect(stageOf([p('t'), p('a')], { spotlight: 'a' })).toEqual({ kind: 'spotlight', user_id: 'a' });
    expect(stageOf([p('t', true), p('a')], { spotlight: 'a' })).toEqual({ kind: 'screen', user_id: 't' });
    expect(stageOf([p('t')], { spotlight: 'gone' })).toBeNull();
  });

  it('active speaker has hysteresis', () => {
    let s = nextSpeaker({ a: 0.01, b: 0.02 }, { id: null, since: 0 }, 0);
    expect(s.id).toBeNull();
    s = nextSpeaker({ a: 0.2, b: 0.01 }, s, 100);
    expect(s).toEqual({ id: 'a', since: 100 });
    // b a little louder while a still talks, too soon: a keeps it
    s = nextSpeaker({ a: 0.2, b: 0.22 }, s, 300);
    expect(s.id).toBe('a');
    // b clearly louder after the hold: b takes it
    s = nextSpeaker({ a: 0.1, b: 0.3 }, s, 100 + SPEAKER_HOLD_MS);
    expect(s.id).toBe('b');
    // everyone quiet: b stays highlighted
    expect(nextSpeaker({ a: 0, b: 0 }, s, 99999).id).toBe('b');
  });

  it('asks for a smaller camera as the class grows', () => {
    expect(groupCameraConstraints(3).width.ideal).toBe(640);
    expect(groupCameraConstraints(5).width.ideal).toBe(320);
  });
});
