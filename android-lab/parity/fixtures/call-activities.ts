/**
 * In-call activities golden vectors (shared/call-activities): the whole state machine.
 * Writes call-activities.json; checked by core/…/calls/CallActivitiesParityTest.kt.
 *
 * For EVERY catalogue entry and several ways of starting it (tutor starts, student starts, no
 * tutor, solo + a joiner), a scripted play-through plus seeded random walks over every action
 * (right and wrong actors, wrong phases, garbage JSON). Each step records the action, who sent
 * it and the session after it (null = refused), with the summary / score / roles per user.
 * Plus hash32 / seededShuffle / describeOptions / buildPool vectors and the catalogue itself.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIVITY_CATALOGUE,
  ACTIVITY_KIND_INFO,
  ACTIVITY_KINDS,
  MAX_DRAFT_CHARS,
  activitySummary,
  blanksFor,
  buildPool,
  builtText,
  cellKey,
  describeOptions,
  hash32,
  joinActivity,
  reduceActivity,
  rolesOf,
  roundTitle,
  scoreOf,
  seededShuffle,
  startActivity,
  totalRounds,
  validateActivitySpec,
  type ActivitySession,
  type ActivitySpec,
} from '../../../shared/call-activities';

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
const r = rng(20261003);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const T = 'tutor-1';
const S = 'student-1';
const X = 'stranger-1';
const NAMES: Record<string, string> = { [T]: 'Minghui', [S]: 'Jerome' };
const USERS = [T, S, X];

// ---- shuffles
const alphabet = ['a', 'Z', '0', ':', ' ', '好', '学', '😀', 'é', '\n', 'session', '-', '123'];
const randStr = (n: number) => { let s = ''; for (let i = 0; i < n; i++) s += pick(alphabet); return s; };
const hashes = [];
for (let i = 0; i < 300; i++) { const s = randStr(Math.floor(r() * 12)); hashes.push({ s, h: hash32(s) }); }
const shuffles = [];
for (let i = 0; i < 300; i++) {
  const n = Math.floor(r() * 12);
  const items = Array.from({ length: n }, (_, k) => k);
  const key = randStr(1 + Math.floor(r() * 10));
  shuffles.push({ items, key, out: seededShuffle(items, key) });
}
const options = [];
const pools = [];
for (const spec of ACTIVITY_CATALOGUE) {
  for (let i = 0; i < 25; i++) {
    const sid = `sess-${Math.floor(r() * 1e9).toString(36)}`;
    for (let round = -1; round <= totalRounds(spec); round++) {
      if (spec.kind === 'describe') options.push({ id: spec.id, sid, round, out: describeOptions(spec, sid, round) });
      if (spec.kind === 'build') pools.push({ id: spec.id, sid, round, out: buildPool(spec, sid, round) });
    }
  }
}
// A two-tile build whose every shuffle could be "right" (exercises the reversed fallback) and one-tile rounds.
const tinyBuild: ActivitySpec = {
  id: 'build-tiny', kind: 'build', title: 'Tiny', level: 'beginner', topic: 't', summary: 's', role_names: { a: 'A', b: 'B' }, tutor_role: 'a',
  items: [{ tiles: ['我', '我'], pinyin: '', english: '' }, { tiles: ['好'], pinyin: '', english: '' }, { tiles: ['你', '好'], pinyin: '', english: '' }],
};
for (let i = 0; i < 40; i++) for (let round = 0; round < 3; round++) pools.push({ spec: tinyBuild, sid: `t${i}`, round, out: buildPool(tinyBuild, `t${i}`, round) });

// ---- actions
type Raw = unknown;
const garbage: Raw[] = [
  null, 5, 'next', [], {}, { type: 5 }, { type: 'bogus' }, { type: 'pick' }, { type: 'pick', option: null },
  { type: 'place', tile: '1' }, { type: 'place', tile: 1.5 }, { type: 'place', tile: -1 }, { type: 'place', tile: 99 }, { type: 'place' },
  { type: 'unplace', tile: null }, { type: 'unplace', tile: '0' }, { type: 'fill', cell: 3, value: '打篮球' }, { type: 'fill', cell: '0:0' },
  { type: 'fill', cell: '9:9', value: '打篮球' }, { type: 'fill', cell: '0:0:0', value: '打篮球' }, { type: 'fill', cell: ' 0:1', value: '去超市' },
  { type: 'fill', cell: '0:1', value: 7 }, { type: 'fill', cell: '0:1', value: '不是' }, { type: 'mark', correct: 'yes' }, { type: 'mark' },
  { type: 'draft', text: 7 }, { type: 'draft' }, { type: 'pick', option: '1\n' }, { type: 'pick', option: '' }, { type: 'pick', option: '00' },
];

function actionPool(s: ActivitySession): Raw[] {
  const spec = s.spec;
  const out: Raw[] = [
    { type: 'next' }, { type: 'skip' }, { type: 'reset_round' }, { type: 'swap_roles' }, { type: 'finish' }, { type: 'reveal' },
  ];
  if (r() < 0.15) out.push({ type: 'restart' });
  switch (spec.kind) {
    case 'describe':
      for (const o of s.data.options ?? []) out.push({ type: 'pick', option: o });
      out.push({ type: 'pick', option: spec.items[s.round]?.hanzi ?? '苹果' }, { type: 'pick', option: '不在' });
      break;
    case 'info_gap': {
      const keys = [...blanksFor(spec, 'a'), ...blanksFor(spec, 'b')];
      for (let i = 0; i < 6; i++) {
        const key = pick(keys);
        const row = Number(key.split(':')[0]);
        const col = Number(key.split(':')[1]);
        const right = spec.rows[row].cells[col].value;
        out.push({ type: 'fill', cell: key, value: r() < 0.5 ? right : r() < 0.6 ? pick(spec.choices).hanzi : r() < 0.5 ? null : '' });
      }
      break;
    }
    case 'roleplay':
      out.push({ type: 'line_done' }, { type: 'line_done' }, { type: 'line_back' });
      break;
    case 'build': {
      const n = spec.items[s.round]?.tiles.length ?? 4;
      for (let i = 0; i < 4; i++) out.push({ type: 'place', tile: Math.floor(r() * (n + 1)) });
      for (const t of s.data.placed ?? []) out.push({ type: 'unplace', tile: t });
      out.push({ type: 'clear_tiles' }, { type: 'said' }, { type: 'said' });
      break;
    }
    case 'quiz': {
      const q = spec.questions[s.round];
      out.push({ type: 'ask' }, { type: 'ask' }, { type: 'play_audio' });
      for (let i = 0; i < (q?.options.length ?? 2) + 1; i++) out.push({ type: 'pick', option: String(i) });
      out.push({ type: 'mark', correct: true }, { type: 'mark', correct: false });
      break;
    }
    case 'dictation': {
      const item = spec.items[s.round];
      out.push({ type: 'ask' }, { type: 'ask' }, { type: 'play_audio' }, { type: 'submit' });
      out.push(
        { type: 'draft', text: item?.hanzi ?? '你好' },
        { type: 'draft', text: `${item?.hanzi ?? ''}！` },
        { type: 'draft', text: ` ${item?.hanzi ?? ''} ` },
        { type: 'draft', text: '你' },
        { type: 'draft', text: '' },
        { type: 'draft', text: 'nǐ hǎo' },
        { type: 'draft', text: '好'.repeat(119) + '😀' + '多' },
        { type: 'draft', text: '字'.repeat(200) },
      );
      out.push({ type: 'mark', correct: true }, { type: 'mark', correct: false });
      break;
    }
  }
  return out;
}

/** The actions that play the round through by the right people (a scripted happy path). */
function happy(s: ActivitySession): [string, Raw][] {
  const A = s.roles.a;
  const B = s.roles.b;
  const H = s.host;
  const spec = s.spec;
  const steps: [string, Raw][] = [];
  switch (spec.kind) {
    case 'describe': {
      const opts = s.data.options ?? [];
      steps.push([B, { type: 'pick', option: s.round % 2 === 0 ? spec.items[s.round].hanzi : opts.find((o) => o !== spec.items[s.round].hanzi) ?? opts[0] }]);
      steps.push([H, { type: 'next' }]);
      break;
    }
    case 'info_gap':
      for (const role of ['a', 'b'] as const) {
        blanksFor(spec, role).forEach((k, i) => {
          const [row, col] = k.split(':').map(Number);
          steps.push([s.roles[role], { type: 'fill', cell: k, value: i === 1 ? spec.choices[spec.choices.length - 1].hanzi : spec.rows[row].cells[col].value }]);
        });
      }
      steps.push([A, { type: 'reveal' }], [H, { type: 'next' }]);
      break;
    case 'roleplay':
      steps.push([s.roles[spec.lines[s.round].speaker], { type: 'line_done' }]);
      break;
    case 'build': {
      const n = spec.items[s.round].tiles.length;
      const order = s.round % 2 === 0 ? Array.from({ length: n }, (_, i) => i) : (s.data.pool ?? []);
      for (const t of order) steps.push([pick([A, B]), { type: 'place', tile: t }]);
      steps.push([H, { type: 'reveal' }], [A, { type: 'said' }], [B, { type: 'said' }], [H, { type: 'next' }]);
      break;
    }
    case 'quiz':
      steps.push([A, { type: 'ask' }], [A, { type: 'play_audio' }], [B, { type: 'pick', option: String(s.round % spec.questions[s.round].options.length) }], [A, { type: 'reveal' }]);
      if (s.round % 3 === 2) steps.push([A, { type: 'mark', correct: true }]);
      steps.push([H, { type: 'next' }]);
      break;
    case 'dictation':
      steps.push([A, { type: 'ask' }], [A, { type: 'play_audio' }], [B, { type: 'draft', text: spec.items[s.round].hanzi.slice(0, 1) }],
        [B, { type: 'draft', text: s.round % 2 === 0 ? spec.items[s.round].hanzi : '错字' }], [B, { type: 'submit' }], [B, { type: 'draft', text: 'late' }], [A, { type: 'reveal' }]);
      if (s.round % 3 === 1) steps.push([A, { type: 'mark', correct: true }]);
      steps.push([H, { type: 'next' }]);
      break;
  }
  return steps;
}

