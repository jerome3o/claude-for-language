/**
 * Claude threads — what each context's thread screen offers (docs/CHAT.md "Claude thread view";
 * the unified-Claude-chats plan §6.3–6.4): the suggestion chips above the composer (`chipsFor`),
 * the composer's intent buttons (`composerFor`), the header's context chip (`headerChipFor`),
 * which existing thread a context resumes (`resumeThreadFor`) and how often the screen looks
 * again while a reply is being written when the live socket is quiet (`claudeReplyPollMs`).
 *
 * Pure; used by the web thread view (components/claude/ClaudeThreadView.tsx) and ported to the
 * Lab app's core `claude/ClaudeChats.kt` (parity-tested by android-lab/parity/fixtures/claude-chats.ts).
 */
import { coachButtons } from '../coach/actions';
import { THREAD_GAP_MS } from '../chats/threads';
import type { AskLanguage } from '../study/askClaude';
import { contextBadge, contextRef, READER_CONTEXT_WORDS_MAX, type ClaudeContextKind, type ClaudeIntent, type ClaudeThreadContext, type StoredClaudeContext } from './context';

// ---------- Suggestion chips ----------

/** One suggestion chip: its label and the question it sends. */
export interface ClaudeChip {
  id: string;
  label: string;
  question: string;
  /** The question goes into the box for the learner to finish (🆘 How do I say…) instead of being sent. */
  fill?: boolean;
}

/**
 * The chips of a card thread (Ask Claude on a study card — was `askQuickActions` in
 * shared/study/askClaude.ts). In Chinese mode the questions themselves are in simple Chinese (the
 * conversation stays Chinese); the labels stay short and bilingual. "Check my answer" only for a
 * typing card with an answer; "Explain sentence" only when the card has an example sentence.
 */
export function cardChips(opts: { language: AskLanguage; typedAnswer: boolean; hasSentence: boolean }): ClaudeChip[] {
  const zh = opts.language === 'zh';
  const list: ClaudeChip[] = [
    {
      id: 'sentences',
      label: zh ? '造句 Use in sentence' : 'Use in sentence',
      question: zh ? '请用这个词造几个简单的句子。' : 'Please use this word in a few example sentences with pinyin and English translations.',
    },
    {
      id: 'characters',
      label: zh ? '每个字 Explain characters' : 'Explain characters',
      question: zh ? '请解释这个词里的每个字。' : 'Please break down each character in this word, explaining the radicals, components, and individual meanings.',
    },
    {
      id: 'related',
      label: zh ? '相关的词 Related words' : 'Related words',
      question: zh ? '跟这个词有关的词还有哪些？' : 'What are some related words or phrases I should learn alongside this one?',
    },
  ];
  // One chip, not two that read as duplicates ("Check" + "Verify").
  if (opts.typedAnswer) {
    list.push({
      id: 'check_answer',
      label: zh ? '我的答案 Check my answer' : 'Check my answer',
      question: zh ? '我的答案对吗？如果不对，哪里错了？' : 'Is my answer correct, grammatically and in meaning? If not, explain what is wrong and how I can improve.',
    });
  }
  list.push(
    {
      id: 'grammar',
      label: zh ? '语法 Explain grammar' : 'Explain grammar',
      question: zh ? '请讲一下这个词的用法和语法。' : 'Can you explain the grammar of this sentence and break down each word?',
    },
    {
      id: 'fun_fact',
      label: zh ? '小知识 Add a fun fact' : 'Add a fun fact',
      question: zh ? '请给这张卡片加一个有意思的小知识。' : 'Add a brief, interesting fun fact or cultural context to this card.',
    },
  );
  if (opts.hasSentence) {
    list.push({
      id: 'sentence',
      label: zh ? '例句 Explain sentence' : 'Explain sentence',
      question: zh ? '请解释一下这张卡片的例句。' : 'Please explain the example sentence for this card. Break down the grammar, explain each word, and provide any cultural context.',
    });
  }
  return list;
}

