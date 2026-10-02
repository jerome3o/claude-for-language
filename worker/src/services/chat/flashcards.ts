/**
 * "Make flashcards from this chat" (docs/CHAT.md PR 3):
 * `POST /api/conversations/:id/flashcards/propose { message_ids?, since?, focus? }`
 * → `{ cards: [FlashcardItem + { already_have, source_message_id }] }`.
 *
 * Nothing is saved here: the client shows the proposals in a review sheet and
 * adds the ones kept with `POST /api/decks/:id/notes/batch` (the content
 * service validates them again). One `structuredCall` (Sonnet, thinking off,
 * forced tool) with the card standard in the prompt and the shared
 * FLASHCARD_ITEM_SCHEMA; items breaking a HARD rule are repaired (a bad
 * sentence clue is dropped) or dropped. `already_have` = the normalised hanzi
 * is already one of the CALLER's notes (whoever asks adds to their own decks).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { CARD_STANDARD, cardTextProblems } from '@shared/cards/standard';
import { normalizeHanziAnswer } from '@shared/lesson/answer-check';
import type { Env, TutorRelationship } from '../../types';
import { FLASHCARD_ITEM_SCHEMA } from '../ai';
import { structuredCall } from '../structured-call';
import { ChatMessageError } from './messages';
import { parseStoredAttachment } from './media';
import { getConversationParticipants, normalizeTimestamp } from './reads';
import { HAN, parseCorrection } from './words';

export const PROPOSE_MODEL = 'claude-sonnet-5';
/** At most this many messages go to Claude (the newest ones of the selection). */
export const MAX_CONTEXT_MESSAGES = 80;
/** …and at most this many characters of transcript. */
export const MAX_CONTEXT_CHARS = 12_000;
/** Without a selection or `since`: the last 50 messages. */
export const DEFAULT_CONTEXT_MESSAGES = 50;
export const MAX_PROPOSED_CARDS = 15;
const MAX_LINE_CHARS = 1500;

export type ProposeFocus = 'correction';

export interface ProposeRequest {
  message_ids?: string[];
  since?: string;
  focus?: ProposeFocus;
}

export interface ProposedCard {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
  already_have: boolean;
  /** The chat message the card comes from (null when Claude did not say). */
  source_message_id: string | null;
}

/** The request body → a clean request, or ChatMessageError 400. */
export function parseProposeRequest(body: unknown): ProposeRequest {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const req: ProposeRequest = {};
  if (o.message_ids !== undefined && o.message_ids !== null) {
    if (!Array.isArray(o.message_ids) || o.message_ids.some((id) => typeof id !== 'string' || !id || id.length > 100)) {
      throw new ChatMessageError('message_ids must be a list of message ids', 400);
    }
    const ids = [...new Set(o.message_ids as string[])];
    if (ids.length > MAX_CONTEXT_MESSAGES) throw new ChatMessageError(`Pick at most ${MAX_CONTEXT_MESSAGES} messages`, 400);
    if (ids.length > 0) req.message_ids = ids;
  }
  if (o.since !== undefined && o.since !== null && o.since !== '') {
    const since = normalizeTimestamp(o.since);
    if (!since) throw new ChatMessageError('since must be an ISO timestamp', 400);
    req.since = since;
  }
  if (o.focus !== undefined && o.focus !== null) {
    if (o.focus !== 'correction') throw new ChatMessageError("focus must be 'correction'", 400);
    req.focus = 'correction';
  }
  return req;
}

// ---------- Context ----------

interface ContextRow {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  attachment: string | null;
  correction: string | null;
  sender_name: string | null;
}

export interface ChatContext {
  /** Numbered transcript, oldest first: `#1 Minghui (tutor): …`. */
  text: string;
  /** Line number (1-based) → message id. */
  ids: string[];
  /** Messages that carry a correction (for focus 'correction'). */
  corrected: number;
  correctedIds: Set<string>;
  learnerName: string;
}

