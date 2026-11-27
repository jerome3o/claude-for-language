/**
 * 🎯 Structures to use in the call (Jerome, Nov 2026: "a few sentence structures I should be
 * trying to use, that I've had homework for or studied in the last couple of weeks … over the
 * lesson I should have a goal to use them … ticked off when used naturally").
 *
 * ONE list per call, shared by both people through the CallRoom (`goals` messages,
 * `welcome.goals`, storage key `goals`): 3–5 grammar structures the STUDENT of the call met in
 * his mini lessons (shared/lesson/learnerStructures.ts), picked by `pickCallGoals` — recent ones
 * (last 14 days) he hasn't used in an earlier call first, topped up with older ones. Either person
 * adds ("一…就…" typed as a pattern), removes or reorders; the tutor ticks / unticks by hand.
 *
 * Auto-tick: only the student's device listens to his OWN microphone (Soniox real-time, the study
 * takes' path), cuts the stream into utterances (`foldGoalSpeech`), and an utterance holding a
 * structure's fixed words in order with bounded gaps (`matchStructure`) is sent as `heard` →
 * "✓ checking…" for both; one small model check ("is the structure really used, in its sense?")
 * answers `checked` → ✓ with the sentence, or back to unticked with the sentence kept as a near miss.
 *
 * Pure rules, used by the CallRoom, the web call page and the Lab app
 * (`core/…/calls/CallGoals.kt`, parity-tested by parity/fixtures/calls-goals.ts).
 */
import { digitsToHanzi } from '../text/numberHanzi';
import { isHanChar } from './gloss';

/** A structure as the picker sees it (shared/lesson/learnerStructures.ts `LearnerStructure`). */
export interface GoalStructure {
  name: string;
  line?: string | null;
  meaning?: string | null;
  example?: string | null;
  fixed: string[];
  /** ISO time he last finished a lesson teaching it. */
  last_met?: string | null;
}

export type CallGoalStatus = 'open' | 'checking' | 'used' | 'near';

/** A sentence that counted (or was heard) for a goal. */
export interface CallGoalHit {
  text: string;
  /** Room time (epoch ms). */
  at: number;
  /** `auto` = heard in his speech and checked; `tutor` = ticked by hand. */
  by: 'auto' | 'tutor';
  /** Who ticked it by hand. */
  name?: string;
}

export interface CallGoal {
  id: string;
  /** "除了…还…" */
  name: string;
  /** "除了 + [Noun] + ， + 还 + [Verb]" */
  line: string | null;
  meaning: string | null;
  /** One example from the lesson (▶ plays it). */
  example: string | null;
  /** The structure's fixed words in order: what a sentence must contain to use it. */
  fixed: string[];
  /** From his lessons, or typed in the call. */
  source: 'learned' | 'added';
  /** When he last met it in a lesson (ISO; null for an added one). */
  last_met: string | null;
  status: CallGoalStatus;
  used: CallGoalHit | null;
  /** The sentence being checked now. */
  checking: { text: string; at: number } | null;
  /** The last sentence that had the words but wasn't the structure. */
  near: { text: string; at: number } | null;
}

export interface CallGoals {
  /** Whose speech ticks them (the relationship's student; the caller in a solo call). */
  student_id: string | null;
  student_name: string;
  goals: CallGoal[];
  /** Counts every change. */
  v: number;
  /** How many learned structures there were to pick from (0 → "none from your lessons yet"). */
  available: number;
}

export type CallGoalsAction =
  /** A pattern typed in the call: "一…就…", "从…的角度来看". */
  | { kind: 'add'; text: string }
  | { kind: 'remove'; id: string }
  /** Move to position `to` (0-based). */
  | { kind: 'move'; id: string; to: number }
  /** The tutor ticks one by hand (the sentence, when she has one). */
  | { kind: 'tick'; id: string; text?: string }
  | { kind: 'untick'; id: string }
  /** The student's device heard the words in this sentence: check it. */
  | { kind: 'heard'; id: string; text: string }
  /** The check's answer for that sentence. */
  | { kind: 'checked'; id: string; text: string; ok: boolean };