function chip(id: string, zh: boolean, zhLabel: string, enLabel: string, zhQuestion: string, enQuestion: string): ClaudeChip {
  return { id, label: zh ? zhLabel : enLabel, question: zh ? zhQuestion : enQuestion };
}

/** A chat about anything (the Coach's "💬 Ask Claude", the Chats composer). */
function generalChips(zh: boolean): ClaudeChip[] {
  return [
    chip('phrase', zh, '实用的句子 A useful phrase', 'A useful phrase', '教我一个日常生活中很常用的句子。', 'Teach me one useful everyday Chinese phrase, with pinyin and an example of when to say it.'),
    chip('quiz', zh, '考考我 Quiz me', 'Quiz me', '用我学过的词考考我，一次问一个问题。', 'Quiz me on a few words I have been learning, one question at a time.'),
    chip('story', zh, '小故事 A short story', 'A short story', '用很简单的中文讲一个很短的故事。', 'Tell me a very short story in simple Chinese, then explain the new words.'),
  ];
}

/** Discuss with Claude: one message of a chat with a person. */
function chatMessageChips(zh: boolean): ClaudeChip[] {
  return [
    chip('meaning', zh, '什么意思 What does it mean', 'What does it mean', '这条消息是什么意思？请一个词一个词地解释。', 'What does this message mean? Break it down word by word.'),
    chip('natural', zh, '自然吗 Is it natural', 'Is it natural', '这样说自然吗？有没有更地道的说法？', 'Is this natural Chinese? How would a native speaker say it?'),
    chip('reply', zh, '怎么回复 How to reply', 'How to reply', '我可以怎么回复？给我两三个简单的回答。', 'How could I reply? Give me two or three simple replies with pinyin.'),
    chip('cards', zh, '做卡片 Make flashcards', 'Make flashcards', '请把这条消息里值得学的词做成卡片。', 'Please make flashcards for the key words and phrases in this message.'),
  ];
}

/**
 * A role-play (practice): the learner steps out of it for help — Claude answers as a tutor, then
 * carries on in character (shared/claude/practice.ts `isPracticeHelpRequest`). "How do I say…" goes
 * into the box to be finished.
 */
function practiceChips(zh: boolean): ClaudeChip[] {
  return [
    chip('hint', zh, '💡 提示 Give me a hint', '💡 Give me a hint', '💡 提示一下：我下一句可以说什么？', '💡 Give me a hint: what could I say next?'),
    { ...chip('say', zh, '🆘 怎么说 How do I say…', '🆘 How do I say…', '🆘 怎么说：', '🆘 How do I say: '), fill: true },
    chip('correct', zh, '✏️ 纠正 Correct my last message', '✏️ Correct my last message', '✏️ 请改一下我上一句话。', '✏️ Please correct my last message.'),
  ];
}

/**
 * A page of a graded reader ("📖 Ask Claude about this page"): what the page means, its grammar, a quiz
 * on it — and, when he tapped / misread words on this page, those words first.
 */
function readerChips(zh: boolean, ctx: { looked_up?: readonly string[]; said_wrong?: readonly string[] }): ClaudeChip[] {
  const list: ClaudeChip[] = [];
  if ((ctx.looked_up?.length ?? 0) + (ctx.said_wrong?.length ?? 0) > 0) {
    list.push(chip('my_words', zh, '我查的词 The words I looked up', 'The words I looked up', '请解释一下我在这一页查过的词和读错的词。', 'Explain the words I looked up or read wrong on this page, each in its sentence.'));
  }
  list.push(
    chip('page_meaning', zh, '这页讲什么 What does this page mean?', 'What does this page mean?', '这一页讲的是什么？请一句一句地说一说。', 'What does this page mean? Go through it sentence by sentence.'),
    chip('grammar', zh, '语法 Explain the grammar in this sentence', 'Explain the grammar in this sentence', '请讲一下这一页句子里的语法。', 'Explain the grammar in the sentences on this page.'),
    chip('quiz', zh, '考考我 Quiz me on this page', 'Quiz me on this page', '用这一页的内容考考我，一次问一个问题。', 'Quiz me on this page, one question at a time.'),
  );
  return list;
}

