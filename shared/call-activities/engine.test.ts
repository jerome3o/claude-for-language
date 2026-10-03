import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_CATALOGUE,
  ACTIVITY_KINDS,
  activitySummary,
  blanksFor,
  buildPool,
  builtText,
  describeOptions,
  findActivity,
  joinActivity,
  reduceActivity,
  rolesOf,
  scoreOf,
  seededShuffle,
  startActivity,
  totalRounds,
  validateActivitySpec,
  type ActivityAction,
  type ActivitySession,
  type ActivitySpec,
  type BuildSpec,
  type DescribeSpec,
  type InfoGapSpec,
} from './index';

const T = 'tutor-1';
const S = 'student-1';
const names = { [T]: 'Minghui', [S]: 'Jerome' };

function start(id: string, opts: Partial<{ starter: string; present: string[]; tutor: string | null }> = {}): ActivitySession {
  return startActivity(findActivity(id)!, { sessionId: 'sess-1', starter: opts.starter ?? T, tutor: opts.tutor === undefined ? T : opts.tutor, present: opts.present ?? [T, S], names, now: 1000 });
}

/** Apply actions in order; every one must be accepted. */
function play(s: ActivitySession, steps: [string, ActivityAction][]): ActivitySession {
  let cur = s;
  steps.forEach(([who, a], i) => {
    const next = reduceActivity(cur, a, who, 2000 + i);
    if (!next) throw new Error(`step ${i} (${a.type} by ${who}) refused`);
    cur = next;
  });
  return cur;
}

describe('catalogue', () => {
  it('every spec is valid and every kind has a sample', () => {
    for (const spec of ACTIVITY_CATALOGUE) expect(validateActivitySpec(spec), spec.id).toEqual([]);
    for (const k of ACTIVITY_KINDS) expect(ACTIVITY_CATALOGUE.some((a) => a.kind === k), k).toBe(true);
    expect(new Set(ACTIVITY_CATALOGUE.map((a) => a.id)).size).toBe(ACTIVITY_CATALOGUE.length);
  });
});

describe('seeded shuffle', () => {
  it('is a stable permutation', () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6], 'k');
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 'k')).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 'other')).not.toEqual(a);
  });
  it('describe options hold the answer and three others; a build pool is never already solved', () => {
    const spec = findActivity('describe-food-1') as DescribeSpec;
    for (let r = 0; r < spec.items.length; r++) {
      const o = describeOptions(spec, 's', r);
      expect(o).toHaveLength(4);
      expect(o).toContain(spec.items[r].hanzi);
      expect(new Set(o).size).toBe(4);
    }
    const b = findActivity('build-sentences-1') as BuildSpec;
    for (let r = 0; r < b.items.length; r++) {
      for (const sid of ['a', 'b', 'c', 'd']) expect(builtText(b, r, buildPool(b, sid, r))).not.toBe(b.items[r].tiles.join(''));
    }
  });
});

describe('roles', () => {
  it('the tutor takes the spec’s tutor role and is the host', () => {
    const s = start('describe-food-1'); // tutor_role b: the student describes
    expect(s.roles).toEqual({ a: S, b: T });
    expect(s.host).toBe(T);
    expect(s.names).toEqual(names);
  });
  it('without a known tutor the starter leads; alone you hold both', () => {
    expect(start('quiz-tones-1', { tutor: null, starter: S }).roles).toEqual({ a: S, b: T });
    const solo = start('quiz-tones-1', { tutor: null, present: [T] });
    expect(solo.roles).toEqual({ a: T, b: T });
    expect(rolesOf(solo, T)).toEqual(['a', 'b']);
  });
  it('a tutor who is not in the call does not lead', () => {
    expect(start('quiz-tones-1', { tutor: 'someone-else', starter: S }).host).toBe(S);
  });
  it('strangers are refused; host controls are host-only', () => {
    const s = start('describe-food-1');
    expect(reduceActivity(s, { type: 'skip' }, 'stranger', 1)).toBeNull();
    expect(reduceActivity(s, { type: 'skip' }, S, 1)).toBeNull();
    expect(reduceActivity(s, { type: 'skip' }, T, 1)).not.toBeNull();
    // Either person may finish.
    expect(reduceActivity(s, { type: 'finish' }, S, 1)?.phase).toBe('done');
  });
  it('someone joining a solo-started activity takes a role (the tutor’s and the host when it is the tutor)', () => {
    const solo = start('describe-food-1', { present: [S], starter: S, tutor: null });
    expect(solo.roles).toEqual({ a: S, b: S });
    const withTutor = joinActivity(solo, T, 'Minghui', T, 5)!;
    expect(withTutor.roles).toEqual({ a: S, b: T }); // tutor_role b
    expect(withTutor.host).toBe(T);
    expect(withTutor.v).toBe(solo.v + 1);
    const withPeer = joinActivity(start('quiz-tones-1', { present: [T], tutor: T }), S, 'Jerome', T, 5)!;
    expect(withPeer.roles).toEqual({ a: T, b: S });
    expect(withPeer.host).toBe(T);
    expect(joinActivity(withPeer, 'third', 'X', T, 5)).toBeNull();
    expect(joinActivity(solo, S, 'Jerome', null, 5)).toBeNull();
  });
  it('swap roles exchanges a and b and resets the round', () => {
    const s = play(start('dictation-everyday-1'), [[T, { type: 'ask' }], [S, { type: 'draft', text: '你' }], [T, { type: 'swap_roles' }]]);
    expect(s.roles).toEqual({ a: S, b: T });
    expect(s.phase).toBe('ready');
    expect(s.data.draft).toBe('');
  });
});

