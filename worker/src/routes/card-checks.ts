/**
 * Word checks (services/card-check.ts, shared/cards/check.ts). Mounted under /api
 * after the auth middleware.
 *
 *   POST /ai/check-words  { words: [{ hanzi, pinyin, english }] } (≤ 60)
 *        → { issues: [{ index, field, kind, current, proposed, reason }], model }
 *        Paste a list's preview and the MCP pre-check. Nothing is stored.
 *   PUT  /profile/card-check  { card_check: boolean | null }  → { card_check, card_check_setting }
 *   POST /notes/check  { note_ids } (≤ 100) → { issues: { [noteId]: NoteCheckIssue[] } } — runs now, stores
 *   POST /notes/:id/check-issues/:issueId/apply    → { note }  (the fix through updateNote)
 *   POST /notes/:id/check-issues/:issueId/dismiss  → { note }
 *
 *   GET  /decks/:id/check        → { estimate, job | null }   (my deck)
 *   POST /decks/:id/check        → 202 { job }
 *   GET  /relationships/:relId/shared-decks/:id/check  → { estimate, job, deck_name, can_fix_source }  (tutor; the student's copy)
 *   POST /relationships/:relId/shared-decks/:id/check  → 202 { job }
 *   GET  /deck-checks/:jobId     → { job }
 *   POST /deck-checks/:jobId/apply  { proposal_ids, also_source? } → { applied, source_applied, failed, job }
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import * as content from '../services/content';
import {
  applyDeckCheck,
  cardCheckEnabled,
  CheckError,
  checkWords,
  countDeckWords,
  getDeckCheckJob,
  jobToApi,
  latestDeckCheck,
  modelAvailable,
  removeNoteIssue,
  runNotesCheck,
  setCardCheck,
  startDeckCheck,
} from '../services/card-check';
import { estimateCheckCost, type CheckWord } from '@shared/cards/check';
import { guardTutorOf } from './student-profile';
import { getNoteById } from '../db/queries';

const cardChecks = new Hono<{ Bindings: Env }>();

function fail(c: { json: (body: unknown, status: number) => Response }, err: unknown): Response {
  if (err instanceof CheckError) return c.json({ error: err.message }, err.status);
  if (err instanceof content.ContentError) return c.json({ error: err.message }, err.status ?? 400);
  throw err;
}

function cleanWords(raw: unknown): CheckWord[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map(w => ({ hanzi: String(w.hanzi ?? '').trim(), pinyin: String(w.pinyin ?? '').trim(), english: String(w.english ?? '').trim() }));
}

cardChecks.post('/ai/check-words', async (c) => {
  const body = await c.req.json<{ words?: unknown }>().catch(() => ({} as { words?: unknown }));
  const words = cleanWords(body.words);
  if (!words || words.length === 0) return c.json({ error: 'words must be a non-empty array' }, 400);
  if (words.length > 60) return c.json({ error: 'At most 60 words per check' }, 400);
  // Rows without hanzi or pinyin have nothing to check; keep their indexes.
  const usable = words.map((w, i) => ({ w, i })).filter(({ w }) => w.hanzi && w.pinyin);
  const found = await checkWords(c.env, usable.map(u => u.w));
  const issues = found.map(f => ({ ...f, index: usable[f.index].i }));
  return c.json({ issues, model: modelAvailable(c.env) });
});

cardChecks.put('/profile/card-check', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ card_check?: unknown }>().catch(() => ({} as { card_check?: unknown }));
  const v = body.card_check;
  if (v !== null && typeof v !== 'boolean') return c.json({ error: 'card_check must be true, false or null' }, 400);
  await setCardCheck(c.env.DB, userId, v);
  return c.json({ card_check: await cardCheckEnabled(c.env.DB, userId), card_check_setting: v });
});

cardChecks.post('/notes/check', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ note_ids?: unknown }>().catch(() => ({} as { note_ids?: unknown }));
  const ids = Array.isArray(body.note_ids) ? body.note_ids.filter((x): x is string => typeof x === 'string') : [];
  if (!ids.length) return c.json({ error: 'note_ids must be a non-empty array' }, 400);
  if (ids.length > 100) return c.json({ error: 'At most 100 notes per check' }, 400);
  const result = await runNotesCheck(c.env, userId, ids);
  return c.json({ issues: Object.fromEntries(result) });
});

cardChecks.post('/notes/:id/check-issues/:issueId/apply', async (c) => {
  const userId = c.get('user').id;
  const noteId = c.req.param('id');
  try {
    const note = await getNoteById(c.env.DB, noteId, userId);
    if (!note) return c.json({ error: 'Note not found' }, 404);
    const { issue } = await removeNoteIssue(c.env.DB, userId, noteId, c.req.param('issueId'));
    const current = issue.field === 'pinyin' ? note.pinyin : note.english;
    if (current.trim() !== issue.current.trim()) throw new CheckError('The word was edited since the check', 409);
    const updated = await content.updateNote(c.env, userId, noteId, { [issue.field]: issue.proposed }, c.executionCtx, { check: false });
    return c.json({ note: updated, applied: issue });
  } catch (err) {
    return fail(c, err);
  }
});

cardChecks.post('/notes/:id/check-issues/:issueId/dismiss', async (c) => {
  const userId = c.get('user').id;
  const noteId = c.req.param('id');
  try {
    await removeNoteIssue(c.env.DB, userId, noteId, c.req.param('issueId'));
    return c.json({ note: await getNoteById(c.env.DB, noteId, userId) });
  } catch (err) {
    return fail(c, err);
  }
});

// ---- deck checks ----

async function ownDeck(db: D1Database, deckId: string, userId: string): Promise<{ id: string; name: string } | null> {
  return db.prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?').bind(deckId, userId).first<{ id: string; name: string }>();
}

cardChecks.get('/decks/:id/check', async (c) => {
  const userId = c.get('user').id;
  const deck = await ownDeck(c.env.DB, c.req.param('id'), userId);
  if (!deck) return c.json({ error: 'Deck not found' }, 404);
  const [words, job] = await Promise.all([countDeckWords(c.env.DB, deck.id), latestDeckCheck(c.env.DB, userId, deck.id)]);
  return c.json({ estimate: estimateCheckCost(words), job: job ? jobToApi(job) : null, deck_name: deck.name, can_fix_source: false });
});

cardChecks.post('/decks/:id/check', async (c) => {
  const userId = c.get('user').id;
  const deck = await ownDeck(c.env.DB, c.req.param('id'), userId);
  if (!deck) return c.json({ error: 'Deck not found' }, 404);
  try {
    const job = await startDeckCheck(c.env, { userId, deckId: deck.id, deckOwnerId: userId }, c.executionCtx);
    return c.json({ job: jobToApi(job) }, 202);
  } catch (err) {
    return fail(c, err);
  }
});

interface ShareInfo {
  target_deck_id: string;
  source_deck_id: string;
  deck_name: string | null;
  owns_source: number;
}

async function findShare(db: D1Database, relId: string, idOrDeckId: string, tutorId: string, studentId: string): Promise<ShareInfo | null> {
  return db
    .prepare(
      `SELECT s.target_deck_id, s.source_deck_id, t.name AS deck_name,
              EXISTS (SELECT 1 FROM decks src WHERE src.id = s.source_deck_id AND src.user_id = ?) AS owns_source
         FROM shared_decks s JOIN decks t ON t.id = s.target_deck_id AND t.user_id = ?
        WHERE s.relationship_id = ? AND (s.id = ? OR s.target_deck_id = ?)
        ORDER BY s.shared_at DESC LIMIT 1`
    )
    .bind(tutorId, studentId, relId, idOrDeckId, idOrDeckId)
    .first<ShareInfo>();
}

const TUTOR_ONLY = "Only the student's tutor can check a homework deck she sent";

cardChecks.get('/relationships/:relId/shared-decks/:id/check', async (c) => {
  const userId = c.get('user').id;
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), userId);
  if (!g.ok) return c.json({ error: g.status === 403 ? TUTOR_ONLY : g.error }, g.status);
  const share = await findShare(c.env.DB, g.rel.id, c.req.param('id'), userId, g.studentId);
  if (!share) return c.json({ error: "The student's copy of this deck is gone" }, 404);
  const [words, job] = await Promise.all([countDeckWords(c.env.DB, share.target_deck_id), latestDeckCheck(c.env.DB, userId, share.target_deck_id)]);
  return c.json({ estimate: estimateCheckCost(words), job: job ? jobToApi(job) : null, deck_name: share.deck_name, can_fix_source: !!share.owns_source });
});

cardChecks.post('/relationships/:relId/shared-decks/:id/check', async (c) => {
  const userId = c.get('user').id;
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), userId);
  if (!g.ok) return c.json({ error: g.status === 403 ? TUTOR_ONLY : g.error }, g.status);
  const share = await findShare(c.env.DB, g.rel.id, c.req.param('id'), userId, g.studentId);
  if (!share) return c.json({ error: "The student's copy of this deck is gone" }, 404);
  try {
    const job = await startDeckCheck(
      c.env,
      { userId, deckId: share.target_deck_id, deckOwnerId: g.studentId, relationshipId: g.rel.id, sourceDeckId: share.owns_source ? share.source_deck_id : null },
      c.executionCtx
    );
    return c.json({ job: jobToApi(job) }, 202);
  } catch (err) {
    return fail(c, err);
  }
});

cardChecks.get('/deck-checks/:jobId', async (c) => {
  const userId = c.get('user').id;
  const job = await getDeckCheckJob(c.env.DB, c.req.param('jobId'));
  if (!job || job.user_id !== userId) return c.json({ error: 'Check not found' }, 404);
  return c.json({ job: jobToApi(job) });
});

cardChecks.post('/deck-checks/:jobId/apply', async (c) => {
  const userId = c.get('user').id;
  const job = await getDeckCheckJob(c.env.DB, c.req.param('jobId'));
  if (!job || job.user_id !== userId) return c.json({ error: 'Check not found' }, 404);
  if (job.status !== 'done') return c.json({ error: 'The check is still running' }, 409);
  if (job.relationship_id) {
    const g = await guardTutorOf(c.env.DB, job.relationship_id, userId);
    if (!g.ok || g.studentId !== job.deck_owner_id) return c.json({ error: TUTOR_ONLY }, 403);
  } else if (job.deck_owner_id !== userId) {
    return c.json({ error: 'Check not found' }, 404);
  }
  const body = await c.req.json<{ proposal_ids?: unknown; also_source?: unknown }>().catch(() => ({} as { proposal_ids?: unknown; also_source?: unknown }));
  const ids = Array.isArray(body.proposal_ids) ? body.proposal_ids.filter((x): x is string => typeof x === 'string') : [];
  if (!ids.length) return c.json({ error: 'Choose at least one fix to apply' }, 400);
  const result = await applyDeckCheck(c.env, job, ids, body.also_source === true, (ownerId, noteId, patch) =>
    content.updateNote(c.env, ownerId, noteId, patch, c.executionCtx, { check: false })
  );
  return c.json(result);
});

export default cardChecks;