/** At least / at most this many picked for a call. */
export const GOALS_MIN = 3;
export const GOALS_MAX = 5;
/** "Recent" = met in a lesson in the last two weeks. */
export const GOALS_RECENT_DAYS = 14;
/** At most this many in one call's list (picked + added). */
export const GOALS_LIST_MAX = 8;
/** A typed pattern: at most this many characters / fixed pieces. */
export const GOAL_INPUT_MAX = 30;
export const GOAL_FIXED_MAX = 6;
/** A heard sentence kept for a goal (longer is cut). */
export const GOAL_TEXT_MAX = 120;
/** A check that never answered (the device went away): a new sentence may replace it after this long. */
export const GOAL_CHECK_STALE_MS = 45_000;
/** The matcher: at most this many characters between two fixed words / in the whole span. */
export const GOAL_MAX_GAP = 16;
export const GOAL_MAX_SPAN = 48;
/** A sentence must have at least this many characters besides the fixed words. */
export const GOAL_MIN_CONTENT = 2;

const DAY_MS = 86_400_000;

// ------------------------------------------------------------------ picking

const parseIso = (s: string | null | undefined): number => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * The structures a call aims for: those met in the last `GOALS_RECENT_DAYS` days and not used in an
 * earlier call (newest met first) — up to GOALS_MAX —, topped up to GOALS_MIN with older ones he
 * hasn't used, then with ones he has. `usedNames`: structures ticked in his earlier calls.
 */
export function pickCallGoals(structures: readonly GoalStructure[], usedNames: readonly string[], now: number): GoalStructure[] {
  const used = new Set(usedNames.map((n) => n.trim()));
  const seen = new Set<string>();
  const list: GoalStructure[] = [];
  for (const s of structures) {
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    if (!name || seen.has(name) || !Array.isArray(s.fixed) || s.fixed.filter((w) => typeof w === 'string' && w.trim()).length === 0) continue;
    seen.add(name);
    list.push(s);
  }
  const byMet = (a: GoalStructure, b: GoalStructure) => parseIso(b.last_met) - parseIso(a.last_met) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const recent = (s: GoalStructure) => now - parseIso(s.last_met) <= GOALS_RECENT_DAYS * DAY_MS;
  const tiers = [
    list.filter((s) => recent(s) && !used.has(s.name.trim())).sort(byMet),
    list.filter((s) => !recent(s) && !used.has(s.name.trim())).sort(byMet),
    list.filter((s) => used.has(s.name.trim())).sort(byMet),
  ];
  const target = Math.max(GOALS_MIN, Math.min(GOALS_MAX, tiers[0].length));
  const out: GoalStructure[] = [];
  for (const tier of tiers) for (const s of tier) if (out.length < target) out.push(s);
  return out;
}

/** The call's list from picked structures. */
export function goalsFromStructures(picked: readonly GoalStructure[], newId: () => string): CallGoal[] {
  return picked.map((s) => ({
    id: newId(),
    name: s.name.trim(),
    line: s.line?.trim() || null,
    meaning: s.meaning?.trim() || null,
    example: s.example?.trim() || null,
    fixed: s.fixed.map((w) => w.trim()).filter(Boolean).slice(0, GOAL_FIXED_MAX),
    source: 'learned',
    last_met: s.last_met ?? null,
    status: 'open',
    used: null,
    checking: null,
    near: null,
  }));
}

// ------------------------------------------------------------------ a typed pattern

/**
 * A pattern typed in the call → its name and fixed words: the runs of Chinese characters, split
 * at anything else (…, ..., spaces, +, letters as slots, brackets). "一…就…" → { name: "一…就…",
 * fixed: ["一", "就"] }; "从 A 的角度来看" → ["从", "的角度来看"]. Null when there is no Chinese.
 */