describe('describe & guess', () => {
  it('the guesser picks; right / wrong is recorded and the host moves on', () => {
    const s0 = start('describe-food-1');
    const spec = s0.spec as DescribeSpec;
    const right = spec.items[0].hanzi;
    const wrong = s0.data.options!.find((o) => o !== right)!;
    expect(reduceActivity(s0, { type: 'pick', option: right }, S, 1)).toBeNull(); // the describer can't pick
    expect(reduceActivity(s0, { type: 'pick', option: '不在选项里' }, T, 1)).toBeNull();
    const s1 = play(s0, [[T, { type: 'pick', option: right }]]);
    expect(s1.phase).toBe('reveal');
    expect(s1.results).toEqual([{ round: 0, correct: true, answer: right }]);
    expect(reduceActivity(s1, { type: 'pick', option: wrong }, T, 1)).toBeNull(); // one guess a round
    const s2 = play(s1, [[T, { type: 'next' }], [T, { type: 'pick', option: s1.spec.kind === 'describe' ? describeOptions(spec, 'sess-1', 1).find((o) => o !== spec.items[1].hanzi)! : '' }]]);
    expect(s2.round).toBe(1);
    expect(scoreOf(s2)).toEqual({ correct: 1, scored: 2 });
    expect(s2.v).toBe(4);
  });
  it('skipping every round ends in done with a summary', () => {
    let s = start('describe-animals-1');
    for (let i = 0; i < totalRounds(s.spec); i++) s = reduceActivity(s, { type: 'skip' }, T, i)!;
    expect(s.phase).toBe('done');
    const sum = activitySummary(s);
    expect(sum).toMatchObject({ played: 0, scored: 0, total_rounds: 8, finished: true });
    expect(sum.lines[0]).toBe('熊猫 — skipped');
    expect(sum.roles).toEqual(['a: Jerome (Describer)', 'b: Minghui (Guesser)']);
    expect(reduceActivity(s, { type: 'skip' }, T, 1)).toBeNull();
    // restart from done
    const again = reduceActivity(s, { type: 'restart' }, T, 1)!;
    expect(again).toMatchObject({ phase: 'play', round: 0, results: [] });
  });
});

describe('information gap', () => {
  it('each fills only the cells they cannot see, with a choice; the check scores the table', () => {
    const s0 = start('info-gap-weekend-1'); // tutor = a
    const spec = s0.spec as InfoGapSpec;
    // 0:0 is owned by a (the tutor sees it) → the student fills it
    expect(reduceActivity(s0, { type: 'fill', cell: '0:0', value: '打篮球' }, T, 1)).toBeNull();
    expect(reduceActivity(s0, { type: 'fill', cell: '0:0', value: '不是选项' }, S, 1)).toBeNull();
    expect(reduceActivity(s0, { type: 'fill', cell: '9:9', value: '打篮球' }, S, 1)).toBeNull();
    let s = s0;
    for (const k of blanksFor(spec, 'b')) {
      const [r, c] = k.split(':').map(Number);
      s = reduceActivity(s, { type: 'fill', cell: k, value: spec.rows[r].cells[c].value }, S, 1)!;
    }
    const aBlanks = blanksFor(spec, 'a');
    s = reduceActivity(s, { type: 'fill', cell: aBlanks[0], value: '游泳' }, T, 1)!; // wrong
    s = reduceActivity(s, { type: 'fill', cell: aBlanks[0], value: null }, T, 1)!; // cleared again
    expect(s.data.answers![aBlanks[0]]).toBeUndefined();
    s = reduceActivity(s, { type: 'fill', cell: aBlanks[1], value: '游泳' }, T, 1)!;
    s = reduceActivity(s, { type: 'reveal' }, S, 1)!;
    expect(s.phase).toBe('reveal');
    expect(s.results[0]).toMatchObject({ round: 0, correct: false, answer: '4/8' });
    s = reduceActivity(s, { type: 'next' }, T, 1)!;
    expect(s.phase).toBe('done');
    const sum = activitySummary(s);
    expect(sum.lines).toContain('星期六上午 · 小明: wrote 打篮球 ✓');
    expect(sum.lines).toContain('星期六下午 · 小明: wrote 游泳 ✗ (right: 看电影)');
    expect(sum.lines).toContain('星期六上午 · 小红: left blank (right: 去超市)');
    expect(sum.lines.at(-1)).toBe('Filled in correctly: 4/8');
  });
});

