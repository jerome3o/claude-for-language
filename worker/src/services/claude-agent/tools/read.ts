/**
 * The read tools of a Claude chat turn (tools/registry.ts marks them `read`): run inline by the loop,
 * the result goes straight back to the model. Every query is scoped to the learner's own rows
 * (`ctx.userId`); nothing here reads another account, a tutor's data or `student_profiles`.
 * Moved verbatim from services/ai.ts (Ask Claude's and Discuss with Claude's executors).
 */
import { addBumps, MAX_BUMPS_PER_REQUEST } from '../../study-bumps';
import type { ToolContext } from '../types';

/**
 * "⚡ Study it today" for the in-app agents: bump words the learner ALREADY has to the front of
 * today's study (services/study-bumps.ts, shared/decks/bumps.ts). Runs inline (idempotent, cheap);
 * the result lists what was bumped / already bumped / not found.
 */
export async function executeBumpCardsTool(
  input: Record<string, unknown>,
  ctx: { db: D1Database; userId: string },
  source: string
): Promise<Record<string, unknown>> {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : typeof v === 'string' && v.trim() ? [v] : []);
  const noteIds = strings(input.note_ids).slice(0, MAX_BUMPS_PER_REQUEST);
  const hanzi = strings(input.hanzi).slice(0, MAX_BUMPS_PER_REQUEST);
  if (noteIds.length + hanzi.length === 0) return { error: 'Give note_ids or hanzi' };
  try {
    const r = await addBumps(ctx.db, ctx.userId, { noteIds, hanzi, source });
    return {
      bumped: r.added.map((a) => a.hanzi),
      already_bumped: r.already.map((a) => a.hanzi),
      not_found: r.not_found,
      pocket: r.bumps.map((b) => ({ note_id: b.note_id, hanzi: b.hanzi, deck: b.deck_name })),
      message: r.added.length || r.already.length ? "They come first in today's study." : 'None of those words are in the learner\'s decks — create_flashcards instead.',
    };
  } catch (error) {
    console.error('bump_cards failed:', error);
    return { error: 'Failed to bump the cards' };
  }
}

