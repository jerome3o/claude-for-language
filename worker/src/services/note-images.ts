/**
 * Pictures on cards: one optional picture per note (migration 0123; rules in
 * shared/cards/note-image.ts; docs/STUDY_SESSION.md "Pictures on cards").
 *
 * Generated pictures work like lesson pictures (services/lesson-images.ts):
 *   - the prompt is built from the note's MEANING (buildNoteImagePrompt — never the Chinese, so the
 *     picture carries no writing) and hashed; `note_images` keeps one row per hash, so the same word
 *     asked for twice (a tutor's note, every student's copy, another account) is drawn ONCE;
 *   - asking marks the note `image_status = 'pending'` with its `image_hash` and queues the hash on
 *     image-generation-queue (`{ kind: 'note_image' }`) — never blocking; a ready hash is written in
 *     at once;
 *   - when the picture is drawn, every note still waiting for that hash gets it, and the copies of
 *     those notes in students' decks follow (propagateToCopies);
 *   - 3 attempts with a growing delay, then `failed` (Regenerate tries again); a pending row older
 *     than 15 min is taken as lost and re-queued the next time anyone looks.
 * Uploads (person-made photos) go to note-uploads/ and replace a generated picture.
 *
 * Every picture write touches image_at, never updated_at (the copy rules compare updated_at), and
 * an R2 object is deleted only when no note references it any more (copies share keys).
 */

import {
  buildNoteImagePrompt,
  estimateIllustrateCost,
  ILLUSTRATE_DECK_MAX,
  NOTE_IMAGE_MAX_BYTES,
  type IllustrateEstimate,
} from '@shared/cards/note-image';
import type { Env } from '../types';
import { ContentError } from './content/decks';
import { GEMINI_IMAGE_MODELS, geminiGenerateContent } from './gemini';
import { sniffImage } from './profile';
import { stripJpegMetadata } from './image-bytes';

export const NOTE_IMAGE_PREFIX = 'note-images';
export const NOTE_UPLOAD_PREFIX = 'note-uploads';
export const MAX_NOTE_IMAGE_ATTEMPTS = 3;
/** A pending row older than this is taken as lost (queue message dropped) and re-queued. */
export const NOTE_IMAGE_PENDING_STALE_MS = 15 * 60 * 1000;

export interface NoteImageMessage {
  kind: 'note_image';
  hash: string;
  prompt: string;
}

export type NoteImageEnv = Pick<Env, 'DB' | 'AUDIO_BUCKET' | 'IMAGE_QUEUE' | 'GEMINI_API_KEY' | 'E2E_TEST_MODE'>;

/** What the apps need to show a note's picture. */
export interface NoteImageView {
  id: string;
  deck_id: string;
  image_key: string | null;
  image_source: 'generated' | 'upload' | null;
  image_status: 'pending' | 'failed' | null;
  image_at: string | null;
}

interface NoteRow {
  id: string;
  deck_id: string;
  hanzi: string;
  english: string;
  sentence_clue: string | null;
  sentence_clue_translation: string | null;
  image_key: string | null;
  image_source: string | null;
  image_status: string | null;
  image_hash: string | null;
}

interface NoteImageRow {
  prompt_hash: string;
  prompt: string;
  status: 'pending' | 'ready' | 'failed';
  image_key: string | null;
  attempts: number;
  updated_at: string;
}

const NOTE_COLUMNS = 'n.id, n.deck_id, n.hanzi, n.english, n.sentence_clue, n.sentence_clue_translation, n.image_key, n.image_source, n.image_status, n.image_hash';
const VIEW_COLUMNS = 'id, deck_id, image_key, image_source, image_status, image_at';

/** No image generator is configured: routes answer 503. */
export class NoteImagesUnavailableError extends Error {
  constructor() {
    super('Pictures can’t be generated right now (no image generator is set up)');
  }
}

/** Can pictures be generated here? (E2E_TEST_MODE draws a fixed fake picture inline.) */
export function noteImagesAvailable(env: Pick<Env, 'GEMINI_API_KEY' | 'IMAGE_QUEUE' | 'E2E_TEST_MODE'>): boolean {
  return Boolean(env.GEMINI_API_KEY && env.IMAGE_QUEUE) || env.E2E_TEST_MODE === 'true';
}