export function parseGoalPattern(raw: string): { name: string; fixed: string[] } | null {
  if (typeof raw !== 'string') return null;
  const text = raw.normalize('NFKC').trim().slice(0, GOAL_INPUT_MAX * 2);
  const fixed: string[] = [];
  let run = '';
  let name = '';
  let gap = false;
  for (const ch of Array.from(text)) {
    if (isHanChar(ch)) {
      if (gap && name) name += '…';
      gap = false;
      run += ch;
      name += ch;
    } else {
      if (run) fixed.push(run);
      run = '';
      gap = true;
    }
  }
  if (run) fixed.push(run);
  if (fixed.length === 0) return null;
  // A pattern ending in a slot ("一…就…") keeps its trailing ellipsis; one starting with a slot too.
  const first = Array.from(text)[0] ?? '';
  const startsWithGap = !isHanChar(first);
  if (gap) name += '…';
  if (startsWithGap) name = `…${name}`;
  if (Array.from(name).length > GOAL_INPUT_MAX || fixed.length > GOAL_FIXED_MAX) return null;
  return { name, fixed };
}

// ------------------------------------------------------------------ matching

/** Recognisers swap these freely and they never decide a structure: one class each. */
const FOLD: Record<string, string> = { 得: '的', 地: '的', 她: '他', 它: '他', 嘛: '吗' };

/** The comparable form of a sentence: digits as Chinese, only Chinese characters, homophone particles folded. */
export function goalMatchKey(text: string): string {
  const s = digitsToHanzi(String(text ?? '').normalize('NFKC'));
  let out = '';
  for (const ch of Array.from(s)) if (isHanChar(ch)) out += FOLD[ch] ?? ch;
  return out;
}

/**
 * Does `sentence` hold the structure's fixed words in order, each within GOAL_MAX_GAP characters of
 * the one before and the whole within GOAL_MAX_SPAN, with some content of its own? Punctuation,
 * spaces, Latin letters and digits (read as Chinese numbers) don't count; 的 / 得 / 地 are one
 * word. Returns the span [start, end) in `goalMatchKey(sentence)`, or null.
 */
export function matchStructure(sentence: string, fixed: readonly string[]): { start: number; end: number } | null {
  const words = fixed.map(goalMatchKey).filter(Boolean);
  if (words.length === 0) return null;
  const key = goalMatchKey(sentence);
  const fixedLen = words.reduce((n, w) => n + Array.from(w).length, 0);
  if (Array.from(key).length < fixedLen + GOAL_MIN_CONTENT) return null;
  const chars = Array.from(key);
  const at = (from: number, word: string): number => {
    const w = Array.from(word);
    outer: for (let i = from; i + w.length <= chars.length; i++) {
      for (let j = 0; j < w.length; j++) if (chars[i + j] !== w[j]) continue outer;
      return i;
    }
    return -1;
  };
  const firstLen = Array.from(words[0]).length;
  for (let start = at(0, words[0]); start >= 0; start = at(start + 1, words[0])) {
    let end = start + firstLen;
    let ok = true;
    for (let k = 1; k < words.length; k++) {
      const i = at(end, words[k]);
      if (i < 0 || i - end > GOAL_MAX_GAP) {
        ok = false;
        break;
      }
      end = i + Array.from(words[k]).length;
    }
    if (ok && end - start <= GOAL_MAX_SPAN) return { start, end };
  }
  return null;
}

/** The open goals a sentence matches (the ones not used yet, not being checked), in list order. */
export function goalsHeardIn(sentence: string, goals: readonly CallGoal[]): CallGoal[] {
  return goals.filter((g) => (g.status === 'open' || g.status === 'near') && matchStructure(sentence, g.fixed) !== null);
}

// ------------------------------------------------------------------ the room's list

