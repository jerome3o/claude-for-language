/**
 * The Coach's "💬 Ask Claude" chat around the Claude agent harness (services/claude-agent: its prompt
 * is the `general` context, persona.ts; the model call is `runClaudeTurn`). Here: "💬 Ask Claude" on the Sentence Coach
 * (docs/CHAT.md "Ask Claude chat", shared/coach/askChat.ts): a plain chat with Claude, stored as a
 * coach conversation with `kind = 'ask'` (migration 0143). Replies are
 * written in the background exactly like the Coach's follow-ups (services/coach-replies.ts:
 * coach-reply-queue, claim, retries, the stale sweep, Retry) — this file holds what is specific to
 * it: the turns from the stored messages, the E2E stand-ins and "Make flashcards from this chat".
 *
 * Language: like Ask Claude on the study card — simple, graded Chinese by default (the same
 * immersion rules, `GENERAL_IMMERSION_RULES`, and a sample of the learner's started words), or
 * English Markdown when the 中文 | EN choice says so or he asks for English for one turn
 * (`turnLanguage`). The turn's language is set on the pending reply's `answer_lang` by the route
 * and the reply keeps it, so the apps know which answers get word chips, ▶, 🎧 and 🎤 Read it back.
 *
 * No tools: cards are made from the chat afterwards ("Make flashcards from this chat",
 * `proposeCoachAskFlashcards`), the default selection being the words he tapped.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { CoachMessage, Env } from '../types';
import { CARD_STANDARD } from '@shared/cards/standard';
import { normalizeHanziAnswer } from '@shared/lesson/answer-check';
import { plainAnswerText, type AskLanguage } from '@shared/study/askClaude';
import { runClaudeTurn } from './claude-agent';
import { withToolRecord } from './claude-agent/tool-record';
import { StructuredCallError, structuredCall } from './structured-call';
import { normalizeProposedCards, proposeFlashcardsTool, knownHanziOf, PROPOSE_MODEL, type ProposedCard } from './chat/flashcards';

/**
 * What a reply is written for. `kind` = the chat's context ('ask' = a general chat, no card); the
 * language is the turn's (`turnLanguage`); `knownWords` = a sample of his started words (looked up
 * when missing and the answer is Chinese).
 */
export interface ClaudeChatContext {
  kind: 'ask';
  language: AskLanguage;
  userId: string;
  knownWords?: string[];
  /** The thread (Claude memory: its summary stands in for old turns of a long chat). */
  threadId?: string;
}

