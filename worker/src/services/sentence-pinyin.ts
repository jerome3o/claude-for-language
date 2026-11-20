import type { SentenceBriefExplanation } from '../types';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { checkAuthoredPinyin, type PinyinReadingSources } from './pinyin-check';
import { fixReaderWordsPinyin } from './reader-words';

/**
 * The deterministic pinyin check (services/pinyin-check.ts — only an IMPOSSIBLE syllable is corrected,
 * a real reading of its character is never touched, a line that doesn't line up is left as written)
 * on the example sentences Claude writes and their "What's going on here?" breakdowns.
 *
 * Nov 2026: the sentence-set row 这些破烂东西可以扔掉。 came back as "… kěyǐ zhuāngdiào。" and its
 * breakdown (made from that row's pinyin) said 扔掉 zhuāngdiào — 扔 is only ever rēng. Lessons, readers,
 * reader word chips, audio lessons and the call board went through the check; the sentence sets and
 * the breakdowns did not.
 *
 * - A sentence line: `checkAuthoredPinyin`, then the 一 / 不 rule (`applyYiBuToneChanges`, the card
 *   standard: Claude's sentence pinyin carries yí gè / bú shì like every Claude pinyin of a card).
 * - A breakdown: each word's pinyin against its own characters, then 一 / 不 over the sentence — the
 *   reader word chips' check (`fixReaderWordsPinyin`), reused as is.
 * - New rows are written checked (`note_sentences.pinyin_checked` = SENTENCE_PINYIN_CHECK_VERSION,
 *   migration 0155); stored rows are checked by `repairSentencePinyin` (the hourly cron over everyone,
 *   and per user before `GET /api/sentences/changes`), which bumps every row of a corrected note so
 *   both apps pull the fix.
 * - The card's own sentence row (`is_card`, `<note>-card`) mirrors `notes.sentence_clue_pinyin` — a
 *   note field, which is never mass-rewritten (the word check proposes fixes instead): only its cached
 *   breakdown is corrected here.
 */

/** Bump when the check changes: every row is checked again. */
export const SENTENCE_PINYIN_CHECK_VERSION = 1;

/** Rows one repair pass looks at. */
export const SENTENCE_PINYIN_REPAIR_LIMIT = 400;

/** A sentence's pinyin with the impossible syllables corrected and the 一 / 不 rule applied (same string when fine). */
export async function checkSentencePinyin(hanzi: string, pinyin: string | null | undefined, sources: PinyinReadingSources = {}): Promise<string> {
  if (!pinyin?.trim() || !hanzi?.trim()) return pinyin ?? '';
  const r = await checkAuthoredPinyin(hanzi, pinyin, sources).catch(() => null);
  const checked = r?.reason ? r.pinyin : pinyin;
  try {
    const yiBu = /[一不]/.test(hanzi) ? applyYiBuToneChanges(hanzi, checked.normalize('NFC')) : checked;
    // Only take the 一 / 不 line when it changed something (else keep the author's bytes, NFC or not).
    return yiBu !== checked.normalize('NFC') ? yiBu : checked;
  } catch {
    return checked;
  }
}

/** A breakdown's word pinyin checked (each word against its characters, then 一 / 不 over the sentence). */
export async function checkBriefExplanationPinyin(
  explanation: SentenceBriefExplanation,
  sources: PinyinReadingSources = {},
): Promise<{ explanation: SentenceBriefExplanation; changed: boolean }> {
  const words = Array.isArray(explanation?.words) ? explanation.words : [];
  if (!words.length) return { explanation, changed: false };
  const { words: fixed, fixes } = await fixReaderWordsPinyin(
    words.map((w) => ({ text: String(w?.hanzi ?? ''), pinyin: String(w?.pinyin ?? ''), gloss: String(w?.gloss ?? '') })),
    sources,
  ).catch(() => ({ words: [], fixes: [] }));
  if (!fixes.length) return { explanation, changed: false };
  return {
    explanation: { ...explanation, words: words.map((w, i) => (fixed[i] && fixed[i].pinyin !== w.pinyin ? { ...w, pinyin: fixed[i].pinyin } : w)) },
    changed: true,
  };
}