/** Who may do what: anyone adds / removes / reorders; the tutor ticks by hand (solo: anyone); only the student's own speech ticks. */
export function mayActOnGoals(action: Pick<CallGoalsAction, 'kind'>, userId: string, tutorId: string | null, studentId: string | null): boolean {
  switch (action.kind) {
    case 'tick':
    case 'untick':
      return tutorId === null || userId === tutorId;
    case 'heard':
    case 'checked':
      return studentId !== null && userId === studentId;
    default:
      return true;
  }
}

const cleanText = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, GOAL_TEXT_MAX) : '');
const cleanId = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 64) : '');

/** A client's `goals` action, cleaned (null = refused). */
export function sanitizeGoalsAction(raw: unknown): CallGoalsAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = cleanId(r.id);
  switch (r.kind) {
    case 'add': {
      const text = typeof r.text === 'string' ? r.text.trim().slice(0, GOAL_INPUT_MAX * 2) : '';
      return text ? { kind: 'add', text } : null;
    }
    case 'remove':
    case 'untick':
      return id ? { kind: r.kind, id } : null;
    case 'move': {
      const to = typeof r.to === 'number' && Number.isFinite(r.to) ? Math.round(r.to) : NaN;
      return id && Number.isFinite(to) ? { kind: 'move', id, to } : null;
    }
    case 'tick': {
      const text = cleanText(r.text);
      return id ? { kind: 'tick', id, ...(text ? { text } : {}) } : null;
    }
    case 'heard': {
      const text = cleanText(r.text);
      return id && text ? { kind: 'heard', id, text } : null;
    }
    case 'checked': {
      const text = cleanText(r.text);
      return id && text && typeof r.ok === 'boolean' ? { kind: 'checked', id, text, ok: r.ok } : null;
    }
    default:
      return null;
  }
}

/**
 * The room's list after `action` by `by` at `now` (null = refused or nothing changed). Permissions
 * are `mayActOnGoals`'s; the room checks them before calling this.
 */
export function reduceGoals(cur: CallGoals, action: CallGoalsAction, by: { userId: string; name: string }, now: number, newId: () => string): CallGoals | null {
  const idx = 'id' in action ? cur.goals.findIndex((g) => g.id === action.id) : -1;
  const goal = idx >= 0 ? cur.goals[idx] : null;
  const withGoal = (g: CallGoal): CallGoals => ({ ...cur, goals: cur.goals.map((x, i) => (i === idx ? g : x)), v: cur.v + 1 });
  switch (action.kind) {
    case 'add': {
      const p = parseGoalPattern(action.text);
      if (!p || cur.goals.length >= GOALS_LIST_MAX) return null;
      if (cur.goals.some((g) => g.name === p.name || g.fixed.join('…') === p.fixed.join('…'))) return null;
      const g: CallGoal = { id: newId(), name: p.name, line: null, meaning: null, example: null, fixed: p.fixed, source: 'added', last_met: null, status: 'open', used: null, checking: null, near: null };
      return { ...cur, goals: [...cur.goals, g], v: cur.v + 1 };
    }
    case 'remove':
      if (!goal) return null;
      return { ...cur, goals: cur.goals.filter((g) => g.id !== action.id), v: cur.v + 1 };
    case 'move': {
      if (!goal) return null;
      const to = Math.max(0, Math.min(cur.goals.length - 1, action.to));
      if (to === idx) return null;
      const rest = cur.goals.filter((g) => g.id !== action.id);
      rest.splice(to, 0, goal);
      return { ...cur, goals: rest, v: cur.v + 1 };
    }
    case 'tick': {
      if (!goal || goal.status === 'used') return null;
      const text = action.text ?? goal.checking?.text ?? goal.near?.text ?? '';
      return withGoal({ ...goal, status: 'used', used: { text, at: now, by: 'tutor', name: by.name }, checking: null });
    }
    case 'untick':
      if (!goal || (goal.status !== 'used' && goal.status !== 'checking')) return null;
      return withGoal({ ...goal, status: 'open', used: null, checking: null });
    case 'heard': {
      if (!goal || goal.status === 'used') return null;
      if (goal.status === 'checking' && goal.checking && now - goal.checking.at < GOAL_CHECK_STALE_MS) return null;
      if (matchStructure(action.text, goal.fixed) === null) return null;
      return withGoal({ ...goal, status: 'checking', checking: { text: action.text, at: now } });
    }
    case 'checked': {
      if (!goal || goal.status !== 'checking' || goal.checking?.text !== action.text) return null;
      return action.ok
        ? withGoal({ ...goal, status: 'used', used: { text: action.text, at: now, by: 'auto' }, checking: null })
        : withGoal({ ...goal, status: 'near', near: { text: action.text, at: now }, checking: null });
    }
    default:
      return null;
  }
}

