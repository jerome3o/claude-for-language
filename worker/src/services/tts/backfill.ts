/**
 * The audio backlog (docs/AUDIO.md "Backfill"): which stored clips still need
 * MiniMax work, in the order they should get it, and how big the backlog is.
 *
 * Tiers, each word → card sentence → sentence set:
 *   1. due_soon      — missing clips of notes with a card due within 48 h
 *   2. active_users  — missing clips in Jerome's / recently active accounts
 *   3. missing       — every other missing clip
 *   4. google        — clips the Google fallback made (unless Google's are current)
 *   5. old_voice     — clips made with settings that aren't current (NULL = before
 *                      provenance; a backup provider's once the first one is back)
 * "Current" = the signature starts with one of `acceptableHashes`
 * (services/tts/config.ts `storedClipPolicy`).
 * A clip that failed (not a rate limit) waits out its retry time in
 * tts_clip_failures before it is picked again.
 */
import type { ClipKind, ClipTarget } from './clips';

export type BackfillTier = 'due_soon' | 'active_users' | 'missing' | 'google' | 'old_voice';
export const BACKFILL_TIERS: BackfillTier[] = ['due_soon', 'active_users', 'missing', 'google', 'old_voice'];
export const CLIP_KINDS: ClipKind[] = ['word', 'clue', 'sentence'];

export interface BackfillItem extends ClipTarget {
  tier: BackfillTier;
}

export const DUE_SOON_MS = 48 * 3600_000;
export const ACTIVE_USER_MS = 7 * 24 * 3600_000;

interface KindSql {
  from: string;
  id: string;
  url: string;
  provider: string;
  settings: string;
  order: string;
  noteId: string;
}

const KIND_SQL: Record<ClipKind, KindSql> = {
  word: {
    from: "notes n JOIN decks d ON d.id = n.deck_id WHERE TRIM(n.hanzi) != ''",
    id: 'n.id', url: 'n.audio_url', provider: 'n.audio_provider', settings: 'n.audio_settings',
    order: 'n.updated_at DESC, n.id', noteId: 'n.id',
  },
  clue: {
    from: "notes n JOIN decks d ON d.id = n.deck_id WHERE n.sentence_clue IS NOT NULL AND TRIM(n.sentence_clue) != ''",
    id: 'n.id', url: 'n.sentence_clue_audio_url', provider: 'n.sentence_clue_audio_provider', settings: 'n.sentence_clue_audio_settings',
    order: 'n.updated_at DESC, n.id', noteId: 'n.id',
  },
  sentence: {
    from: "note_sentences s JOIN notes n ON n.id = s.note_id JOIN decks d ON d.id = n.deck_id WHERE TRIM(s.hanzi) != ''",
    id: 's.id', url: 's.audio_url', provider: 's.audio_provider', settings: 's.audio_settings',
    order: 's.note_id, s.position, s.id', noteId: 'n.id',
  },
};

/** SQL condition + params for "this clip needs work in this tier". */
export function tierCondition(
  tier: BackfillTier,
  kind: ClipKind,
  ctx: { nowIso: string; dueBeforeIso: string; userIds: string[]; settingsHash?: string; acceptableHashes?: string[] },
): { sql: string; params: unknown[] } {
  const k = KIND_SQL[kind];
  const missing = `${k.url} IS NULL`;
  const hashes = hashesOf(ctx);
  const notCurrent = `(${k.settings} IS NULL OR NOT (${hashes.map(() => `${k.settings} LIKE ?`).join(' OR ')}))`;
  const hashParams = hashes.map((h) => `${h}.%`);
  switch (tier) {
    case 'due_soon':
      return {
        sql: `${missing} AND EXISTS (SELECT 1 FROM cards c WHERE c.note_id = ${k.noteId} AND c.queue != 0 AND c.next_review_at IS NOT NULL AND c.next_review_at <= ?)`,
        params: [ctx.dueBeforeIso],
      };
    case 'active_users':
      if (ctx.userIds.length === 0) return { sql: '0', params: [] };
      return { sql: `${missing} AND d.user_id IN (${ctx.userIds.map(() => '?').join(', ')})`, params: ctx.userIds };
    case 'missing':
      return { sql: missing, params: [] };
    case 'google':
      return { sql: `${k.url} IS NOT NULL AND ${k.provider} = 'gtts' AND ${notCurrent}`, params: hashParams };
    case 'old_voice':
      return {
        sql: `${k.url} IS NOT NULL AND COALESCE(${k.provider}, '') != 'gtts' AND ${notCurrent}`,
        params: hashParams,
      };
  }
}