interface StartCase { label: string; starter: string; tutor: string | null; present: string[]; join?: { user: string; tutor: string | null } }
const starts: StartCase[] = [
  { label: 'tutor starts', starter: T, tutor: T, present: [T, S] },
  { label: 'student starts', starter: S, tutor: T, present: [S, T] },
  { label: 'no tutor', starter: S, tutor: null, present: [T, S] },
  { label: 'solo then student joins', starter: T, tutor: T, present: [T], join: { user: S, tutor: T } },
  { label: 'solo student then tutor joins', starter: S, tutor: T, present: [S], join: { user: T, tutor: T } },
  { label: 'solo, nobody joins', starter: T, tutor: null, present: [] },
];

let clock = 1_760_000_000_000;
function snapshot(s: ActivitySession | null) {
  if (!s) return null;
  return {
    summary: activitySummary(s),
    score: scoreOf(s),
    roles_of: Object.fromEntries(USERS.map((u) => [u, rolesOf(s, u)])),
    built: s.spec.kind === 'build' ? builtText(s.spec, s.round, s.data.placed ?? []) : null,
    round_title: roundTitle(s.spec, s.round),
  };
}

const runs = [];
for (const spec of ACTIVITY_CATALOGUE) {
  for (const [si, st] of starts.entries()) {
    for (const mode of ['happy', 'random'] as const) {
      const sessionId = `${spec.id}-${si}-${mode}`;
      let s = startActivity(spec, { sessionId, starter: st.starter, tutor: st.tutor, present: st.present, names: NAMES, now: clock });
      const start = { session_id: sessionId, starter: st.starter, tutor: st.tutor, present: st.present, names: NAMES, now: clock };
      const steps: { actor: string; action?: Raw; join?: { user: string; name: string; tutor: string | null }; now: number; session: ActivitySession | null; view: unknown }[] = [];
      const doJoin = (user: string, tutor: string | null) => {
        clock += 1000;
        const j = joinActivity(s, user, NAMES[user] ?? 'Someone', tutor, clock);
        steps.push({ actor: user, join: { user, name: NAMES[user] ?? 'Someone', tutor }, now: clock, session: j, view: snapshot(j) });
        if (j) s = j;
      };
      const act = (actor: string, action: Raw) => {
        clock += 700;
        const next = reduceActivity(s, action as never, actor, clock);
        steps.push({ actor, action, now: clock, session: next, view: snapshot(next) });
        if (next) s = next;
      };
      if (st.join && mode === 'happy') doJoin(st.join.user, st.join.tutor);
      if (mode === 'happy') {
        let guard = 0;
        while (s.phase !== 'done' && guard++ < 40) {
          const before = s.v;
          for (const [actor, action] of happy(s)) act(actor, action);
          if (s.v === before) act(s.host, { type: 'skip' });
        }
        // After done: everything refused but restart; then a couple more rounds and finish.
        act(s.host, { type: 'next' });
        act(s.roles.b, { type: 'restart' });
        act(s.host, { type: 'restart' });
        for (const [actor, action] of happy(s)) act(actor, action);
        act(s.host, { type: 'swap_roles' });
        act(s.host, { type: 'reset_round' });
        for (const [actor, action] of happy(s)) act(actor, action);
        doJoin(X, null);
        act(s.roles.a, { type: 'finish' });
        act(s.roles.a, { type: 'finish' });
      } else {
        for (let i = 0; i < 90; i++) {
          if (st.join && i === 20) doJoin(st.join.user, st.join.tutor);
          const roll = r();
          const actor = roll < 0.12 ? X : roll < 0.3 ? s.host : roll < 0.65 ? s.roles.a : s.roles.b;
          const action = r() < 0.08 ? pick(garbage) : pick(actionPool(s));
          act(actor, action);
          if (s.phase === 'done' && r() < 0.5) act(s.host, { type: 'restart' });
        }
      }
      const first = startActivity(spec, { sessionId, starter: st.starter, tutor: st.tutor, present: st.present, names: NAMES, now: start.now });
      runs.push({ id: spec.id, label: `${st.label} / ${mode}`, start, first, first_view: snapshot(first), steps });
    }
  }
}