/** Stable id of a picture prompt: the first 32 hex chars of its SHA-256. */
export async function noteImageHash(prompt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt.trim()));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** D1's datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC. */
function parseDbTime(value: string): number {
  const ms = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : 0;
}

/** A picture being drawn whose row hasn't moved for 15 min: the message was lost. */
export function isStalePending(row: Pick<NoteImageRow, 'status' | 'updated_at'> | null, nowMs: number): boolean {
  return !!row && row.status === 'pending' && nowMs - parseDbTime(row.updated_at) > NOTE_IMAGE_PENDING_STALE_MS;
}

// ============ Reads ============

async function ownedNotes(db: D1Database, userId: string, noteIds: string[]): Promise<NoteRow[]> {
  if (noteIds.length === 0) return [];
  const out: NoteRow[] = [];
  for (let i = 0; i < noteIds.length; i += 50) {
    const chunk = noteIds.slice(i, i + 50);
    const { results } = await db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ? AND n.id IN (${chunk.map(() => '?').join(',')})`)
      .bind(userId, ...chunk)
      .all<NoteRow>();
    out.push(...(results ?? []));
  }
  return out;
}

/**
 * The caller's note's picture state, for polling. A picture whose queue message was lost
 * (pending for 15 min) is queued again here, and a note waiting on an already-drawn hash gets it.
 */
export async function getOwnedNoteImageView(env: NoteImageEnv, userId: string, noteId: string): Promise<NoteImageView | null> {
  const [note] = await ownedNotes(env.DB, userId, [noteId]);
  if (!note) return null;
  if (note.image_status === 'pending' && note.image_hash) {
    const row = (await imageRows(env.DB, [note.image_hash])).get(note.image_hash) ?? null;
    if (row?.status === 'ready' && row.image_key) await applyHashEverywhere(env, note.image_hash, row.image_key);
    else if (!row || row.status === 'failed') await failHash(env.DB, note.image_hash);
    else if (isStalePending(row, Date.now()) && env.IMAGE_QUEUE) {
      await env.DB.prepare(`UPDATE note_images SET updated_at = datetime('now') WHERE prompt_hash = ?`).bind(row.prompt_hash).run();
      await env.IMAGE_QUEUE.send({ kind: 'note_image', hash: row.prompt_hash, prompt: row.prompt });
    }
  }
  return getNoteImageView(env.DB, noteId);
}

export async function getNoteImageView(db: D1Database, noteId: string): Promise<NoteImageView | null> {
  return (await db.prepare(`SELECT ${VIEW_COLUMNS} FROM notes WHERE id = ?`).bind(noteId).first<NoteImageView>()) ?? null;
}

async function imageRows(db: D1Database, hashes: string[]): Promise<Map<string, NoteImageRow>> {
  const out = new Map<string, NoteImageRow>();
  for (let i = 0; i < hashes.length; i += 50) {
    const chunk = hashes.slice(i, i + 50);
    const { results } = await db
      .prepare(`SELECT * FROM note_images WHERE prompt_hash IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<NoteImageRow>();
    for (const r of results ?? []) out.set(r.prompt_hash, r);
  }
  return out;
}

// ============ Copies (a tutor's note → the students' copies) ============

/**
 * Carry a note's new picture onto its copies in the decks shared from its deck (matched by hanzi,
 * like the audio). Only copies still showing the OLD picture (or none) follow: a student's own
 * upload is never replaced. Touches image_at only.
 */
async function propagateToCopies(
  db: D1Database,
  note: { id: string; deck_id: string; hanzi: string },
  oldKey: string | null,
  next: { key: string | null; source: string | null; hash: string | null },
): Promise<number> {
  const shares = await db
    .prepare('SELECT target_deck_id FROM shared_decks WHERE source_deck_id = ?')
    .bind(note.deck_id)
    .all<{ target_deck_id: string }>();
  let updated = 0;
  for (const share of shares.results ?? []) {
    const res = next.key
      ? await db
        .prepare(`UPDATE notes SET image_key = ?, image_source = ?, image_hash = ?, image_status = NULL, image_at = datetime('now')
                   WHERE deck_id = ? AND TRIM(hanzi) = ? AND id != ?
                     AND (image_key IS NULL OR image_key = ?) AND (image_key IS NULL OR image_key != ?)`)
        .bind(next.key, next.source, next.hash, share.target_deck_id, note.hanzi.trim(), note.id, oldKey ?? '', next.key)
        .run()
      : oldKey
        ? await db
          .prepare(`UPDATE notes SET image_key = NULL, image_source = NULL, image_hash = NULL, image_status = NULL, image_at = datetime('now')
                     WHERE deck_id = ? AND TRIM(hanzi) = ? AND id != ? AND image_key = ?`)
          .bind(share.target_deck_id, note.hanzi.trim(), note.id, oldKey)
          .run()
        : null;
    updated += res?.meta?.changes ?? 0;
  }
  return updated;
}

