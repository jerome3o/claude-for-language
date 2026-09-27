/**
 * Diff two study-state debug reports (./report.ts) — typically the Lab app's
 * against the web app's — and say where the "cards due" numbers part ways:
 * headline counts, per-deck pools / introduced-today / allocation / counts,
 * cards whose computed state differs, cards and review events only one side
 * has, and — when the server's own event list is passed in — which side is
 * missing events versus holding events it never uploaded.
 *
 * Pure: the worker (services/debug-reports.ts) loads the reports from R2 and
 * the server truth from D1; tests call it directly.
 */

import type { DebugCardRow, DebugDeckRow, DebugQueueCounts, DebugReport } from './report';
import { eventIdHash } from './report';

/** The server's view, for the "truth" columns. */
export interface ServerTruth {
  /** Every review event of the user, keyed by eventIdHash(id). */
  events: Map<string, { id: string; card_id: string; reviewed_at: string }>;
  /** Card ids the user owns on the server (optional). */
  card_ids?: Set<string>;
}

export interface CompareOptions {
  /** How many differing cards to list in full (default 40). */
  maxCards?: number;
  /** How many sample ids per one-sided list (default 20). */
  maxSamples?: number;
  server?: ServerTruth;
  /** Ids of the stored reports, echoed back. */
  ids?: { a?: string; b?: string };
}

export interface ValuePair<T = number | string | boolean | null> {
  a: T;
  b: T;
}

export interface CardSideState {
  queue: number;
  due_ms: number | null;
  due_iso: string | null;
  reps: number;
  lapses: number;
  events: number;
  in_due_queue: boolean;
  first_review_iso: string | null;
}

export interface CardDiff {
  card_id: string;
  note_id: string;
  deck_id: string;
  deck_name: string | null;
  card_type: string;
  differs: string[];
  a: CardSideState;
  b: CardSideState;
  /** The server's event count for this card (when server truth was given). */
  server_events?: number;
}

export interface EventSide {
  count: number;
  /** Of those, how many the server also has (the other side did not download them) / lacks (never uploaded). */
  on_server?: number;
  not_on_server?: number;
  sample: Array<{ hash: string; id?: string; card_id?: string; reviewed_at?: string; on_server?: boolean }>;
}

export interface DebugComparison {
  a: ReportMeta;
  b: ReportMeta;
  context: {
    minutes_apart: number;
    same_local_date: boolean;
    local_date: ValuePair<string>;
    timezone: ValuePair<string>;
    cutoff: ValuePair<string>;
    budget: ValuePair<string>;
    bonus_all: ValuePair<number>;
    introduced_basis: ValuePair<string>;
  };
  /** Every headline number side by side; `diff` = b − a. */
  headline: Record<string, { a: number; b: number; diff: number }>;
  decks: {
    compared: number;
    only_a: Array<{ id: string; name: string }>;
    only_b: Array<{ id: string; name: string }>;
    differing: Array<{ id: string; name: string; fields: Record<string, ValuePair<unknown>> }>;
  };
  cards: {
    compared: number;
    differing: number;
    by_field: Record<string, number>;
    /** "a→b" queue transitions among differing cards, e.g. "1→2": 12. */
    queue_changes: Record<string, number>;
    in_due_queue_only_a: number;
    in_due_queue_only_b: number;
    /** Differing cards whose event counts agree (same history, different computed state). */
    same_events_different_state: number;
    listed: CardDiff[];
    only_a: { count: number; in_due_queue: number; on_server?: number; sample: string[] };
    only_b: { count: number; in_due_queue: number; on_server?: number; sample: string[] };
  };
  events: {
    a_total: number;
    b_total: number;
    only_a: EventSide;
    only_b: EventSide;
    server?: { total: number; missing_from_a: number; missing_from_b: number; sample_missing_from_a: string[]; sample_missing_from_b: string[] };
  };
  /** Plain-language pointers derived from the numbers above. */
  hints: string[];
}

export interface ReportMeta {
  id?: string;
  client: string;
  app_version: string;
  generated_at: string;
  timezone: string;
}

const COUNT_KEYS: Array<keyof DebugQueueCounts> = ['new', 'secondaryNew', 'learning', 'review'];

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function sumCounts(c: DebugQueueCounts | undefined): number {
  if (!c) return 0;
  return (c.new ?? 0) + (c.secondaryNew ?? 0) + (c.learning ?? 0) + (c.review ?? 0);
}