/** A stored breakdown (JSON) checked; the same string when nothing changed or it doesn't parse. */
export async function checkExplanationJson(json: string | null, sources: PinyinReadingSources = {}): Promise<string | null> {
  if (!json) return json;
  let parsed: SentenceBriefExplanation;
  try {
    parsed = JSON.parse(json) as SentenceBriefExplanation;
  } catch {
    return json;
  }
  if (!parsed || typeof parsed !== 'object') return json;
  const r = await checkBriefExplanationPinyin(parsed, sources);
  return r.changed ? JSON.stringify(r.explanation) : json;
}

/** The new rows of a set, their pinyin checked (the fields the generator returns). */
export async function checkGeneratedSentencesPinyin<T extends { hanzi: string; pinyin: string }>(
  sentences: T[],
  sources: PinyinReadingSources = {},
): Promise<T[]> {
  const out: T[] = [];
  for (const s of sentences) {
    const pinyin = await checkSentencePinyin(s.hanzi, s.pinyin, sources);
    out.push(pinyin === s.pinyin ? s : { ...s, pinyin });
  }
  return out;
}

export interface SentencePinyinRow {
  id: string;
  note_id: string;
  hanzi: string;
  pinyin: string | null;
  explanation: string | null;
  is_card: number | null;
}

/** What a stored row should hold after the check (the card row's pinyin is the note's — left alone). */
export async function checkStoredSentenceRow(
  row: SentencePinyinRow,
  sources: PinyinReadingSources = {},
): Promise<{ pinyin: string | null; explanation: string | null; changed: boolean }> {
  const pinyin = row.is_card || !row.pinyin ? row.pinyin : await checkSentencePinyin(row.hanzi, row.pinyin, sources);
  const explanation = await checkExplanationJson(row.explanation, sources);
  return { pinyin, explanation, changed: pinyin !== row.pinyin || explanation !== row.explanation };
}

export interface SentencePinyinRepair {
  /** Rows looked at this pass. */
  checked: number;
  /** Rows whose pinyin or breakdown was corrected. */
  fixed: number;
  /** Notes whose rows were bumped (so the devices replace them). */
  note_ids: string[];
  /** True when the pass hit its limit (more rows may be waiting). */
  more: boolean;
}

/** D1 caps bound parameters per statement (100). */
const ID_CHUNK = 90;

/**
 * Check stored rows not yet checked at the current version — one user's (`userId`) or anyone's —
 * at most `limit`. A corrected row is written only while it still holds what was read (a write in
 * between wins; it is checked again next time), and every row of its note gets a new `updated_at`
 * (the devices replace a note's rows whole from `/api/sentences/changes`). Every row looked at is
 * marked checked. Idempotent: a second pass finds nothing.
 */