/**
 * Delete pictures nothing points at any more (a copy may share the key). A generated picture's
 * note_images row goes with it, so the next request for that prompt draws it again.
 */
export async function deleteUnreferencedNoteImages(env: Pick<Env, 'DB' | 'AUDIO_BUCKET'>, keys: Array<string | null | undefined>): Promise<number> {
  const wanted = [...new Set(keys.filter((k): k is string => !!k && (k.startsWith(`${NOTE_IMAGE_PREFIX}/`) || k.startsWith(`${NOTE_UPLOAD_PREFIX}/`))))];
  let deleted = 0;
  for (const key of wanted) {
    const used = await env.DB.prepare('SELECT 1 AS k FROM notes WHERE image_key = ? LIMIT 1').bind(key).first();
    if (used) continue;
    try {
      await env.AUDIO_BUCKET.delete(key);
      if (key.startsWith(`${NOTE_IMAGE_PREFIX}/`)) await env.DB.prepare('DELETE FROM note_images WHERE image_key = ?').bind(key).run();
      deleted++;
    } catch (err) {
      console.error('[note-images] Failed to delete', key, err);
    }
  }
  return deleted;
}

// ============ Writing a picture onto notes ============

/** Every note waiting for `hash` gets the drawn picture (and its copies follow). Returns notes updated. */
async function applyHashEverywhere(env: Pick<Env, 'DB' | 'AUDIO_BUCKET'>, hash: string, key: string): Promise<number> {
  const { results } = await env.DB
    .prepare(`SELECT id, deck_id, hanzi, image_key FROM notes WHERE image_hash = ? AND image_status = 'pending'`)
    .bind(hash)
    .all<{ id: string; deck_id: string; hanzi: string; image_key: string | null }>();
  const waiting = results ?? [];
  if (waiting.length === 0) return 0;
  await env.DB
    .prepare(`UPDATE notes SET image_key = ?, image_source = 'generated', image_status = NULL, image_at = datetime('now')
               WHERE image_hash = ? AND image_status = 'pending'`)
    .bind(key, hash)
    .run();
  for (const n of waiting) await propagateToCopies(env.DB, n, n.image_key, { key, source: 'generated', hash });
  await deleteUnreferencedNoteImages(env, waiting.map(n => n.image_key).filter(k => k !== key));
  return waiting.length;
}

async function failHash(db: D1Database, hash: string): Promise<void> {
  await db
    .prepare(`UPDATE notes SET image_status = 'failed', image_at = datetime('now') WHERE image_hash = ? AND image_status = 'pending'`)
    .bind(hash)
    .run();
}

// ============ Asking for generated pictures ============

export interface EnsureNoteImagesResult {
  /** Notes that got an already-drawn picture at once. */
  ready: number;
  /** Notes now waiting for a picture being drawn. */
  pending: number;
  /** Prompts sent to the image queue. */
  queued: number;
}

/**
 * Ask for a generated picture for each note (already checked as the caller's): a drawn picture is
 * written in at once, otherwise the note waits ('pending') and its prompt is queued — once per
 * prompt, again only for a lost (stale) or failed row. `variant` > 0 = Regenerate.
 */
