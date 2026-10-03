/**
 * "Check my Chinese automatically" (docs/CHAT.md "Auto-check"). When a learner
 * sends (or edits) a text message with Chinese, it is checked in the
 * background — the same job as the Sentence Coach's "Check my sentence", with
 * the chat's last few lines as context — and the result is stored on the
 * message (`messages.auto_check`) and sent with `message_updated`, so both
 * apps get it live and through `?since=`. Only the sender ever sees it.
 *
 * Who is checked: `autoCheckApplies` (the student side of a tutor chat, the
 * person in a Claude practice chat, or anyone who switched it on); what is
 * skipped: `autoCheckSkipReason` (no / little Chinese, ≤ 2 characters, emoji,
 * very long). Idempotent per message + text; an edit clears it and re-checks.
 */

import type { Env, TutorRelationship } from '../../types';
import { CLAUDE_AI_USER_ID } from '../../types';
import {
  autoCheckApplies,
  autoCheckSkipReason,
  parseAutoCheck,
  type AutoCheckCard,
  type AutoCheckResult,
  type AutoCheckSeverity,
} from '@shared/chats/autoCheck';
import { CARD_STANDARD, cardTextProblems } from '@shared/cards/standard';
import { structuredCall } from '../structured-call';
import { getMyRole } from '../relationships';
import { getConversationParticipants } from './reads';
import { broadcastMessageUpdated, currentUpdatedAt, laterThan } from './messages';
import { parseStoredAttachment } from './media';

/** Sonnet for judgement (a fast first pass; Haiku is structuredCall's fallback). */
export const AUTO_CHECK_MODEL = 'claude-sonnet-5';

const SYSTEM = `You check one chat message a Chinese learner just sent, the way a good tutor would glance at it.

Decide whether it is worth improving. Flag ONLY real improvements:
- grammar errors (wrong or missing particle, wrong word order, a misused 了 / 的 / 得 / 地, wrong measure word…)
- wrong words (a word that does not mean what they meant, a wrong character)
- clearly unnatural phrasing a native speaker would not say
Do NOT nitpick: chat style, a missing final 。, casual register, emoji, pinyin input slips that are still the right word, or something that is merely one of several fine ways to say it. A message that is fine is "ok" — most messages are.

When it is "improvable":
- corrected: the message fixed, as close to their own words and meaning as possible (only what needs changing), with pinyin (tone marks, spaces between words) and an English translation
- mistakes: each specific mistake — quote = the exact short span they wrote ("" if something was missing), fix = what it should be, why = ONE short line in English. At most 4.
- for a mistake about a word or a pattern worth remembering, a card for it (the word or a short natural phrase using the pattern)
- alternative: optionally ONE more natural way to say the whole thing, only when it is clearly better than the minimal correction
- severity: minor (small slip, meaning clear) | moderate (a real grammar / word error) | major (meaning unclear or wrong)
- card: the corrected sentence as a card
When "ok", return the text unchanged as corrected and no mistakes.

Pinyin ALWAYS uses tone marks, never tone numbers.

Cards follow this standard:
${CARD_STANDARD}

Answer with the check_message tool.`;

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    hanzi: { type: 'string' },
    pinyin: { type: 'string' },
    english: { type: 'string' },
    fun_facts: { type: 'string', description: 'The explanation per the card standard (3–6 short lines)' },
  },
  required: ['hanzi', 'pinyin', 'english', 'fun_facts'],
};

const TOOL = {
  name: 'check_message',
  description: 'Whether the message is worth improving and, if so, how.',
  input_schema: {
    type: 'object' as const,
    properties: {
      status: { type: 'string', enum: ['ok', 'improvable'] },
      severity: { type: 'string', enum: ['minor', 'moderate', 'major'] },
      corrected: {
        type: 'object',
        properties: { hanzi: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' } },
        required: ['hanzi', 'pinyin', 'english'],
      },
      mistakes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            quote: { type: 'string', description: 'Exact span of what they wrote, "" when something is missing' },
            fix: { type: 'string' },
            why: { type: 'string', description: 'One short line' },
            card: CARD_SCHEMA,
          },
          required: ['quote', 'fix', 'why'],
        },
      },
      alternative: {
        type: 'object',
        properties: { hanzi: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' }, note: { type: 'string' } },
        required: ['hanzi', 'pinyin', 'english'],
      },
      card: CARD_SCHEMA,
    },
    required: ['status', 'corrected', 'mistakes'],
  },
};

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Compare sentences ignoring punctuation and spaces (a "fix" that only adds 。 is no fix). */
const bare = (t: string) => t.replace(/[\s\p{P}\p{S}]/gu, '');