const isStatus = (v: unknown): v is CallGoalStatus => v === 'open' || v === 'checking' || v === 'used' || v === 'near';

/** A stored / received list, cleaned (null = unusable). */
export function sanitizeCallGoals(raw: unknown): CallGoals | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.goals)) return null;
  const goals: CallGoal[] = [];
  for (const x of r.goals.slice(0, GOALS_LIST_MAX)) {
    if (!x || typeof x !== 'object') continue;
    const g = x as Record<string, unknown>;
    const fixed = Array.isArray(g.fixed) ? g.fixed.filter((w): w is string => typeof w === 'string' && w.trim() !== '').slice(0, GOAL_FIXED_MAX) : [];
    const name = typeof g.name === 'string' ? g.name.trim().slice(0, 60) : '';
    const id = cleanId(g.id);
    if (!id || !name || fixed.length === 0) continue;
    const hit = (h: unknown): { text: string; at: number } | null => {
      if (!h || typeof h !== 'object') return null;
      const o = h as Record<string, unknown>;
      return typeof o.at === 'number' && Number.isFinite(o.at) ? { text: cleanText(o.text), at: o.at } : null;
    };
    const usedRaw = g.used as Record<string, unknown> | null | undefined;
    const usedBase = hit(usedRaw);
    const used: CallGoalHit | null = usedBase
      ? { ...usedBase, by: usedRaw?.by === 'tutor' ? 'tutor' : 'auto', ...(typeof usedRaw?.name === 'string' && usedRaw.name ? { name: usedRaw.name.slice(0, 80) } : {}) }
      : null;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 400) : null);
    let status: CallGoalStatus = isStatus(g.status) ? g.status : 'open';
    const checking = hit(g.checking);
    if (status === 'used' && !used) status = 'open';
    if (status === 'checking' && !checking) status = 'open';
    goals.push({
      id,
      name,
      line: str(g.line),
      meaning: str(g.meaning),
      example: str(g.example),
      fixed,
      source: g.source === 'added' ? 'added' : 'learned',
      last_met: typeof g.last_met === 'string' ? g.last_met : null,
      status,
      used: status === 'used' ? used : null,
      checking: status === 'checking' ? checking : null,
      near: hit(g.near),
    });
  }
  return {
    student_id: typeof r.student_id === 'string' && r.student_id ? r.student_id : null,
    student_name: typeof r.student_name === 'string' ? r.student_name.slice(0, 80) : '',
    goals,
    v: typeof r.v === 'number' && Number.isFinite(r.v) ? r.v : 0,
    available: typeof r.available === 'number' && Number.isFinite(r.available) ? Math.max(0, Math.round(r.available)) : 0,
  };
}

// ------------------------------------------------------------------ speech → utterances

/** The listener's running state: final text since the last utterance ended. */
export interface GoalSpeechState {
  pending: string;
}
export const EMPTY_GOAL_SPEECH: GoalSpeechState = { pending: '' };
/** An utterance longer than this is cut at its last punctuation (or whole). */
export const GOAL_UTTERANCE_MAX = 80;

const SENTENCE_END = /[。！？!?；;]/;