export async function ensureNoteImages(
  env: NoteImageEnv,
  notes: NoteRow[],
  opts: { variant?: number; nowMs?: number; generate?: GenerateNoteImage } = {},
): Promise<EnsureNoteImagesResult> {
  const out: EnsureNoteImagesResult = { ready: 0, pending: 0, queued: 0 };
  if (notes.length === 0) return out;
  if (!noteImagesAvailable(env)) throw new NoteImagesUnavailableError();
  const nowMs = opts.nowMs ?? Date.now();
  const prompts = notes.map(n => buildNoteImagePrompt(n, opts.variant ?? 0));
  const hashes = await Promise.all(prompts.map(noteImageHash));
  const rows = await imageRows(env.DB, [...new Set(hashes)]);
  const toQueue = new Map<string, string>();

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const hash = hashes[i];
    const row = rows.get(hash) ?? null;
    if (row?.status === 'ready' && row.image_key) {
      if (note.image_key === row.image_key) {
        await env.DB.prepare(`UPDATE notes SET image_hash = ?, image_status = NULL, image_source = 'generated', image_at = datetime('now') WHERE id = ?`).bind(hash, note.id).run();
      } else {
        await env.DB.prepare(`UPDATE notes SET image_hash = ?, image_status = 'pending', image_at = datetime('now') WHERE id = ?`).bind(hash, note.id).run();
        // Only this note (and its copies): applyHashEverywhere finds the notes waiting for the hash.
        await applyHashEverywhere(env, hash, row.image_key);
      }
      out.ready++;
      continue;
    }
    await env.DB.prepare(`UPDATE notes SET image_hash = ?, image_status = 'pending', image_at = datetime('now') WHERE id = ?`).bind(hash, note.id).run();
    out.pending++;
    const needsQueue = !row || row.status === 'failed' || isStalePending(row, nowMs);
    if (needsQueue && !toQueue.has(hash)) toQueue.set(hash, prompts[i]);
  }

  for (const [hash, prompt] of toQueue) {
    await env.DB.prepare(`
      INSERT INTO note_images (prompt_hash, prompt, status, attempts, updated_at)
      VALUES (?, ?, 'pending', 0, datetime('now'))
      ON CONFLICT(prompt_hash) DO UPDATE SET status = 'pending', error = NULL, image_key = NULL,
        attempts = CASE WHEN note_images.status = 'failed' THEN 0 ELSE note_images.attempts END,
        updated_at = datetime('now')
    `).bind(hash, prompt).run();
  }
  const messages = [...toQueue].map(([hash, prompt]) => ({ kind: 'note_image' as const, hash, prompt }));
  out.queued = messages.length;
  if (messages.length === 0) return out;

  if (env.E2E_TEST_MODE === 'true') {
    // E2E: draw the fixed fake picture right away (no queue consumer, no image model) — even when
    // the E2E workflow has a real GEMINI_API_KEY: a real drawing on the queue made the spec flaky.
    for (const msg of messages) await handleNoteImageMessage(env, msg, opts.generate ?? fakeNoteImage(env.AUDIO_BUCKET));
    return out;
  }
  for (let i = 0; i < messages.length; i += 100) {
    await env.IMAGE_QUEUE.sendBatch(messages.slice(i, i + 100).map(body => ({ body })));
  }
  return out;
}

/** "🖼 Add picture" / "Regenerate" on one note the user owns. */
export async function requestNoteImage(env: NoteImageEnv, userId: string, noteId: string, opts: { regenerate?: boolean } = {}): Promise<NoteImageView | null> {
  const [note] = await ownedNotes(env.DB, userId, [noteId]);
  if (!note) return null;
  // A new variant gives a new prompt (a new hash), so Regenerate really draws a new picture.
  const variant = opts.regenerate ? 1 + Math.floor(Math.random() * 1_000_000) : 0;
  await ensureNoteImages(env, [note], { variant });
  return getNoteImageView(env.DB, noteId);
}

// ============ Uploads / removal ============

/** Problems with an uploaded picture ([] = fine). */
export function noteUploadProblems(bytes: Uint8Array | null): string[] {
  if (!bytes || bytes.length === 0) return ['No picture was sent'];
  if (bytes.length > NOTE_IMAGE_MAX_BYTES) return [`The picture must be at most ${NOTE_IMAGE_MAX_BYTES / 1024 / 1024} MB`];
  if (!sniffImage(bytes)) return ['The picture must be a JPEG, PNG or WebP image'];
  return [];
}