// ---- odd specs: empty kinds, out-of-range values (validation + start / reduce never crash)
const odd: ActivitySpec[] = [
  { ...tinyBuild },
  { id: 'd', kind: 'describe', title: 'D', level: 'beginner', topic: '', summary: '', role_names: { a: 'A', b: 'B' }, tutor_role: 'a', items: [
    { emoji: '1', hanzi: '一', pinyin: 'yī', english: 'one' }, { emoji: '2', hanzi: '一', pinyin: 'yī', english: 'one' }, { emoji: '3', hanzi: '三', pinyin: 'sān', english: 'three' }] },
  { id: 'q', kind: 'quiz', title: 'Q', level: 'beginner', topic: '', summary: '', role_names: { a: 'A', b: 'B' }, tutor_role: 'a', questions: [
    { prompt: '', options: ['x'], answer: 3 }, { prompt: 'p', audio: '', options: ['a', 'b'], answer: -1 }] },
  { id: 'g', kind: 'info_gap', title: 'G', level: 'beginner', topic: '', summary: '', role_names: { a: 'A', b: 'B' }, tutor_role: 'a', prompt: '', columns: ['c1', 'c2'],
    rows: [{ label: 'r', cells: [{ value: '甲', owner: 'a' }] }, { label: 'r2', cells: [{ value: '乙', owner: 'b' }, { value: '丙', owner: 'b' }] }], choices: [{ hanzi: '甲', pinyin: '', english: '' }] },
];
/** Specs only validated (playing them would index past the end in the TS too). */
const invalidOnly: ActivitySpec[] = [
  { id: '', kind: 'roleplay', title: '', level: 'beginner', topic: '', summary: '', role_names: { a: 'A', b: 'B' }, tutor_role: 'b', setting: '', speakers: { a: 'x', b: 'y' }, lines: [] },
  { id: 'x', kind: 'dictation', title: 'X', level: 'beginner', topic: '', summary: '', role_names: { a: 'A', b: 'B' }, tutor_role: 'c' as never, items: [] },
  { id: 'b', kind: 'build', title: 'B', level: 'beginner', topic: '', summary: '', role_names: { a: 'A', b: 'B' }, tutor_role: 'a', items: [{ tiles: ['一'], pinyin: '', english: '' }] },
];
const oddRuns = [];
for (const spec of odd) {
  const s0 = startActivity(spec, { sessionId: `odd-${spec.id}`, starter: T, tutor: T, present: [T, S], names: NAMES, now: 5 });
  const steps = [];
  let s = s0;
  for (let i = 0; i < 40; i++) {
    const actor = pick([T, S, s.roles.a, s.roles.b]);
    const action = r() < 0.2 ? pick(garbage) : pick(actionPool(s));
    const next = reduceActivity(s, action as never, actor, 10 + i);
    steps.push({ actor, action, now: 10 + i, session: next, view: snapshot(next) });
    if (next) s = next;
  }
  oddRuns.push({ spec, problems: validateActivitySpec(spec), first: s0, first_view: snapshot(s0), steps, blanks: spec.kind === 'info_gap' ? { a: blanksFor(spec, 'a'), b: blanksFor(spec, 'b') } : null });
}

writeFileSync(
  join(OUT, 'call-activities.json'),
  JSON.stringify({
    catalogue: ACTIVITY_CATALOGUE,
    kinds: ACTIVITY_KINDS,
    kind_info: ACTIVITY_KIND_INFO,
    max_draft_chars: MAX_DRAFT_CHARS,
    problems: ACTIVITY_CATALOGUE.map((s) => ({ id: s.id, problems: validateActivitySpec(s), total: totalRounds(s), blanks_a: s.kind === 'info_gap' ? blanksFor(s, 'a') : null, blanks_b: s.kind === 'info_gap' ? blanksFor(s, 'b') : null })),
    cell_keys: [[0, 0], [3, 1], [12, 7]].map(([a, b]) => ({ row: a, col: b, key: cellKey(a, b) })),
    hashes,
    shuffles,
    options,
    pools,
    runs,
    odd_runs: oddRuns,
    invalid: invalidOnly.map((spec) => ({ spec, problems: validateActivitySpec(spec), total: totalRounds(spec) })),
  }),
);
