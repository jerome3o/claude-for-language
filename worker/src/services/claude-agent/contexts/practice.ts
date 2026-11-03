/**
 * Context `practice` — Practice with Claude: a role-play thread (docs/CHAT.md "Practice with Claude";
 * shared/claude/practice.ts). Claude plays someone in a situation (a waiter, a taxi driver, a new
 * friend, or "a friendly conversation partner" for a study card's word) and the learner talks to them
 * in Chinese.
 *
 * - load: the card's word when the role-play started from one (`note_id`, ownership-checked) and the
 *   known-words sample, side by side (two reads; the sample is cached per day).
 * - persona: PRACTICE_SYSTEM_PROMPT (static, cached); learner: the known-words sample (per user / day,
 *   cached); context block: the situation, the roles, the level, the word.
 * - Model: `MODEL_POLICY.practice` (Sonnet, thinking off, a short budget) — a role-play line must come
 *   fast, and it is streamed like every thread reply.
 * - Tools: NONE. A role-play turn is one model round: a tool call would break character and add a
 *   round's latency; cards come afterwards from the thread (⋯ → "Make flashcards from this chat",
 *   word chips → + Add as card / ⚡), help comes from the chips (💡 hint, 🆘 how do I say…, ✏️ correct me).
 * - The read-aloud voice is the persona's (`practiceVoiceFor`, stored on the thread at creation); the
 *   clip is made after the reply in the background, never awaited (thread-turn.ts).
 */
import { DEFAULT_PRACTICE_LEVEL, parsePracticeLevel } from '@shared/claude/practice';
import { StructuredCallError } from '../../structured-call';
import { sampleKnownWords } from '../learner';
import { knownWordsBlock, PRACTICE_LEVEL_RULES, PRACTICE_SYSTEM_PROMPT } from '../persona';
import { ClaudeContextError, type ChatTurn, type ContextOf, type ContextProvider, type ToolName } from '../types';

/** A role-play line or a short bit of help (thinking is off, so it is all answer). */
export const PRACTICE_MAX_TOKENS = 1500;

/** The first turn when Claude speaks first (never stored; the persona knows it). */
export const PRACTICE_OPENER = '(The role-play starts now. Open the scene with your first line, in character.)';

const NO_TOOLS: readonly ToolName[] = [];

interface PracticeWord {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface PracticeData {
  ctx: ContextOf<'practice'>;
  word: PracticeWord | null;
  knownWords: string[];
}

/** The role-play's context block: situation, roles, level, the card's word. */
export function practiceSystemBlock(d: Pick<PracticeData, 'ctx' | 'word'>): string {
  const level = parsePracticeLevel(d.ctx.level) ?? DEFAULT_PRACTICE_LEVEL;
  const lines = ['THE ROLE-PLAY'];
  if (d.ctx.scenario) lines.push(`Situation: ${d.ctx.scenario}`);
  lines.push(`You play: ${d.ctx.ai_role || 'a friendly person the learner meets in this situation'}`);
  lines.push(`The learner plays: ${d.ctx.user_role || 'themselves'}`);
  lines.push(`Level: ${PRACTICE_LEVEL_RULES[level]}`);
  if (d.word) {
    lines.push(
      `The word they are practising: ${d.word.hanzi} (${d.word.pinyin}) — ${d.word.english}. Use it naturally in your lines early on, and steer the talk so the learner gets to use it too.`,
    );
  }
  return lines.join('\n');
}

/**
 * The model turns of a role-play from its stored messages: finished text messages in order, the same
 * role merged; when Claude spoke first (the opener) — or nothing is there yet — the conversation opens
 * with PRACTICE_OPENER as the learner's turn (the API wants a user turn first).
 */
export function practiceTurns(stored: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; content_type?: string; status?: string | null }>): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of stored) {
    if (m.status) continue;
    if (m.content_type && m.content_type !== 'text') continue;
    const content = (m.content || '').trim();
    if (!content) continue;
    if (turns.length === 0 && m.role === 'assistant') turns.push({ role: 'user', content: PRACTICE_OPENER });
    const prev = turns[turns.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${content}`;
    else turns.push({ role: m.role, content });
  }
  if (turns.length === 0) turns.push({ role: 'user', content: PRACTICE_OPENER });
  return turns;
}

export const practiceContextProvider: ContextProvider<'practice', PracticeData> = {
  kind: 'practice',
  surface: 'practice',
  policy: 'practice',
  maxTokens: PRACTICE_MAX_TOKENS,
  // No tools: one round.
  maxRounds: 1,
  async load(env, ctx, input) {
    const [word, knownWords] = await Promise.all([
      ctx.note_id
        ? env.DB
            .prepare('SELECT n.hanzi, n.pinyin, n.english FROM notes n JOIN decks d ON d.id = n.deck_id WHERE n.id = ? AND d.user_id = ?')
            .bind(ctx.note_id, input.userId)
            .first<PracticeWord>()
        : Promise.resolve(null),
      input.knownWords ? Promise.resolve(input.knownWords) : sampleKnownWords(env.DB, input.userId),
    ]);
    // A card's role-play whose card is gone: it carries on without the word (the situation is still there).
    if (ctx.note_id && !word && !ctx.scenario) throw new ClaudeContextError('Note not found', 404);
    return { ctx, word: word ?? null, knownWords };
  },
  persona: () => PRACTICE_SYSTEM_PROMPT,
  learner: (d) => knownWordsBlock(d.knownWords),
  systemBlock: (d) => practiceSystemBlock(d),
  tools: () => NO_TOOLS,
  toolContext: () => ({ deckId: '', bumpSource: 'claude_practice' }),
  deferredAck: (tool) => `Tool ${tool} is not available here`,
  finish(text) {
    const answer = text.trim();
    if (!answer) throw new StructuredCallError('Claude gave an empty answer', true);
    return answer;
  },
};
