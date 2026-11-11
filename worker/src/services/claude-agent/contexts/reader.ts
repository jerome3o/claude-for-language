/**
 * Context `reader` — "📖 Ask Claude about this page" on a graded reader (docs/STUDY_SESSION.md "Graded
 * readers" → "Ask Claude about this page"; the unified-Claude-chats plan §6.5).
 *
 * load: ONE `db.batch` — the reader (ownership: missing → 404, someone else's → 403), its pages, the
 * learner's decks (create_flashcards picks one) and, for Chinese answers, the known-words sample.
 * The context block (uncached, after the cached persona + learner blocks): the story's title and level,
 * the page he asked on in full (Chinese, pinyin, English), a budgeted window of the pages around it
 * (`READER_WINDOW_PAGES` each side, ≤ `READER_WINDOW_CHARS` in all) and the words he tapped / read aloud
 * wrong on this page in this reading — the device's reader word recap run sends them with the context
 * (shared/study/wordRecap.ts), so "the words I looked up" needs no server state.
 * Tools: read-only look-ups + create_flashcards (into a deck from the listed ones, applied by the
 * thread turn like the Coach's) + bump_cards.
 */
import { plainAnswerText, type AskLanguage } from '@shared/study/askClaude';
import { StructuredCallError } from '../../structured-call';
import { knownWordsStatement } from '../learner';
import { buildContextChatSystemBlocks } from '../persona';
import { ClaudeContextError, type AgentEnv, type ContextProvider, type ContextOf, type ToolName } from '../types';

/** The reader chat's tools, in the order the model sees them. */
export const READER_TOOLS: readonly ToolName[] = ['create_flashcards', 'search_cards', 'bump_cards', 'get_note_cards', 'search_my_chats', 'read_chat'];

/** A reader chat's output budget (thinking off: all answer). */
export const READER_CHAT_MAX_TOKENS = 4000;
/** Pages before / after the current one in the context block… */
export const READER_WINDOW_PAGES = 2;
/** …within this many characters in all (the current page is always whole). */
export const READER_WINDOW_CHARS = 1600;

export interface ReaderPageRow {
  id: string;
  page_number: number;
  content_chinese: string;
  content_pinyin: string;
  content_english: string;
}

interface ReaderData {
  title: string;
  titleEnglish: string;
  level: string;
  topic: string | null;
  pages: ReaderPageRow[];
  /** Index of the current page in `pages`. */
  index: number;
  decks: string;
  language: AskLanguage;
  knownWords: string[];
  lookedUp: string[];
  saidWrong: string[];
}