export async function repairSentencePinyin(
  db: D1Database,
  sources: PinyinReadingSources = {},
  opts: { userId?: string; limit?: number; now?: () => string } = {},
): Promise<SentencePinyinRepair> {
  const limit = Math.max(1, Math.min(2000, opts.limit ?? SENTENCE_PINYIN_REPAIR_LIMIT));
  const stale = '(ns.pinyin_checked IS NULL OR ns.pinyin_checked < ?)';
  const cols = 'ns.id, ns.note_id, ns.hanzi, ns.pinyin, ns.explanation, ns.is_card';
  // One user's: walk their notes (the unary + keeps SQLite off the pinyin_checked index, which would
  // scan everyone's unchecked rows first).
  const rows = opts.userId
    ? await db
        .prepare(`SELECT ${cols} FROM decks d JOIN notes n ON n.deck_id = d.id JOIN note_sentences ns ON ns.note_id = n.id
                  WHERE d.user_id = ? AND (+ns.pinyin_checked IS NULL OR +ns.pinyin_checked < ?)
                  LIMIT ?`)
        .bind(opts.userId, SENTENCE_PINYIN_CHECK_VERSION, limit)
        .all<SentencePinyinRow>()
    : await db.prepare(`SELECT ${cols} FROM note_sentences ns WHERE ${stale} LIMIT ?`).bind(SENTENCE_PINYIN_CHECK_VERSION, limit).all<SentencePinyinRow>();
  const list = rows.results ?? [];
  if (!list.length) return { checked: 0, fixed: 0, note_ids: [], more: false };

  const now = (opts.now ?? (() => new Date().toISOString()))();
  const fixStmts: D1PreparedStatement[] = [];
  const okIds: string[] = [];
  const notes = new Set<string>();
  for (const row of list) {
    const r = await checkStoredSentenceRow(row, sources);
    if (!r.changed) {
      okIds.push(row.id);
      continue;
    }
    notes.add(row.note_id);
    fixStmts.push(
      db
        .prepare(`UPDATE note_sentences SET pinyin = ?, explanation = ?, pinyin_checked = ?, updated_at = ?
                  WHERE id = ? AND hanzi = ? AND pinyin IS ? AND explanation IS ?`)
        .bind(r.pinyin, r.explanation, SENTENCE_PINYIN_CHECK_VERSION, now, row.id, row.hanzi, row.pinyin, row.explanation),
    );
  }
  const stmts: D1PreparedStatement[] = [...fixStmts];
  for (const noteId of notes) {
    stmts.push(db.prepare('UPDATE note_sentences SET updated_at = ? WHERE note_id = ?').bind(now, noteId));
  }
  for (let i = 0; i < okIds.length; i += ID_CHUNK) {
    const chunk = okIds.slice(i, i + ID_CHUNK);
    stmts.push(
      db
        .prepare(`UPDATE note_sentences SET pinyin_checked = ? WHERE id IN (${chunk.map(() => '?').join(', ')})`)
        .bind(SENTENCE_PINYIN_CHECK_VERSION, ...chunk),
    );
  }
  const results = stmts.length ? await db.batch(stmts) : [];
  // A guarded write that found the row changed since it was read wrote nothing (checked again next time).
  const fixed = results.slice(0, fixStmts.length).filter((r) => (r?.meta?.changes ?? 1) > 0).length;
  if (fixed) console.log(`[sentence-pinyin] corrected ${fixed} stored sentence row(s) in ${notes.size} note(s)`);
  return { checked: list.length, fixed, note_ids: [...notes], more: list.length >= limit };
}

/** Per isolate: when a user's rows were last repaired, and users found fully checked. */
const lastUserRun = new Map<string, number>();
const USER_REPAIR_EVERY_MS = 10 * 60_000;
const USER_DONE_FOR_MS = 6 * 60 * 60_000;

/**
 * The lazy per-user pass before `/api/sentences/changes` reads: a user's corrected rows come down in
 * that very sync. Throttled per isolate (every 10 min while rows are left, 6 h once none were), so
 * a sync rarely pays for it. Never throws.
 */
export async function repairUserSentencePinyinSoon(db: D1Database, userId: string, sources: PinyinReadingSources = {}, nowMs = Date.now()): Promise<SentencePinyinRepair | null> {
  const last = lastUserRun.get(userId);
  if (last !== undefined && nowMs < last) return null;
  try {
    const r = await repairSentencePinyin(db, sources, { userId });
    if (lastUserRun.size > 5000) lastUserRun.clear();
    lastUserRun.set(userId, nowMs + (r.more ? 0 : r.checked ? USER_REPAIR_EVERY_MS : USER_DONE_FOR_MS));
    return r;
  } catch (err) {
    console.error('[sentence-pinyin] user repair failed:', err instanceof Error ? err.message : err);
    lastUserRun.set(userId, nowMs + USER_REPAIR_EVERY_MS);
    return null;
  }
}

/** Tests: forget the per-isolate throttle. */
export function resetSentencePinyinThrottle(): void {
  lastUserRun.clear();
}
