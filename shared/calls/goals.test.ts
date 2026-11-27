import { describe, expect, it } from 'vitest';
import {
  EMPTY_GOAL_SPEECH,
  GOALS_LIST_MAX,
  GOAL_CHECK_STALE_MS,
  flushGoalSpeech,
  foldGoalSpeech,
  goalListenNote,
  goalListenStatus,
  goalMatchKey,
  goalSourceLine,
  goalsChipLabel,
  goalsEmptyText,
  goalsFromStructures,
  goalsHeardIn,
  goalsNotes,
  goalsSummary,
  matchStructure,
  mayActOnGoals,
  mergeLessonGoals,
  parseGoalPattern,
  pickCallGoals,
  reduceGoals,
  sanitizeCallGoals,
  sanitizeGoalsAction,
  type CallGoals,
  type GoalStructure,
} from './goals';

const NOW = Date.parse('2026-11-27T10:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const st = (name: string, fixed: string[], daysAgo: number): GoalStructure => ({ name, fixed, last_met: day(daysAgo), line: `${name} line`, meaning: 'meaning', example: '例子。' });

describe('pickCallGoals', () => {
  const list = [
    st('除了…还…', ['除了', '还'], 2),
    st('本来…要…', ['本来', '要'], 5),
    st('从…的角度来看', ['从', '的角度来看'], 9),
    st('一…就…', ['一', '就'], 30),
    st('越…越…', ['越', '越'], 60),
    st('把…', ['把'], 1),
  ];
  it('takes recent ones not used before, newest first, up to five', () => {
    expect(pickCallGoals(list, [], NOW).map((s) => s.name)).toEqual(['把…', '除了…还…', '本来…要…', '从…的角度来看']);
  });
  it('skips the ones already used in a call and tops up with older ones to three', () => {
    expect(pickCallGoals(list, ['把…', '除了…还…', '本来…要…'], NOW).map((s) => s.name)).toEqual(['从…的角度来看', '一…就…', '越…越…']);
  });
  it('uses used ones last when there is nothing else', () => {
    expect(pickCallGoals(list.slice(0, 2), ['除了…还…'], NOW).map((s) => s.name)).toEqual(['本来…要…', '除了…还…']);
  });
  it('caps at five recent ones', () => {
    const many = Array.from({ length: 8 }, (_, i) => st(`S${i}`, [`字${i}`], i));
    expect(pickCallGoals(many, [], NOW)).toHaveLength(5);
  });
  it('drops duplicates and structures without fixed words', () => {
    expect(pickCallGoals([st('A', ['甲'], 1), st('A', ['甲'], 1), st('B', [], 1), st(' ', ['乙'], 1)], [], NOW).map((s) => s.name)).toEqual(['A']);
  });
  it('makes open goals', () => {
    let n = 0;
    const g = goalsFromStructures(pickCallGoals(list, [], NOW), () => `g${++n}`);
    expect(g[0]).toMatchObject({ id: 'g1', name: '把…', status: 'open', source: 'learned', used: null, fixed: ['把'] });
  });
});

describe('parseGoalPattern', () => {
  it('splits the Chinese runs', () => {
    expect(parseGoalPattern('一…就…')).toEqual({ name: '一…就…', fixed: ['一', '就'] });
    expect(parseGoalPattern('除了...还...')).toEqual({ name: '除了…还…', fixed: ['除了', '还'] });
    expect(parseGoalPattern('从 A 的角度来看')).toEqual({ name: '从…的角度来看', fixed: ['从', '的角度来看'] });
    expect(parseGoalPattern('…以后')).toEqual({ name: '…以后', fixed: ['以后'] });
    expect(parseGoalPattern('虽然 + [clause] + 但是')).toEqual({ name: '虽然…但是', fixed: ['虽然', '但是'] });
  });
  it('refuses no Chinese / too long', () => {
    expect(parseGoalPattern('hello')).toBeNull();
    expect(parseGoalPattern('')).toBeNull();
    expect(parseGoalPattern('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一')).toBeNull();
    expect(parseGoalPattern('一 二 三 四 五 六 七')).toBeNull();
  });
});

describe('matchStructure', () => {
  it('finds the fixed words in order with bounded gaps', () => {
    expect(matchStructure('除了中文，我还学日语。', ['除了', '还'])).not.toBeNull();
    expect(matchStructure('我一到家就睡觉了', ['一', '就'])).not.toBeNull();
    expect(matchStructure('还有除了', ['除了', '还'])).toBeNull();
    expect(matchStructure('除了这个，' + '我们'.repeat(10) + '还要', ['除了', '还'])).toBeNull();
  });
  it('ignores punctuation, spaces, Latin and reads digits as Chinese', () => {
    expect(matchStructure('除了 coffee, 我还 drink 茶!', ['除了', '还'])).not.toBeNull();
    expect(matchStructure('我等了3个小时', ['等了', '三个'])).not.toBeNull();
    expect(goalMatchKey('他跑得很快 OK 3')).toBe('他跑的很快三');
  });
  it('folds 的 / 得 / 地', () => {
    expect(matchStructure('从老师得角度来看，这样不好', ['从', '的角度来看'])).not.toBeNull();
  });
  it('needs some content of its own', () => {
    expect(matchStructure('除了还', ['除了', '还'])).toBeNull();
    expect(matchStructure('除了茶还有', ['除了', '还'])).not.toBeNull();
  });
  it('tries later starts when the first one fails', () => {
    expect(matchStructure('一个人' + '我们'.repeat(8) + '一回家就做饭', ['一', '就'])).toEqual({ start: 19, end: 23 });
  });
});

describe('the room list', () => {
  const base = (): CallGoals => {
    let n = 0;
    return { student_id: 'stu', student_name: 'Jerome Swannack', goals: goalsFromStructures([st('除了…还…', ['除了', '还'], 2), st('一…就…', ['一', '就'], 3)], () => `g${++n}`), v: 1, available: 2 };
  };
  const tutor = { userId: 'tut', name: 'Minghui Li' };
  const student = { userId: 'stu', name: 'Jerome' };
  const id = () => 'new';

  it('permissions', () => {
    expect(mayActOnGoals({ kind: 'tick' }, 'stu', 'tut', 'stu')).toBe(false);
    expect(mayActOnGoals({ kind: 'tick' }, 'tut', 'tut', 'stu')).toBe(true);
    expect(mayActOnGoals({ kind: 'tick' }, 'stu', null, 'stu')).toBe(true);
    expect(mayActOnGoals({ kind: 'heard' }, 'tut', 'tut', 'stu')).toBe(false);
    expect(mayActOnGoals({ kind: 'heard' }, 'stu', 'tut', 'stu')).toBe(true);
    expect(mayActOnGoals({ kind: 'add' }, 'stu', 'tut', 'stu')).toBe(true);
  });

  it('heard → checking → used, or near', () => {
    let g = reduceGoals(base(), { kind: 'heard', id: 'g1', text: '除了中文，我还学日语。' }, student, 100, id)!;
    expect(g.goals[0]).toMatchObject({ status: 'checking', checking: { text: '除了中文，我还学日语。', at: 100 } });
    expect(g.v).toBe(2);
    // A second sentence while checking: ignored until stale.
    expect(reduceGoals(g, { kind: 'heard', id: 'g1', text: '除了茶我还喝咖啡' }, student, 200, id)).toBeNull();
    expect(reduceGoals(g, { kind: 'heard', id: 'g1', text: '除了茶我还喝咖啡' }, student, 100 + GOAL_CHECK_STALE_MS, id)!.goals[0].checking!.text).toBe('除了茶我还喝咖啡');
    // A result for another sentence is stale.
    expect(reduceGoals(g, { kind: 'checked', id: 'g1', text: 'x', ok: true }, student, 300, id)).toBeNull();
    const used = reduceGoals(g, { kind: 'checked', id: 'g1', text: '除了中文，我还学日语。', ok: true }, student, 300, id)!;
    expect(used.goals[0]).toMatchObject({ status: 'used', used: { text: '除了中文，我还学日语。', at: 300, by: 'auto' }, checking: null });
    expect(reduceGoals(used, { kind: 'heard', id: 'g1', text: '除了中文，我还学日语。' }, student, 400, id)).toBeNull();
    g = reduceGoals(g, { kind: 'checked', id: 'g1', text: '除了中文，我还学日语。', ok: false }, student, 300, id)!;
    expect(g.goals[0]).toMatchObject({ status: 'near', near: { text: '除了中文，我还学日语。', at: 300 } });
    // A near miss can still be heard again.
    expect(reduceGoals(g, { kind: 'heard', id: 'g1', text: '除了茶我还喝咖啡' }, student, 500, id)!.goals[0].status).toBe('checking');
  });

  it('a heard sentence that does not match is refused', () => {
    expect(reduceGoals(base(), { kind: 'heard', id: 'g1', text: '我还学日语' }, student, 1, id)).toBeNull();
  });

  it('tick / untick by hand', () => {
    const t = reduceGoals(base(), { kind: 'tick', id: 'g2' }, tutor, 50, id)!;
    expect(t.goals[1]).toMatchObject({ status: 'used', used: { text: '', by: 'tutor', name: 'Minghui Li', at: 50 } });
    const u = reduceGoals(t, { kind: 'untick', id: 'g2' }, tutor, 60, id)!;
    expect(u.goals[1]).toMatchObject({ status: 'open', used: null });
    expect(reduceGoals(u, { kind: 'untick', id: 'g2' }, tutor, 60, id)).toBeNull();
  });

  it('add / remove / move', () => {
    let g = reduceGoals(base(), { kind: 'add', text: '本来…要…' }, student, 1, id)!;
    expect(g.goals.map((x) => x.name)).toEqual(['除了…还…', '一…就…', '本来…要…']);
    expect(g.goals[2]).toMatchObject({ id: 'new', source: 'added', fixed: ['本来', '要'] });
    expect(reduceGoals(g, { kind: 'add', text: '本来...要...' }, student, 1, id)).toBeNull();
    expect(reduceGoals(g, { kind: 'add', text: 'nope' }, student, 1, id)).toBeNull();
    g = reduceGoals(g, { kind: 'move', id: 'new', to: 0 }, student, 1, id)!;
    expect(g.goals.map((x) => x.name)).toEqual(['本来…要…', '除了…还…', '一…就…']);
    expect(reduceGoals(g, { kind: 'move', id: 'new', to: -3 }, student, 1, id)).toBeNull();
    g = reduceGoals(g, { kind: 'remove', id: 'g1' }, tutor, 1, id)!;
    expect(g.goals.map((x) => x.name)).toEqual(['本来…要…', '一…就…']);
    let full = base();
    for (let i = 0; i < 10; i++) full = reduceGoals(full, { kind: 'add', text: `${'甲乙丙丁戊己庚辛壬癸'[i]}…就` }, student, 1, () => `a${i}`) ?? full;
    expect(full.goals).toHaveLength(GOALS_LIST_MAX);
  });

  it('sanitizes actions and stored lists', () => {
    expect(sanitizeGoalsAction({ kind: 'heard', id: 'g1', text: '  除了  茶 ' })).toEqual({ kind: 'heard', id: 'g1', text: '除了 茶' });
    expect(sanitizeGoalsAction({ kind: 'checked', id: 'g1', text: 'x' })).toBeNull();
    expect(sanitizeGoalsAction({ kind: 'move', id: 'g1', to: 1.6 })).toEqual({ kind: 'move', id: 'g1', to: 2 });
    expect(sanitizeGoalsAction({ kind: 'nope' })).toBeNull();
    const s = sanitizeCallGoals({ ...base(), goals: [...base().goals, { id: 'x', name: 'y', fixed: [] }, { id: 'z', name: 'z', fixed: ['了'], status: 'used' }] })!;
    expect(s.goals.map((g) => g.id)).toEqual(['g1', 'g2', 'z']);
    expect(s.goals[2].status).toBe('open');
    expect(sanitizeCallGoals(null)).toBeNull();
  });

  it('heard in a sentence', () => {
    expect(goalsHeardIn('我一到家就除了吃饭还睡觉', base().goals).map((g) => g.id)).toEqual(['g1', 'g2']);
  });
});

describe('speech → utterances', () => {
  const msg = (tokens: Array<[string, boolean]>, finished = false) => JSON.stringify({ tokens: tokens.map(([text, is_final]) => ({ text, is_final })), ...(finished ? { finished: true } : {}) });
  it('closes an utterance at <end>, sentence punctuation or finished; skips non-final tokens', () => {
    let s = EMPTY_GOAL_SPEECH;
    let r = foldGoalSpeech(s, msg([['除了', true], ['中文', true], ['我还', false]]));
    expect(r.utterances).toEqual([]);
    s = r.state;
    r = foldGoalSpeech(s, msg([['我还学日语', true], ['<end>', true]]));
    expect(r.utterances).toEqual(['除了中文我还学日语']);
    r = foldGoalSpeech(r.state, msg([['我一到家就睡觉了。你呢', true]]));
    expect(r.utterances).toEqual(['我一到家就睡觉了。']);
    expect(r.state.pending).toBe('你呢');
    r = foldGoalSpeech(r.state, msg([], true));
    expect(r.utterances).toEqual(['你呢']);
    expect(foldGoalSpeech(EMPTY_GOAL_SPEECH, 'not json').utterances).toEqual([]);
    expect(flushGoalSpeech({ pending: ' 好的 ' })).toEqual({ state: EMPTY_GOAL_SPEECH, utterances: ['好的'] });
  });
  it('cuts a long run at its last comma', () => {
    const long = '我们'.repeat(30) + '，' + '他们'.repeat(15);
    const r = foldGoalSpeech(EMPTY_GOAL_SPEECH, msg([[long, true]]));
    expect(r.utterances).toHaveLength(1);
    expect(r.utterances[0].endsWith('，')).toBe(true);
  });
});

describe('listening and words', () => {
  const goals: CallGoals = { student_id: 's', student_name: 'Jerome', goals: goalsFromStructures([st('一…就…', ['一', '就'], 1)], () => 'g'), v: 1, available: 1 };
  it('listens only on the student device, live, with an open goal and the mic on', () => {
    const o = { live: true, isStudent: true, goals, micOn: true, hasMic: true, unavailable: false };
    expect(goalListenStatus(o)).toBe('listening');
    expect(goalListenStatus({ ...o, isStudent: false })).toBe('off');
    expect(goalListenStatus({ ...o, micOn: false })).toBe('muted');
    expect(goalListenStatus({ ...o, unavailable: true })).toBe('unavailable');
    expect(goalListenStatus({ ...o, goals: { ...goals, goals: [{ ...goals.goals[0], status: 'used' }] } })).toBe('off');
    expect(goalListenNote('listening', true)).toContain('Listening');
    expect(goalListenNote('listening', false)).toBeNull();
  });
  it('chip, empty text, source line', () => {
    expect(goalsChipLabel(null)).toBeNull();
    expect(goalsChipLabel(goals)).toBe('🎯 0/1');
    expect(goalsChipLabel({ ...goals, goals: [] })).toBe('🎯');
    expect(goalsEmptyText(false, 'Jerome Swannack', 0)).toContain('Jerome’s mini lessons');
    expect(goalSourceLine({ source: 'learned', last_met: '2026-11-03T10:00:00Z' })).toBe('From a mini lesson · 3 Nov');
    expect(goalSourceLine({ source: 'added', last_met: null })).toBe('Added in the call');
  });
  it('summary and notes, merged across calls', () => {
    const [a, b, c] = goalsFromStructures([st('A…', ['甲'], 1), st('B…', ['乙'], 1), st('C…', ['丙'], 1)], (() => { let n = 0; return () => `x${++n}`; })());
    const used = { ...a, status: 'used' as const, used: { text: '甲乙丙丁', at: 1, by: 'auto' as const } };
    const near = { ...b, status: 'near' as const, near: { text: '乙丁', at: 1 } };
    const s = goalsSummary([used, near, c]);
    expect(s).toEqual({ used: [{ name: 'A…', text: '甲乙丙丁', by: 'auto' }], near: [{ name: 'B…', text: '乙丁' }], not_tried: ['C…'] });
    expect(goalsNotes(s)).toBe('- USED A…: “甲乙丙丁”\n- TRIED, NOT QUITE B…: “乙丁”\n- NOT TRIED C…');
    expect(mergeLessonGoals([[used, b], [a, near]]).map((g) => `${g.name}:${g.status}`)).toEqual(['A…:used', 'B…:near']);
  });
});