/** What a message says, as a transcript line's text ('' = nothing to show). */
function messageText(row: ContextRow): string {
  const att = parseStoredAttachment(row.attachment);
  if (att?.kind === 'voice') {
    const t = att.transcript_status === 'done' ? (att.transcript ?? '').trim() : '';
    return t ? `🎤 ${t}` : '';
  }
  if (att?.kind === 'image') {
    const caption = row.content.trim();
    return caption ? `📷 ${caption}` : '';
  }
  return row.content.trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/**
 * The messages to make cards from, as a numbered transcript within the limits
 * (≤ 80 messages, ≤ 12k characters — the newest kept). A tutor's correction
 * follows its message as `✏️ correction: <original> → <corrected> (note)`.
 */
export async function buildChatContext(
  db: D1Database,
  conversationId: string,
  roles: { tutorId: string | null; studentId: string | null },
  req: ProposeRequest,
): Promise<ChatContext> {
  const where = ['m.conversation_id = ?', 'm.deleted_at IS NULL'];
  const params: string[] = [conversationId];
  if (req.message_ids?.length) {
    where.push(`m.id IN (${req.message_ids.map(() => '?').join(',')})`);
    params.push(...req.message_ids);
  }
  if (req.since) {
    where.push('m.created_at > ?');
    params.push(req.since);
  }
  if (req.focus === 'correction') where.push('m.correction IS NOT NULL');
  const limit = req.message_ids?.length || req.since || req.focus ? MAX_CONTEXT_MESSAGES : DEFAULT_CONTEXT_MESSAGES;
  const rows = await db
    .prepare(
      `SELECT m.id, m.sender_id, m.content, m.created_at, m.attachment, m.correction, u.name AS sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.created_at DESC
        LIMIT ${limit}`,
    )
    .bind(...params)
    .all<ContextRow>();

  // Newest first until the character budget is spent, then back to oldest first.
  const picked: Array<{ row: ContextRow; body: string; correction: string | null }> = [];
  let chars = 0;
  for (const row of rows.results ?? []) {
    const body = clip(messageText(row), MAX_LINE_CHARS);
    const corr = parseCorrection(row.correction);
    if (!body && !corr) continue;
    const correction = corr
      ? `✏️ correction: ${clip(row.content.trim(), MAX_LINE_CHARS)} → ${clip(corr.text, MAX_LINE_CHARS)}${corr.note ? ` (${clip(corr.note, 600)})` : ''}`
      : null;
    const size = body.length + (correction?.length ?? 0) + 40;
    if (picked.length > 0 && chars + size > MAX_CONTEXT_CHARS) break;
    chars += size;
    picked.push({ row, body, correction });
  }
  picked.reverse();

  const role = (id: string) => (id === roles.tutorId ? 'tutor' : id === roles.studentId ? 'student' : 'other');
  const lines: string[] = [];
  const ids: string[] = [];
  let corrected = 0;
  const correctedIds = new Set<string>();
  picked.forEach(({ row, body, correction }, i) => {
    ids.push(row.id);
    lines.push(`#${i + 1} ${row.sender_name || 'Someone'} (${role(row.sender_id)}): ${body}`);
    if (correction) {
      corrected++;
      correctedIds.add(row.id);
      lines.push(`   ${correction}`);
    }
  });
  let learnerName = 'the student';
  if (roles.studentId) {
    const learner = (rows.results ?? []).find((r) => r.sender_id === roles.studentId);
    if (learner?.sender_name) learnerName = learner.sender_name;
    else {
      const u = await db.prepare('SELECT name FROM users WHERE id = ?').bind(roles.studentId).first<{ name: string | null }>();
      if (u?.name) learnerName = u.name;
    }
  }
  return { text: lines.join('\n'), ids, corrected, correctedIds, learnerName };
}

// ---------- The call ----------

const SYSTEM = `You make flashcards for a learner of Chinese from a chat with their tutor.

Read the numbered chat and propose the cards most worth studying, in this order of priority:
1. The tutor's corrections (lines marked ✏️ correction: original → corrected) and anything the learner got wrong: the card teaches the CORRECT version — hanzi is the corrected sentence (or the corrected word), and fun_facts says what was wrong in the original and why. Never make a card of the wrong version.
2. Words, phrases and structures the tutor introduced, explained or used that the learner is likely not to know.
3. Useful phrases from the chat the learner would want to say themselves.
Skip what any beginner knows (你好, 谢谢, 我) unless it was corrected, skip English-only chatter, and never duplicate a card. Fewer good cards beat many weak ones: at most 12, none when nothing is worth it.

For each card give source: the #number of the chat line it comes from.

${CARD_STANDARD}`;

const CORRECTION_SYSTEM = `You make flashcards for a learner of Chinese from their tutor's correction of a message they wrote.

Each chat line below is the learner's message, followed by "✏️ correction: original → corrected (tutor's note)".
Make ONE card per correction — two at most when the correction teaches a separate word worth its own card:
- The first card's hanzi is the CORRECTED sentence exactly as the tutor wrote it (only drop characters the card standard forbids); pinyin and english are for the corrected sentence.
- fun_facts: first what was wrong in the original and why (in one or two lines, using the tutor's note), then gloss every word of the corrected sentence and its structure, per the card standard.
- An optional second card is the key word or pattern that was wrong, with its own sentence_clue.
- Never make a card of the original, wrong version.

For each card give source: the #number of the chat line it comes from.

${CARD_STANDARD}`;

function proposeTool(): { name: string; description: string; input_schema: Anthropic.Tool.InputSchema } {
  return {
    name: 'propose_flashcards',
    description: 'The flashcards proposed from this chat, most important first.',
    input_schema: {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          maxItems: MAX_PROPOSED_CARDS,
          items: {
            type: 'object',
            properties: {
              ...FLASHCARD_ITEM_SCHEMA.properties,
              source: { type: 'integer', description: 'The #number of the chat line this card comes from.' },
            },
            required: [...FLASHCARD_ITEM_SCHEMA.required, 'source'],
          },
        },
      },
      required: ['cards'],
    },
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Claude's cards → clean proposals (without `already_have`). A card whose
 * hanzi / pinyin break a HARD rule, or that lacks hanzi / pinyin / english, is
 * dropped; a sentence clue that breaks one, or does not contain the word, is
 * dropped from its card. Duplicates (same normalised hanzi) are dropped.
 */
export function normalizeProposedCards(raw: unknown, ids: string[]): Array<Omit<ProposedCard, 'already_have'>> {
  const list = (raw as { cards?: unknown })?.cards;
  if (!Array.isArray(list)) throw new Error('No cards in the reply');
  const out: Array<Omit<ProposedCard, 'already_have'>> = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const hanzi = str(o.hanzi);
    const pinyin = str(o.pinyin);
    const english = str(o.english);
    if (!hanzi || !pinyin || !english || !HAN.test(hanzi)) continue;
    if (cardTextProblems({ hanzi, pinyin }).length > 0) continue;
    const key = normalizeHanziAnswer(hanzi);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const card: Omit<ProposedCard, 'already_have'> = {
      hanzi,
      pinyin,
      english,
      fun_facts: str(o.fun_facts),
      source_message_id: null,
    };
    const clue = str(o.sentence_clue);
    if (clue && clue !== hanzi && clue.includes(hanzi) && cardTextProblems({ sentence_clue: clue }).length === 0) {
      card.sentence_clue = clue;
      const cluePinyin = str(o.sentence_clue_pinyin);
      const clueTranslation = str(o.sentence_clue_translation);
      if (cluePinyin) card.sentence_clue_pinyin = cluePinyin;
      if (clueTranslation) card.sentence_clue_translation = clueTranslation;
    }
    const source = typeof o.source === 'number' ? o.source : typeof o.source === 'string' ? Number(o.source.replace(/^#/, '')) : NaN;
    if (Number.isInteger(source) && source >= 1 && source <= ids.length) card.source_message_id = ids[source - 1];
    out.push(card);
    if (out.length >= MAX_PROPOSED_CARDS) break;
  }
  // Claude proposed cards but every one broke the rules: worth another try.
  if (out.length === 0 && list.length > 0) throw new Error('Every proposed card broke the card standard');
  return out;
}

/** The normalised hanzi of every note in the user's decks. */
async function knownHanzi(db: D1Database, userId: string): Promise<Set<string>> {
  const rows = await db
    .prepare('SELECT n.hanzi FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ?')
    .bind(userId)
    .all<{ hanzi: string }>();
  const set = new Set<string>();
  for (const r of rows.results ?? []) {
    const k = normalizeHanziAnswer(r.hanzi || '');
    if (k) set.add(k);
  }
  return set;
}

export interface ProposeOptions {
  client?: Pick<Anthropic, 'messages'>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Propose flashcards from a conversation for the caller (a participant).
 * Throws ChatMessageError (400 / 403 / 404 / 503) or StructuredCallError.
 */
export async function proposeChatFlashcards(
  env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY'>,
  conversationId: string,
  userId: string,
  req: ProposeRequest,
  opts: ProposeOptions = {},
): Promise<{ cards: ProposedCard[] }> {
  const participants = await getConversationParticipants(env.DB, conversationId);
  if (!participants) throw new ChatMessageError('Conversation not found', 404);
  if (!participants.user_ids.includes(userId) || participants.status !== 'active') throw new ChatMessageError('Access denied', 403);

  const rel = await env.DB
    .prepare('SELECT id, requester_id, recipient_id, requester_role, status FROM tutor_relationships WHERE id = ?')
    .bind(participants.relationship_id)
    .first<TutorRelationship>();
  let tutorId: string | null = null;
  let studentId: string | null = null;
  if (rel) {
    tutorId = rel.requester_role === 'tutor' ? rel.requester_id : rel.recipient_id;
    studentId = rel.requester_role === 'tutor' ? rel.recipient_id : rel.requester_id;
  }

  const context = await buildChatContext(env.DB, conversationId, { tutorId, studentId }, req);
  if (req.focus === 'correction' && context.corrected === 0) {
    throw new ChatMessageError('There is no corrected message to make a card from', 400);
  }
  if (!context.text) throw new ChatMessageError('There is nothing in these messages to make cards from', 400);
  if (!env.ANTHROPIC_API_KEY && !opts.client) throw new ChatMessageError('AI is not configured', 503);

  const cards = await structuredCall({
    apiKey: env.ANTHROPIC_API_KEY ?? '',
    model: PROPOSE_MODEL,
    system: req.focus === 'correction' ? CORRECTION_SYSTEM : SYSTEM,
    user: `The learner is ${context.learnerName}.\n\nChat (oldest first):\n${context.text}`,
    tool: proposeTool(),
    maxTokens: 6000,
    attempts: 2,
    timeoutMs: 60_000,
    client: opts.client,
    sleep: opts.sleep,
    validate: (input) => normalizeProposedCards(input, context.ids),
  });

  const known = await knownHanzi(env.DB, userId);
  // Cards from corrected messages first (stable otherwise: Claude's order).
  const fromCorrection = (c: { source_message_id: string | null }) => (c.source_message_id && context.correctedIds.has(c.source_message_id) ? 0 : 1);
  const ordered = cards.map((c, i) => ({ c, i })).sort((a, b) => fromCorrection(a.c) - fromCorrection(b.c) || a.i - b.i).map(({ c }) => c);
  return {
    cards: ordered.map((card) => ({ ...card, already_have: known.has(normalizeHanziAnswer(card.hanzi)) })),
  };
}