function sideState(r: DebugCardRow): CardSideState {
  return {
    queue: r[4],
    due_ms: r[5],
    due_iso: iso(r[5]),
    reps: r[6],
    lapses: r[7],
    events: r[8],
    in_due_queue: r[9] === 1,
    first_review_iso: iso(r[10]),
  };
}

/** Learning cards (queue 1/3) whose due time is after the cutoff — due tomorrow or later. */
function learningAfterCutoff(r: DebugReport): number {
  let n = 0;
  for (const c of r.cards) if ((c[4] === 1 || c[4] === 3) && c[5] !== null && c[5] > r.cutoff.ms) n++;
  return n;
}

function meta(r: DebugReport, id?: string): ReportMeta {
  return {
    ...(id ? { id } : {}),
    client: r.client,
    app_version: r.app_version,
    generated_at: r.generated_at,
    timezone: `${r.timezone?.iana ?? '?'} (UTC${(r.timezone?.offset_minutes ?? 0) >= 0 ? '+' : ''}${(r.timezone?.offset_minutes ?? 0) / 60})`,
  };
}

function deckFields(d: DebugDeckRow): Record<string, unknown> {
  return {
    priority: d.priority,
    caps: `${d.caps.primary}+${d.caps.secondary}`,
    introduced_today: `${d.introduced_today.primary}+${d.introduced_today.secondary}`,
    pool_new: d.pools.totalNew,
    pool_secondary: d.pools.totalSecondaryNew,
    pool_learning: d.pools.learning,
    pool_review: d.pools.review,
    alloc: `${d.allocation.primary}+${d.allocation.secondary}`,
    shows_new: d.counts.new,
    shows_secondary: d.counts.secondaryNew,
    shows_learning: d.counts.learning,
    shows_review: d.counts.review,
    notes: d.note_count,
    cards: d.card_count,
  };
}

