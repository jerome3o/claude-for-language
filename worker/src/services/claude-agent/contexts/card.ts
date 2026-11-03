/**
 * Context `card` — Ask Claude on a study card (routes/ask-claude.ts, docs/STUDY_SESSION.md "Ask Claude").
 *
 * load: the note (ownership-checked, unless the route already did) + ONE `db.batch` for the deck list,
 * the learner's bio, the card states, the last 5 reviews and (Chinese answers) the known-words sample.
 * The card's facts ride in the FIRST user message ("The user is studying this vocabulary: …"), never
 * in the tools or the system prompt, so the cached prefix is the same for every card.
 */
import { plainAnswerText, type AskLanguage } from '@shared/study/askClaude';
import * as queries from '../../../db/queries';
import type { Note } from '../../../types';
import { knownWordsStatement } from '../learner';
import { buildAskSystemBlocks } from '../persona';
import { ClaudeContextError, type ChatTurn, type ContextProvider, type ToolName } from '../types';

// Helper: human-readable time ago string
function getTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export interface AskDbContext {
  db: D1Database;
  userId: string;
  deckId: string;
  /** Where a bump_cards call comes from (analytics / the bump's source). */
  bumpSource?: string;
}

/** What Ask Claude reads from D1 before the call — ONE `db.batch` (one round trip). */
export interface AskNoteContext {
  /** Lines for the card's context ("- Deck: …"). */
  lines: string[];
  knownWords: string[];
}

export async function loadAskNoteContext(dbContext: AskDbContext, note: Note, language: AskLanguage): Promise<AskNoteContext> {
  const { db, userId, deckId } = dbContext;
  const lines: string[] = [];
  const statements: D1PreparedStatement[] = [
    db.prepare(`SELECT id, name, description FROM decks WHERE user_id = ? ORDER BY name`).bind(userId),
    db.prepare('SELECT bio FROM users WHERE id = ?').bind(userId),
    db.prepare(`SELECT card_type, queue, ease_factor, interval, repetitions, stability FROM cards WHERE note_id = ?`).bind(note.id),
    db.prepare(`
      SELECT re.rating, re.reviewed_at, c.card_type
      FROM review_events re
      JOIN cards c ON re.card_id = c.id
      WHERE c.note_id = ?
      ORDER BY re.reviewed_at DESC
      LIMIT 5
    `).bind(note.id),
  ];
  if (language === 'zh') statements.push(knownWordsStatement(db, userId));
  let results: D1Result<Record<string, unknown>>[];
  try {
    results = await db.batch<Record<string, unknown>>(statements);
  } catch (err) {
    console.error('[claude-agent card] Failed to fetch enhanced context:', err);
    return { lines, knownWords: [] };
  }
  const rowsOf = <T>(i: number) => ((results[i]?.results ?? []) as unknown) as T[];

  const decks = rowsOf<{ id: string; name: string; description: string | null }>(0);
  const deck = decks.find((d) => d.id === deckId);
  if (deck) lines.push(`- Deck: ${deck.name}${deck.description ? ` — ${deck.description}` : ''}`);
  // Every deck, so Claude knows where cross-deck cards can go.
  if (decks.length > 1) {
    lines.push(`- User's decks: ${decks.map((d) => (d.id === deckId ? `${d.name} (id: ${d.id}) [current]` : `${d.name} (id: ${d.id})`)).join(', ')}`);
  }

  const bio = rowsOf<{ bio: string | null }>(1)[0]?.bio;
  if (bio) lines.push(`- Learner bio: ${bio}`);

  // Card mastery (every card type of this note).
  const cards = rowsOf<{ card_type: string; queue: number; ease_factor: number; interval: number; repetitions: number; stability: number | null }>(2);
  if (cards.length > 0) {
    const queueNames: Record<number, string> = { 0: 'new', 1: 'learning', 2: 'review', 3: 'relearning' };
    const cardSummaries = cards.map((c) => {
      const parts = [`${c.card_type}: ${queueNames[c.queue] || 'unknown'}`];
      if (c.queue === 2) { // REVIEW
        parts.push(`interval ${c.interval}d`);
        if (c.stability) parts.push(`stability ${Math.round(c.stability)}d`);
      }
      if (c.repetitions > 0) parts.push(`${c.repetitions} reps`);
      return parts.join(', ');
    });
    lines.push(`- Card status: ${cardSummaries.join(' | ')}`);
  }

  // The last 5 reviews.
  const reviews = rowsOf<{ rating: number; reviewed_at: string; card_type: string }>(3);
  if (reviews.length > 0) {
    const ratingNames: Record<number, string> = { 0: 'Again', 1: 'Hard', 2: 'Good', 3: 'Easy' };
    lines.push(`- Recent reviews: ${reviews.map((r) => `${ratingNames[r.rating] || r.rating} on ${r.card_type} (${getTimeAgo(r.reviewed_at)})`).join(', ')}`);
  }

  const knownWords = language === 'zh' ? rowsOf<{ hanzi: string }>(4).map((r) => r.hanzi).filter(Boolean) : [];
  return { lines, knownWords };
}