/** Exercise types answered by choosing (the "why is this the answer" chip). */
const CHOICE_EXERCISES = ['choice', 'listen_choice', 'judge', 'gap_choice', 'match'];
/** Exercise types where he writes or says his own Chinese (a model answer to compare with). */
const OWN_ANSWER_EXERCISES = ['translate', 'listen_translate', 'speak', 'oral_expression', 'describe_image', 'sentence_making', 'write_typed', 'write_handwriting', 'dictation'];

/**
 * One exercise of a mini lesson ("💬 Ask Claude" on it): "Why is my answer wrong?" when his checked
 * answer was wrong / almost, else "Is my answer OK?" when he has one; the explanation that fits the
 * type (the right answer / the model answer / the word order / the note); another example; one more
 * like it.
 */
function exerciseChips(zh: boolean, ctx: { exercise_type?: string; answer?: { verdict?: string } }): ClaudeChip[] {
  const list: ClaudeChip[] = [];
  const type = ctx.exercise_type ?? '';
  const verdict = ctx.answer?.verdict;
  if (ctx.answer && (verdict === 'wrong' || verdict === 'almost')) {
    list.push(chip('why_wrong', zh, '为什么错了 Why is my answer wrong?', 'Why is my answer wrong?', '我的答案为什么不对？应该怎么说？', 'Why is my answer wrong? What should I have said, and why?'));
  } else if (ctx.answer) {
    list.push(chip('my_answer', zh, '我的答案 Is my answer OK?', 'Is my answer OK?', '我的答案自然吗？还可以怎么说？', 'Is my answer natural? How else could I say it?'));
  }
  if (type === 'note') {
    list.push(chip('explain', zh, '讲一讲 Explain this note', 'Explain this note', '请用更简单的话讲一讲这个语法点。', 'Explain this point again in simpler words, with one more example.'));
  } else if (type === 'scramble') {
    list.push(chip('explain', zh, '语序 Explain the word order', 'Explain the word order', '这个句子为什么是这个语序？', 'Why are the words in this order? Explain the structure.'));
  } else if (CHOICE_EXERCISES.includes(type)) {
    list.push(chip('explain', zh, '为什么 Explain the right answer', 'Explain the right answer', '为什么这个是对的答案？别的为什么不对？', 'Why is the right answer right, and why are the others wrong?'));
  } else if (OWN_ANSWER_EXERCISES.includes(type)) {
    list.push(chip('explain', zh, '参考答案 Explain the model answer', 'Explain the model answer', '请解释一下参考答案，一个词一个词地说。', 'Explain the model answer word by word.'));
  } else {
    list.push(chip('explain', zh, '讲一讲 Explain this exercise', 'Explain this exercise', '请讲一讲这个练习考的是什么。', 'What is this exercise practising? Explain it.'));
  }
  list.push(
    chip('example', zh, '再来一个例子 Give me another example', 'Give me another example', '请再给我一个例子。', 'Give me another example of this, with pinyin and English.'),
    chip('one_more', zh, '再练一个 One more like this', 'One more like this', '给我出一个类似的小练习，先别告诉我答案。', 'Give me one more exercise like this to try — don’t tell me the answer yet.'),
  );
  return list;
}

/** After Claude's first reply, at most this many chips stay above the composer. */
export const CHIPS_AFTER_REPLY_MAX = 3;

export interface ChipOptions {
  language: AskLanguage;
  /** A card thread: he asked right after typing an answer (also read from the context's `typed`). */
  typedAnswer?: boolean;
  /** A card thread: the card has an example sentence. */
  hasSentence?: boolean;
  /** Claude's finished replies so far — after one, only the first CHIPS_AFTER_REPLY_MAX chips. */
  replies?: number;
  /** Chips already used in this thread (by id): never offered again. */
  used?: readonly string[];
}

