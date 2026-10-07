/**
 * Study-state debug reports: ONE shape that the web app (IndexedDB) and the
 * native Lab app (Room, android-lab/app/…/data/DebugReport.kt mirrors it) both
 * build from the same functions their home screen and study queue use, upload
 * to `POST /api/debug/reports`, and the worker diffs with `compareDebugReports`
 * (./compare.ts) — so "the two apps show a different number of cards due" can
 * be answered with data instead of guesses.
 *
 * Keep this file and DebugReport.kt in step; bump DEBUG_REPORT_VERSION when a
 * field changes meaning.
 */

export const DEBUG_REPORT_VERSION = 1;

export type DebugClient = 'lab' | 'web';

export const DEBUG_CLIENTS: readonly DebugClient[] = ['lab', 'web'];

/** Queue counts as a screen shows them. */
export interface DebugQueueCounts {
  new: number;
  secondaryNew: number;
  learning: number;
  review: number;
  hasMoreNew?: boolean;
}

/** Column order of `DebugReport.cards` rows. */
export const DEBUG_CARD_COLUMNS = [
  'card_id',
  'note_id',
  'deck_id',
  'card_type',
  'queue',
  'due_ms',
  'reps',
  'lapses',
  'event_count',
  'in_due_queue',
  'first_review_ms',
] as const;

/**
 * One card: [card_id, note_id, deck_id, card_type, queue (0 new, 1 learning,
 * 2 review, 3 relearning), due_ms (epoch ms the queue compares with the
 * cutoff; null for NEW), reps, lapses, local event count, in_due_queue (1 when
 * today's study queue — all decks, today's bonus — contains it), first review
 * (epoch ms, null when never reviewed)].
 */
export type DebugCardRow = [
  string,
  string,
  string,
  string,
  number,
  number | null,
  number,
  number,
  number,
  0 | 1,
  number | null,
];

export interface DebugDeckRow {
  id: string;
  name: string;
  priority: number;
  created_at: string;
  /** The deck's own caps (secondary falls back to 10 on rows without the column). */
  caps: { primary: number; secondary: number };
  /** New cards introduced today as the QUEUE counted them (web: dailyStats counter; lab: derived from events). */
  introduced_today: { primary: number; secondary: number };
  /** Web only: the same number recomputed from review events (differs from the counter when it drifted). */
  introduced_today_from_events?: { primary: number; secondary: number };
  /** Raw pools before the budget: NEW cards on unseen notes / started notes, learning + review due. */
  pools: { totalNew: number; totalSecondaryNew: number; learning: number; review: number };
  /** What the global budget gives this deck today (all-decks view, today's "all" bonus). */
  allocation: { primary: number; secondary: number };
  /** The counts this deck's row shows on the home / decks screen. */
  counts: DebugQueueCounts;
  note_count: number;
  card_count: number;
}

export interface DebugReport {
  version: number;
  client: DebugClient;
  app_version: string;
  generated_at: string;
  timezone: { iana: string; offset_minutes: number };
  now_ms: number;
  /** "Due today" cutoff: the later of local 23:59:59.999 and now + 1 h. */
  cutoff: { ms: number; iso: string };
  /** Local midnight today (the basis for "introduced today" — see `introduced_basis`). */
  day_start: { ms: number; iso: string; local_date: string };
  /** How this client decides what was introduced today (free text, e.g. "dailyStats counter"). */
  introduced_basis: string;
  budget: { new_cards_per_day: number; secondary_cards_per_day: number };
  /** "Order new cards by" (shared/decks/new-card-order.ts) as this device applies it; absent in older reports. */
  new_card_order?: { new_characters_first: boolean; new_words_first: boolean; most_common_first: boolean; sentences_last: boolean };
  /** "Study 10 more" bonuses in effect: all-decks bonus + per deck, and the day key they are stored under. */
  bonus: { all: number; by_deck: Record<string, number>; day_key: string };
  /** Client-specific sync cursors / state (free-form). */
  sync: Record<string, unknown>;
  totals: {
    decks: number;
    notes: number;
    cards: number;
    events: number;
    unsynced_events: number;
    pending_deletions: number;
    /** Events whose card is not on this device. */
    orphan_events: number;
    earliest_reviewed_at: string | null;
    latest_reviewed_at: string | null;
  };
  /** Exactly what the home screen's Study button shows. */
  home: {
    total: number;
    counts: DebugQueueCounts;
    /** Things added to the home total that are not cards (web: due graded readers). */
    extras: Record<string, number>;
    note?: string;
  };
  /** The study queue a session started now would get (all decks, today's bonus). */
  queue: {
    due_cards: number;
    /** Counted from the due cards themselves. */
    from_due_cards: DebugQueueCounts;
    /** The counts the queue builder reports alongside (web: raw learning counts; lab: same as from_due_cards). */
    reported: DebugQueueCounts;
  };
  /**
   * One-off homework (docs/HOMEWORK.md) as the home screen's Homework card
   * shows it. Not part of the card count; omitted by clients without homework.
   */
  homework?: { todo: number; overdue: number; due_today: number; done: number };
  decks: DebugDeckRow[];
  card_columns: readonly string[];
  cards: DebugCardRow[];
  /** `eventIdHash` of every local review event, sorted (compact set for the diff; the server resolves them to ids). */
  event_hashes: string[];
  /** Anything else worth knowing (free-form). */
  notes?: Record<string, unknown>;
  /**
   * Crashes since the last report (Lab: CrashLog.kt): uncaught exceptions written before the
   * process died, non-fatal background failures, and the system's exit records (crash / ANR).
   */
  crashes?: DebugCrash[];
}