/** The card's facts, as the first user message opens with them. */
export function cardFacts(note: Note, lines: string[], typed?: { answer: string; correct?: string }): string {
  const parts = [
    `The user is studying this vocabulary:`,
    `- Chinese: ${note.hanzi}`,
    `- Pinyin: ${note.pinyin}`,
    `- English: ${note.english}`,
  ];
  if (note.fun_facts) parts.push(`- Notes: ${note.fun_facts}`);
  if (note.sentence_clue) {
    let clueStr = `- Sentence clue: ${note.sentence_clue}`;
    if (note.sentence_clue_pinyin) clueStr += ` (${note.sentence_clue_pinyin})`;
    if (note.sentence_clue_translation) clueStr += ` — ${note.sentence_clue_translation}`;
    if (note.sentence_clue_audio_url) clueStr += ' (has audio)';
    parts.push(clueStr);
  }
  parts.push(...lines);
  if (typed?.answer) {
    parts.push('');
    parts.push(`The user was asked to write the Chinese characters.`);
    parts.push(`User's answer: ${typed.answer}`);
    parts.push(`Correct answer: ${typed.correct || note.hanzi}`);
  }
  return parts.join('\n');
}

/** Ask Claude's Q&A history (question / answer pairs) as the conversation, the new question last. */
export function askTurns(question: string, history?: ReadonlyArray<{ question: string; answer: string }>): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const h of history ?? []) {
    turns.push({ role: 'user', content: h.question });
    turns.push({ role: 'assistant', content: h.answer });
  }
  turns.push({ role: 'user', content: question });
  return turns;
}

/** Ask Claude's tools, in the order the model sees them (the start of the cached prefix). */
export const CARD_TOOLS: readonly ToolName[] = [
  'edit_current_card',
  'create_flashcards',
  'delete_current_card',
  'create_custom_lesson',
  'search_cards',
  'bump_cards',
  'list_conversations',
  'get_deck_info',
  'get_note_cards',
  'get_note_history',
  'get_deck_progress',
  'get_due_cards',
  'get_overall_stats',
];

interface CardData {
  note: Note;
  facts: string;
  language: AskLanguage;
  knownWords: string[];
}

export const cardContext: ContextProvider<'card', CardData> = {
  kind: 'card',
  surface: 'ask',
  policy: 'chat',
  maxRounds: 5,
  async load(env, ctx, input) {
    const note = ctx.note ?? (await queries.getNoteById(env.DB, ctx.note_id, input.userId));
    if (!note) throw new ClaudeContextError('Note not found', 404);
    const language: AskLanguage = input.language ?? 'en';
    const loaded = await loadAskNoteContext({ db: env.DB, userId: input.userId, deckId: note.deck_id }, note, language);
    return { note, facts: cardFacts(note, loaded.lines, ctx.typed), language, knownWords: loaded.knownWords };
  },
  persona: (d) => buildAskSystemBlocks({ language: d.language, knownWords: d.knownWords })[0],
  learner: (d) => buildAskSystemBlocks({ language: d.language, knownWords: d.knownWords })[1],
  systemBlock: () => '',
  frameFirstTurn: (d, content) => `${d.facts}\n\nUser's question: ${content}`,
  tools: () => CARD_TOOLS,
  toolContext: (d, input) => ({ deckId: d.note.deck_id, bumpSource: input.bumpSource ?? 'ask_claude' }),
  deferredAck: (tool) => `Tool ${tool} will be executed after user approval`,
  finish: (text, input) => ((input.language ?? 'en') === 'zh' ? plainAnswerText(text) : text),
};
