/**
 * The in-call activity state machine (see ./types.ts). Pure: the call room
 * runs it on every action and broadcasts the result; the Lab app's
 * `CallActivities.kt` is a port, parity-tested against golden vectors made by
 * running this file (android-lab/parity/fixtures/call-activities.ts).
 *
 * `reduceActivity` returns null when an action is refused (wrong role, wrong
 * phase, bad value) — the room then sends nothing, so a stale or duplicate
 * action is harmless.
 */

import { isHanziAnswerCorrect } from '../lesson/answer-check';
import type {
  ActivityAction,
  ActivityRole,
  ActivityRoundData,
  ActivityRoundResult,
  ActivitySession,
  ActivitySpec,
  ActivitySummary,
  BuildSpec,
  DescribeSpec,
  InfoGapSpec,
} from './types';
import { MAX_DRAFT_CHARS } from './types';

// ------------------------------------------------------------------ seeded shuffle

/** FNV-1a over UTF-16 code units, unsigned 32-bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** xorshift32 step (never 0 for a non-zero seed). */
function nextRand(x: number): number {
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** Fisher–Yates with a seed made from `key`: the same key always gives the same order. */
export function seededShuffle<T>(items: readonly T[], key: string): T[] {
  const out = items.slice();
  let x = hash32(key) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x = nextRand(x);
    const j = x % (i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

// ------------------------------------------------------------------ helpers

export function totalRounds(spec: ActivitySpec): number {
  switch (spec.kind) {
    case 'describe':
      return spec.items.length;
    case 'info_gap':
      return 1;
    case 'roleplay':
      return spec.lines.length;
    case 'build':
      return spec.items.length;
    case 'quiz':
      return spec.questions.length;
    case 'dictation':
      return spec.items.length;
  }
}

export const otherRole = (r: ActivityRole): ActivityRole => (r === 'a' ? 'b' : 'a');

/** The roles this user holds (both in a solo call, none for a stranger). */
export function rolesOf(s: Pick<ActivitySession, 'roles'>, userId: string): ActivityRole[] {
  const out: ActivityRole[] = [];
  if (s.roles.a === userId) out.push('a');
  if (s.roles.b === userId) out.push('b');
  return out;
}

export const holds = (s: Pick<ActivitySession, 'roles'>, userId: string, role: ActivityRole) => s.roles[role] === userId;
export const isHost = (s: Pick<ActivitySession, 'host'>, userId: string) => s.host === userId;

/** "Minghui (Describer)". */
export function roleLabel(s: ActivitySession, role: ActivityRole): string {
  const name = s.names[s.roles[role]] ?? 'Someone';
  return `${name} (${s.spec.role_names[role]})`;
}

/** Cell key in an info-gap table. */
export const cellKey = (row: number, col: number) => `${row}:${col}`;

/** The blank cells of an info-gap table that `role` must fill (cells the OTHER role owns). */
export function blanksFor(spec: InfoGapSpec, role: ActivityRole): string[] {
  const out: string[] = [];
  spec.rows.forEach((r, ri) => r.cells.forEach((c, ci) => { if (c.owner !== role) out.push(cellKey(ri, ci)); }));
  return out;
}

function infoGapCell(spec: InfoGapSpec, key: string): { value: string; owner: ActivityRole } | null {
  const m = /^(\d+):(\d+)$/.exec(key);
  if (!m) return null;
  return spec.rows[Number(m[1])]?.cells[Number(m[2])] ?? null;
}

/** The four options of a describe round: the item and three others, shuffled. */
export function describeOptions(spec: DescribeSpec, sessionId: string, round: number): string[] {
  const target = spec.items[round];
  if (!target) return [];
  const others = seededShuffle(spec.items.filter((_, i) => i !== round).map((i) => i.hanzi), `${sessionId}:${round}:others`).slice(0, 3);
  return seededShuffle([target.hanzi, ...others], `${sessionId}:${round}:options`);
}

/** The tile order of a build round's pool: shuffled, never already in the right order (when it can differ). */
export function buildPool(spec: BuildSpec, sessionId: string, round: number): number[] {
  const tiles = spec.items[round]?.tiles ?? [];
  const idx = tiles.map((_, i) => i);
  const right = tiles.join('');
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = seededShuffle(idx, `${sessionId}:${round}:pool:${attempt}`);
    if (p.map((i) => tiles[i]).join('') !== right || tiles.length < 2) return p;
  }
  return idx.slice().reverse();
}

/** The sentence a build round's placed tiles make. */
export function builtText(spec: BuildSpec, round: number, placed: readonly number[]): string {
  const tiles = spec.items[round]?.tiles ?? [];
  return placed.map((i) => tiles[i] ?? '').join('');
}

function roundData(s: Pick<ActivitySession, 'spec' | 'session_id'>, round: number): { phase: ActivitySession['phase']; data: ActivityRoundData } {
  const spec = s.spec;
  switch (spec.kind) {
    case 'describe':
      return { phase: 'play', data: { options: describeOptions(spec, s.session_id, round), pick: null } };
    case 'info_gap':
      return { phase: 'play', data: { answers: {} } };
    case 'roleplay':
      return { phase: 'play', data: {} };
    case 'build':
      return { phase: 'play', data: { pool: buildPool(spec, s.session_id, round), placed: [], said: [] } };
    case 'quiz':
      return { phase: 'ready', data: { pick: null, mark: null, play: 0 } };
    case 'dictation':
      return { phase: 'ready', data: { draft: '', submitted: false, mark: null, play: 0 } };
  }
}

// ------------------------------------------------------------------ start

export interface StartOptions {
  sessionId: string;
  /** Who pressed Start. */
  starter: string;
  /** The tutor of the call's relationship (null in a solo call / unknown). */
  tutor: string | null;
  /** Everyone in the call now (user ids, the starter included). */
  present: string[];
  names: Record<string, string>;
  now: number;
}

/**
 * A new session at round 0. Roles: the tutor takes `spec.tutor_role` and the
 * other person the other role; without a known tutor the starter does; alone,
 * one person holds both.
 */
export function startActivity(spec: ActivitySpec, o: StartOptions): ActivitySession {
  const people = Array.from(new Set([o.starter, ...o.present]));
  const lead = o.tutor && people.includes(o.tutor) ? o.tutor : o.starter;
  const other = people.find((p) => p !== lead) ?? lead;
  const roles = spec.tutor_role === 'a' ? { a: lead, b: other } : { a: other, b: lead };
  const names: Record<string, string> = {};
  for (const p of people) names[p] = o.names[p] ?? 'Someone';
  const base = { session_id: o.sessionId, spec, roles, host: lead, names, round: 0, results: [], started_at: o.now, updated_at: o.now, v: 1 };
  return { ...base, ...roundData(base, 0) };
}

/**
 * Someone joins a call whose activity was started alone (one person holding both
 * roles): they take a role — the tutor's (and become host) if they are the tutor,
 * else the other one. Null = nothing changes (already playing, or roles were split).
 */
export function joinActivity(s: ActivitySession, userId: string, name: string, tutor: string | null, now: number): ActivitySession | null {
  if (s.roles.a !== s.roles.b || s.roles.a === userId || s.phase === 'done') return null;
  const solo = s.roles.a;
  const joinerIsTutor = tutor === userId;
  const joinerRole = joinerIsTutor ? s.spec.tutor_role : otherRole(s.spec.tutor_role);
  const roles = joinerRole === 'a' ? { a: userId, b: solo } : { a: solo, b: userId };
  return { ...s, roles, host: joinerIsTutor ? userId : s.host, names: { ...s.names, [userId]: name }, v: s.v + 1, updated_at: now };
}

// ------------------------------------------------------------------ reduce

function withResult(results: readonly ActivityRoundResult[], r: ActivityRoundResult): ActivityRoundResult[] {
  return [...results.filter((x) => x.round !== r.round), r].sort((x, y) => x.round - y.round);
}

/** Move to `round` (or `done` past the last). */
function goTo(s: ActivitySession, round: number): ActivitySession {
  if (round >= totalRounds(s.spec)) return { ...s, round: Math.max(0, totalRounds(s.spec) - 1), phase: 'done', data: {} };
  return { ...s, round, ...roundData(s, round) };
}

function step(s: ActivitySession, action: ActivityAction, actor: string): ActivitySession | null {
  const spec = s.spec;
  const host = isHost(s, actor);
  const a = holds(s, actor, 'a');
  const b = holds(s, actor, 'b');
  if (!a && !b && !host) return null;
  const d = s.data;

  // ---- controls, any kind
  switch (action.type) {
    case 'finish':
      return s.phase === 'done' ? null : { ...s, phase: 'done', data: {} };
    case 'restart':
      if (!host) return null;
      return { ...goTo({ ...s, results: [] }, 0) };
    case 'swap_roles':
      if (!host || s.phase === 'done') return null;
      return { ...s, roles: { a: s.roles.b, b: s.roles.a }, ...roundData(s, s.round) };
    case 'reset_round':
      if (!host || s.phase === 'done') return null;
      return { ...s, results: s.results.filter((r) => r.round !== s.round), ...roundData(s, s.round) };
    case 'skip':
      if (!host || s.phase === 'done') return null;
      if (s.phase === 'reveal') return goTo(s, s.round + 1);
      return goTo({ ...s, results: withResult(s.results, { round: s.round, correct: null, skipped: true }) }, s.round + 1);
    case 'next':
      if (!host || s.phase !== 'reveal') return null;
      return goTo(s, s.round + 1);
    default:
      break;
  }
  if (s.phase === 'done') return null;

  switch (spec.kind) {
    case 'describe': {
      if (action.type !== 'pick' || !b || s.phase !== 'play') return null;
      if (!(d.options ?? []).includes(action.option)) return null;
      const correct = action.option === spec.items[s.round].hanzi;
      return { ...s, phase: 'reveal', data: { ...d, pick: action.option }, results: withResult(s.results, { round: s.round, correct, answer: action.option }) };
    }
    case 'info_gap': {
      if (action.type === 'fill') {
        if (s.phase !== 'play') return null;
        const cell = infoGapCell(spec, action.cell);
        if (!cell || !holds(s, actor, otherRole(cell.owner))) return null;
        const answers = { ...(d.answers ?? {}) };
        if (action.value === null || action.value === '') delete answers[action.cell];
        else if (spec.choices.some((c) => c.hanzi === action.value)) answers[action.cell] = action.value;
        else return null;
        return { ...s, data: { ...d, answers } };
      }
      if (action.type === 'reveal') {
        if (s.phase !== 'play') return null;
        const blanks = [...blanksFor(spec, 'a'), ...blanksFor(spec, 'b')];
        const right = blanks.filter((k) => d.answers?.[k] === infoGapCell(spec, k)?.value).length;
        const detail = spec.rows.flatMap((row, ri) => row.cells.map((c, ci) => {
          const got = d.answers?.[cellKey(ri, ci)];
          return `${row.label} · ${spec.columns[ci] ?? ''}: ${got ? `wrote ${got}${got === c.value ? ' ✓' : ` ✗ (right: ${c.value})`}` : `left blank (right: ${c.value})`}`;
        }));
        return { ...s, phase: 'reveal', results: withResult(s.results, { round: 0, correct: right === blanks.length, answer: `${right}/${blanks.length}`, detail }) };
      }
      return null;
    }
    case 'roleplay': {
      if (s.phase !== 'play') return null;
      if (action.type === 'line_done') {
        const line = spec.lines[s.round];
        if (!holds(s, actor, line.speaker) && !host) return null;
        return goTo({ ...s, results: withResult(s.results, { round: s.round, correct: null, answer: line.hanzi }) }, s.round + 1);
      }
      if (action.type === 'line_back') {
        if (s.round === 0) return null;
        return { ...s, round: s.round - 1, results: s.results.filter((r) => r.round < s.round - 1), ...roundData(s, s.round - 1) };
      }
      return null;
    }
    case 'build': {
      const placed = d.placed ?? [];
      const tiles = spec.items[s.round].tiles;
      switch (action.type) {
        case 'place':
          if (s.phase !== 'play' || !Number.isInteger(action.tile) || action.tile < 0 || action.tile >= tiles.length || placed.includes(action.tile)) return null;
          return { ...s, data: { ...d, placed: [...placed, action.tile] } };
        case 'unplace':
          if (s.phase !== 'play' || !placed.includes(action.tile)) return null;
          return { ...s, data: { ...d, placed: placed.filter((t) => t !== action.tile) } };
        case 'clear_tiles':
          if (s.phase !== 'play' || placed.length === 0) return null;
          return { ...s, data: { ...d, placed: [] } };
        case 'reveal': {
          if (!host || s.phase !== 'play') return null;
          const built = builtText(spec, s.round, placed);
          return { ...s, phase: 'reveal', results: withResult(s.results, { round: s.round, correct: built === tiles.join(''), answer: built }) };
        }
        case 'said': {
          if (s.phase !== 'reveal' || (d.said ?? []).includes(actor)) return null;
          return { ...s, data: { ...d, said: [...(d.said ?? []), actor] } };
        }
        default:
          return null;
      }
    }
    case 'quiz': {
      const q = spec.questions[s.round];
      switch (action.type) {
        case 'ask':
          if (!a || s.phase !== 'ready') return null;
          return { ...s, phase: 'play', data: { ...d, play: (d.play ?? 0) + (q.audio ? 1 : 0) } };
        case 'play_audio':
          if (!a || !q.audio || s.phase === 'ready') return null;
          return { ...s, data: { ...d, play: (d.play ?? 0) + 1 } };
        case 'pick': {
          const i = Number(action.option);
          if (!b || s.phase !== 'play' || !/^\d+$/.test(action.option) || i >= q.options.length) return null;
          return { ...s, data: { ...d, pick: action.option } };
        }
        case 'reveal': {
          if (!a || s.phase !== 'play') return null;
          const correct = d.pick != null && Number(d.pick) === q.answer;
          return { ...s, phase: 'reveal', data: { ...d, mark: correct }, results: withResult(s.results, { round: s.round, correct, answer: d.pick != null ? q.options[Number(d.pick)] : '' }) };
        }
        case 'mark': {
          if (!a || s.phase !== 'reveal') return null;
          const prev = s.results.find((r) => r.round === s.round);
          return { ...s, data: { ...d, mark: action.correct === true }, results: withResult(s.results, { round: s.round, correct: action.correct === true, answer: prev?.answer ?? '' }) };
        }
        default:
          return null;
      }
    }
    case 'dictation': {
      const item = spec.items[s.round];
      switch (action.type) {
        case 'ask':
          if (!a || s.phase !== 'ready') return null;
          return { ...s, phase: 'play' };
        case 'play_audio':
          if (!a || s.phase === 'ready') return null;
          return { ...s, data: { ...d, play: (d.play ?? 0) + 1 } };
        case 'draft':
          if (!b || s.phase !== 'play' || d.submitted || typeof action.text !== 'string') return null;
          return { ...s, data: { ...d, draft: action.text.slice(0, MAX_DRAFT_CHARS) } };
        case 'submit':
          if (!b || s.phase !== 'play' || d.submitted) return null;
          return { ...s, data: { ...d, submitted: true } };
        case 'reveal': {
          if (!a || s.phase !== 'play') return null;
          const draft = d.draft ?? '';
          const correct = isHanziAnswerCorrect(draft, item.hanzi);
          return { ...s, phase: 'reveal', data: { ...d, submitted: true, mark: correct }, results: withResult(s.results, { round: s.round, correct, answer: draft }) };
        }
        case 'mark': {
          if (!a || s.phase !== 'reveal') return null;
          return { ...s, data: { ...d, mark: action.correct === true }, results: withResult(s.results, { round: s.round, correct: action.correct === true, answer: d.draft ?? '' }) };
        }
        default:
          return null;
      }
    }
  }
}

/** Apply one action by `actor` (a user id). Null = refused, nothing changes. */
export function reduceActivity(s: ActivitySession, action: ActivityAction, actor: string, now: number): ActivitySession | null {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return null;
  const next = step(s, action, actor);
  if (!next) return null;
  return { ...next, v: s.v + 1, updated_at: now };
}

// ------------------------------------------------------------------ score + summary

export function scoreOf(s: Pick<ActivitySession, 'results'>): { correct: number; scored: number } {
  const scored = s.results.filter((r) => r.correct !== null);
  return { correct: scored.filter((r) => r.correct === true).length, scored: scored.length };
}

const mark = (c: boolean | null) => (c === true ? ' ✓' : c === false ? ' ✗' : '');

/** The readable record of a session (kept with the lesson; the review page and the homework agent read it). */
export function activitySummary(s: ActivitySession): ActivitySummary {
  const spec = s.spec;
  const lines: string[] = [];
  for (const r of s.results) {
    if (r.skipped) {
      lines.push(`${roundTitle(spec, r.round)} — skipped`);
      continue;
    }
    switch (spec.kind) {
      case 'describe': {
        const it = spec.items[r.round];
        lines.push(`${it.emoji} ${it.hanzi} (${it.pinyin}, ${it.english}) — picked ${r.answer ?? '?'}${mark(r.correct)}`);
        break;
      }
      case 'info_gap':
        lines.push(...(r.detail ?? []));
        lines.push(`Filled in correctly: ${r.answer ?? ''}`);
        break;
      case 'roleplay': {
        const l = spec.lines[r.round];
        lines.push(`${spec.speakers[l.speaker]} (${s.names[s.roles[l.speaker]] ?? l.speaker}): ${l.hanzi}`);
        break;
      }
      case 'build': {
        const it = spec.items[r.round];
        lines.push(`${it.tiles.join('')} (${it.english}) — built ${r.answer || '(nothing)'}${mark(r.correct)}`);
        break;
      }
      case 'quiz': {
        const q = spec.questions[r.round];
        lines.push(`${q.prompt || '🔊'}${q.audio ? ` [heard: ${q.audio}]` : ''} — picked ${r.answer || '(nothing)'}${mark(r.correct)}${r.correct ? '' : ` (answer: ${q.options[q.answer]})`}`);
        break;
      }
      case 'dictation': {
        const it = spec.items[r.round];
        lines.push(`${it.hanzi} (${it.pinyin}, ${it.english}) — wrote ${r.answer || '(nothing)'}${mark(r.correct)}`);
        break;
      }
    }
  }
  const sc = scoreOf(s);
  return {
    activity_id: spec.id,
    kind: spec.kind,
    title: spec.title,
    played: s.results.filter((r) => !r.skipped).length,
    scored: sc.scored,
    correct: sc.correct,
    total_rounds: totalRounds(spec),
    finished: s.phase === 'done',
    roles: (['a', 'b'] as ActivityRole[]).map((r) => `${r}: ${roleLabel(s, r)}`),
    lines,
  };
}

/** A short name for round `i` (for "skipped" lines and progress). */
export function roundTitle(spec: ActivitySpec, i: number): string {
  switch (spec.kind) {
    case 'describe':
      return spec.items[i]?.hanzi ?? `Round ${i + 1}`;
    case 'info_gap':
      return spec.title;
    case 'roleplay':
      return spec.lines[i]?.hanzi ?? `Line ${i + 1}`;
    case 'build':
      return spec.items[i]?.tiles.join('') ?? `Sentence ${i + 1}`;
    case 'quiz':
      return spec.questions[i]?.prompt || `Question ${i + 1}`;
    case 'dictation':
      return spec.items[i]?.hanzi ?? `Word ${i + 1}`;
  }
}