/**
 * The suggestion chips above a thread's composer: shown while the thread is empty and after each
 * reply (at most three then). A practice chat's help chips are offered again and again (never "used").
 */
export function chipsFor(
  ctx: Pick<ClaudeThreadContext, 'kind'> & { typed?: unknown; looked_up?: readonly string[]; said_wrong?: readonly string[]; exercise_type?: string; answer?: { verdict?: string } },
  opts: ChipOptions,
): ClaudeChip[] {
  const zh = opts.language === 'zh';
  let list: ClaudeChip[];
  switch (ctx.kind) {
    case 'card':
      list = cardChips({ language: opts.language, typedAnswer: !!(opts.typedAnswer || ctx.typed), hasSentence: !!opts.hasSentence });
      break;
    case 'general':
      list = generalChips(zh);
      break;
    case 'chat_message':
      list = chatMessageChips(zh);
      break;
    case 'reader':
      list = readerChips(zh, ctx);
      break;
    case 'exercise':
      list = exerciseChips(zh, ctx);
      break;
    case 'practice':
      return practiceChips(zh);
    default:
      return [];
  }
  const used = new Set(opts.used ?? []);
  list = list.filter((c) => !used.has(c.id));
  return (opts.replies ?? 0) > 0 ? list.slice(0, CHIPS_AFTER_REPLY_MAX) : list;
}

// ---------- The composer ----------

export const CLAUDE_INTENT_LABELS: Record<ClaudeIntent, string> = {
  ask: 'Ask',
  check: '✏️ Check',
  explain: '🔍 Explain',
  translate: '🔤 Translate',
};

export const PRACTICE_READ_ONLY_NOTE = 'This practice chat is from the old chat screen and can’t go on — start a new one: ✏️ → 🎭 Practice a situation.';

export interface ClaudeComposer {
  /** The buttons, in order; the first is the primary one (Enter / ➤). Empty = no composer. */
  intents: ClaudeIntent[];
  primary: ClaudeIntent | null;
  /** False with nothing to send (the buttons show, disabled). */
  enabled: boolean;
  /** A line under the box (what Check / Explain / Translate would do), or null. */
  hint: string | null;
  /** A read-only thread (an old practice chat copied in): no composer, a banner instead. */
  readOnly: boolean;
}

/**
 * Which buttons a thread's composer offers for what is in the box. Check / Explain / Translate
 * only START a general chat (the server answers them with the Coach's structured reply), so a
 * general thread that already has messages — and every card / chat-message / practice / reader /
 * exercise thread — has Ask only. A new general chat: Ask first, then the Coach's buttons for the text
 * (`coachButtons`): Chinese → ✏️ Check + 🔍 Explain, English → Translate; empty → Ask / Check / Explain,
 * disabled. A read-only thread (an old practice chat copied in) has no composer.
 */
export function composerFor(kind: ClaudeContextKind, text: string, opts: { started: boolean; readOnly?: boolean }): ClaudeComposer {
  const hasText = text.trim().length > 0;
  if (opts.readOnly) return { intents: [], primary: null, enabled: false, hint: PRACTICE_READ_ONLY_NOTE, readOnly: true };
  if (kind !== 'general' || opts.started) return { intents: ['ask'], primary: 'ask', enabled: hasText, hint: null, readOnly: false };
  const b = coachButtons(text);
  return { intents: ['ask', ...b.actions], primary: 'ask', enabled: b.enabled, hint: b.hint, readOnly: false };
}

// ---------- The header chip ----------

/** Where the header chip leads: the card's hub, the chat the message is in, the reader at that page, the lesson, or nowhere. */
export type ClaudeContextLink =
  | { kind: 'card'; note_id: string }
  | { kind: 'chat_message'; message_id: string; conversation_id: string | null }
  | { kind: 'reader'; reader_id: string; page: number | null }
  | { kind: 'exercise'; lesson_id: string; exercise_key: string }
  | null;

