/**
 * Claude chats — the ONE place a chat reply's prompt is built and the model is called, from a
 * context object (`ClaudeChatContext`), so other Claude chats (a card's Ask Claude, role-play, a
 * reader) can move onto it by adding a `kind`. Today: "💬 Ask Claude" on the Sentence Coach
 * (docs/CHAT.md "Ask Claude chat", shared/coach/askChat.ts): a plain chat with Claude, stored as a
 * coach conversation with `kind = 'ask'` (migration 0143). Replies are
 * written in the background exactly like the Coach's follow-ups (services/coach-replies.ts:
 * coach-reply-queue, claim, retries, the stale sweep, Retry) — this file is only the part that
 * differs: the prompt and the model call.
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
import Anthropic from '@anthropic-ai/sdk';
import type { CoachMessage, Env } from '../types';
import { CARD_STANDARD } from '@shared/cards/standard';
import { normalizeHanziAnswer } from '@shared/lesson/answer-check';
import { plainAnswerText, type AskLanguage } from '@shared/study/askClaude';
import { GENERAL_IMMERSION_RULES, knownWordsBlock } from './ask-prompt';
import { cachedSystem, chatTurnParams, ChatTurnMeter } from './chat-turn';
import { sampleKnownWords } from './ai';
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
}

export interface CoachAskTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Writes one reply from the conversation so far (the last turn is the learner's). */
export type CoachAskReplyFn = (turns: CoachAskTurn[], context: ClaudeChatContext) => Promise<string>;

const ROLE = `You are a friendly Chinese tutor chatting with a learner of Chinese in the app's "Ask Claude" chat. They can ask you anything — about Chinese, about China, about everyday life, or just chat to practise. The app shows pinyin over every Chinese word on request, a tap on a word opens a dictionary, and the learner may read your messages aloud for practice, so write Chinese that is worth reading aloud.`;

const ENGLISH = `Answer in clear, friendly English (Markdown is fine). Use Chinese examples with pinyin and an English gloss where they help. Keep it focused: a few short paragraphs or a short list.`;

const CARDS = `If the learner asks for flashcards, tell them to use ⋯ → "Make flashcards from this chat" — it makes cards from the words they tapped. Whenever you write a word card in your answer, follow the card standard:\n${CARD_STANDARD}`;

/**
 * The system prompt of one reply as two blocks for prompt caching (services/chat-turn.ts): the
 * STATIC rules (role, language rules, cards) — the same for everyone in that language — then the
 * learner's known-words block ('' in English or without words; deterministic per user and day).
 */
export function buildClaudeChatSystemBlocks(opts: Pick<ClaudeChatContext, 'kind' | 'language' | 'knownWords'>): [staticRules: string, learner: string] {
  const parts = [ROLE, opts.language === 'zh' ? GENERAL_IMMERSION_RULES : ENGLISH, CARDS];
  return [parts.join('\n\n'), opts.language === 'zh' ? knownWordsBlock(opts.knownWords) : ''];
}

/** The system prompt of one reply, from its context (the two blocks joined). */
export function buildClaudeChatSystemPrompt(opts: Pick<ClaudeChatContext, 'kind' | 'language' | 'knownWords'>): string {
  return buildClaudeChatSystemBlocks(opts).filter(Boolean).join('\n\n');
}

/** A chat reply's output budget (thinking is off, so it is all answer). */
export const CLAUDE_CHAT_MAX_TOKENS = 4000;

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
    const content = (m.content || '').trim();
    if (!content) continue;
    if (turns.length === 0 && m.role !== 'user') continue;
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

/** The real model call (or the E2E stand-in, checked first); null when the coach can't answer here. */
export function defaultCoachAskReply(
  env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>,
  opts: { client?: Pick<Anthropic, 'messages'> } = {},
): CoachAskReplyFn | null {
  if (env.E2E_TEST_MODE === 'true') return fakeCoachAskReply;
  if (!env.ANTHROPIC_API_KEY) return null;
  const apiKey = env.ANTHROPIC_API_KEY;
  return async (turns, context) => {
    const { language, userId } = context;
    const knownWords = context.knownWords ?? (language === 'zh' ? await sampleKnownWords(env.DB, userId) : []);
    const client = opts.client ?? new Anthropic({ apiKey });
    // A chat turn (services/chat-turn.ts): thinking off, the static rules + the learner block cached,
    // the conversation's tail cached for the next turn. No tools.
    const meter = new ChatTurnMeter('coach_ask', userId);
    const res = await client.messages.create(chatTurnParams({
      system: cachedSystem(...buildClaudeChatSystemBlocks({ kind: context.kind, language, knownWords })),
      tools: [],
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
      maxTokens: CLAUDE_CHAT_MAX_TOKENS,
    }));
    meter.add(res);
    meter.finish();
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    // An empty answer (cut off / declined): worth another delivery.
    if (!text) throw new StructuredCallError('Claude gave an empty answer', true);
    return text;
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
