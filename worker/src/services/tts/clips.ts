/**
 * One stored clip at a time (docs/AUDIO.md): a note's word clip, its example
 * sentence's clip, or one sentence-set row's clip.
 *
 * `ensureClip` is idempotent per (row, field, settings + text signature): a
 * clip already made with the current settings for the current text is left
 * alone, so a duplicate queue message or a second backfill pass costs one
 * lookup. A new clip always gets a fresh R2 key; the row is only switched over
 * while it still points at the key we started from (else someone else won and
 * our clip is dropped); every other row that shared the old key (a student's
 * copy) moves with it; the old object is deleted only when nothing references
 * it. `updated_at` is bumped, so devices sync the row and prefetch the new key.
 *
 * Student copies of a tutor deck never get their own generation: the tutor's
 * source note is made (once) and its clip is shared with every copy.
 */
import type { Env } from '../../types';
import { generateTTSDetailed, type TTSOptions, type TTSOutcome } from '../audio';
import type { TtsPriority } from './bucket';
import { clipSignature, settingsHash, TTS_MODEL } from './settings';
import { storedClipPolicy, type StoredClipPolicy } from './config';

export type ClipKind = 'word' | 'clue' | 'sentence';
export interface ClipTarget {
  kind: ClipKind;
  id: string;
}

export type ClipResult =
  | { status: 'current' | 'generated' | 'copied' | 'none' | 'gone' }
  | { status: 'rate_limited'; retryAfterMs: number; minimax: boolean }
  | { status: 'failed'; reason: string; permanent: boolean };

export type TtsFn = (env: Env, text: string, keyId: string, options: TTSOptions) => Promise<TTSOutcome>;

export interface EnsureClipOptions {
  priority: TtsPriority;
  /** Interactive: how long to wait for a limiter slot. */
  maxWaitMs?: number;
  /** Only make a clip that is missing (or reported broken and really gone) — never replace an old one. */
  onlyMissing?: boolean;
  /** R2 keys a device got a 404 for. */
  brokenKeys?: Set<string>;
  /** Regenerate even when the signature matches. */
  force?: boolean;
  tts?: TtsFn;
  /** Internal: a copy's source is ensured at most one level deep. */
  depth?: number;
  /** Which providers' clips are current (default: from the admin settings + account state). */
  policy?: StoredClipPolicy;
}

/** The settings hash a new clip records (null = custom settings, never current). */
function signatureHashOf(r: { provider: string; voice: string; speed: number; settingsHash?: string | null }, policy: StoredClipPolicy): string | null {
  if (r.settingsHash !== undefined) return r.settingsHash;
  // A maker that doesn't say (tests, old callers): a MiniMax clip in the house voice + speed.
  if (r.provider === 'minimax' && settingsHash(TTS_MODEL, r.voice, r.speed) === policy.hashes.minimax) return policy.hashes.minimax;
  return null;
}

/** The signatures a clip of `text` may carry and still be current. */
export function acceptableSignatures(policy: Pick<StoredClipPolicy, 'acceptableHashes'>, text: string): Set<string> {
  return new Set(policy.acceptableHashes.map((hash) => clipSignature({ hash }, text)));
}

interface Columns {
  table: 'notes' | 'note_sentences';
  url: string;
  provider: string;
  voice: string;
  model: string;
  settings: string;
  text: string;
}

export const CLIP_COLUMNS: Record<ClipKind, Columns> = {
  word: { table: 'notes', url: 'audio_url', provider: 'audio_provider', voice: 'audio_voice', model: 'audio_model', settings: 'audio_settings', text: 'hanzi' },
  clue: {
    table: 'notes',
    url: 'sentence_clue_audio_url',
    provider: 'sentence_clue_audio_provider',
    voice: 'sentence_clue_audio_voice',
    model: 'sentence_clue_audio_model',
    settings: 'sentence_clue_audio_settings',
    text: 'sentence_clue',
  },
  sentence: { table: 'note_sentences', url: 'audio_url', provider: 'audio_provider', voice: 'audio_voice', model: 'audio_model', settings: 'audio_settings', text: 'hanzi' },
};

/** notes.updated_at is SQLite datetime; note_sentences.updated_at is ISO (see setNoteSentenceAudio). */
function touch(table: Columns['table']): { sql: string; params: unknown[] } {
  return table === 'notes' ? { sql: "updated_at = datetime('now')", params: [] } : { sql: 'updated_at = ?', params: [new Date().toISOString()] };
}