function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** A person's own photo for the note (cropped + resized on the device); replaces any picture. */
export async function setUploadedNoteImage(env: Pick<Env, 'DB' | 'AUDIO_BUCKET'>, userId: string, noteId: string, bytes: Uint8Array): Promise<NoteImageView | null> {
  const [note] = await ownedNotes(env.DB, userId, [noteId]);
  if (!note) return null;
  const problems = noteUploadProblems(bytes);
  if (problems.length) throw new ContentError(problems[0]);
  const kind = sniffImage(bytes)!;
  const clean = stripJpegMetadata(bytes);
  const key = `${NOTE_UPLOAD_PREFIX}/${noteId}-${randomId()}.${kind.ext}`;
  await env.AUDIO_BUCKET.put(key, clean, { httpMetadata: { contentType: kind.mime } });
  await env.DB
    .prepare(`UPDATE notes SET image_key = ?, image_source = 'upload', image_status = NULL, image_hash = NULL, image_at = datetime('now') WHERE id = ?`)
    .bind(key, noteId)
    .run();
  await propagateToCopies(env.DB, note, note.image_key, { key, source: 'upload', hash: null });
  await deleteUnreferencedNoteImages(env, [note.image_key]);
  return getNoteImageView(env.DB, noteId);
}

/** Take the picture off the note (copies still showing it lose it too; a student's own upload stays). */
export async function removeNoteImage(env: Pick<Env, 'DB' | 'AUDIO_BUCKET'>, userId: string, noteId: string): Promise<NoteImageView | null> {
  const [note] = await ownedNotes(env.DB, userId, [noteId]);
  if (!note) return null;
  await env.DB
    .prepare(`UPDATE notes SET image_key = NULL, image_source = NULL, image_status = NULL, image_hash = NULL, image_at = datetime('now') WHERE id = ?`)
    .bind(noteId)
    .run();
  await propagateToCopies(env.DB, note, note.image_key, { key: null, source: null, hash: null });
  await deleteUnreferencedNoteImages(env, [note.image_key]);
  return getNoteImageView(env.DB, noteId);
}

// ============ Decks ============

export interface DeckIllustrateStatus {
  deck_id: string;
  deck_name: string;
  total: number;
  with_image: number;
  pending: number;
  failed: number;
  /** Notes without a picture that "Illustrate" would draw (pending ones excluded). */
  missing: number;
  estimate: IllustrateEstimate;
  illustrate_new: boolean;
  /** false = no image generator here (the sheet says so, uploads still work). */
  available: boolean;
}

async function ownedDeck(db: D1Database, userId: string, deckId: string) {
  return db.prepare('SELECT id, name, illustrate_new FROM decks WHERE id = ? AND user_id = ?').bind(deckId, userId).first<{ id: string; name: string; illustrate_new: number | null }>();
}

/**
 * The "Illustrate this deck" sheet: how many cards have a picture, how many are being drawn, the
 * estimate for the rest. Looking also re-queues pictures whose message was lost.
 */