describe('role-play', () => {
  it('the speaker of each line (or the host) moves it on; back goes back', () => {
    const s0 = start('roleplay-restaurant-1'); // tutor = a = 服务员, line 0 is a's
    expect(reduceActivity(s0, { type: 'line_done' }, S, 1)).toBeNull();
    const s1 = play(s0, [[T, { type: 'line_done' }]]);
    expect(s1.round).toBe(1);
    const s2 = play(s1, [[S, { type: 'line_done' }], [T, { type: 'line_back' }]]);
    expect(s2.round).toBe(1);
    expect(s2.results).toHaveLength(1);
    // the host can move a line that isn't theirs
    let s = play(s2, [[T, { type: 'line_done' }]]);
    while (s.phase !== 'done') s = reduceActivity(s, { type: 'line_done' }, T, 1)!;
    const sum = activitySummary(s);
    expect(sum.played).toBe(13);
    expect(sum.lines[0]).toBe('服务员 (Minghui): 你好！请问几位？');
  });
});

describe('sentence building', () => {
  it('both place tiles; the host reveals; each says it', () => {
    const s0 = start('build-sentences-1');
    const spec = s0.spec as BuildSpec;
    const order = spec.items[0].tiles.map((_, i) => i);
    let s = s0;
    s = reduceActivity(s, { type: 'place', tile: 1 }, S, 1)!;
    expect(reduceActivity(s, { type: 'place', tile: 1 }, T, 1)).toBeNull(); // already placed
    expect(reduceActivity(s, { type: 'place', tile: 99 }, T, 1)).toBeNull();
    s = reduceActivity(s, { type: 'unplace', tile: 1 }, T, 1)!;
    for (const i of order) s = reduceActivity(s, { type: 'place', tile: i }, i % 2 ? S : T, 1)!;
    expect(builtText(spec, 0, s.data.placed!)).toBe('我把书放在桌子上');
    expect(reduceActivity(s, { type: 'reveal' }, S, 1)).toBeNull(); // the host reveals
    expect(reduceActivity(s, { type: 'said' }, S, 1)).toBeNull(); // not before the reveal
    s = play(s, [[T, { type: 'reveal' }], [S, { type: 'said' }], [T, { type: 'said' }]]);
    expect(s.results[0]).toEqual({ round: 0, correct: true, answer: '我把书放在桌子上' });
    expect(s.data.said).toEqual([S, T]);
    expect(reduceActivity(s, { type: 'said' }, S, 1)).toBeNull();
    s = play(s, [[T, { type: 'next' }], [S, { type: 'place', tile: 4 }], [T, { type: 'clear_tiles' }]]);
    expect(s.data.placed).toEqual([]);
  });
});