function cleanCard(v: unknown): AutoCheckCard | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const card = { hanzi: str(o.hanzi, 200), pinyin: str(o.pinyin, 400), english: str(o.english, 300), fun_facts: str(o.fun_facts, 1500) };
  if (!card.hanzi || !card.pinyin || !card.english) return null;
  // A card that breaks a HARD rule of the standard would be refused on save: leave it out.
  return cardTextProblems(card).length === 0 ? card : null;
}

/**
 * Shape-check the tool input into an AutoCheckResult for `text`; throws (→
 * retried) when an "improvable" answer has no correction. An "improvable" whose
 * correction only changes punctuation / spacing and names no mistake is "ok".
 */
export function normalizeAutoCheck(raw: unknown, text: string, now = new Date().toISOString()): AutoCheckResult {
  const r = (raw ?? {}) as Record<string, any>;
  const okResult = (): AutoCheckResult => ({
    text,
    status: 'ok',
    corrected: text,
    corrected_pinyin: str(r.corrected?.pinyin, 1200),
    corrected_english: str(r.corrected?.english, 800),
    mistakes: [],
    alternative: null,
    severity: null,
    card: null,
    checked_at: now,
  });
  if (r.status !== 'improvable') {
    if (r.status !== 'ok') throw new Error('Invalid auto-check status from AI');
    return okResult();
  }
  const corrected = str(r.corrected?.hanzi, 800);
  if (!corrected) throw new Error('Auto-check said improvable but gave no correction');
  const mistakes = (Array.isArray(r.mistakes) ? r.mistakes : [])
    .map((m: any) => ({ quote: str(m?.quote, 200), fix: str(m?.fix, 200), why: str(m?.why, 400), card: cleanCard(m?.card) }))
    .filter((m: { quote: string; fix: string }) => m.fix && m.fix !== m.quote)
    .slice(0, 4);
  if (bare(corrected) === bare(text) && mistakes.length === 0) return okResult();
  const altHanzi = str(r.alternative?.hanzi, 400);
  const alternative = altHanzi && bare(altHanzi) !== bare(corrected) && bare(altHanzi) !== bare(text)
    ? { hanzi: altHanzi, pinyin: str(r.alternative?.pinyin), english: str(r.alternative?.english), note: str(r.alternative?.note, 400) || null }
    : null;
  const severity: AutoCheckSeverity = r.severity === 'minor' || r.severity === 'major' ? r.severity : 'moderate';
  return {
    text,
    status: 'improvable',
    corrected,
    corrected_pinyin: str(r.corrected?.pinyin, 1200),
    corrected_english: str(r.corrected?.english, 800),
    mistakes,
    alternative,
    severity,
    card: cleanCard(r.card) ?? cleanCard({ hanzi: corrected, pinyin: r.corrected?.pinyin, english: r.corrected?.english, fun_facts: mistakes.map((m: { quote: string; fix: string; why: string }) => `${m.quote ? `${m.quote} → ` : ''}${m.fix}: ${m.why}`).join('\n') }),
    checked_at: now,
  };
}

export type AutoChecker = (text: string, context: string) => Promise<unknown>;

/** The model call (structuredCall: forced tool, thinking off, retries, Haiku on the last try). */
export function defaultAutoChecker(env: Pick<Env, 'ANTHROPIC_API_KEY'>): AutoChecker | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return (text, context) =>
    structuredCall({
      apiKey: env.ANTHROPIC_API_KEY,
      model: AUTO_CHECK_MODEL,
      system: SYSTEM,
      user: `${context ? `The chat so far (for context only):\n${context}\n\n` : ''}The learner just sent:\n${text}`,
      tool: TOOL,
      maxTokens: 1500,
      validate: (input) => input,
    });
}