export interface DebugCrash {
  /** 'uncaught' (our handler, thread "non-fatal: …" = caught background failure) | 'exit_info' (Android ApplicationExitInfo). */
  source: string;
  at: string;
  app_version?: string;
  thread?: string;
  /** exit_info: crash | crash_native | anr | initialization_failure. */
  reason?: string;
  description?: string;
  trace?: string;
}

/** The small summary stored in the D1 index row. */
export interface DebugReportSummary {
  generated_at: string;
  timezone: string;
  home_total: number;
  home: DebugQueueCounts;
  queue_due_cards: number;
  decks: number;
  cards: number;
  events: number;
  unsynced_events: number;
  latest_reviewed_at: string | null;
  /** Present when the report carried crashes: when, what, and the top of each trace. */
  crashes?: Array<{ at: string; source: string; reason?: string; app_version?: string; head: string }>;
}

export function summarizeDebugReport(r: DebugReport): DebugReportSummary {
  return {
    generated_at: r.generated_at,
    timezone: r.timezone?.iana ?? '',
    home_total: r.home?.total ?? 0,
    home: r.home?.counts ?? { new: 0, secondaryNew: 0, learning: 0, review: 0 },
    queue_due_cards: r.queue?.due_cards ?? 0,
    decks: r.totals?.decks ?? 0,
    cards: r.totals?.cards ?? 0,
    events: r.totals?.events ?? 0,
    unsynced_events: r.totals?.unsynced_events ?? 0,
    latest_reviewed_at: r.totals?.latest_reviewed_at ?? null,
    ...(Array.isArray(r.crashes) && r.crashes.length
      ? {
          crashes: r.crashes.slice(0, 10).map((c) => ({
            at: String(c?.at ?? ''),
            source: String(c?.source ?? ''),
            ...(c?.reason ? { reason: String(c.reason) } : {}),
            ...(c?.app_version ? { app_version: String(c.app_version) } : {}),
            head: String(c?.trace || c?.description || '').slice(0, 1500),
          })),
        }
      : {}),
  };
}

/**
 * Short, stable hash of a review-event id: FNV-1a (32-bit) over UTF-16 code
 * units, as 8 lowercase hex digits. The Lab app computes the identical value
 * (DebugReport.kt `eventIdHash`); both are checked against EVENT_HASH_VECTORS.
 */
export function eventIdHash(id: string): string {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Known answers for eventIdHash, shared with the Kotlin test. */
export const EVENT_HASH_VECTORS: ReadonlyArray<[string, string]> = [
  ['', '811c9dc5'],
  ['a', 'e40c292c'],
  ['foobar', 'bf9cf968'],
  ['3f2b8c1e-9d4a-4e6b-8f0a-1c2d3e4f5a6b', 'd04aef6b'],
  ['学习', 'cb323bfb'],
];

/** Pure structural check of an uploaded report; returns problems (empty = fine). */
export function validateDebugReport(r: unknown): string[] {
  const problems: string[] = [];
  if (!r || typeof r !== 'object') return ['report must be an object'];
  const o = r as Record<string, unknown>;
  if (!DEBUG_CLIENTS.includes(o.client as DebugClient)) problems.push('client must be "lab" or "web"');
  if (typeof o.generated_at !== 'string') problems.push('generated_at must be a string');
  if (!Array.isArray(o.cards)) problems.push('cards must be an array');
  if (!Array.isArray(o.decks)) problems.push('decks must be an array');
  if (!Array.isArray(o.event_hashes)) problems.push('event_hashes must be an array');
  if (!o.home || typeof o.home !== 'object') problems.push('home must be an object');
  if (!o.totals || typeof o.totals !== 'object') problems.push('totals must be an object');
  return problems;
}