describe('quick quiz', () => {
  it('ask plays the audio on both, the pick is live, reveal auto-marks, the asker can override', () => {
    const s0 = start('quiz-tones-1');
    expect(s0.phase).toBe('ready');
    expect(reduceActivity(s0, { type: 'pick', option: '0' }, S, 1)).toBeNull(); // not asked yet
    expect(reduceActivity(s0, { type: 'ask' }, S, 1)).toBeNull();
    let s = play(s0, [[T, { type: 'ask' }]]);
    expect(s.data.play).toBe(1);
    s = play(s, [[S, { type: 'pick', option: '1' }], [S, { type: 'pick', option: '0' }], [T, { type: 'play_audio' }]]);
    expect(s.data).toMatchObject({ pick: '0', play: 2 });
    expect(reduceActivity(s, { type: 'pick', option: '7' }, S, 1)).toBeNull();
    s = play(s, [[T, { type: 'reveal' }]]);
    expect(s.results[0]).toEqual({ round: 0, correct: true, answer: 'mǎi 买 (buy)' });
    s = play(s, [[T, { type: 'mark', correct: false }]]);
    expect(s.results[0].correct).toBe(false);
    s = play(s, [[T, { type: 'next' }]]);
    expect(s).toMatchObject({ round: 1, phase: 'ready', data: { pick: null, play: 0 } });
  });
  it('a question without audio asks without playing', () => {
    const s = play(start('quiz-measure-words-1'), [[T, { type: 'ask' }]]);
    expect(s.data.play).toBe(0);
    expect(reduceActivity(s, { type: 'play_audio' }, T, 1)).toBeNull();
    const done = play(s, [[T, { type: 'reveal' }]]);
    expect(done.results[0]).toMatchObject({ correct: false, answer: '' });
    expect(activitySummary(done).lines[0]).toBe('一___书 (a book) — picked (nothing) ✗ (answer: 本)');
  });
});

describe('dictation', () => {
  it('the writer’s draft is live; reveal checks it (punctuation ignored)', () => {
    let s = play(start('dictation-everyday-1'), [[T, { type: 'ask' }], [T, { type: 'play_audio' }]]);
    expect(s.data.play).toBe(1);
    s = play(s, [[S, { type: 'draft', text: '你' }], [S, { type: 'draft', text: '你好！' }]]);
    expect(s.data.draft).toBe('你好！');
    expect(reduceActivity(s, { type: 'draft', text: 'x' }, T, 1)).toBeNull();
    s = play(s, [[S, { type: 'submit' }]]);
    expect(reduceActivity(s, { type: 'draft', text: '改' }, S, 1)).toBeNull();
    s = play(s, [[T, { type: 'reveal' }]]);
    expect(s.results[0]).toEqual({ round: 0, correct: true, answer: '你好！' });
    s = play(s, [[T, { type: 'next' }], [T, { type: 'ask' }], [S, { type: 'draft', text: 'x'.repeat(500) }]]);
    expect(s.data.draft).toHaveLength(120);
    s = play(s, [[T, { type: 'reveal' }], [T, { type: 'finish' }]]);
    const sum = activitySummary(s);
    expect(sum).toMatchObject({ played: 2, scored: 2, correct: 1, finished: true });
    expect(sum.lines[1]).toMatch(/^谢谢 \(xièxie, thank you\) — wrote x+ ✗$/);
  });
  it('a solo player holds both roles', () => {
    const s = play(start('dictation-everyday-1', { present: [T], tutor: null }), [[T, { type: 'ask' }], [T, { type: 'draft', text: '你好' }], [T, { type: 'reveal' }]]);
    expect(s.results[0].correct).toBe(true);
  });
});

describe('robustness', () => {
  it('a spec with no lines takes no actions instead of throwing', () => {
    const empty = { ...findActivity('roleplay-restaurant-1')!, lines: [] } as ActivitySpec;
    const s = startActivity(empty, { sessionId: 'x', starter: T, tutor: T, present: [T, S], names, now: 1 });
    expect(reduceActivity(s, { type: 'line_done' }, T, 1)).toBeNull();
    expect(reduceActivity(s, { type: 'finish' }, T, 1)?.phase).toBe('done');
  });
  it('a numeric quiz pick is refused (options are index strings)', () => {
    const s = play(start('quiz-tones-1'), [[T, { type: 'ask' }]]);
    expect(reduceActivity(s, { type: 'pick', option: 1 } as unknown as ActivityAction, S, 1)).toBeNull();
  });
  it('garbage actions are refused, never thrown', () => {
    const specs: ActivitySpec[] = ACTIVITY_CATALOGUE;
    const junk = [null, {}, { type: 'pick', option: 1 }, { type: 42 }, { type: 'nope' }, { type: 'place', tile: 'x' }, { type: 'fill', cell: 5 }, { type: 'pick' }, { type: 'draft', text: 7 }];
    for (const spec of specs) {
      const s = startActivity(spec, { sessionId: 'x', starter: T, tutor: T, present: [T, S], names, now: 1 });
      for (const j of junk) for (const who of [T, S]) expect(() => reduceActivity(s, j as unknown as ActivityAction, who, 1)).not.toThrow();
    }
  });
});