export interface ClaudeHeaderChip {
  icon: string;
  text: string;
  link: ClaudeContextLink;
}

/**
 * The context chip in a thread's header: "📇 Asked on card · 银行" (→ the card hub), "💬 From a chat
 * message" (→ that chat), "📖 Reader · 成都 p.3" (→ the reader at that page), "🧩 Exercise · Translate"
 * (→ the lesson), "🎭 Practice · 点菜" (no link). A plain chat has none.
 */
export function headerChipFor(ctx: StoredClaudeContext): ClaudeHeaderChip | null {
  switch (ctx.kind) {
    case 'card': {
      const badge = contextBadge(ctx)!;
      return { icon: badge.icon, text: badge.text, link: { kind: 'card', note_id: ctx.note_id } };
    }
    case 'chat_message':
      return { icon: '💬', text: 'From a chat message', link: { kind: 'chat_message', message_id: ctx.message_id, conversation_id: ctx.conversation_id ?? null } };
    case 'practice': {
      const badge = contextBadge(ctx)!;
      return { icon: badge.icon, text: badge.text, link: null };
    }
    case 'reader': {
      const badge = contextBadge(ctx)!;
      return { icon: badge.icon, text: badge.text, link: { kind: 'reader', reader_id: ctx.reader_id, page: ctx.page ?? null } };
    }
    case 'exercise': {
      const badge = contextBadge(ctx)!;
      return { icon: badge.icon, text: badge.text, link: { kind: 'exercise', lesson_id: ctx.lesson_id, exercise_key: ctx.exercise_key } };
    }
    default:
      return null;
  }
}

// ---------- Resuming a thread ----------

/** A thread as the resume rule sees it (an inbox row). */
export interface ResumeCandidate {
  id: string;
  context_kind: ClaudeContextKind;
  context: StoredClaudeContext;
  /** ISO. */
  last_message_at: string | null;
  created_at: string;
  archived?: boolean;
}

/** A card question within this long of the card's last one continues that thread (the server's rule too). */
export const RESUME_WINDOW_MS = THREAD_GAP_MS;

/** The contexts whose thread resumes only within RESUME_WINDOW_MS: a card, a reader page, an exercise. */
const WINDOWED_KINDS: readonly ClaudeContextKind[] = ['card', 'reader', 'exercise'];

function timeOf(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
}

/**
 * Which existing thread opening Claude in a context continues, or null for a new one. A plain chat
 * and a new role-play never resume (each is new). A card's, a reader page's or an exercise's newest
 * thread resumes while its last message is within RESUME_WINDOW_MS of now (the 30-minute rule the server
 * groups card questions by); a chat message's thread (Discuss with Claude) or an old practice chat's
 * always resumes (one per message / chat). Archived threads never do. Ties: the newest activity, then the id.
 */
export function resumeThreadFor(threads: readonly ResumeCandidate[], ctx: ClaudeThreadContext, nowMs: number): string | null {
  if (ctx.kind === 'general') return null;
  if (ctx.kind === 'practice' && !ctx.conversation_id) return null;
  const ref = contextRef(ctx);
  let best: { id: string; at: number } | null = null;
  for (const t of threads) {
    if (t.archived || t.context_kind !== ctx.kind || contextRef(t.context) !== ref) continue;
    const last = timeOf(t.last_message_at);
    const at = Number.isNaN(last) ? timeOf(t.created_at) : last;
    if (Number.isNaN(at)) continue;
    if (WINDOWED_KINDS.includes(ctx.kind) && nowMs - at > RESUME_WINDOW_MS) continue;
    if (!best || at > best.at || (at === best.at && t.id > best.id)) best = { id: t.id, at };
  }
  return best?.id ?? null;
}

// ---------- Polling while a reply is written ----------