/** The settings hashes whose clips are current (one, or the providers' list). */
function hashesOf(ctx: { settingsHash?: string; acceptableHashes?: string[] }): string[] {
  const list = ctx.acceptableHashes?.length ? ctx.acceptableHashes : ctx.settingsHash ? [ctx.settingsHash] : [];
  return list.length ? list : ['s-none'];
}

function notWaiting(kind: ClipKind): string {
  return `NOT EXISTS (SELECT 1 FROM tts_clip_failures f WHERE f.kind = '${kind}' AND f.target_id = ${KIND_SQL[kind].id} AND f.next_attempt_at > ?)`;
}

/** Jerome (ADMIN_EMAIL) + anyone who opened the app in the last week. */
export async function priorityUserIds(db: D1Database, adminEmail: string | undefined, now: number): Promise<string[]> {
  const since = new Date(now - ACTIVE_USER_MS).toISOString();
  const rows = await db
    .prepare('SELECT id FROM users WHERE (email = ? AND email IS NOT NULL) OR (last_opened_at IS NOT NULL AND last_opened_at >= ?) LIMIT 50')
    .bind(adminEmail ?? '', since)
    .all<{ id: string }>();
  return (rows.results || []).map((r) => r.id);
}

/** The next `limit` clips to make, in priority order, each target once. */
export async function selectBackfill(
  db: D1Database,
  opts: { now: number; limit: number; userIds: string[]; settingsHash?: string; acceptableHashes?: string[] },
): Promise<BackfillItem[]> {
  const ctx = {
    nowIso: new Date(opts.now).toISOString(),
    dueBeforeIso: new Date(opts.now + DUE_SOON_MS).toISOString(),
    userIds: opts.userIds,
    settingsHash: opts.settingsHash,
    acceptableHashes: opts.acceptableHashes,
  };
  const out: BackfillItem[] = [];
  const seen = new Set<string>();
  for (const tier of BACKFILL_TIERS) {
    for (const kind of CLIP_KINDS) {
      if (out.length >= opts.limit) return out;
      const cond = tierCondition(tier, kind, ctx);
      if (cond.sql === '0') continue;
      const k = KIND_SQL[kind];
      const rows = await db
        .prepare(`SELECT ${k.id} AS id FROM ${k.from} AND ${cond.sql} AND ${notWaiting(kind)} ORDER BY ${k.order} LIMIT ?`)
        .bind(...cond.params, ctx.nowIso, opts.limit)
        .all<{ id: string }>();
      for (const r of rows.results || []) {
        const key = `${kind}:${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind, id: r.id, tier });
        if (out.length >= opts.limit) return out;
      }
    }
  }
  return out;
}

export interface KindCounts {
  total: number;
  current: number;
  missing: number;
  google: number;
  old_voice: number;
  /** Of the above, waiting out a failure's retry time. */
  waiting_retry: number;
  due_soon_missing: number;
}

export interface BackfillCounts {
  settings_hash: string;
  kinds: Record<ClipKind, KindCounts>;
  backlog: number;
  /** Stored clips by provider / model / voice (NULL model or voice = made before provenance). */
  by_voice: Array<{ kind: ClipKind; provider: string | null; model: string | null; voice: string | null; count: number }>;
  failures: Array<{ kind: ClipKind; target_id: string; attempts: number; last_error: string | null; next_attempt_at: string }>;
}

export async function backfillCounts(db: D1Database, opts: { now: number; settingsHash: string; acceptableHashes?: string[] }): Promise<BackfillCounts> {
  const nowIso = new Date(opts.now).toISOString();
  const ctx = { nowIso, dueBeforeIso: new Date(opts.now + DUE_SOON_MS).toISOString(), userIds: [], settingsHash: opts.settingsHash, acceptableHashes: opts.acceptableHashes };
  const kinds = {} as Record<ClipKind, KindCounts>;
  const byVoice: BackfillCounts['by_voice'] = [];
  for (const kind of CLIP_KINDS) {
    const k = KIND_SQL[kind];
    const count = async (sql: string, params: unknown[]) =>
      (await db.prepare(`SELECT COUNT(*) AS n FROM ${k.from} AND ${sql}`).bind(...params).first<{ n: number }>())?.n ?? 0;
    const missing = tierCondition('missing', kind, ctx);
    const google = tierCondition('google', kind, ctx);
    const old = tierCondition('old_voice', kind, ctx);
    const due = tierCondition('due_soon', kind, ctx);
    const total = await count('1', []);
    const c: KindCounts = {
      total,
      missing: await count(missing.sql, missing.params),
      google: await count(google.sql, google.params),
      old_voice: await count(old.sql, old.params),
      current: 0,
      waiting_retry: await count(`NOT (${notWaiting(kind)})`, [nowIso]),
      due_soon_missing: await count(due.sql, due.params),
    };
    c.current = total - c.missing - c.google - c.old_voice;
    kinds[kind] = c;
    const voiceCol = kind === 'clue' ? 'n.sentence_clue_audio_' : kind === 'word' ? 'n.audio_' : 's.audio_';
    const rows = await db
      .prepare(
        `SELECT ${k.provider} AS provider, ${voiceCol}model AS model, ${voiceCol}voice AS voice, COUNT(*) AS count
           FROM ${k.from} AND ${k.url} IS NOT NULL GROUP BY 1, 2, 3 ORDER BY count DESC`,
      )
      .all<{ provider: string | null; model: string | null; voice: string | null; count: number }>();
    for (const r of rows.results || []) byVoice.push({ kind, ...r });
  }
  const failures = await db
    .prepare('SELECT kind, target_id, attempts, last_error, next_attempt_at FROM tts_clip_failures ORDER BY updated_at DESC LIMIT 20')
    .all<BackfillCounts['failures'][number]>();
  const backlog = CLIP_KINDS.reduce((n, k) => n + kinds[k].missing + kinds[k].google + kinds[k].old_voice, 0);
  return { settings_hash: opts.settingsHash, kinds, backlog, by_voice: byVoice, failures: failures.results || [] };
}

/**
 * Clips per minute the backfill can expect, from what the limiter saw in the
 * last hour (successful calls), else the configured share of the rate.
 */
export function throughputPerMinute(
  minutes: Array<{ minute: number; ok: number }>,
  now: number,
  fallback: number,
): { per_minute: number; measured: boolean; window_minutes: number } {
  const current = Math.floor(now / 60_000);
  // Whole minutes only: the current one is still filling.
  const recent = minutes.filter((m) => m.minute < current && m.minute >= current - 60);
  const ok = recent.reduce((n, m) => n + m.ok, 0);
  if (recent.length >= 5 && ok > 0) {
    const span = current - Math.min(...recent.map((m) => m.minute));
    return { per_minute: Math.round((ok / span) * 10) / 10, measured: true, window_minutes: span };
  }
  return { per_minute: fallback, measured: false, window_minutes: 0 };
}

export function etaMinutes(backlog: number, perMinute: number): number | null {
  if (backlog <= 0) return 0;
  if (perMinute <= 0) return null;
  return Math.ceil(backlog / perMinute);
}
