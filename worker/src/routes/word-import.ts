/**
 * Endpoints behind the deck page's "Paste a list" importer:
 *
 *   POST /ai/gloss-words              fill in missing pinyin / English for up to 100 words (Haiku)
 *   POST /ai/enrich-words             write the explanation (fun_facts) + example sentence for up to 30 words (Sonnet, card standard)
 *   GET  /decks/:id/student-shares    a tutor's copies of this deck in students' accounts, with
 *                                     how far behind each copy is (for "Update their copy")
 *
 * The notes themselves are created / updated through the existing
 * POST /decks/:deckId/notes and PUT /notes/:id, one request per row, so TTS
 * and sentence-set generation run exactly as for a hand-added word.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { glossWords, MAX_GLOSS_WORDS } from '../services/gloss-words';
import { enrichWords, MAX_ENRICH_WORDS } from '../services/enrich-words';
import { getDeckById } from '../db/queries';
import { sharedCopyDrift } from '../services/relationships';

const wordImport = new Hono<{ Bindings: Env }>();

wordImport.post('/ai/gloss-words', async (c) => {
  const body = await c.req.json<{ words?: Array<{ hanzi?: unknown; pinyin?: unknown; english?: unknown }> }>().catch(() => ({} as { words?: undefined }));
  const words = (body.words || [])
    .filter(w => w && typeof w.hanzi === 'string' && (w.hanzi as string).trim())
    .map(w => ({
      hanzi: (w.hanzi as string).trim(),
      pinyin: typeof w.pinyin === 'string' ? w.pinyin : undefined,
      english: typeof w.english === 'string' ? w.english : undefined,
    }));
  if (words.length === 0) return c.json({ error: 'words is required' }, 400);
  if (words.length > MAX_GLOSS_WORDS) return c.json({ error: `At most ${MAX_GLOSS_WORDS} words per call` }, 400);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured' }, 503);
  try {
    return c.json({ words: await glossWords(c.env.ANTHROPIC_API_KEY, words) });
  } catch (error) {
    console.error('[gloss-words] failed:', error);
    return c.json({ error: 'Could not fill in the words right now' }, 502);
  }
});

wordImport.post('/ai/enrich-words', async (c) => {
  type In = { hanzi?: unknown; pinyin?: unknown; english?: unknown; fun_facts?: unknown; sentence_clue?: unknown };
  const body = await c.req.json<{ words?: In[] }>().catch(() => ({} as { words?: undefined }));
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const words = (body.words || [])
    .filter(w => w && typeof w.hanzi === 'string' && (w.hanzi as string).trim())
    .map(w => ({ hanzi: (w.hanzi as string).trim(), pinyin: s(w.pinyin), english: s(w.english), fun_facts: s(w.fun_facts), sentence_clue: s(w.sentence_clue) }));
  if (words.length === 0) return c.json({ error: 'words is required' }, 400);
  if (words.length > MAX_ENRICH_WORDS) return c.json({ error: `At most ${MAX_ENRICH_WORDS} words per call` }, 400);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured' }, 503);
  try {
    return c.json({ words: await enrichWords(c.env.ANTHROPIC_API_KEY, words) });
  } catch (error) {
    console.error('[enrich-words] failed:', error);
    return c.json({ error: 'Could not write the explanations right now' }, 502);
  }
});

wordImport.get('/decks/:id/student-shares', async (c) => {
  const user = c.get('user');
  const deckId = c.req.param('id');
  const deck = await getDeckById(c.env.DB, deckId, user.id);
  if (!deck) return c.json({ error: 'Deck not found' }, 404);
  const rows = await c.env.DB
    .prepare(
      `SELECT sd.id AS shared_deck_id, sd.relationship_id, sd.target_deck_id, sd.shared_at,
              u.id AS student_id, u.name AS student_name, u.email AS student_email,
              (SELECT COUNT(*) FROM decks td WHERE td.id = sd.target_deck_id) AS target_exists
       FROM shared_decks sd
       JOIN tutor_relationships tr ON tr.id = sd.relationship_id AND tr.status = 'active'
       JOIN users u ON u.id = CASE WHEN tr.requester_id = ? THEN tr.recipient_id ELSE tr.requester_id END
       WHERE sd.source_deck_id = ?
         AND ((tr.requester_id = ? AND tr.requester_role = 'tutor') OR (tr.recipient_id = ? AND tr.requester_role = 'student'))
       ORDER BY sd.shared_at DESC`
    )
    .bind(user.id, deckId, user.id, user.id)
    .all<{
      shared_deck_id: string;
      relationship_id: string;
      target_deck_id: string;
      shared_at: string;
      student_id: string;
      student_name: string | null;
      student_email: string | null;
      target_exists: number;
    }>();
  const shares = [];
  for (const r of rows.results || []) {
    const drift = r.target_exists ? await sharedCopyDrift(c.env.DB, deckId, r.target_deck_id) : { missing: 0, behind: 0 };
    shares.push({
      shared_deck_id: r.shared_deck_id,
      relationship_id: r.relationship_id,
      target_deck_id: r.target_deck_id,
      shared_at: r.shared_at,
      student_id: r.student_id,
      student_name: r.student_name || r.student_email || 'Student',
      target_deleted: !r.target_exists,
      notes_missing: drift.missing,
      notes_behind: drift.behind,
    });
  }
  return c.json({ shares });
});

export default wordImport;