export async function deckIllustrateStatus(env: NoteImageEnv, userId: string, deckId: string): Promise<DeckIllustrateStatus | null> {
  const deck = await ownedDeck(env.DB, userId, deckId);
  if (!deck) return null;
  const counts = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN image_key IS NOT NULL THEN 1 ELSE 0 END) AS with_image,
           SUM(CASE WHEN image_status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN image_status = 'failed' AND image_key IS NULL THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN image_key IS NULL AND (image_status IS NULL OR image_status = 'failed') THEN 1 ELSE 0 END) AS missing
      FROM notes WHERE deck_id = ?`).bind(deckId).first<Record<string, number | null>>();
  const pending = Number(counts?.pending ?? 0);
  if (pending > 0 && noteImagesAvailable(env)) await requeueStale(env, deckId).catch(err => console.warn('[note-images] requeue failed', err));
  const missing = Number(counts?.missing ?? 0);
  return {
    deck_id: deck.id,
    deck_name: deck.name,
    total: Number(counts?.total ?? 0),
    with_image: Number(counts?.with_image ?? 0),
    pending,
    failed: Number(counts?.failed ?? 0),
    missing,
    estimate: estimateIllustrateCost(missing),
    illustrate_new: !!deck.illustrate_new,
    available: noteImagesAvailable(env),
  };
}

async function requeueStale(env: NoteImageEnv, deckId: string): Promise<void> {
  const { results } = await env.DB.prepare(`
    SELECT ni.prompt_hash, ni.prompt, ni.status, ni.updated_at FROM note_images ni
     WHERE ni.status = 'pending' AND ni.prompt_hash IN (SELECT image_hash FROM notes WHERE deck_id = ? AND image_status = 'pending')`)
    .bind(deckId)
    .all<NoteImageRow>();
  const nowMs = Date.now();
  const stale = (results ?? []).filter(r => isStalePending(r, nowMs));
  for (const r of stale) {
    await env.DB.prepare(`UPDATE note_images SET updated_at = datetime('now') WHERE prompt_hash = ?`).bind(r.prompt_hash).run();
  }
  if (stale.length && env.IMAGE_QUEUE) {
    for (let i = 0; i < stale.length; i += 100) {
      await env.IMAGE_QUEUE.sendBatch(stale.slice(i, i + 100).map(r => ({ body: { kind: 'note_image' as const, hash: r.prompt_hash, prompt: r.prompt } })));
    }
  }
  // A note pending on a hash that is already drawn (or has no row at all) is repaired here too.
  const orphans = await env.DB.prepare(`
    SELECT n.image_hash AS h, ni.status, ni.image_key FROM notes n LEFT JOIN note_images ni ON ni.prompt_hash = n.image_hash
     WHERE n.deck_id = ? AND n.image_status = 'pending' AND (ni.prompt_hash IS NULL OR ni.status != 'pending')`)
    .bind(deckId)
    .all<{ h: string; status: string | null; image_key: string | null }>();
  for (const o of orphans.results ?? []) {
    if (o.status === 'ready' && o.image_key) await applyHashEverywhere(env, o.h, o.image_key);
    else await failHash(env.DB, o.h);
  }
}

/** "Illustrate this deck": a picture for every card without one (up to ILLUSTRATE_DECK_MAX). */
export async function illustrateDeck(env: NoteImageEnv, userId: string, deckId: string, limit = ILLUSTRATE_DECK_MAX): Promise<(EnsureNoteImagesResult & { status: DeckIllustrateStatus }) | null> {
  const deck = await ownedDeck(env.DB, userId, deckId);
  if (!deck) return null;
  const n = Math.max(1, Math.min(ILLUSTRATE_DECK_MAX, Math.floor(limit) || ILLUSTRATE_DECK_MAX));
  const { results } = await env.DB
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes n WHERE n.deck_id = ? AND n.image_key IS NULL AND (n.image_status IS NULL OR n.image_status = 'failed') ORDER BY n.created_at ASC LIMIT ?`)
    .bind(deckId, n)
    .all<NoteRow>();
  const res = await ensureNoteImages(env, results ?? []);
  const status = await deckIllustrateStatus(env, userId, deckId);
  return { ...res, status: status! };
}

/** The deck's "Illustrate new cards" switch. Null when the deck isn't the user's. */
export async function setDeckIllustrateNew(db: D1Database, userId: string, deckId: string, on: boolean): Promise<boolean | null> {
  const res = await db.prepare('UPDATE decks SET illustrate_new = ? WHERE id = ? AND user_id = ?').bind(on ? 1 : 0, deckId, userId).run();
  return (res.meta?.changes ?? 0) > 0 ? on : null;
}

/** New notes in a deck with "Illustrate new cards" on get a picture (never throws: a card save must not fail over a picture). */
export async function illustrateNewNotes(env: NoteImageEnv, userId: string, deckId: string, noteIds: string[]): Promise<void> {
  try {
    if (noteIds.length === 0 || !noteImagesAvailable(env)) return;
    const deck = await ownedDeck(env.DB, userId, deckId);
    if (!deck?.illustrate_new) return;
    await ensureNoteImages(env, await ownedNotes(env.DB, userId, noteIds));
  } catch (err) {
    console.warn('[note-images] illustrate new notes failed:', err);
  }
}

// ============ Drawing (queue consumer) ============

export type GenerateNoteImage = (prompt: string, hash: string) => Promise<string | null>;

export type NoteImageOutcome =
  | { action: 'ack'; status: 'ready' | 'failed'; key?: string; applied?: number }
  | { action: 'retry'; delaySeconds: number };

/**
 * Draw one picture. Already drawn (a duplicate message) → just apply it. A failed attempt is retried
 * with a growing delay; after MAX_NOTE_IMAGE_ATTEMPTS the notes waiting for it are 'failed'.
 */
