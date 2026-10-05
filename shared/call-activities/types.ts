/**
 * In-call activities: small two-person exercises played together inside a
 * video call (docs/VIDEO_CALLS.md "In-call activities").
 *
 * An activity is a SPEC (hand-written content in ./catalogue.ts, keyed by
 * level / topic) played as a SESSION: one shared state machine that the call
 * room (CallRoom Durable Object) owns. Clients send actions, the room runs
 * `reduceActivity` (./engine.ts) and broadcasts the whole session after every
 * change, so both people always see the same thing and a reload / reconnect
 * just gets the session again in `welcome`.
 *
 * Each person has a ROLE, `a` or `b` (what they are depends on the kind:
 * describer / guesser, asker / answerer, speaker A / speaker B). The HOST —
 * the tutor of the call's relationship, else whoever started it — controls
 * the session (skip, reset, swap roles, next); either person may end it.
 * In a solo test call one person holds both roles.
 *
 * The spec rides inside the session, so a client never needs the same
 * catalogue version as the room (and generated activities can come later).
 */

export type ActivityKind = 'describe' | 'info_gap' | 'roleplay' | 'build' | 'quiz' | 'dictation';
export const ACTIVITY_KINDS: ActivityKind[] = ['describe', 'info_gap', 'roleplay', 'build', 'quiz', 'dictation'];

export type ActivityRole = 'a' | 'b';
export type ActivityLevel = 'beginner' | 'elementary' | 'intermediate';

/** A word / phrase with its reading and meaning. */
export interface ActivityWord {
  hanzi: string;
  pinyin: string;
  english: string;
}

interface SpecBase {
  /** Stable id, e.g. "describe-food-1". */
  id: string;
  title: string;
  /** Chinese title shown under the English one. */
  title_zh?: string;
  level: ActivityLevel;
  topic: string;
  /** One line: what the two of you do. */
  summary: string;
  /** What each role is called in this activity. */
  role_names: { a: string; b: string };
  /** The role the tutor takes when the session starts (the student gets the other). */
  tutor_role: ActivityRole;
}

/** A describes the thing in Chinese (without saying it); B picks it from up to `DESCRIBE_OPTION_COUNT`. */
export interface DescribeSpec extends SpecBase {
  kind: 'describe';
  items: (ActivityWord & { emoji: string; /** Words A might use. */ hints?: string[] })[];
  /** Extra wrong options from the same category (never a round's answer), so the guesser has more to choose from. */
  distractors?: ActivityWord[];
  /** Reading + meaning of the hint words ("words you needed" → + Add as card). */
  glossary?: ActivityWord[];
}

/** How many options a describe round shows the guesser (fewer when the spec has fewer words). */
export const DESCRIBE_OPTION_COUNT = 8;

/**
 * Information gap: a small table; each person sees only their half and fills
 * the other half by asking. `owner` = who can SEE the cell; the other person
 * fills it in from `choices`.
 */
export interface InfoGapSpec extends SpecBase {
  kind: 'info_gap';
  /** What to ask, e.g. "Ask: 小红星期六上午做什么？". */
  prompt: string;
  /** A question pattern each side can use. */
  phrases?: ActivityWord[];
  columns: string[];
  rows: { label: string; cells: { value: string; owner: ActivityRole }[] }[];
  /** Everything a blank can be filled with (all the values plus a few distractors). */
  choices: ActivityWord[];
}

/** A scripted dialogue; each person reads their part, turn by turn. */
export interface RoleplaySpec extends SpecBase {
  kind: 'roleplay';
  setting: string;
  /** Who A and B are in the story (e.g. 服务员 / 客人). */
  speakers: { a: string; b: string };
  lines: (ActivityWord & { speaker: ActivityRole })[];
}

/** Put scrambled tiles in order together; then each says the sentence aloud. */
export interface BuildSpec extends SpecBase {
  kind: 'build';
  items: { tiles: string[]; pinyin: string; english: string }[];
}

/** The asker pushes a question; the answerer picks; the asker marks it. */
export interface QuizSpec extends SpecBase {
  kind: 'quiz';
  questions: {
    /** Shown to both (may be empty for a pure listening question). */
    prompt: string;
    /** Played aloud (TTS) on both devices when asked, text hidden until the reveal. */
    audio?: string;
    options: string[];
    /** Index into options. */
    answer: number;
    explanation?: string;
  }[];
}