/** The thread screen looks again this often while a reply is pending and the socket is quiet… */
export const CLAUDE_POLL_FAST_MS = 400;
/** …for the first this-many ms of the reply… */
export const CLAUDE_POLL_FAST_FOR_MS = 10_000;
/** …then this often (also the safety net while live events are arriving). */
export const CLAUDE_POLL_SLOW_MS = 1500;
/** A live event within this long = the socket is delivering the reply. */
export const CLAUDE_LIVE_FRESH_MS = 3000;

/**
 * How long the thread screen waits before asking `GET /api/claude/threads/:id?since=` again while a
 * reply is pending (`pendingForMs` = how long THIS screen has seen it pending, device clock). While
 * `claude_turn` events are arriving over the live socket (one within CLAUDE_LIVE_FRESH_MS) the poll
 * is only a slow safety net; otherwise — socket down, a Check / Explain / Translate reply (not
 * streamed), the stream gone quiet — 400 ms for the first 10 s, then 1.5 s.
 */
export function claudeReplyPollMs(pendingForMs: number, live?: { open: boolean; sinceEventMs: number | null }): number {
  if (live?.open && live.sinceEventMs !== null && Number.isFinite(live.sinceEventMs) && live.sinceEventMs < CLAUDE_LIVE_FRESH_MS) return CLAUDE_POLL_SLOW_MS;
  return Number.isFinite(pendingForMs) && pendingForMs < CLAUDE_POLL_FAST_FOR_MS ? CLAUDE_POLL_FAST_MS : CLAUDE_POLL_SLOW_MS;
}

// ---------- The streaming bubble's status line ----------

const CARD_TOOLS = ['search_cards', 'get_note_cards', 'get_deck_info', 'list_student_decks'];
const PROGRESS_TOOLS = ['get_note_history', 'get_overall_stats', 'get_deck_progress', 'get_due_cards'];

/** What the bubble says while Claude works ("Looking through your cards…" while a read tool runs). */
export function turnStatusLine(status: 'thinking' | 'tool' | 'streaming' | 'done' | 'failed' | null | undefined, tool: string | null | undefined, language: AskLanguage): string | null {
  const zh = language === 'zh';
  if (status === 'tool') {
    if (tool && CARD_TOOLS.includes(tool)) return zh ? '在看你的卡片… Looking through your cards…' : 'Looking through your cards…';
    if (tool && PROGRESS_TOOLS.includes(tool)) return zh ? '在看你的学习记录… Looking at your progress…' : 'Looking at your progress…';
    return zh ? '在查… Looking it up…' : 'Looking it up…';
  }
  if (status === 'thinking') return zh ? '想一想… Thinking…' : 'Thinking…';
  return null;
}

// ---------- A reader page's words for its context ----------

/** A reader word recap word as `readerPageWords` reads it (shared/study/wordRecap.ts `WordRecapWord`). */
export interface ReaderRecapWordLike {
  hanzi: string;
  /** 0-based page index. */
  page: number;
  /** Place on the page (story order). */
  pos: number;
  reasons: readonly string[];
}

/**
 * The words of ONE page of this reading for the reader context ("📖 Ask Claude about this page"): the
 * ones he tapped (`looked_up`) and the ones a 🎤 take heard wrong (`said_wrong`), in story order, each
 * list ≤ READER_CONTEXT_WORDS_MAX. Empty lists are left out.
 */
export function readerPageWords(words: readonly ReaderRecapWordLike[], page: number): { looked_up?: string[]; said_wrong?: string[] } {
  const onPage = words.filter((w) => w.page === page && w.hanzi.trim()).sort((a, b) => a.pos - b.pos);
  const pick = (reason: string) => {
    const out: string[] = [];
    for (const w of onPage) {
      const h = w.hanzi.trim();
      if (w.reasons.includes(reason) && !out.includes(h)) out.push(h);
      if (out.length >= READER_CONTEXT_WORDS_MAX) break;
    }
    return out;
  };
  const lookedUp = pick('tapped');
  const saidWrong = pick('said_wrong');
  return { ...(lookedUp.length ? { looked_up: lookedUp } : {}), ...(saidWrong.length ? { said_wrong: saidWrong } : {}) };
}
