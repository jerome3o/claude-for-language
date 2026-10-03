/**
 * The tutor sets a student's daily new-card budget (shared/decks/budget.ts — ONE
 * budget per account: N new words + M extra cards a day, filled from the deck queue).
 * TUTOR of an active relationship only; mounted under /api after the auth middleware.
 *
 *   GET /relationships/:relId/student-study-budget
 *       → { budget: StudyBudgetInfo, default, top_deck: { id, name, words_to_go } | null }
 *   PUT /relationships/:relId/student-study-budget  { new_cards_per_day?, secondary_cards_per_day? }
 *       (null = back to the default; same validation as the student's own
 *       PUT /api/profile/study-budget, 400 + problems)
 *       → { budget, changed, message_sent }
 *
 * A change records the tutor as `study_budget_set_by` (the student's Settings shows
 * "Set by <tutor> · 3 Oct"; the student can still change it, last write wins) and
 * posts a short chat message from the tutor through the normal send path (unread
 * badge, live, push). The student's own decks and their caps are never touched.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { budgetChangeMessage, DEFAULT_STUDY_BUDGET, pickStudyBudgetUpdate, type StudyBudgetInfo } from '@shared/decks';
import { getStudyBudgetInfo, setStudyBudget } from '../db/queries';
import { fetchLastConversationId } from '../db/tutor-dashboard-queries';
import { createConversation, sendMessage } from '../services/conversations';
import { guardTutorOf } from './student-profile';
import { background, deliverSentMessage } from './chat-live';

const studentStudyBudget = new Hono<{ Bindings: Env }>();

const FORBIDDEN = "Only the student's tutor can change their daily new cards";

export interface TopDeck {
  id: string;
  name: string;
  words_to_go: number;
}

/**
 * The first deck in the student's study queue that still has words to introduce
 * (what the tutor's sheet hints about: "At 5 a day, <deck> finishes in ~9 days").
 * Decks with a cap of 0 never introduce anything; words switched off long-term are left out.
 */
export async function fetchTopDeck(db: D1Database, studentId: string): Promise<TopDeck | null> {
  const res = await db
    .prepare(
      `SELECT d.id, d.name,
              (SELECT COUNT(*) FROM notes n
                WHERE n.deck_id = d.id AND COALESCE(n.long_term, 1) != 0
                  AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.note_id = n.id AND COALESCE(c.queue, 0) != 0)) AS words_to_go
       FROM decks d
       WHERE d.user_id = ? AND COALESCE(d.new_cards_per_day, 1) > 0
       ORDER BY COALESCE(d.study_priority, 0) DESC, d.created_at DESC
       LIMIT 20`
    )
    .bind(studentId)
    .all<TopDeck>();
  return (res.results ?? []).find((d) => d.words_to_go > 0) ?? null;
}

function sameNumbers(a: StudyBudgetInfo, b: StudyBudgetInfo): boolean {
  return a.new_cards_per_day === b.new_cards_per_day && a.secondary_cards_per_day === b.secondary_cards_per_day && a.is_default === b.is_default;
}

studentStudyBudget.get('/relationships/:relId/student-study-budget', async (c) => {
  const userId = c.get('user').id;
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), userId);
  if (!g.ok) return c.json({ error: g.status === 403 ? FORBIDDEN : g.error }, g.status);
  const [budget, top_deck] = await Promise.all([getStudyBudgetInfo(c.env.DB, g.studentId), fetchTopDeck(c.env.DB, g.studentId)]);
  return c.json({ budget, default: DEFAULT_STUDY_BUDGET, top_deck });
});

studentStudyBudget.put('/relationships/:relId/student-study-budget', async (c) => {
  const user = c.get('user');
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), user.id);
  if (!g.ok) return c.json({ error: g.status === 403 ? FORBIDDEN : g.error }, g.status);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const { update, problems } = pickStudyBudgetUpdate(body);
  if (problems.length) return c.json({ error: problems.join('; '), problems }, 400);
  if (update.new_cards_per_day === undefined && update.secondary_cards_per_day === undefined) {
    const msg = 'Send new_cards_per_day and/or secondary_cards_per_day (a number 0–200, or null for the default)';
    return c.json({ error: msg, problems: [msg] }, 400);
  }

  const before = await getStudyBudgetInfo(c.env.DB, g.studentId);
  const budget = await setStudyBudget(c.env.DB, g.studentId, update, user.id);
  const changed = !sameNumbers(before, budget);

  // Tell the student in the chat, as the tutor, through the normal send path.
  let message_sent = false;
  if (changed) {
    try {
      let conversationId = await fetchLastConversationId(c.env.DB, g.rel.id);
      if (!conversationId) conversationId = (await createConversation(c.env.DB, g.rel.id, user.id, {})).id;
      const sent = await sendMessage(c.env.DB, conversationId, user.id, budgetChangeMessage(budget, budget.is_default));
      const { duplicate: _duplicate, ...message } = sent;
      await background(c, deliverSentMessage(c.env, conversationId, user.id, message));
      message_sent = true;
    } catch (err) {
      console.error('[student-study-budget] chat message failed:', err);
    }
  }
  return c.json({ budget, changed, message_sent });
});

export default studentStudyBudget;