/** The reader and its pages when they are the caller's (404 / 403 otherwise), + the decks and known words. */
export async function loadReaderContext(env: AgentEnv, ctx: ContextOf<'reader'>, userId: string, language: AskLanguage): Promise<ReaderData> {
  const db = env.DB;
  const statements: D1PreparedStatement[] = [
    db.prepare('SELECT id, user_id, title_chinese, title_english, difficulty_level, topic FROM graded_readers WHERE id = ?').bind(ctx.reader_id),
    db
      .prepare('SELECT id, page_number, content_chinese, content_pinyin, content_english FROM reader_pages WHERE reader_id = ? ORDER BY page_number, rowid')
      .bind(ctx.reader_id),
    db.prepare('SELECT id, name FROM decks WHERE user_id = ? ORDER BY name').bind(userId),
  ];
  if (language === 'zh') statements.push(knownWordsStatement(db, userId));
  const results = await db.batch<Record<string, unknown>>(statements);
  const reader = results[0].results?.[0] as { user_id: string; title_chinese: string; title_english: string; difficulty_level: string; topic: string | null } | undefined;
  if (!reader) throw new ClaudeContextError('Reader not found', 404);
  if (reader.user_id !== userId) throw new ClaudeContextError('Access denied', 403);
  const pages = (results[1].results ?? []) as unknown as ReaderPageRow[];
  const at = ctx.page_id ? pages.findIndex((p) => p.id === ctx.page_id) : 0;
  if (ctx.page_id && at < 0) throw new ClaudeContextError('Page not found', 404);
  const decks = (results[2].results ?? []) as Array<{ id: string; name: string }>;
  return {
    title: reader.title_chinese,
    titleEnglish: reader.title_english,
    level: reader.difficulty_level,
    topic: reader.topic,
    pages,
    index: Math.max(0, at),
    decks: decks.length ? decks.map((d) => `${d.name} (id: ${d.id})`).join(', ') : 'none',
    language,
    knownWords: language === 'zh' ? ((results[3]?.results ?? []) as Array<{ hanzi: string }>).map((r) => r.hanzi).filter(Boolean) : [],
    lookedUp: ctx.looked_up ?? [],
    saidWrong: ctx.said_wrong ?? [],
  };
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One neighbouring page in the window: its Chinese and English, each cut to fit. */
function windowPage(p: ReaderPageRow, max: number): string {
  const half = Math.max(30, Math.floor((max - 20) / 2));
  return `Page ${p.page_number}: ${cut(p.content_chinese.replace(/\s+/g, ' ').trim(), half)} — ${cut(p.content_english.replace(/\s+/g, ' ').trim(), half)}`;
}

/**
 * The pages around the current one, nearest first until the budget runs out, then in story order.
 * Pure (exported for tests).
 */
export function readerWindow(pages: readonly ReaderPageRow[], index: number, opts: { each?: number; chars?: number } = {}): string[] {
  const each = opts.each ?? READER_WINDOW_PAGES;
  let budget = opts.chars ?? READER_WINDOW_CHARS;
  const picked: Array<{ i: number; line: string }> = [];
  for (let d = 1; d <= each; d++) {
    for (const i of [index - d, index + d]) {
      if (i < 0 || i >= pages.length || budget <= 60) continue;
      const line = windowPage(pages[i], Math.min(400, budget));
      if (line.length > budget) continue;
      budget -= line.length;
      picked.push({ i, line });
    }
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => p.line);
}

/** The context block: the story, the page in full, the window, the looked-up words, the decks. */
export function readerBlock(d: ReaderData): string {
  const lines = [`The learner is reading this graded reader: 《${d.title}》 (${d.titleEnglish}) — level: ${d.level}${d.topic ? `, topic: ${d.topic}` : ''}.`];
  const page = d.pages[d.index];
  if (page) {
    lines.push('', `The page they asked on (page ${page.page_number} of ${d.pages.length}):`, `- Chinese: ${page.content_chinese}`, `- Pinyin: ${page.content_pinyin}`, `- English: ${page.content_english}`);
    const around = readerWindow(d.pages, d.index);
    if (around.length) lines.push('', 'The pages around it (shortened):', ...around.map((l) => `- ${l}`));
  } else {
    lines.push('', 'The story has no pages yet.');
  }
  if (d.lookedUp.length) lines.push('', `Words they tapped to look up on this page: ${d.lookedUp.join('、')}`);
  if (d.saidWrong.length) lines.push(`Words they read aloud wrong on this page: ${d.saidWrong.join('、')}`);
  lines.push('', `The learner's decks (create_flashcards: only when he names one — otherwise leave deck_id out and the cards go to "From Claude"): ${d.decks}`);
  return lines.join('\n');
}

export const readerContext: ContextProvider<'reader', ReaderData> = {
  kind: 'reader',
  surface: 'reader',
  policy: 'chat',
  maxTokens: READER_CHAT_MAX_TOKENS,
  maxRounds: 4,
  load: (env, ctx, input) => loadReaderContext(env, ctx, input.userId, input.language ?? 'en'),
  persona: (d) => buildContextChatSystemBlocks('reader', { language: d.language, knownWords: d.knownWords })[0],
  learner: (d) => buildContextChatSystemBlocks('reader', { language: d.language, knownWords: d.knownWords })[1],
  systemBlock: (d) => readerBlock(d),
  tools: () => READER_TOOLS,
  toolContext: (_d, input) => ({ deckId: '', bumpSource: input.bumpSource ?? 'reader' }),
  deferredAck: (tool) => (tool === 'create_flashcards' ? 'The cards will be saved when your reply is finished.' : `Tool ${tool} will be applied after your reply`),
  finish(text, input) {
    const answer = (input.language ?? 'en') === 'zh' ? plainAnswerText(text).trim() : text.trim();
    if (!answer) throw new StructuredCallError('Claude gave an empty answer', true);
    return answer;
  },
};