export interface ClipRow {
  id: string;
  text: string | null;
  url: string | null;
  provider: string | null;
  signature: string | null;
  voice: string | null;
  model: string | null;
  note_id: string;
  deck_id: string;
  hanzi: string;
}

export async function loadClipRow(db: D1Database, target: ClipTarget): Promise<ClipRow | null> {
  const c = CLIP_COLUMNS[target.kind];
  if (c.table === 'notes') {
    return db
      .prepare(
        `SELECT id, ${c.text} AS text, ${c.url} AS url, ${c.provider} AS provider, ${c.settings} AS signature,
                ${c.voice} AS voice, ${c.model} AS model, id AS note_id, deck_id, hanzi
           FROM notes WHERE id = ?`,
      )
      .bind(target.id)
      .first<ClipRow>();
  }
  return db
    .prepare(
      `SELECT s.id, s.hanzi AS text, s.audio_url AS url, s.audio_provider AS provider, s.audio_settings AS signature,
              s.audio_voice AS voice, s.audio_model AS model, s.note_id, n.deck_id, n.hanzi
         FROM note_sentences s JOIN notes n ON n.id = s.note_id WHERE s.id = ?`,
    )
    .bind(target.id)
    .first<ClipRow>();
}

/** A clip's R2 key: stored urls are keys, but tolerate a `/api/audio/` prefix. */
export function audioKeyOf(url: string): string {
  return url.replace(/^\/?api\/audio\//, '').replace(/^\//, '');
}

export interface ClipProvenance {
  url: string;
  provider: string | null;
  voice: string | null;
  model: string | null;
  signature: string | null;
}

/**
 * Point a row at a new clip, only while it still points at `expectUrl`.
 * Returns false when the row changed under us (or is gone).
 */
export async function writeClip(db: D1Database, target: ClipTarget, expectUrl: string | null, prov: ClipProvenance): Promise<boolean> {
  const c = CLIP_COLUMNS[target.kind];
  const t = touch(c.table);
  const res = await db
    .prepare(
      `UPDATE ${c.table} SET ${c.url} = ?, ${c.provider} = ?, ${c.voice} = ?, ${c.model} = ?, ${c.settings} = ?, ${t.sql}
        WHERE id = ? AND ${c.url} IS ?`,
    )
    .bind(prov.url, prov.provider, prov.voice, prov.model, prov.signature, ...t.params, target.id, expectUrl)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Every other row that pointed at `oldUrl` (a student's copy shares the tutor's
 * keys) moves to the new clip too, so the old object becomes unreferenced.
 */
export async function moveSharedKey(db: D1Database, oldUrl: string, prov: ClipProvenance): Promise<number> {
  let moved = 0;
  for (const kind of ['word', 'clue', 'sentence'] as const) {
    const c = CLIP_COLUMNS[kind];
    const t = touch(c.table);
    const res = await db
      .prepare(
        `UPDATE ${c.table} SET ${c.url} = ?, ${c.provider} = ?, ${c.voice} = ?, ${c.model} = ?, ${c.settings} = ?, ${t.sql}
          WHERE ${c.url} = ?`,
      )
      .bind(prov.url, prov.provider, prov.voice, prov.model, prov.signature, ...t.params, oldUrl)
      .run();
    moved += res.meta?.changes ?? 0;
  }
  return moved;
}

/** Student copies of this note (same deck share, same text) that have no clip get this one. */
async function fillCopies(db: D1Database, kind: 'word' | 'clue', row: ClipRow, prov: ClipProvenance): Promise<number> {
  const c = CLIP_COLUMNS[kind];
  const text = (row.text ?? '').trim();
  if (!text) return 0;
  const res = await db
    .prepare(
      `UPDATE notes SET ${c.url} = ?, ${c.provider} = ?, ${c.voice} = ?, ${c.model} = ?, ${c.settings} = ?, updated_at = datetime('now')
        WHERE deck_id IN (SELECT target_deck_id FROM shared_decks WHERE source_deck_id = ?)
          AND TRIM(hanzi) = ? AND TRIM(COALESCE(${c.text}, '')) = ? AND ${c.url} IS NULL`,
    )
    .bind(prov.url, prov.provider, prov.voice, prov.model, prov.signature, row.deck_id, row.hanzi.trim(), text)
    .run();
  return res.meta?.changes ?? 0;
}

/** The tutor's note a student's copy was made from (same hanzi, via shared_decks). */
async function findSourceNote(db: D1Database, row: ClipRow): Promise<string | null> {
  const src = await db
    .prepare(
      `SELECT n.id FROM shared_decks s JOIN notes n ON n.deck_id = s.source_deck_id
        WHERE s.target_deck_id = ? AND TRIM(n.hanzi) = ? AND n.id != ?
        ORDER BY n.created_at LIMIT 1`,
    )
    .bind(row.deck_id, row.hanzi.trim(), row.note_id)
    .first<{ id: string }>();
  return src?.id ?? null;
}

/**
 * Delete R2 clips that no note, clue or sentence row still points at. A
 * tutor's note and the student's copy share the same keys (shareDeck copies
 * the URL, not the bytes), so a delete must never take the other side's audio.
 */
export async function deleteUnreferencedAudio(env: Pick<Env, 'DB' | 'AUDIO_BUCKET'>, keys: Array<string | null | undefined>): Promise<number> {
  const wanted = Array.from(new Set(keys.filter((k): k is string => !!k)));
  if (wanted.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < wanted.length; i += 40) {
    const chunk = wanted.slice(i, i + 40);
    const ph = chunk.map(() => '?').join(', ');
    const rows = await env.DB
      .prepare(
        `SELECT audio_url AS k FROM notes WHERE audio_url IN (${ph})
         UNION SELECT sentence_clue_audio_url AS k FROM notes WHERE sentence_clue_audio_url IN (${ph})
         UNION SELECT audio_url AS k FROM note_sentences WHERE audio_url IN (${ph})`
      )
      .bind(...chunk, ...chunk, ...chunk)
      .all<{ k: string }>();
    const referenced = new Set((rows.results || []).map(r => r.k));
    for (const key of chunk) {
      if (referenced.has(key)) continue;
      try {
        await env.AUDIO_BUCKET.delete(key);
        deleted++;
      } catch (err) {
        console.error('[audio] Failed to delete clip', key, err);
      }
    }
  }
  return deleted;
}

async function r2Has(env: Env, url: string): Promise<boolean> {
  try {
    return (await env.AUDIO_BUCKET.head(audioKeyOf(url))) !== null;
  } catch {
    // Can't tell (a blip): assume it's there — nothing regenerates on a flaky lookup.
    return true;
  }
}

// ---------- Failures (not rate limits) wait before the backfill tries again ----------

const RETRY_AFTER_MS = [10 * 60_000, 60 * 60_000, 6 * 3600_000, 24 * 3600_000];
const PERMANENT_RETRY_MS = 7 * 24 * 3600_000;

export function failureRetryDelay(attempts: number, permanent: boolean): number {
  if (permanent) return PERMANENT_RETRY_MS;
  return RETRY_AFTER_MS[Math.min(Math.max(attempts, 1), RETRY_AFTER_MS.length) - 1];
}

export async function recordClipFailure(db: D1Database, target: ClipTarget, reason: string, permanent: boolean, now = Date.now()): Promise<void> {
  const prev = await db
    .prepare('SELECT attempts FROM tts_clip_failures WHERE kind = ? AND target_id = ?')
    .bind(target.kind, target.id)
    .first<{ attempts: number }>();
  const attempts = (prev?.attempts ?? 0) + 1;
  const next = new Date(now + failureRetryDelay(attempts, permanent)).toISOString();
  await db
    .prepare(
      `INSERT INTO tts_clip_failures (kind, target_id, attempts, last_error, next_attempt_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(kind, target_id) DO UPDATE SET attempts = excluded.attempts, last_error = excluded.last_error,
         next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at`,
    )
    .bind(target.kind, target.id, attempts, reason.slice(0, 300), next)
    .run();
}

async function clearClipFailure(db: D1Database, target: ClipTarget): Promise<void> {
  await db.prepare('DELETE FROM tts_clip_failures WHERE kind = ? AND target_id = ?').bind(target.kind, target.id).run();
}

function keyIdFor(target: ClipTarget, row: ClipRow): string {
  return target.kind === 'word' ? row.note_id : target.kind === 'clue' ? `${row.note_id}-sentence` : `${row.id}-sentence`;
}

// ---------- The one entry point ----------

export async function ensureClip(env: Env, target: ClipTarget, opts: EnsureClipOptions): Promise<ClipResult> {
  const policy = opts.policy ?? (await storedClipPolicy(env));
  opts = { ...opts, policy };
  const row = await loadClipRow(env.DB, target);
  if (!row) return { status: 'gone' };
  const text = (row.text ?? '').trim();
  if (!text) return { status: 'none' };
  const current = acceptableSignatures(policy, text);

  let broken = false;
  if (row.url && opts.brokenKeys?.has(audioKeyOf(row.url))) {
    try {
      broken = (await env.AUDIO_BUCKET.head(audioKeyOf(row.url))) === null;
    } catch {
      broken = false;
    }
  }
  const hasClip = !!row.url && !broken;
  if (hasClip && !opts.force) {
    if (opts.onlyMissing) return { status: 'current' };
    if (row.signature && current.has(row.signature)) return { status: 'current' };
  }

  // A student's copy: share the tutor's clip instead of making its own.
  if (target.kind !== 'sentence' && (opts.depth ?? 0) === 0 && !opts.force) {
    const shared = await shareFromSource(env, target, row, hasClip, current, opts);
    if (shared) return shared;
  }

  const tts = opts.tts ?? generateTTSDetailed;
  const made = await tts(env, text, keyIdFor(target, row), { priority: opts.priority, maxWaitMs: opts.maxWaitMs });
  if (!made.ok) {
    if (made.rateLimited) {
      // Also an account pause (no credit / bad key): wait it out, record nothing against the clip.
      return { status: 'rate_limited', retryAfterMs: made.retryAfterMs ?? 60_000, minimax: made.reason !== 'limiter' && made.account === undefined };
    }
    await recordClipFailure(env.DB, target, made.reason, made.permanent).catch(() => {});
    return { status: 'failed', reason: made.reason, permanent: made.permanent };
  }

  const prov: ClipProvenance = {
    url: made.result.audioKey,
    provider: made.result.provider,
    voice: made.result.voice,
    model: made.result.model,
    // A clip made with other settings (a custom voice / speed) is not "current".
    signature: signatureHashOf(made.result, policy) ? clipSignature({ hash: signatureHashOf(made.result, policy)! }, text) : null,
  };
  const ok = await writeClip(env.DB, target, row.url, prov);
  if (!ok) {
    // The row changed while we were generating: theirs wins, ours is dropped.
    await deleteUnreferencedAudio(env, [prov.url]);
    return { status: 'current' };
  }
  if (row.url) {
    await moveSharedKey(env.DB, row.url, prov);
    await deleteUnreferencedAudio(env, [row.url]);
  }
  if (target.kind !== 'sentence') await fillCopies(env.DB, target.kind, row, prov);
  await clearClipFailure(env.DB, target).catch(() => {});
  return { status: 'generated' };
}

/**
 * The copy's tutor note: copy its current clip; else (when the copy has none)
 * copy its older clip for now; else make the tutor's clip — once — and share it.
 * Null = this note is nobody's copy; generate its own.
 */
async function shareFromSource(
  env: Env,
  target: ClipTarget,
  row: ClipRow,
  hasClip: boolean,
  current: Set<string>,
  opts: EnsureClipOptions,
): Promise<ClipResult | null> {
  const sourceId = await findSourceNote(env.DB, row);
  if (!sourceId) return null;
  const sourceTarget: ClipTarget = { kind: target.kind, id: sourceId };
  let source = await loadClipRow(env.DB, sourceTarget);
  if (!source || (source.text ?? '').trim() !== (row.text ?? '').trim()) return null;

  const copy = async (src: ClipRow): Promise<ClipResult> => {
    const prov: ClipProvenance = { url: src.url!, provider: src.provider, voice: src.voice, model: src.model, signature: src.signature };
    const ok = await writeClip(env.DB, target, row.url, prov);
    if (ok && row.url && row.url !== src.url) await deleteUnreferencedAudio(env, [row.url]);
    return { status: ok ? 'copied' : 'current' };
  };

  const sourceCurrent = !!source.url && !!source.signature && current.has(source.signature);
  if (sourceCurrent && source.url !== row.url && (await r2Has(env, source.url!))) return copy(source);
  if (!hasClip && source.url && (await r2Has(env, source.url))) return copy(source);
  if (opts.onlyMissing && hasClip) return { status: 'current' };

  // Make the tutor's clip (it moves every row sharing its old key, and fills empty copies).
  const made = await ensureClip(env, sourceTarget, { ...opts, depth: 1, onlyMissing: false });
  if (made.status === 'rate_limited' || made.status === 'failed') return made;
  const mine = await loadClipRow(env.DB, target);
  if (mine?.url && mine.signature && current.has(mine.signature)) return { status: 'copied' };
  source = await loadClipRow(env.DB, sourceTarget);
  if (source?.url && source.signature && acceptableSignatures(opts.policy!, (source.text ?? '').trim()).has(source.signature)) return copy(source);
  return null;
}
