/**
 * Suspend & snooze (migration 0135 `card_holds`, shared/decks/holds.ts; docs/STUDY_SESSION.md
 * "Suspend & snooze"). The server only keeps the rows: every device derives which cards are
 * held TODAY from its own local date and leaves them out of its queue (shared rule). Holds
 * never write a review event and never touch a card's state.
 *
 * Idempotent by client id: a hold whose id exists is "already". A new hold on a card clears
 * the card's older active holds; a clear covers holds made at or before it (a hold made on
 * another device after the clear survives).
 */
import { isLocalDate, type HoldKind } from '@shared/decks';
import { normalizeHanzi } from '@shared/import/parse';

export const MAX_HOLDS_PER_REQUEST = 200;

/** One active hold with what the "Suspended & snoozed cards" list shows. */
export interface CardHoldRow {
  id: string;
  card_id: string;
  kind: HoldKind;
  until: string | null;
  source: string | null;
  created_at: string;
  note_id: string;
  card_type: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface HoldInputItem {
  /** Client id (offline outbox); a retry with the same id is a no-op. */
  id?: string;
  card_id: string;
  kind: string;
  /** Snooze: the local date it ends ("YYYY-MM-DD"). */
  until?: string | null;
  created_at?: string;
  source?: string;
}

export interface HoldResult {
  holds: CardHoldRow[];
  /** Cards newly held. */
  added: string[];
  /** Holds already stored (same client id) — nothing changed. */
  already: string[];
  /** card ids / note ids / hanzi that matched none of the user's cards. */
  not_found: string[];
  /** Items refused (bad kind / date). */
  invalid: Array<{ card_id: string; error: string }>;
}

const isoNow = () => new Date().toISOString();

function validIso(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  // Never in the future: a device clock ahead would make a later clear miss it.
  return new Date(Math.min(ms, Date.now())).toISOString();
}

function chunks<T>(xs: T[], n = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** The user's cards with these ids → note id. */
async function ownedCards(db: D1Database, userId: string, cardIds: string[]): Promise<Map<string, { note_id: string; card_type: string }>> {
  const out = new Map<string, { note_id: string; card_type: string }>();
  for (const chunk of chunks([...new Set(cardIds)])) {
    const res = await db
      .prepare(
        `SELECT c.id, c.note_id, c.card_type FROM cards c JOIN notes n ON n.id = c.note_id JOIN decks d ON d.id = n.deck_id
         WHERE d.user_id = ? AND c.id IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(userId, ...chunk)
      .all<{ id: string; note_id: string; card_type: string }>();
    for (const r of res.results ?? []) out.set(r.id, { note_id: r.note_id, card_type: r.card_type });
  }
  return out;
}

/** Every card of the user's notes with these ids (optionally only some card types). */
export async function cardsOfNotes(db: D1Database, userId: string, noteIds: string[], cardTypes?: string[] | null): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunks([...new Set(noteIds)])) {
    const res = await db
      .prepare(
        `SELECT c.id, c.card_type FROM cards c JOIN notes n ON n.id = c.note_id JOIN decks d ON d.id = n.deck_id
         WHERE d.user_id = ? AND c.note_id IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(userId, ...chunk)
      .all<{ id: string; card_type: string }>();
    for (const r of res.results ?? []) if (!cardTypes?.length || cardTypes.includes(r.card_type)) out.push(r.id);
  }
  return out;
}

/** The user's notes spelled like `hanzi` (punctuation / spaces ignored) → note ids, plus the hanzi that matched nothing. */
export async function notesByHanzi(db: D1Database, userId: string, hanzi: string[]): Promise<{ noteIds: string[]; notFound: string[] }> {
  if (hanzi.length === 0) return { noteIds: [], notFound: [] };
  const wanted = new Map(hanzi.map(h => [normalizeHanzi(h), h]));
  const res = await db
    .prepare('SELECT n.id, n.hanzi FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ?')
    .bind(userId)
    .all<{ id: string; hanzi: string }>();
  const found = new Set<string>();
  const noteIds: string[] = [];
  for (const n of res.results ?? []) {
    const key = normalizeHanzi(n.hanzi ?? '');
    if (wanted.has(key)) {
      noteIds.push(n.id);
      found.add(key);
    }
  }
  return { noteIds, notFound: [...wanted].filter(([k]) => !found.has(k)).map(([, h]) => h) };
}

/** Every active (not cleared) hold of the user, with the card's note and deck. Snoozes long over are left out. */
export async function listActiveHolds(db: D1Database, userId: string): Promise<CardHoldRow[]> {
  const res = await db
    .prepare(
      `SELECT h.id, h.card_id, h.kind, h.until, h.source, h.created_at,
              c.note_id, c.card_type, n.hanzi, n.pinyin, n.english, d.id AS deck_id, d.name AS deck_name
       FROM card_holds h
       JOIN cards c ON c.id = h.card_id
       JOIN notes n ON n.id = c.note_id
       JOIN decks d ON d.id = n.deck_id
       WHERE h.user_id = ? AND h.cleared_at IS NULL AND d.user_id = ?
         AND (h.kind = 'suspend' OR h.until >= date('now', '-2 days'))
       ORDER BY h.created_at DESC`
    )
    .bind(userId, userId)
    .all<CardHoldRow>();
  return (res.results ?? []).map(r => ({ ...r, kind: r.kind === 'snooze' ? 'snooze' : 'suspend' }));
}

/** Hold cards (suspend / snooze). Each item's card must be the user's. */
export async function addHolds(db: D1Database, userId: string, items: HoldInputItem[]): Promise<HoldResult> {
  const result: HoldResult = { holds: [], added: [], already: [], not_found: [], invalid: [] };
  const owned = await ownedCards(db, userId, items.map(i => i.card_id));
  const ids = items.map(i => i.id).filter((x): x is string => typeof x === 'string' && !!x);
  const existing = new Set<string>();
  for (const chunk of chunks(ids)) {
    const res = await db
      .prepare(`SELECT id FROM card_holds WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ id: string }>();
    for (const r of res.results ?? []) existing.add(r.id);
  }
  const statements: D1PreparedStatement[] = [];
  for (const item of items) {
    if (!owned.has(item.card_id)) {
      result.not_found.push(item.card_id);
      continue;
    }
    const kind = item.kind === 'suspend' || item.kind === 'snooze' ? item.kind : null;
    if (!kind) {
      result.invalid.push({ card_id: item.card_id, error: "kind must be 'suspend' or 'snooze'" });
      continue;
    }
    const until = kind === 'snooze' ? item.until : null;
    if (kind === 'snooze' && !isLocalDate(until)) {
      result.invalid.push({ card_id: item.card_id, error: 'A snooze needs until as a date (YYYY-MM-DD)' });
      continue;
    }
    if (item.id && existing.has(item.id)) {
      result.already.push(item.card_id);
      continue;
    }
    const id = item.id || crypto.randomUUID();
    const createdAt = validIso(item.created_at) ?? isoNow();
    // The newest hold on a card is the one that counts: older active ones are cleared.
    statements.push(
      db
        .prepare(`UPDATE card_holds SET cleared_at = ?, updated_at = datetime('now') WHERE user_id = ? AND card_id = ? AND cleared_at IS NULL AND created_at <= ?`)
        .bind(createdAt, userId, item.card_id, createdAt)
    );
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO card_holds (id, user_id, card_id, kind, until, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, userId, item.card_id, kind, until ?? null, typeof item.source === 'string' ? item.source.slice(0, 40) : null, createdAt)
    );
    existing.add(id);
    result.added.push(item.card_id);
  }
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  result.holds = await listActiveHolds(db, userId);
  return result;
}

/**
 * Unsuspend / Wake now: clear the active holds of these cards made at or before `clearedAt`
 * (default now). `kind` limits it to one kind. Returns how many holds were cleared.
 */
export async function clearHolds(db: D1Database, userId: string, cardIds: string[], clearedAt?: string | null, kind?: HoldKind | null): Promise<number> {
  const at = validIso(clearedAt) ?? isoNow();
  let cleared = 0;
  for (const chunk of chunks([...new Set(cardIds)])) {
    const res = await db
      .prepare(
        `UPDATE card_holds SET cleared_at = ?, updated_at = datetime('now')
         WHERE user_id = ? AND cleared_at IS NULL AND created_at <= ? ${kind ? 'AND kind = ?' : ''}
           AND card_id IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(at, userId, at, ...(kind ? [kind] : []), ...chunk)
      .run();
    cleared += res.meta?.changes ?? 0;
  }
  return cleared;
}

/** "Don't show a word's other card types on the same day" — the account's switch (default off). */
export async function getBurySiblings(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT bury_siblings FROM users WHERE id = ?').bind(userId).first<{ bury_siblings: number | null }>();
  return Number(row?.bury_siblings) === 1;
}

export async function setBurySiblings(db: D1Database, userId: string, on: boolean | null): Promise<boolean> {
  await db.prepare('UPDATE users SET bury_siblings = ? WHERE id = ?').bind(on === null ? null : on ? 1 : 0, userId).run();
  return on === true;
}