export function compareDebugReports(a: DebugReport, b: DebugReport, opts: CompareOptions = {}): DebugComparison {
  const maxCards = opts.maxCards ?? 40;
  const maxSamples = opts.maxSamples ?? 20;
  const server = opts.server;
  const hints: string[] = [];
  const A = a.client.toUpperCase();
  const B = b.client === a.client ? `${b.client.toUpperCase()}(2)` : b.client.toUpperCase();

  // ---------- context ----------
  const minutesApart = Math.round((Date.parse(b.generated_at) - Date.parse(a.generated_at)) / 60000);
  const context: DebugComparison['context'] = {
    minutes_apart: minutesApart,
    same_local_date: a.day_start.local_date === b.day_start.local_date,
    local_date: { a: a.day_start.local_date, b: b.day_start.local_date },
    timezone: { a: a.timezone.iana, b: b.timezone.iana },
    cutoff: { a: a.cutoff.iso, b: b.cutoff.iso },
    budget: {
      a: `${a.budget.new_cards_per_day}+${a.budget.secondary_cards_per_day}`,
      b: `${b.budget.new_cards_per_day}+${b.budget.secondary_cards_per_day}`,
    },
    bonus_all: { a: a.bonus.all, b: b.bonus.all },
    introduced_basis: { a: a.introduced_basis, b: b.introduced_basis },
  };
  if (Math.abs(minutesApart) > 30) {
    hints.push(`The reports were taken ${Math.abs(minutesApart)} min apart — reviews made in between explain part of any difference. Take both within a few minutes for a clean comparison.`);
  }
  if (!context.same_local_date) hints.push(`The reports are on different local dates (${a.day_start.local_date} vs ${b.day_start.local_date}); "today" means different things.`);
  if (context.budget.a !== context.budget.b) hints.push(`Daily budget differs: ${A} ${context.budget.a} vs ${B} ${context.budget.b}.`);
  if (a.bonus.all !== b.bonus.all) hints.push(`"Study 10 more" bonus differs: ${A} ${a.bonus.all} vs ${B} ${b.bonus.all}.`);

  // ---------- headline ----------
  const headline: DebugComparison['headline'] = {};
  const put = (k: string, x: number, y: number) => {
    headline[k] = { a: x, b: y, diff: y - x };
  };
  put('home.total', a.home.total, b.home.total);
  for (const k of COUNT_KEYS) put(`home.${k}`, Number(a.home.counts[k] ?? 0), Number(b.home.counts[k] ?? 0));
  const extraKeys = new Set([...Object.keys(a.home.extras ?? {}), ...Object.keys(b.home.extras ?? {})]);
  for (const k of extraKeys) put(`home.extras.${k}`, a.home.extras?.[k] ?? 0, b.home.extras?.[k] ?? 0);
  if (a.homework || b.homework) {
    put('homework.todo', a.homework?.todo ?? 0, b.homework?.todo ?? 0);
    put('homework.overdue', a.homework?.overdue ?? 0, b.homework?.overdue ?? 0);
  }
  put('queue.due_cards', a.queue.due_cards, b.queue.due_cards);
  for (const k of COUNT_KEYS) put(`queue.${k}`, Number(a.queue.from_due_cards[k] ?? 0), Number(b.queue.from_due_cards[k] ?? 0));
  for (const k of ['decks', 'notes', 'cards', 'events', 'unsynced_events', 'pending_deletions', 'orphan_events'] as const) {
    put(`totals.${k}`, a.totals[k] ?? 0, b.totals[k] ?? 0);
  }
  const laA = learningAfterCutoff(a);
  const laB = learningAfterCutoff(b);
  put('cards.learning_due_after_cutoff', laA, laB);

  if (a.home.total !== b.home.total) {
    const parts = COUNT_KEYS.map(k => ({ k, d: Number(b.home.counts[k] ?? 0) - Number(a.home.counts[k] ?? 0) })).filter(p => p.d !== 0);
    hints.push(
      `Home total ${A} ${a.home.total} vs ${B} ${b.home.total} (${B} − ${A} = ${b.home.total - a.home.total}): ` +
        (parts.length ? parts.map(p => `${p.k} ${p.d > 0 ? '+' : ''}${p.d}`).join(', ') : 'no single count differs') +
        '.'
    );
  }
  for (const [r, other, label, otherLabel] of [[a, b, A, B], [b, a, B, A]] as const) {
    if (r.homework && !other.homework && r.homework.todo > 0) {
      hints.push(`${label} shows ${r.homework.todo} homework item(s) to do; ${otherLabel} does not report homework at all (it has no homework screen yet).`);
    }
  }
  for (const [r, label] of [[a, A], [b, B]] as const) {
    const extras =Object.entries(r.home.extras ?? {}).filter(([, v]) => v > 0);
    if (extras.length) hints.push(`${label}'s home total includes non-card items: ${extras.map(([k, v]) => `${k} ${v}`).join(', ')}.`);
    const homeLearning = Number(r.home.counts.learning ?? 0);
    const dueLearning = Number(r.queue.from_due_cards.learning ?? 0);
    if (homeLearning !== dueLearning) {
      hints.push(`${label}'s home shows ${homeLearning} learning but its study queue holds ${dueLearning} learning cards (${learningAfterCutoff(r)} learning cards are due after the cutoff).`);
    }
    const homeSum = sumCounts(r.home.counts);
    if (homeSum !== r.queue.due_cards) {
      hints.push(`${label}'s home counts add up to ${homeSum} but its study queue would hold ${r.queue.due_cards} cards.`);
    }
  }

  // ---------- decks ----------
  const decksA = new Map(a.decks.map(d => [d.id, d]));
  const decksB = new Map(b.decks.map(d => [d.id, d]));
  const deckName = (id: string) => decksA.get(id)?.name ?? decksB.get(id)?.name ?? null;
  const deckOut: DebugComparison['decks'] = { compared: 0, only_a: [], only_b: [], differing: [] };
  for (const d of a.decks) if (!decksB.has(d.id)) deckOut.only_a.push({ id: d.id, name: d.name });
  for (const d of b.decks) if (!decksA.has(d.id)) deckOut.only_b.push({ id: d.id, name: d.name });
  for (const da of a.decks) {
    const db = decksB.get(da.id);
    if (!db) continue;
    deckOut.compared++;
    const fa = deckFields(da);
    const fb = deckFields(db);
    const fields: Record<string, ValuePair<unknown>> = {};
    for (const k of Object.keys(fa)) if (fa[k] !== fb[k]) fields[k] = { a: fa[k], b: fb[k] };
    if (Object.keys(fields).length) deckOut.differing.push({ id: da.id, name: da.name, fields });
  }
  if (deckOut.only_a.length || deckOut.only_b.length) {
    hints.push(`Decks on one side only: ${A} ${deckOut.only_a.length}, ${B} ${deckOut.only_b.length}.`);
  }
  const introDiff = deckOut.differing.filter(d => 'introduced_today' in d.fields);
  if (introDiff.length) {
    hints.push(`"Introduced today" differs in ${introDiff.length} deck(s) (${introDiff.map(d => `${d.name}: ${d.fields.introduced_today.a} vs ${d.fields.introduced_today.b}`).join('; ')}) — that changes how much of the budget is left.`);
  }
  for (const [r, label] of [[a, A], [b, B]] as const) {
    const drift = r.decks.filter(
      d => d.introduced_today_from_events &&
        (d.introduced_today_from_events.primary !== d.introduced_today.primary ||
          d.introduced_today_from_events.secondary !== d.introduced_today.secondary)
    );
    if (drift.length) {
      hints.push(`${label}'s introduced-today counter disagrees with its own review events in ${drift.length} deck(s): ${drift.map(d => `${d.name} counter ${d.introduced_today.primary}+${d.introduced_today.secondary} vs events ${d.introduced_today_from_events!.primary}+${d.introduced_today_from_events!.secondary}`).join('; ')}.`);
    }
  }

  // ---------- cards ----------
  const cardsA = new Map(a.cards.map(c => [c[0], c]));
  const cardsB = new Map(b.cards.map(c => [c[0], c]));
  const byField: Record<string, number> = {};
  const queueChanges: Record<string, number> = {};
  const diffs: CardDiff[] = [];
  let compared = 0;
  let inQueueOnlyA = 0;
  let inQueueOnlyB = 0;
  let sameEventsDifferentState = 0;
  const serverCardEvents = new Map<string, number>();
  if (server) for (const e of server.events.values()) serverCardEvents.set(e.card_id, (serverCardEvents.get(e.card_id) ?? 0) + 1);

  for (const ca of a.cards) {
    const cb = cardsB.get(ca[0]);
    if (!cb) continue;
    compared++;
    const differs: string[] = [];
    if (ca[2] !== cb[2]) differs.push('deck');
    if (ca[4] !== cb[4]) differs.push('queue');
    if (ca[5] !== cb[5]) differs.push('due');
    if (ca[6] !== cb[6]) differs.push('reps');
    if (ca[7] !== cb[7]) differs.push('lapses');
    if (ca[8] !== cb[8]) differs.push('events');
    if (ca[9] !== cb[9]) differs.push('in_due_queue');
    if (ca[10] !== cb[10]) differs.push('first_review');
    if (!differs.length) continue;
    for (const f of differs) byField[f] = (byField[f] ?? 0) + 1;
    if (ca[4] !== cb[4]) queueChanges[`${ca[4]}→${cb[4]}`] = (queueChanges[`${ca[4]}→${cb[4]}`] ?? 0) + 1;
    if (ca[9] === 1 && cb[9] === 0) inQueueOnlyA++;
    if (ca[9] === 0 && cb[9] === 1) inQueueOnlyB++;
    if (ca[8] === cb[8] && differs.some(f => f !== 'in_due_queue' && f !== 'deck')) sameEventsDifferentState++;
    diffs.push({
      card_id: ca[0],
      note_id: ca[1],
      deck_id: ca[2],
      deck_name: deckName(ca[2]),
      card_type: ca[3],
      differs,
      a: sideState(ca),
      b: sideState(cb),
      ...(server ? { server_events: serverCardEvents.get(ca[0]) ?? 0 } : {}),
    });
  }
  // Most explanatory first: the ones that change the due count, then state, then the rest.
  const rank = (d: CardDiff) =>
    (d.differs.includes('in_due_queue') ? 0 : 4) + (d.differs.includes('events') ? 0 : 2) + (d.differs.includes('queue') ? 0 : 1);
  diffs.sort((x, y) => rank(x) - rank(y) || x.card_id.localeCompare(y.card_id));

  const onlyCards = (mine: DebugReport, other: Map<string, DebugCardRow>) => {
    const rows = mine.cards.filter(c => !other.has(c[0]));
    return {
      count: rows.length,
      in_due_queue: rows.filter(c => c[9] === 1).length,
      ...(server?.card_ids ? { on_server: rows.filter(c => server.card_ids!.has(c[0])).length } : {}),
      sample: rows.slice(0, maxSamples).map(c => c[0]),
    };
  };
  const cardsOut: DebugComparison['cards'] = {
    compared,
    differing: diffs.length,
    by_field: byField,
    queue_changes: queueChanges,
    in_due_queue_only_a: inQueueOnlyA,
    in_due_queue_only_b: inQueueOnlyB,
    same_events_different_state: sameEventsDifferentState,
    listed: diffs.slice(0, maxCards),
    only_a: onlyCards(a, cardsB),
    only_b: onlyCards(b, cardsA),
  };
  if (inQueueOnlyA || inQueueOnlyB) {
    hints.push(`Of the cards both sides have, ${inQueueOnlyA} are in ${A}'s study queue only and ${inQueueOnlyB} in ${B}'s only.`);
  }
  if (byField.events) hints.push(`${byField.events} card(s) have a different number of review events on each side — the event sets differ (see events).`);
  if (sameEventsDifferentState) {
    hints.push(`${sameEventsDifferentState} card(s) have the SAME number of events but a different computed state — a stale cached state or a replay difference, not missing events.`);
  }
  if (cardsOut.only_a.count || cardsOut.only_b.count) {
    hints.push(`Cards on one side only: ${A} ${cardsOut.only_a.count} (${cardsOut.only_a.in_due_queue} in its queue), ${B} ${cardsOut.only_b.count} (${cardsOut.only_b.in_due_queue} in its queue).`);
  }

  // ---------- events ----------
  const hashesA = new Set(a.event_hashes);
  const hashesB = new Set(b.event_hashes);
  const eventSide = (mine: Set<string>, other: Set<string>): EventSide => {
    const only = [...mine].filter(h => !other.has(h)).sort();
    const out: EventSide = { count: only.length, sample: [] };
    if (server) {
      let on = 0;
      for (const h of only) if (server.events.has(h)) on++;
      out.on_server = on;
      out.not_on_server = only.length - on;
    }
    out.sample = only.slice(0, maxSamples).map(h => {
      const s = server?.events.get(h);
      return s ? { hash: h, id: s.id, card_id: s.card_id, reviewed_at: s.reviewed_at, on_server: true } : { hash: h, ...(server ? { on_server: false } : {}) };
    });
    return out;
  };
  const eventsOut: DebugComparison['events'] = {
    a_total: a.event_hashes.length,
    b_total: b.event_hashes.length,
    only_a: eventSide(hashesA, hashesB),
    only_b: eventSide(hashesB, hashesA),
  };
  if (server) {
    const missing = (mine: Set<string>) => [...server.events.keys()].filter(h => !mine.has(h));
    const mA = missing(hashesA);
    const mB = missing(hashesB);
    eventsOut.server = {
      total: server.events.size,
      missing_from_a: mA.length,
      missing_from_b: mB.length,
      sample_missing_from_a: mA.slice(0, maxSamples).map(h => server.events.get(h)!.id),
      sample_missing_from_b: mB.slice(0, maxSamples).map(h => server.events.get(h)!.id),
    };
    if (mA.length) hints.push(`${A} is missing ${mA.length} review event(s) the server has (not downloaded yet, or its event cursor skipped them).`);
    if (mB.length) hints.push(`${B} is missing ${mB.length} review event(s) the server has (not downloaded yet, or its event cursor skipped them).`);
    if (eventsOut.only_a.not_on_server) hints.push(`${A} holds ${eventsOut.only_a.not_on_server} event(s) the server does not have (never uploaded, or undone elsewhere).`);
    if (eventsOut.only_b.not_on_server) hints.push(`${B} holds ${eventsOut.only_b.not_on_server} event(s) the server does not have (never uploaded, or undone elsewhere).`);
  } else if (eventsOut.only_a.count || eventsOut.only_b.count) {
    hints.push(`Review events on one side only: ${A} ${eventsOut.only_a.count}, ${B} ${eventsOut.only_b.count}.`);
  }
  if (!hints.length) hints.push('No differences found.');

  return {
    a: meta(a, opts.ids?.a),
    b: meta(b, opts.ids?.b),
    context,
    headline,
    decks: deckOut,
    cards: cardsOut,
    events: eventsOut,
    hints,
  };
}

/** Build a ServerTruth from raw rows (the worker's D1 query). */
export function serverTruthFromRows(
  events: Array<{ id: string; card_id: string; reviewed_at: string }>,
  cardIds?: Iterable<string>
): ServerTruth {
  const map = new Map<string, { id: string; card_id: string; reviewed_at: string }>();
  for (const e of events) map.set(eventIdHash(e.id), { id: e.id, card_id: e.card_id, reviewed_at: e.reviewed_at });
  return { events: map, ...(cardIds ? { card_ids: new Set(cardIds) } : {}) };
}
