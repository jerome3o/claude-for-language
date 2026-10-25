/**
 * Hard mode in the homework pass (docs/HOMEWORK.md §3d; Jerome, Oct 2026: "Can we make them more like
 * the hard mode we have in the normal flashcards? … it's good to do a few different angles for each
 * word"). A one-off pass is the only time he sees these words for a while, so:
 *
 * - **The pass honours Hard mode** (shared/study/hardMode.ts — the same check-first ladder and Sentence
 *   round on the reading / meaning cards). Its own setting, per device, DEFAULT ALL (`parsePassHardMode`):
 *   **All** = every word · **Red** = words he marked *Not yet* in this pass (and so every time they come
 *   back) · **Off** = the pass as before. `passHardApplies` decides per showing.
 * - **Got it needs the ladder**: in Hard mode a miss / 👁 Show answer locks Got it (as Good / Easy in the
 *   session) and suggests *Not yet*.
 * - **A second angle**: a word got right in Hard mode on its first angle is owed ONE more showing later in
 *   the pass, on a different card type (`secondAngleType`: reading ↔ meaning; the listening card when the
 *   note has audio and the other two are done or missing) — at most `PASS_MAX_ANGLES` (2) per word. It
 *   comes back once `PASS_ANGLE_GAP` other words have been started since (or at the end, among the
 *   retries); only then is the word done.
 *
 * Events (append-only, offline-first, no schema change): *Not yet* is `wrong` on the word (note id) as
 * before; *Got it* on a first angle that is owed a second is `right` on a STEP id `<noteId>#<card type>`
 * (`passStepId`); the word's final *Got it* is `right` on the note id. The server and every other rule
 * (`passProgress`, `passRetryBar`, Home rows, the tutor's views) count only the note id, so a word is
 * "done" for them exactly when it is done here — and an older app that ignores step events just shows
 * the word again and finishes it. Undo (§3b) works unchanged: a step is an answer like any other.
 *
 * `passAnglePlan` is the walk: what to show next (word + card type + angle), what is left, and the retry
 * bar (§3c) with the owed angles counted as steps (so the bar stays truthful). With no step events and
 * Hard mode off it is exactly `passProgress` + `passRetryBar`.
 *
 * Pure; Lab port core `PassAngles.kt`, parity-tested (parity/fixtures/pass-angles.ts).
 */

// Type only: shared/homework is bundled into the worker (hardMode.ts pulls the sentence rules in).
import type { HardMode } from '../study/hardMode';
import { livePassEvents, type PassEvent } from './pass';
import { retryBar, type RetryBar } from './retry-bar';

export const PASS_READ = 'hanzi_to_meaning';
export const PASS_MEANING = 'meaning_to_hanzi';
export const PASS_LISTEN = 'audio_to_hanzi';
/** The card types Hard mode's ladder runs on (`SENTENCE_GATE_CARD_TYPES`, repeated so this module stays light). */
const LADDER_TYPES: readonly string[] = [PASS_READ, PASS_MEANING];
/** A word's first angle: the pass's read card, else the next in this order (`passCardId`). */
const FIRST_ORDER: readonly string[] = [PASS_READ, PASS_MEANING, PASS_LISTEN];

/** At most this many angles (showings got right) per word. */
export const PASS_MAX_ANGLES = 2;
/** A second angle comes back once this many other words have been started since its first was got. */
export const PASS_ANGLE_GAP = 3;

// --- the setting ----------------------------------------------------------------------------------

export const DEFAULT_PASS_HARD_MODE: HardMode = 'all';

/** A stored value → the pass's mode; anything unknown (never set) = All. */
export function parsePassHardMode(raw: string | null | undefined): HardMode {
  return raw === 'off' || raw === 'red' || raw === 'all' ? raw : DEFAULT_PASS_HARD_MODE;
}

/**
 * Hard mode on this showing of a pass word: the pass setting, a reading / meaning card, and — Red —
 * a word he has marked *Not yet* in this pass.
 */
export function passHardApplies(args: { mode: HardMode; cardType: string; missed: boolean }): boolean {
  if (args.mode === 'off' || !LADDER_TYPES.includes(args.cardType)) return false;
  return args.mode === 'all' || args.missed;
}

// --- step ids --------------------------------------------------------------------------------------

const SEP = '#';

/** The item id a first angle's *Got it* is recorded on: `<noteId>#<card type>`. */
export function passStepId(noteId: string, cardType: string): string {
  return `${noteId}${SEP}${cardType}`;
}

/** `<noteId>#<card type>` → its parts; null = a plain item id. */
export function parsePassStepId(itemId: string): { noteId: string; cardType: string } | null {
  const i = itemId.lastIndexOf(SEP);
  if (i <= 0 || i === itemId.length - 1) return null;
  return { noteId: itemId.slice(0, i), cardType: itemId.slice(i + 1) };
}

// --- the words -------------------------------------------------------------------------------------

/** A pass word as the walk needs it: the card types it has on the device, and whether it has audio. */
export interface PassWord {
  id: string;
  /** Card types of the note's cards (empty = not on the device yet: shown as the read card). */
  cardTypes: readonly string[];
  hasAudio: boolean;
}

