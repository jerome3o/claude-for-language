/**
 * Video calls: 🎯 Structures to use (shared/calls/goals.ts). The pick, the typed-pattern parser, the
 * matcher (punctuation / Latin / digits / 的得地), seeded action runs through reduceGoals, the
 * speech → utterance fold, the listen rule, the stored-list sanitizer and the words.
 * Writes calls-goals.json; checked by core/…/calls/CallsGoalsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_GOAL_SPEECH,
  GOALS_ADD_PLACEHOLDER,
  GOALS_LIST_MAX,
  GOALS_MAX,
  GOALS_MENU_LABEL,
  GOALS_MIN,
  GOALS_RECENT_DAYS,
  GOALS_TITLE,
  GOAL_CHECK_STALE_MS,
  GOAL_CHECKING_LABEL,
  GOAL_MAX_GAP,
  GOAL_MAX_SPAN,
  GOAL_MIN_CONTENT,
  GOAL_TICK_LABEL,
  GOAL_UNTICK_LABEL,
  GOAL_UTTERANCE_MAX,
  flushGoalSpeech,
  foldGoalSpeech,
  goalHitCaption,
  goalListenNote,
  goalListenStatus,
  goalMatchKey,
  goalSourceLine,
  goalsChipAria,
  goalsChipLabel,
  goalsEmptyText,
  goalsFromStructures,
  goalsHeardIn,
  goalsIntro,
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
  type CallGoalsAction,
  type GoalListenStatus,
  type GoalStructure,
} from '../../../shared/calls/goals';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261127);
const int = (n: number) => Math.floor(r() * n);

const NOW = Date.parse('2026-11-27T10:00:00Z');
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000 - int(3_600_000)).toISOString();

const POOL: Array<[string, string[]]> = [
  ['除了…还…', ['除了', '还']],
  ['本来…要…', ['本来', '要']],
  ['从…的角度来看', ['从', '的角度来看']],
  ['一…就…', ['一', '就']],
  ['越…越…', ['越', '越']],
  ['虽然…但是…', ['虽然', '但是']],
  ['把…', ['把']],
  ['连…都…', ['连', '都']],
  ['不但…而且…', ['不但', '而且']],
  ['既然…就…', ['既然', '就']],
];

// ---- the pick
const picks: unknown[] = [];
for (let k = 0; k < 40; k++) {
  const n = int(POOL.length + 1);
  const structures: GoalStructure[] = [];
  for (let i = 0; i < n; i++) {
    const [name, fixed] = POOL[int(POOL.length)];
    structures.push({ name: int(8) === 0 ? ` ${name} ` : name, fixed: int(12) === 0 ? [] : fixed, last_met: int(10) === 0 ? null : iso(int(40)), line: `${name} line`, meaning: int(2) ? 'meaning' : null, example: int(2) ? '例子。' : null });
  }
  const used = POOL.filter(() => int(4) === 0).map(([name]) => name);
  const picked = pickCallGoals(structures, used, NOW);
  let id = 0;
  picks.push({ structures, used, now: NOW, picked: picked.map((s) => s.name), goals: goalsFromStructures(picked, () => `g${++id}`) });
}

// ---- typed patterns
const patterns = ['一…就…', '除了...还...', '从 A 的角度来看', '…以后', '虽然 + [clause] + 但是', 'hello', '', '  ', '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一', '一 二 三 四 五 六 七', '越来越', 'A越B越', '（连）…都…', '把…放在…上', 'ｶﾞ一＋就'].map((text) => ({ text, parsed: parseGoalPattern(text) }));

// ---- matching
const sentences = [
  '除了中文，我还学日语。', '我一到家就睡觉了', '还有除了', '除了这个，' + '我们'.repeat(10) + '还要', '除了 coffee, 我还 drink 茶!',
  '我等了3个小时', '从老师得角度来看，这样不好', '除了还', '除了茶还有', '一个人' + '我们'.repeat(8) + '一回家就做饭',
  '我本来要去，后来没去', '他跑得越来越快', '虽然下雨，但是我们还是去了', '把书放在桌子上', '连他都不知道', '2026年我一毕业就工作',
  '他她它嘛吗', '不但便宜而且好吃', '既然你来了，就坐吧', '我们越聊越开心！', 'Hello world', '',
];
const matches = sentences.flatMap((s) => POOL.map(([name, fixed]) => ({ s, name, fixed, key: goalMatchKey(s), m: matchStructure(s, fixed) })));

// ---- seeded runs through the room's reducer
const people = [{ userId: 'tut', name: 'Minghui Li' }, { userId: 'stu', name: 'Jerome Swannack' }];
const runs: unknown[] = [];
for (let k = 0; k < 30; k++) {
  let n = 0;
  const newId = () => `k${k}-${++n}`;
  const pick = pickCallGoals(POOL.slice(0, 2 + int(6)).map(([name, fixed]) => ({ name, fixed, last_met: iso(int(20)) })), [], NOW);
  let cur: CallGoals = { student_id: 'stu', student_name: 'Jerome Swannack', goals: goalsFromStructures(pick, newId), v: 1, available: pick.length };
  let now = NOW;
  const steps: unknown[] = [];
  for (let i = 0; i < 16; i++) {
    now += int(5) === 0 ? int(80_000) : int(9_000);
    const g = cur.goals.length ? cur.goals[int(cur.goals.length)] : null;
    const gid = g ? (int(15) === 0 ? 'missing' : g.id) : 'missing';
    const sentence = sentences[int(sentences.length)];
    const roll = int(12);
    let action: CallGoalsAction;
    if (roll <= 3) action = { kind: 'heard', id: gid, text: sentence };
    else if (roll <= 5) action = { kind: 'checked', id: gid, text: g?.checking?.text ?? sentence, ok: int(3) !== 0 };
    else if (roll === 6) action = { kind: 'tick', id: gid, ...(int(2) ? { text: sentence } : {}) };
    else if (roll === 7) action = { kind: 'untick', id: gid };
    else if (roll === 8) action = { kind: 'add', text: POOL[int(POOL.length)][0] };
    else if (roll === 9) action = { kind: 'remove', id: gid };
    else if (roll === 10) action = { kind: 'move', id: gid, to: int(6) - 1 };
    else action = { kind: 'add', text: patterns[int(patterns.length)].text };
    const by = people[int(2)];
    const allowed = mayActOnGoals(action, by.userId, 'tut', 'stu');
    const next = allowed ? reduceGoals(cur, action, by, now, newId) : null;
    if (next) cur = next;
    steps.push({ now, action, by: by.userId, by_name: by.name, allowed, changed: next !== null, goals: cur, heard: goalsHeardIn(sentence, cur.goals).map((x) => x.id), sentence });
  }
  runs.push({ start: { student_id: 'stu', student_name: 'Jerome Swannack', available: pick.length }, steps });
}

// ---- speech folding
const msg = (tokens: Array<[string, boolean]>, finished = false) => JSON.stringify({ tokens: tokens.map(([text, is_final]) => ({ text, is_final })), ...(finished ? { finished: true } : {}) });
const streams: unknown[] = [];
const pieces = ['除了', '中文', '，', '我还', '学日语', '。', '<end>', '<fin>', '你呢', '？', '我们', '他们', 'OK', ' ', '一到家就睡觉了', '我们'.repeat(30) + '，' + '他们'.repeat(15), '好', '!'];
for (let k = 0; k < 25; k++) {
  let state = EMPTY_GOAL_SPEECH;
  const steps: unknown[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = int(15) === 0 ? 'not json' : msg(Array.from({ length: int(5) }, () => [pieces[int(pieces.length)], int(4) !== 0] as [string, boolean]), int(10) === 0);
    const res = foldGoalSpeech(state, raw);
    state = res.state;
    steps.push({ raw, utterances: res.utterances, pending: state.pending });
  }
  steps.push({ flush: flushGoalSpeech(state) });
  streams.push(steps);
}

// ---- listening
const sampleGoals: CallGoals = { student_id: 's', student_name: 'Jerome', goals: goalsFromStructures([{ name: '一…就…', fixed: ['一', '就'] }], () => 'g'), v: 1, available: 1 };
const listen: unknown[] = [];
for (const live of [true, false]) for (const isStudent of [true, false]) for (const micOn of [true, false]) for (const hasMic of [true, false]) for (const unavailable of [true, false]) {
  for (const goals of [sampleGoals, null, { ...sampleGoals, goals: [{ ...sampleGoals.goals[0], status: 'used' as const }] }, { ...sampleGoals, goals: [{ ...sampleGoals.goals[0], status: 'near' as const }] }]) {
    listen.push({ live, isStudent, micOn, hasMic, unavailable, goals, status: goalListenStatus({ live, isStudent, micOn, hasMic, unavailable, goals }) });
  }
}

// ---- stored lists
const stored = [
  null, 1, {}, { goals: 'x' },
  { student_id: 'stu', student_name: 'J', v: 2, available: 3, goals: [{ id: 'a', name: '一…就…', fixed: ['一', '就'], status: 'used' }, { id: 'b', name: 'x', fixed: [] }, { id: 'c', name: ' 把… ', fixed: ['把', 3, ''], status: 'checking', checking: { text: '把书', at: 5 } }, { id: 'd', name: 'e', fixed: ['了'], status: 'used', used: { text: 't', at: 9, by: 'tutor', name: 'Minghui' }, near: { text: 'n', at: 'x' } }, 7] },
  { student_id: '', goals: [], v: 'x', available: -2.4 },
];

// ---- actions
const rawActions = [
  null, {}, { kind: 'add', text: '  一…就… ' }, { kind: 'add', text: '' }, { kind: 'remove', id: 'a' }, { kind: 'remove' }, { kind: 'move', id: 'a', to: 1.6 }, { kind: 'move', id: 'a', to: 'x' },
  { kind: 'tick', id: 'a' }, { kind: 'tick', id: 'a', text: '  我  一到家就睡 ' }, { kind: 'untick', id: 'a' }, { kind: 'heard', id: 'a', text: '' }, { kind: 'heard', id: 'a', text: '除了'.repeat(80) },
  { kind: 'checked', id: 'a', text: 'x', ok: true }, { kind: 'checked', id: 'a', text: 'x' }, { kind: 'nope', id: 'a' },
];

// ---- words
const statuses: GoalListenStatus[] = ['listening', 'muted', 'unavailable', 'off'];
const summaryGoals = goalsFromStructures(POOL.slice(0, 4).map(([name, fixed]) => ({ name, fixed })), (() => { let n = 0; return () => `s${++n}`; })());
summaryGoals[0] = { ...summaryGoals[0], status: 'used', used: { text: '除了茶我还喝咖啡', at: 1, by: 'auto' } };
summaryGoals[1] = { ...summaryGoals[1], status: 'used', used: { text: '', at: 2, by: 'tutor', name: 'Minghui Li' } };
summaryGoals[2] = { ...summaryGoals[2], status: 'near', near: { text: '从这里来看', at: 3 } };
const summary = goalsSummary(summaryGoals);

writeFileSync(
  join(OUT, 'calls-goals.json'),
  JSON.stringify({
    constants: { GOALS_MIN, GOALS_MAX, GOALS_RECENT_DAYS, GOALS_LIST_MAX, GOAL_CHECK_STALE_MS, GOAL_MAX_GAP, GOAL_MAX_SPAN, GOAL_MIN_CONTENT, GOAL_UTTERANCE_MAX, GOALS_TITLE, GOALS_MENU_LABEL, GOALS_ADD_PLACEHOLDER, GOAL_CHECKING_LABEL, GOAL_TICK_LABEL, GOAL_UNTICK_LABEL },
    picks,
    patterns,
    matches,
    runs,
    streams,
    listen,
    stored: stored.map((raw) => ({ raw, goals: sanitizeCallGoals(raw) })),
    actions: rawActions.map((raw) => ({ raw, action: sanitizeGoalsAction(raw) })),
    may: (['add', 'remove', 'move', 'tick', 'untick', 'heard', 'checked'] as const).flatMap((kind) => [['tut', 'tut', 'stu'], ['stu', 'tut', 'stu'], ['stu', null, 'stu'], ['x', null, null]].map(([u, t, s]) => ({ kind, user: u, tutor: t, student: s, may: mayActOnGoals({ kind }, u as string, t, s) }))),
    words: {
      chip: [null, sampleGoals, { ...sampleGoals, goals: [] }, { ...sampleGoals, goals: summaryGoals }].map((g) => ({ goals: g, label: goalsChipLabel(g), aria: goalsChipAria(g) })),
      intro: [[true, 'Jerome Swannack'], [false, 'Jerome Swannack'], [false, '']].map(([s, n]) => ({ student: s, name: n, text: goalsIntro(s as boolean, n as string) })),
      empty: [[true, 'Jerome', 0], [false, 'Jerome Swannack', 0], [false, '', 0], [true, 'J', 3]].map(([s, n, a]) => ({ student: s, name: n, available: a, text: goalsEmptyText(s as boolean, n as string, a as number) })),
      listen: statuses.flatMap((st) => [true, false].map((s) => ({ status: st, student: s, text: goalListenNote(st, s) }))),
      source: [{ source: 'learned', last_met: '2026-11-03T10:00:00Z' }, { source: 'learned', last_met: '2026-01-31T23:59:00Z' }, { source: 'learned', last_met: null }, { source: 'learned', last_met: 'nope' }, { source: 'added', last_met: null }].map((g) => ({ ...g, text: goalSourceLine(g as { source: 'learned' | 'added'; last_met: string | null }) })),
      hit: [{ text: 'x', at: 1, by: 'auto' }, { text: '', at: 1, by: 'tutor', name: 'Minghui Li' }, { text: '', at: 1, by: 'tutor' }].map((h) => ({ hit: h, text: goalHitCaption(h as never) })),
    },
    summary: { goals: summaryGoals, summary, notes: goalsNotes(summary), merged: mergeLessonGoals([summaryGoals, summaryGoals.map((g) => ({ ...g, status: 'open' as const, used: null }))]) },
  }, null, 1),
);