/**
 * One Soniox real-time response (raw JSON) folded into the listener: final tokens build the current
 * utterance; an `<end>` token (endpoint detection: he paused), `<fin>`, sentence-final punctuation
 * or `finished` closes it. Returns the finished utterances (trimmed, non-empty). Non-final tokens
 * are ignored — a tick waits for words the recogniser won't change.
 */
export function foldGoalSpeech(state: GoalSpeechState, raw: string): { state: GoalSpeechState; utterances: string[] } {
  let msg: { tokens?: Array<{ text?: unknown; is_final?: unknown }>; finished?: unknown };
  try {
    msg = JSON.parse(raw);
  } catch {
    return { state, utterances: [] };
  }
  let pending = state.pending;
  const out: string[] = [];
  const close = () => {
    const t = pending.trim();
    if (t) out.push(t);
    pending = '';
  };
  for (const tok of Array.isArray(msg.tokens) ? msg.tokens : []) {
    if (typeof tok?.text !== 'string' || tok.is_final !== true) continue;
    if (tok.text === '<end>' || tok.text === '<fin>') {
      close();
      continue;
    }
    for (const ch of Array.from(tok.text)) {
      pending += ch;
      if (SENTENCE_END.test(ch)) close();
    }
    if (Array.from(pending).length > GOAL_UTTERANCE_MAX) {
      const chars = Array.from(pending);
      let cut = -1;
      for (let i = chars.length - 1; i > 0; i--) if (/[，,、]/.test(chars[i])) { cut = i + 1; break; }
      if (cut <= 0) close();
      else {
        const head = chars.slice(0, cut).join('').trim();
        if (head) out.push(head);
        pending = chars.slice(cut).join('');
      }
    }
  }
  if (msg.finished === true) close();
  return { state: { pending }, utterances: out };
}

/** The stream is closing (rotation, mute, leave): whatever is pending is an utterance. */
export function flushGoalSpeech(state: GoalSpeechState): { state: GoalSpeechState; utterances: string[] } {
  const t = state.pending.trim();
  return { state: EMPTY_GOAL_SPEECH, utterances: t ? [t] : [] };
}

// ------------------------------------------------------------------ listening

export type GoalListenStatus = 'listening' | 'muted' | 'unavailable' | 'off';

/**
 * Should this device stream its mic for auto-ticks? Only the student's own device, only while the
 * call is live, a goal is still open (or a near miss), and the mic is on.
 */
export function goalListenStatus(o: { live: boolean; isStudent: boolean; goals: CallGoals | null; micOn: boolean; hasMic: boolean; unavailable: boolean }): GoalListenStatus {
  if (!o.live || !o.isStudent || !o.goals || !o.goals.goals.some((g) => g.status === 'open' || g.status === 'near')) return 'off';
  if (o.unavailable) return 'unavailable';
  if (!o.hasMic || !o.micOn) return 'muted';
  return 'listening';
}

// ------------------------------------------------------------------ words

export const GOALS_TITLE = '🎯 Structures';
export const GOALS_MENU_LABEL = '🎯 Structures to use';
export const GOALS_ADD_PLACEHOLDER = 'Add a structure, e.g. 一…就…';
export const GOAL_CHECKING_LABEL = '✓ checking…';
export const GOAL_TICK_LABEL = '✓ Tick';
export const GOAL_UNTICK_LABEL = 'Untick';

export function goalsUsedCount(goals: CallGoals | null): number {
  return goals ? goals.goals.filter((g) => g.status === 'used').length : 0;
}

/** The top-bar chip both people see: "🎯 1/4"; null when there is no list (an older room). */
export function goalsChipLabel(goals: CallGoals | null): string | null {
  if (!goals) return null;
  if (goals.goals.length === 0) return '🎯';
  return `🎯 ${goalsUsedCount(goals)}/${goals.goals.length}`;
}