/** The first angle's card type: the read card, else the meaning card, else the listening card. */
export function firstAngleType(word: Pick<PassWord, 'cardTypes'>): string {
  for (const t of FIRST_ORDER) if (word.cardTypes.includes(t)) return t;
  return PASS_READ;
}

/**
 * The second angle's card type after a first angle on `firstType`, of the types the word has and that
 * aren't `done` yet: reading → meaning, meaning → reading; then the listening card (only with audio);
 * a first angle on the listening card → reading, then meaning. null = none (the word is done at once).
 */
export function secondAngleType(word: Pick<PassWord, 'cardTypes' | 'hasAudio'>, firstType: string, done: readonly string[] = []): string | null {
  const listen = word.hasAudio ? [PASS_LISTEN] : [];
  const candidates =
    firstType === PASS_READ ? [PASS_MEANING, ...listen]
      : firstType === PASS_MEANING ? [PASS_READ, ...listen]
        : [PASS_READ, PASS_MEANING];
  for (const t of candidates) {
    if (t !== firstType && word.cardTypes.includes(t) && !done.includes(t)) return t;
  }
  return null;
}

// --- the walk --------------------------------------------------------------------------------------

/** One showing to come: which word, on which card, which angle, and whether it is a retry (after a Not yet). */
export interface PassShowing {
  noteId: string;
  cardType: string;
  angle: 1 | 2;
  retry: boolean;
}

export interface PassAnglePlan {
  /** Showings to come, in order (one per word not done). */
  remaining: PassShowing[];
  next: PassShowing | null;
  /** Words done (their final Got it), of `total`. */
  done: number;
  total: number;
  complete: boolean;
  /** Words owed a retry (a Not yet since their last Got it). */
  retrying: number;
  /** Words owed their second angle (not counting retries). */
  anglesOwed: number;
  /** The retry bar (§3c) with every owed angle as a step in the track. */
  bar: RetryBar;
}

interface WordState {
  final: boolean;
  /** Card types got right on a first angle (step events). */
  steps: string[];
  lastStepAt: string | null;
  lastStepType: string | null;
  wrongs: number;
  lastWrongAt: string | null;
  firstAt: string | null;
  /** Steps answered (distinct step ids) + wrongs + the final right: the bar's blue. */
  answered: number;
}

function wordStates(words: readonly PassWord[], events: readonly PassEvent[]): Map<string, WordState> {
  const states = new Map<string, WordState>();
  for (const w of words) {
    states.set(w.id, { final: false, steps: [], lastStepAt: null, lastStepType: null, wrongs: 0, lastWrongAt: null, firstAt: null, answered: 0 });
  }
  for (const e of livePassEvents(events)) {
    const step = parsePassStepId(e.item_id);
    const direct = states.get(e.item_id);
    const s = direct ?? (step ? states.get(step.noteId) : undefined);
    if (!s) continue;
    if (e.result !== 'right' && e.result !== 'wrong' && e.result !== 'done') continue;
    // A step id only ever carries a Got it.
    if (!direct && e.result !== 'right') continue;
    if (!s.firstAt || e.created_at < s.firstAt) s.firstAt = e.created_at;
    if (direct) {
      if (e.result === 'wrong') {
        s.wrongs++;
        s.answered++;
        if (!s.lastWrongAt || e.created_at > s.lastWrongAt) s.lastWrongAt = e.created_at;
      } else if (!s.final) {
        s.final = true;
        s.answered++;
      }
    } else if (step) {
      if (!s.steps.includes(step.cardType)) {
        s.steps.push(step.cardType);
        s.answered++;
      }
      if (!s.lastStepAt || e.created_at >= s.lastStepAt) {
        s.lastStepAt = e.created_at;
        s.lastStepType = step.cardType;
      }
    }
  }
  return states;
}