/** Runs one read tool; failures come back as `{ error }` for the model, never a throw. */
export async function executeReadTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  try {
    switch (toolName) {
      case 'bump_cards':
        return executeBumpCardsTool(input, ctx, ctx.bumpSource);

      case 'search_cards': {
        const query = (input.query as string || '').toLowerCase();
        if (ctx.context === 'chat_message') {
          // Discuss with Claude's search (no sentence column), as before the harness.
          const results = await ctx.db.prepare(`
            SELECT n.id, n.hanzi, n.pinyin, n.english, d.name as deck_name
            FROM notes n
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ?
            AND (LOWER(n.hanzi) LIKE ? OR LOWER(n.pinyin) LIKE ? OR LOWER(n.english) LIKE ?)
            LIMIT 20
          `).bind(ctx.userId, `%${query}%`, `%${query}%`, `%${query}%`).all();
          return { results: results.results || [], count: (results.results || []).length };
        }
        // Search across user's notes
        const results = await ctx.db.prepare(`
          SELECT n.id, n.hanzi, n.pinyin, n.english, n.sentence_clue, d.name as deck_name
          FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE d.user_id = ?
          AND (LOWER(n.hanzi) LIKE ? OR LOWER(n.pinyin) LIKE ? OR LOWER(n.english) LIKE ?)
          LIMIT 20
        `).bind(ctx.userId, `%${query}%`, `%${query}%`, `%${query}%`).all();
        return { results: results.results || [], count: (results.results || []).length };
      }

      case 'list_conversations': {
        const noteId = input.note_id as string | undefined;
        const limit = Math.min((input.limit as number) || 10, 20);
        let results;
        if (noteId) {
          results = await ctx.db.prepare(`
            SELECT nq.id, nq.note_id, nq.question, nq.answer, nq.asked_at, n.hanzi, n.pinyin
            FROM note_questions nq
            JOIN notes n ON nq.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE nq.note_id = ? AND d.user_id = ?
            ORDER BY nq.asked_at DESC
            LIMIT ?
          `).bind(noteId, ctx.userId, limit).all();
        } else {
          results = await ctx.db.prepare(`
            SELECT nq.id, nq.note_id, nq.question, nq.answer, nq.asked_at, n.hanzi, n.pinyin
            FROM note_questions nq
            JOIN notes n ON nq.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ?
            ORDER BY nq.asked_at DESC
            LIMIT ?
          `).bind(ctx.userId, limit).all();
        }
        // Truncate answers for the listing
        const conversations = (results.results || []).map((r: Record<string, unknown>) => ({
          id: r.id,
          note_id: r.note_id,
          hanzi: r.hanzi,
          pinyin: r.pinyin,
          question: r.question,
          answer_preview: (r.answer as string || '').substring(0, 200),
          asked_at: r.asked_at,
        }));
        return { conversations, count: conversations.length };
      }

      case 'get_deck_info': {
        const deck = await ctx.db.prepare(`
          SELECT d.id, d.name, d.description, d.new_cards_per_day, d.created_at,
            (SELECT COUNT(*) FROM notes WHERE deck_id = d.id) as note_count,
            (SELECT COUNT(*) FROM cards c JOIN notes n ON c.note_id = n.id WHERE n.deck_id = d.id) as card_count
          FROM decks d
          WHERE d.id = ? AND d.user_id = ?
        `).bind(ctx.deckId, ctx.userId).first();
        return deck ? { deck } : { error: 'Deck not found' };
      }

      case 'get_note_cards': {
        const noteId = input.note_id as string;
        const note = await ctx.db.prepare(`
          SELECT n.hanzi, n.pinyin, n.english, n.sentence_clue, n.sentence_clue_pinyin, n.sentence_clue_translation, n.sentence_clue_audio_url FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE n.id = ? AND d.user_id = ?
        `).bind(noteId, ctx.userId).first<{ hanzi: string; pinyin: string; english: string; sentence_clue: string | null; sentence_clue_pinyin: string | null; sentence_clue_translation: string | null; sentence_clue_audio_url: string | null }>();
        if (!note) return { error: 'Note not found' };

        const cards = await ctx.db.prepare(`
          SELECT id, card_type, ease_factor, interval, repetitions, queue, next_review_at
          FROM cards WHERE note_id = ?
        `).bind(noteId).all();

        const queueNames: Record<number, string> = { 0: 'new', 1: 'learning', 2: 'review', 3: 'relearning' };
        const cardsWithLabels = (cards.results || []).map((c: Record<string, unknown>) => ({
          ...c,
          queue_name: queueNames[c.queue as number] || 'unknown',
        }));
        return { note: { hanzi: note.hanzi, pinyin: note.pinyin, english: note.english, sentence_clue: note.sentence_clue, sentence_clue_pinyin: note.sentence_clue_pinyin, sentence_clue_translation: note.sentence_clue_translation, sentence_clue_audio_url: note.sentence_clue_audio_url }, cards: cardsWithLabels };
      }

      case 'get_note_history': {
        const noteId = input.note_id as string;
        const noteCheck = await ctx.db.prepare(`
          SELECT n.hanzi, n.pinyin, n.english, n.sentence_clue, n.sentence_clue_pinyin, n.sentence_clue_translation, n.sentence_clue_audio_url FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE n.id = ? AND d.user_id = ?
        `).bind(noteId, ctx.userId).first<{ hanzi: string; pinyin: string; english: string; sentence_clue: string | null; sentence_clue_pinyin: string | null; sentence_clue_translation: string | null; sentence_clue_audio_url: string | null }>();
        if (!noteCheck) return { error: 'Note not found' };

        const reviews = await ctx.db.prepare(`
          SELECT re.rating, re.time_spent_ms, re.user_answer, re.reviewed_at, c.card_type
          FROM review_events re
          JOIN cards c ON re.card_id = c.id
          WHERE c.note_id = ?
          ORDER BY re.reviewed_at DESC
          LIMIT 30
        `).bind(noteId).all<{
          rating: number; time_spent_ms: number | null; user_answer: string | null;
          reviewed_at: string; card_type: string;
        }>();

        const ratingLabels = ['Again', 'Hard', 'Good', 'Easy'];
        const byCardType: Record<string, unknown[]> = {};
        for (const review of reviews.results) {
          if (!byCardType[review.card_type]) byCardType[review.card_type] = [];
          byCardType[review.card_type].push({
            reviewed_at: review.reviewed_at,
            rating: ratingLabels[review.rating] || review.rating,
            time_spent_ms: review.time_spent_ms,
            user_answer: review.user_answer,
          });
        }
        return {
          note: { hanzi: noteCheck.hanzi, pinyin: noteCheck.pinyin, english: noteCheck.english, sentence_clue: noteCheck.sentence_clue, sentence_clue_pinyin: noteCheck.sentence_clue_pinyin, sentence_clue_translation: noteCheck.sentence_clue_translation, sentence_clue_audio_url: noteCheck.sentence_clue_audio_url },
          total_reviews: reviews.results.length,
          history_by_card_type: byCardType,
        };
      }

      case 'get_deck_progress': {
        const cards = await ctx.db.prepare(`
          SELECT c.interval, c.next_review_at, c.card_type, c.ease_factor, c.repetitions,
                 n.hanzi, n.pinyin, n.english, n.id as note_id
          FROM cards c
          JOIN notes n ON c.note_id = n.id
          WHERE n.deck_id = ? AND n.deck_id IN (SELECT id FROM decks WHERE user_id = ?)
          ORDER BY n.hanzi
        `).bind(ctx.deckId, ctx.userId).all();

        const results = cards.results || [];
        const stats = {
          total_cards: results.length,
          new_cards: results.filter((c: Record<string, unknown>) => c.next_review_at === null).length,
          learning: results.filter((c: Record<string, unknown>) => c.next_review_at !== null && (c.interval as number) <= 1).length,
          reviewing: results.filter((c: Record<string, unknown>) => (c.interval as number) > 1 && (c.interval as number) <= 21).length,
          mastered: results.filter((c: Record<string, unknown>) => (c.interval as number) > 21).length,
          due_now: results.filter((c: Record<string, unknown>) =>
            c.next_review_at === null || new Date(c.next_review_at as string) <= new Date()
          ).length,
        };
        return { stats };
      }

      case 'get_due_cards': {
        const limit = Math.min((input.limit as number) || 20, 30);
        const result = await ctx.db.prepare(`
          SELECT c.card_type, c.ease_factor, c.interval, c.repetitions, c.next_review_at,
                 n.hanzi, n.pinyin, n.english, n.id as note_id
          FROM cards c
          JOIN notes n ON c.note_id = n.id
          JOIN decks d ON n.deck_id = d.id
          WHERE d.user_id = ? AND n.deck_id = ?
            AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
          ORDER BY c.next_review_at ASC NULLS LAST
          LIMIT ?
        `).bind(ctx.userId, ctx.deckId, limit).all();
        return { count: (result.results || []).length, cards: result.results || [] };
      }

      case 'get_overall_stats': {
        const [totalCards, cardsDue, studiedToday, totalDecks] = await Promise.all([
          ctx.db.prepare(`
            SELECT COUNT(*) as count FROM cards c
            JOIN notes n ON c.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ?
          `).bind(ctx.userId).first<{ count: number }>(),
          ctx.db.prepare(`
            SELECT COUNT(*) as count FROM cards c
            JOIN notes n ON c.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
          `).bind(ctx.userId).first<{ count: number }>(),
          ctx.db.prepare(`
            SELECT COUNT(*) as count FROM review_events
            WHERE user_id = ? AND date(reviewed_at) = date('now')
          `).bind(ctx.userId).first<{ count: number }>(),
          ctx.db.prepare('SELECT COUNT(*) as count FROM decks WHERE user_id = ?')
            .bind(ctx.userId).first<{ count: number }>(),
        ]);
        return {
          total_decks: totalDecks?.count || 0,
          total_cards: totalCards?.count || 0,
          cards_due_today: cardsDue?.count || 0,
          cards_studied_today: studiedToday?.count || 0,
        };
      }

      case 'list_student_decks': {
        const decks = await ctx.db.prepare(`
          SELECT d.id, d.name, d.description,
            (SELECT COUNT(*) FROM notes WHERE deck_id = d.id) as note_count
          FROM decks d
          WHERE d.user_id = ?
          ORDER BY d.name
        `).bind(ctx.userId).all();
        return { decks: decks.results || [], count: (decks.results || []).length };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`Read-only tool ${toolName} error:`, error);
    return { error: `Failed to execute ${toolName}` };
  }
}