export async function handleNoteImageMessage(env: Pick<Env, 'DB' | 'AUDIO_BUCKET'>, msg: NoteImageMessage, generate: GenerateNoteImage): Promise<NoteImageOutcome> {
  const existing = await env.DB.prepare('SELECT * FROM note_images WHERE prompt_hash = ?').bind(msg.hash).first<NoteImageRow>();
  if (existing?.status === 'ready' && existing.image_key) {
    const applied = await applyHashEverywhere(env, msg.hash, existing.image_key);
    return { action: 'ack', status: 'ready', key: existing.image_key, applied };
  }
  let key: string | null = null;
  let error = 'The image generator returned no picture';
  try {
    key = await generate(msg.prompt, msg.hash);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (key) {
    await env.DB.prepare(`
      INSERT INTO note_images (prompt_hash, prompt, status, image_key, attempts, updated_at)
      VALUES (?, ?, 'ready', ?, 1, datetime('now'))
      ON CONFLICT(prompt_hash) DO UPDATE SET status = 'ready', image_key = excluded.image_key, error = NULL,
        attempts = note_images.attempts + 1, updated_at = datetime('now')
    `).bind(msg.hash, msg.prompt, key).run();
    const applied = await applyHashEverywhere(env, msg.hash, key);
    return { action: 'ack', status: 'ready', key, applied };
  }
  const attempts = (existing?.attempts ?? 0) + 1;
  const failed = attempts >= MAX_NOTE_IMAGE_ATTEMPTS;
  await env.DB.prepare(`
    INSERT INTO note_images (prompt_hash, prompt, status, attempts, error, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(prompt_hash) DO UPDATE SET status = excluded.status, attempts = excluded.attempts,
      error = excluded.error, updated_at = datetime('now')
  `).bind(msg.hash, msg.prompt, failed ? 'failed' : 'pending', attempts, error.slice(0, 500)).run();
  if (failed) {
    await failHash(env.DB, msg.hash);
    return { action: 'ack', status: 'failed' };
  }
  return { action: 'retry', delaySeconds: 60 * attempts };
}

/** Draw a card picture with the image model (GEMINI_IMAGE_MODELS) and store it as note-images/<hash>.<ext>. */
export async function generateNoteImage(apiKey: string, bucket: R2Bucket, prompt: string, hash: string): Promise<string | null> {
  if (!apiKey) return null;
  type Resp = { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
  const { data, model } = await geminiGenerateContent<Resp>({
    apiKey,
    models: GEMINI_IMAGE_MODELS,
    label: 'card picture',
    body: () => ({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  const b64 = part?.inlineData?.data;
  if (!b64) {
    console.warn('[note-images] no picture in the answer of', model);
    return null;
  }
  const mime = part?.inlineData?.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const key = `${NOTE_IMAGE_PREFIX}/${hash}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`;
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  return key;
}

/** E2E_TEST_MODE's picture: a small fixed PNG (an orange sun over grass), stored like a real one. */
export const FAKE_NOTE_IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAgElEQVR42u3YsQ2AMAxE0ZuNgagZgpnYhQWoqKioaYiVxJYtfekP8Lr4ovN6UiVAgAABsnbvy39xoCZlhCVXTYdJrpQOlmI0dlNN0BSN0aRIjcVUDTRd0zQBAgQIEKDiIB7XivcQJ2zR1ZFxlyVdrhm3Pd8xgD6g7VhTBQgQIO9eoKbFjrGWwMYAAAAASUVORK5CYII=';

export function fakeNoteImage(bucket: R2Bucket): GenerateNoteImage {
  return async (_prompt, hash) => {
    const key = `${NOTE_IMAGE_PREFIX}/${hash}.png`;
    const bytes = Uint8Array.from(atob(FAKE_NOTE_IMAGE_PNG_BASE64), c => c.charCodeAt(0));
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
    return key;
  };
}

/** Notes of a deck, for deleteDeck / deleteNote to clean their pictures. */
export async function noteImageKeysOfDeck(db: D1Database, deckId: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT image_key FROM notes WHERE deck_id = ? AND image_key IS NOT NULL').bind(deckId).all<{ image_key: string }>();
  return (results ?? []).map(r => r.image_key);
}