/** The walk of a pass with angles (see the file comment). `mode` only sizes the bar's owed steps. */
export function passAnglePlan(words: readonly PassWord[], events: readonly PassEvent[], mode: HardMode): PassAnglePlan {
  const seen = new Set<string>();
  const unique = words.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
  const states = wordStates(unique, events);

  type Pending = { showing: PassShowing; at: string; index: number; due: boolean };
  const unseen: PassShowing[] = [];
  const pending: Pending[] = [];
  let done = 0;
  let answered = 0;
  let fresh = 0;
  let retries = 0;
  let anglesOwed = 0;
  // When each word was started (its first live answer), for the gap rule.
  const starts = unique.map((w) => states.get(w.id)!.firstAt).filter((t): t is string => !!t);

  unique.forEach((w, index) => {
    const s = states.get(w.id)!;
    answered += s.answered;
    if (s.final) {
      done++;
      return;
    }
    const first = firstAngleType(w);
    if (s.steps.length > 0) {
      // A first angle was got: the second, on another card type (the same one again if none is left).
      const stepType = s.lastStepType ?? first;
      const cardType = secondAngleType(w, stepType, s.steps) ?? stepType;
      const retry = !!s.lastWrongAt && !!s.lastStepAt && s.lastWrongAt > s.lastStepAt;
      const at = retry ? s.lastWrongAt! : s.lastStepAt!;
      const due = !retry && starts.filter((t) => t > s.lastStepAt!).length >= PASS_ANGLE_GAP;
      pending.push({ showing: { noteId: w.id, cardType, angle: 2, retry }, at, index, due });
      if (retry) retries++;
      else {
        fresh++;
        anglesOwed++;
      }
      return;
    }
    // A second angle to come after this one: All mode (or Red for a word already missed), on a ladder card.
    const planned = passHardApplies({ mode, cardType: first, missed: s.wrongs > 0 }) && secondAngleType(w, first) !== null ? 1 : 0;
    if (s.wrongs > 0) {
      pending.push({ showing: { noteId: w.id, cardType: first, angle: 1, retry: true }, at: s.lastWrongAt!, index, due: false });
      retries++;
      fresh += planned;
      return;
    }
    unseen.push({ noteId: w.id, cardType: first, angle: 1, retry: false });
    fresh += 1 + planned;
  });

  const byTime = (a: Pending, b: Pending) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.index - b.index);
  const dueAngles = pending.filter((p) => p.due).sort(byTime).map((p) => p.showing);
  const rest = pending.filter((p) => !p.due).sort(byTime).map((p) => p.showing);
  const remaining = [...dueAngles, ...unseen, ...rest];
  return {
    remaining,
    next: remaining[0] ?? null,
    done,
    total: unique.length,
    complete: unique.length > 0 && done === unique.length,
    retrying: retries,
    anglesOwed,
    bar: retryBar({ answered, fresh, retries, itemsDone: done, items: unique.length }),
  };
}

/** Did he mark this word *Not yet* in this pass (any live `wrong` on it)? — Red mode's "red word". */
export function passWordMissed(noteId: string, events: readonly PassEvent[]): boolean {
  return livePassEvents(events).some((e) => e.item_id === noteId && e.result === 'wrong');
}

/**
 * The item id an answer on `showing` is recorded on: *Not yet* → the word; *Got it* on a first angle
 * shown in Hard mode that is owed a second (`secondAngleType`) → its step id; any other *Got it* → the
 * word (it is done).
 */
export function passAnswerItemId(args: { showing: PassShowing; word: PassWord; right: boolean; hard: boolean }): string {
  const { showing, word, right, hard } = args;
  if (!right || !hard || showing.angle !== 1) return showing.noteId;
  return secondAngleType(word, showing.cardType) ? passStepId(showing.noteId, showing.cardType) : showing.noteId;
}

// --- words (both apps) -----------------------------------------------------------------------------

/** The pass's chip / Settings options (the session's are about cards, these about words). */
export const PASS_HARD_MODE_OPTION: Record<HardMode, string> = {
  off: 'Off',
  red: 'Words I miss',
  all: 'All words',
};
export const PASS_HARD_MODE_OPTION_HINT: Record<HardMode, string> = {
  off: 'Each word once, straight to the answer',
  red: 'Words you mark Not yet: checked first, sentences, then a second angle',
  all: 'Every word: checked first, sentences, then a second angle later',
};
export const PASS_HARD_MODE_TITLE = 'Hard mode in homework';
/** Settings → Study, under the title. */
export const PASS_HARD_MODE_DESCRIPTION =
  'One-off homework is the only time you see those words for a while, so it uses Hard mode by default: your answer is checked first, then a few sentences, and each word comes back once more from another angle.';
/** The chip's accessible name: "Hard mode in homework: All words". */
export function passHardModeChipLabel(mode: HardMode): string {
  return `${PASS_HARD_MODE_TITLE}: ${PASS_HARD_MODE_OPTION[mode]}`;
}

/** The pass header's line under the bar: "2 angles per word" (null = Off). */
export function passAnglesLabel(mode: HardMode): string | null {
  if (mode === 'all') return '🎯 2 angles per word';
  if (mode === 'red') return '🎯 2 angles for words you miss';
  return null;
}

const ANGLE_CARD: Record<string, string> = {
  [PASS_READ]: 'Chinese → meaning',
  [PASS_MEANING]: 'English → Chinese',
  [PASS_LISTEN]: 'Listen → Chinese',
};

/** The banner on a second angle: "🔄 Second angle · English → Chinese" (null on a first angle). */
export function passAngleLine(showing: Pick<PassShowing, 'angle' | 'cardType'>): string | null {
  if (showing.angle !== 2) return null;
  return `🔄 Second angle · ${ANGLE_CARD[showing.cardType] ?? showing.cardType}`;
}

/** Under the Sentence round's Skip in the pass (Got it isn't held back by the sentences). */
export const PASS_ROUND_SKIP_NOTE = 'Skipping is fine — Got it stays open, and the word still comes back from another angle.';
/** Above Not yet / Got it after giving up in Hard mode. */
export const PASS_GAVE_UP_LINE = '👁 You looked at the answer — Not yet this time';
/** Said when the locked Got it is tapped. */
export const PASS_GAVE_UP_BLOCKED =
  'You looked at the answer before getting it right, so Got it stays locked — the word comes back later in the pass.';