export interface CoachAskTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Writes one reply from the conversation so far (the last turn is the learner's). */
export type CoachAskReplyFn = (turns: CoachAskTurn[], context: ClaudeChatContext) => Promise<string>;

// The prompt (persona.ts) and the model call (the `general` context) live in the Claude agent harness.
export { buildClaudeChatSystemBlocks, buildClaudeChatSystemPrompt } from './claude-agent/persona';
export { CLAUDE_CHAT_MAX_TOKENS } from './claude-agent/contexts/general';

/**
 * The model conversation from the stored messages: the learner's and Claude's finished messages in
 * order (pending / failed replies left out), two turns of one role in a row merged (the API wants
 * alternation), starting with the learner.
 */
export function coachAskTurns(stored: readonly CoachMessage[]): CoachAskTurn[] {
  const turns: CoachAskTurn[] = [];
  for (const m of stored) {
    if (m.status) continue;
    if (m.content_type !== 'text') continue;
    const text = (m.content || '').trim();
    if (!text) continue;
    if (turns.length === 0 && m.role !== 'user') continue;
    // An earlier reply + what its tools did (tool-record.ts): Claude must never lose sight of a card it made.
    const content = m.role === 'assistant' ? withToolRecord(text, m.tool_results) : text;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${content}`;
    else turns.push({ role: m.role, content });
  }
  return turns;
}

/** The answer as stored: a Chinese answer as plain text (Markdown the model slipped in taken out). */
export function storedAskAnswer(answer: string, language: AskLanguage): string {
  return language === 'zh' ? plainAnswerText(answer) : answer.trim();
}

/**
 * The real model call (or the E2E stand-in, checked first); null when the coach can't answer here.
 * The call is a `general` turn of the Claude agent harness (`runClaudeTurn`): no tools, thinking off,
 * the static rules + the learner block cached.
 */
export function defaultCoachAskReply(
  env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>,
  opts: { client?: Pick<Anthropic, 'messages'> } = {},
): CoachAskReplyFn | null {
  if (env.E2E_TEST_MODE === 'true') return fakeCoachAskReply;
  if (!env.ANTHROPIC_API_KEY) return null;
  return async (turns, context) => {
    const r = await runClaudeTurn(
      env,
      { kind: 'general' },
      { userId: context.userId, threadId: context.threadId ?? null, language: context.language, turns, knownWords: context.knownWords },
      { client: opts.client },
    );
    return r.answer;
  };
}

// ---------- E2E_TEST_MODE stand-ins ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** E2E: a fixed Chinese answer about 成都 food (the screenshots' conversation), else a generic one. */
export const FAKE_ASK_ANSWERS: Record<string, string> = {
  chengdu: '成都的菜很有名，特别是火锅。\n火锅又麻又辣，可是很好吃。\n你可以试试串串和担担面。\n你喜欢吃辣的吗？',
  generic: '这是一个好问题。\n我用简单的中文回答你。\n有不懂的词，你可以点一下。',
};

export const fakeCoachAskReply: CoachAskReplyFn = async (turns, { language }) => {
  await sleep(1200);
  const last = turns[turns.length - 1]?.content ?? '';
  if (language === 'en') return `(E2E) Claude's answer in English to: ${last.slice(0, 80)}`;
  return /成都|Chengdu|四川/i.test(last) ? FAKE_ASK_ANSWERS.chengdu : FAKE_ASK_ANSWERS.generic;
};

const FAKE_TRANSLATIONS: Record<string, string> = {
  [FAKE_ASK_ANSWERS.chengdu]: "Chengdu's food is famous, especially hot pot.\nHot pot is numbing and spicy, but it's delicious.\nYou could try chuanchuan and dandan noodles.\nDo you like spicy food?",
};

/** E2E: the translation of a known answer, else a marked stand-in. */
export async function fakeCoachTranslate(text: string): Promise<string> {
  return FAKE_TRANSLATIONS[text] ?? `(E2E) The English of: ${text.slice(0, 60)}`;
}

// ---------- "Make flashcards from this chat" ----------

const PROPOSE_SYSTEM = `You make flashcards for a learner of Chinese from their chat with Claude (their tutor).

Read the numbered chat and propose the cards most worth studying:
1. FIRST the words the learner tapped to look up or got wrong reading a message aloud (listed below as "Words to focus on") — one card each, in that order, unless it is something any beginner knows. The card is the word as it is used in the chat.
2. Then, if room is left, other words or useful phrases from Claude's messages the learner is unlikely to know.
Skip what any beginner knows (你好, 谢谢, 我), skip English-only chatter, never duplicate a card. At most 12.

For each card give source: the #number of the chat line it comes from.

${CARD_STANDARD}`;

export const MAX_ASK_CONTEXT_CHARS = 12_000;

/** The coach conversation as a numbered transcript (newest kept within the budget), and the line ids. */
export function coachAskTranscript(stored: readonly CoachMessage[]): { text: string; ids: string[] } {
  const picked: Array<{ id: string; line: string }> = [];
  let chars = 0;
  for (const m of [...stored].reverse()) {
    if (m.status || m.content_type !== 'text') continue;
    const body = (m.content || '').trim().slice(0, 1500);
    if (!body) continue;
    const line = `${m.role === 'user' ? 'Learner' : 'Claude'}: ${body}`;
    if (picked.length > 0 && chars + line.length > MAX_ASK_CONTEXT_CHARS) break;
    chars += line.length + 8;
    picked.push({ id: m.id, line });
  }
  picked.reverse();
  return { text: picked.map((p, i) => `#${i + 1} ${p.line}`).join('\n'), ids: picked.map((p) => p.id) };
}

export type CoachProposeFn = (system: string, user: string, ids: string[]) => Promise<Array<Omit<ProposedCard, 'already_have'>>>;

const FAKE_CARDS: Record<string, [string, string, string]> = {
  火锅: ['huǒguō', 'hot pot', '火 (huǒ) fire + 锅 (guō) pot: a pot of broth kept boiling at the table.'],
  麻: ['má', 'numbing (Sichuan pepper)', '麻 is the tingling, numbing feeling of Sichuan pepper; 麻辣 = numbing and spicy.'],
  辣: ['là', 'spicy (hot)', '辣 = spicy-hot; 很辣 = very spicy.'],
  串串: ['chuànchuan', 'skewers cooked in hot pot broth', '串 (chuàn) a string / skewer, doubled for the dish.'],
  担担面: ['dàndanmiàn', 'dandan noodles', '担担 (dàndan) the carrying pole street sellers used + 面 (miàn) noodles.'],
  有名: ['yǒumíng', 'famous', '有 (yǒu) have + 名 (míng) name: to have a name, be famous.'],
  特别: ['tèbié', 'especially', '特 (tè) special + 别 (bié) other: especially, particularly.'],
  好吃: ['hǎochī', 'delicious', '好 (hǎo) good + 吃 (chī) eat: good to eat.'],
};

/** E2E: cards for the focus words it knows, else the first two it knows from the chat. */
export function fakeCoachPropose(focus: readonly string[], transcript: string, ids: string[]): Array<Omit<ProposedCard, 'already_have'>> {
  const pick = focus.filter((w) => FAKE_CARDS[w]);
  const words = pick.length > 0 ? pick : Object.keys(FAKE_CARDS).filter((w) => transcript.includes(w)).slice(0, 2);
  return words.map((w) => {
    const [pinyin, english, fun] = FAKE_CARDS[w];
    return { hanzi: w, pinyin, english, fun_facts: fun, source_message_id: ids[ids.length - 1] ?? null };
  });
}

/**
 * Propose cards from a coach conversation for its owner: one structured call (the chat's
 * `propose_flashcards` tool and validation, the card standard in the prompt), the tapped / said-wrong
 * words first. Nothing is saved — the app's review sheet adds the kept ones with the batch route.
 */
export async function proposeCoachAskFlashcards(
  env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>,
  userId: string,
  stored: readonly CoachMessage[],
  focusWords: readonly string[],
  deps: { propose?: CoachProposeFn } = {},
): Promise<{ cards: ProposedCard[] }> {
  const { text, ids } = coachAskTranscript(stored);
  if (!text) throw new StructuredCallError('There is nothing in this chat to make cards from', false);
  const focus = focusWords.map((w) => w.trim()).filter(Boolean).slice(-40);
  const user = `${focus.length ? `Words to focus on (tapped or said wrong), in order: ${focus.join('、')}\n\n` : ''}Chat (oldest first):\n${text}`;
  let cards: Array<Omit<ProposedCard, 'already_have'>>;
  if (deps.propose) cards = await deps.propose(PROPOSE_SYSTEM, user, ids);
  else if (env.E2E_TEST_MODE === 'true') cards = fakeCoachPropose(focus, text, ids);
  else {
    if (!env.ANTHROPIC_API_KEY) throw new StructuredCallError('AI is not configured', false);
    cards = await structuredCall({
      apiKey: env.ANTHROPIC_API_KEY,
      model: PROPOSE_MODEL,
      system: PROPOSE_SYSTEM,
      user,
      tool: proposeFlashcardsTool(),
      maxTokens: 6000,
      attempts: 2,
      timeoutMs: 60_000,
      validate: (input) => normalizeProposedCards(input, ids),
    });
  }
  const known = await knownHanziOf(env.DB, userId);
  // The focus words first, in their order; then Claude's order.
  const rank = (hanzi: string) => {
    const i = focus.findIndex((w) => normalizeHanziAnswer(w) === normalizeHanziAnswer(hanzi));
    return i < 0 ? focus.length : i;
  };
  const ordered = cards.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.hanzi) - rank(b.c.hanzi) || a.i - b.i).map(({ c }) => c);
  return { cards: ordered.map((card) => ({ ...card, already_have: known.has(normalizeHanziAnswer(card.hanzi)) })) };
}