export function goalsChipAria(goals: CallGoals | null): string {
  if (!goals || goals.goals.length === 0) return 'Structures to use';
  return `Structures to use: ${goalsUsedCount(goals)} of ${goals.goals.length} used`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/** The line under the title. */
export function goalsIntro(isStudent: boolean, studentName: string): string {
  return isStudent
    ? 'Try to use these in today’s conversation — each one ticks itself when you say it.'
    : `${firstName(studentName) || 'Your student'} is aiming to use these today. Each one ticks itself when ${firstName(studentName) || 'they'} says it — or tick one by hand.`;
}

/** No list to show. */
export function goalsEmptyText(isStudent: boolean, studentName: string, available: number): string {
  if (available > 0) return 'Nothing to aim for right now — add a structure below.';
  return isStudent
    ? 'No structures from your recent mini lessons yet. Add one to aim for — type a pattern like 一…就….'
    : `No structures from ${firstName(studentName) || 'your student'}’s mini lessons yet. Add one to aim for — type a pattern like 一…就….`;
}

/** The note about auto-ticking (null = nothing to say). */
export function goalListenNote(status: GoalListenStatus, isStudent: boolean): string | null {
  if (!isStudent) return null;
  switch (status) {
    case 'listening':
      return '🎙 Listening for them as you speak';
    case 'muted':
      return '🔇 Your mic is muted — not listening';
    case 'unavailable':
      return 'Auto-tick isn’t available right now — your tutor can tick them by hand.';
    default:
      return null;
  }
}

/** "met 3 Nov" / "added in the call". */
export function goalSourceLine(g: Pick<CallGoal, 'source' | 'last_met'>): string {
  if (g.source === 'added') return 'Added in the call';
  const t = parseIso(g.last_met);
  if (!t) return 'From a mini lesson';
  const d = new Date(t);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `From a mini lesson · ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/** "✓ ticked by Minghui" when the tutor ticked it without a sentence. */
export function goalHitCaption(hit: CallGoalHit): string {
  if (hit.by === 'tutor') return `✓ ticked by ${firstName(hit.name ?? '') || 'your tutor'}`;
  return '✓ used';
}

// ------------------------------------------------------------------ after the call

export interface GoalsSummary {
  used: Array<{ name: string; text: string; by: 'auto' | 'tutor' }>;
  near: Array<{ name: string; text: string }>;
  not_tried: string[];
}

/** What the lesson's goals came to (the report's "Structures you used"). */
export function goalsSummary(goals: readonly CallGoal[]): GoalsSummary {
  const out: GoalsSummary = { used: [], near: [], not_tried: [] };
  for (const g of goals) {
    if (g.status === 'used' && g.used) out.used.push({ name: g.name, text: g.used.text, by: g.used.by });
    else if (g.near) out.near.push({ name: g.name, text: g.near.text });
    else out.not_tried.push(g.name);
  }
  return out;
}

/** The summary as lines for the lesson report's prompt and the homework agent's notes ('' when no goals). */
export function goalsNotes(s: GoalsSummary): string {
  const lines: string[] = [];
  for (const u of s.used) lines.push(`- USED ${u.name}${u.text ? `: “${u.text}”` : ''}${u.by === 'tutor' ? ' (ticked by the tutor)' : ''}`);
  for (const n of s.near) lines.push(`- TRIED, NOT QUITE ${n.name}: “${n.text}”`);
  for (const n of s.not_tried) lines.push(`- NOT TRIED ${n}`);
  return lines.join('\n');
}

/** One lesson's goals from its calls' lists (later calls win; a structure used in any call stays used). */
export function mergeLessonGoals(lists: readonly (readonly CallGoal[])[]): CallGoal[] {
  const byName = new Map<string, CallGoal>();
  for (const list of lists) {
    for (const g of list) {
      const prev = byName.get(g.name);
      if (prev && prev.status === 'used' && g.status !== 'used') continue;
      byName.set(g.name, g);
    }
  }
  return [...byName.values()];
}