/** The few lines before the message (who said what), for context. */
async function recentContext(db: D1Database, conversationId: string, createdAt: string, senderId: string): Promise<string> {
  const rows = await db
    .prepare(
      `SELECT sender_id, content FROM messages
        WHERE conversation_id = ? AND created_at < ? AND deleted_at IS NULL AND content != ''
        ORDER BY created_at DESC LIMIT 6`,
    )
    .bind(conversationId, createdAt)
    .all<{ sender_id: string; content: string }>();
  return (rows.results ?? [])
    .reverse()
    .map((m) => `${m.sender_id === senderId ? 'Learner' : 'Other'}: ${m.content.slice(0, 300)}`)
    .join('\n');
}

export type AutoCheckOutcome = 'checked' | 'cached' | 'skipped' | 'off' | 'failed';

/**
 * Check one message if it should be, store the result (only while the text is
 * still the one checked) and send `message_updated`. Never throws.
 */
export async function autoCheckMessageInBackground(
  env: Pick<Env, 'DB' | 'CHAT_HUB' | 'ANTHROPIC_API_KEY'>,
  messageId: string,
  deps: { check?: AutoChecker | null; now?: () => string } = {},
): Promise<AutoCheckOutcome> {
  try {
    const row = await env.DB
      .prepare(
        `SELECT m.conversation_id, m.sender_id, m.content, m.created_at, m.attachment, m.deleted_at, m.auto_check,
                u.chat_auto_check
           FROM messages m JOIN users u ON u.id = m.sender_id
          WHERE m.id = ?`,
      )
      .bind(messageId)
      .first<{ conversation_id: string; sender_id: string; content: string; created_at: string; attachment: string | null; deleted_at: string | null; auto_check: string | null; chat_auto_check: number | null }>();
    if (!row || row.deleted_at || parseStoredAttachment(row.attachment) || row.sender_id === CLAUDE_AI_USER_ID) return 'skipped';

    const participants = await getConversationParticipants(env.DB, row.conversation_id);
    if (!participants) return 'skipped';
    let senderRole: 'tutor' | 'student' | null = null;
    if (!participants.is_ai) {
      const rel = await env.DB
        .prepare('SELECT id, requester_id, recipient_id, requester_role, status FROM tutor_relationships WHERE id = ?')
        .bind(participants.relationship_id)
        .first<TutorRelationship>();
      senderRole = rel ? getMyRole(rel, row.sender_id) : null;
    }
    const setting = row.chat_auto_check === null || row.chat_auto_check === undefined ? null : row.chat_auto_check !== 0;
    if (!autoCheckApplies(setting, senderRole, participants.is_ai)) return 'off';
    if (autoCheckSkipReason(row.content)) return 'skipped';
    if (parseAutoCheck(row.auto_check, row.content)) return 'cached';

    const check = deps.check === undefined ? defaultAutoChecker(env) : deps.check;
    if (!check) return 'skipped';
    const context = await recentContext(env.DB, row.conversation_id, row.created_at, row.sender_id);
    const now = deps.now?.() ?? new Date().toISOString();
    const result = normalizeAutoCheck(await check(row.content, context), row.content, now);

    const at = laterThan(await currentUpdatedAt(env.DB, messageId));
    const res = await env.DB
      .prepare('UPDATE messages SET auto_check = ?, updated_at = ? WHERE id = ? AND content = ? AND deleted_at IS NULL')
      .bind(JSON.stringify(result), at, messageId, row.content)
      .run();
    if ((res.meta?.changes ?? 0) === 0) return 'skipped';
    await broadcastMessageUpdated(env, messageId);
    return 'checked';
  } catch (err) {
    console.error('[chat] auto-check failed for', messageId, err instanceof Error ? err.message : err);
    return 'failed';
  }
}

/** `users.chat_auto_check`: true / false, or null = back to the default. */
export async function setChatAutoCheck(db: D1Database, userId: string, value: boolean | null): Promise<void> {
  await db.prepare('UPDATE users SET chat_auto_check = ? WHERE id = ?').bind(value === null ? null : value ? 1 : 0, userId).run();
}