/** The asker says a word (or plays it); the writer types it; the asker sees it live and marks it. */
export interface DictationSpec extends SpecBase {
  kind: 'dictation';
  items: ActivityWord[];
}

export type ActivitySpec = DescribeSpec | InfoGapSpec | RoleplaySpec | BuildSpec | QuizSpec | DictationSpec;

/**
 * `ready`: the round is set up, the asker hasn't pushed it yet (quiz, dictation);
 * `play`: being played; `reveal`: answer shown, waiting for Next; `done`: finished, summary on screen.
 */
export type ActivityPhase = 'ready' | 'play' | 'reveal' | 'done';

/** One finished round. `correct` null = not scored (a dialogue line, a skipped round). */
export interface ActivityRoundResult {
  round: number;
  correct: boolean | null;
  /** What was answered (a guess, the typed text, the built sentence). */
  answer?: string;
  /** info_gap: one line per blank cell ("星期六 上午 · 小红: wrote 看电影 ✓"). */
  detail?: string[];
  skipped?: boolean;
  /** Who gave the answer (user id): the guesser who picked, the writer, the speaker. */
  by?: string;
}

/** The current round's working state, per kind (only the fields the kind uses). */
export interface ActivityRoundData {
  /** describe: the four options shown (hanzi, shuffled). */
  options?: string[];
  /** describe: the hanzi B picked; quiz: the option index B picked, as a string ("0".."3"). */
  pick?: string | null;
  /** describe / quiz: who picked (user id) — the reveal names this person, never "the guesser" by role. */
  pick_by?: string | null;
  /** build: the tile order shown in the pool (indices into the item's tiles). */
  pool?: number[];
  /** build: the tiles placed so far, in order (indices). */
  placed?: number[];
  /** build: who has said the sentence aloud (user ids). */
  said?: string[];
  /** dictation: what the writer has typed so far / submitted. */
  draft?: string;
  submitted?: boolean;
  /** quiz / dictation: the asker's mark (null = not marked; auto-marked on reveal). */
  mark?: boolean | null;
  /** quiz / dictation: bumped every time the asker plays the audio — clients play when it goes up. */
  play?: number;
  /** info_gap: the filled cells, "row:col" → value. */
  answers?: Record<string, string>;
}

export interface ActivitySession {
  /** One per start (uuid); actions carry it so a stale action for an old session is ignored. */
  session_id: string;
  spec: ActivitySpec;
  /** user id per role (the same id twice in a solo call). */
  roles: { a: string; b: string };
  /** Who controls the session (the tutor, else the starter). */
  host: string;
  /** user id → display name. */
  names: Record<string, string>;
  /** 0-based index of the current round (item / question / line). */
  round: number;
  phase: ActivityPhase;
  data: ActivityRoundData;
  results: ActivityRoundResult[];
  started_at: number;
  updated_at: number;
  /** Bumped on every applied action — a client ignores a session older than the one it has. */
  v: number;
}

/** Actions a client sends (`activity_action`). Which role may send which is checked by the engine. */
export type ActivityAction =
  // Host controls (any kind)
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'reset_round' }
  | { type: 'swap_roles' }
  | { type: 'restart' }
  | { type: 'finish' }
  // describe / quiz (the answerer)
  | { type: 'pick'; option: string }
  // quiz / dictation (the asker)
  | { type: 'ask' }
  | { type: 'play_audio' }
  | { type: 'reveal' }
  | { type: 'mark'; correct: boolean }
  // dictation (the writer)
  | { type: 'draft'; text: string }
  | { type: 'submit' }
  // build (either person)
  | { type: 'place'; tile: number }
  | { type: 'unplace'; tile: number }
  | { type: 'clear_tiles' }
  | { type: 'said' }
  // info_gap (the person who can't see the cell)
  | { type: 'fill'; cell: string; value: string | null }
  // roleplay (the speaker of the line, or the host)
  | { type: 'line_done' }
  | { type: 'line_back' };

/** What an activity left behind: kept with the lesson (review page, homework agent). */
export interface ActivitySummary {
  activity_id: string;
  kind: ActivityKind;
  title: string;
  /** Rounds played (not skipped) / of them scored and right. */
  played: number;
  scored: number;
  correct: number;
  total_rounds: number;
  finished: boolean;
  /** Who held which role: "a: Minghui (Describer)". */
  roles: string[];
  /** One readable line per round, e.g. "苹果 (píngguǒ) — picked 香蕉 ✗". */
  lines: string[];
}

/** Limits. */
export const MAX_DRAFT_CHARS = 120;
