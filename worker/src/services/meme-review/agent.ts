/**
 * 梗 Meme review — the research agent (PROTOTYPE, docs/MEME_REVIEW.md).
 *
 * Claude (the current Opus) with Anthropic's server-side web search + web fetch researches the
 * Chinese internet of the last ~6–8 weeks and hands in ONE monthly issue through `submit_issue`.
 * The issue is validated by shared/meme-review (every URL must be one the tools RETURNED — the
 * agent loop collects them from the tool results; pinyin is re-derived by the app); problems go
 * back as the tool's error for at most MAX_SUBMITS - 1 repair rounds.
 *
 * Bounded: ≤ MAX_SEARCHES web searches and MAX_FETCHES fetches (counted from the API's own
 * `server_tool_use` usage; each request's `max_uses` is what is left), ≤ MAX_ROUNDS model calls.
 * Like the audio-lesson author, the transcript is checkpointed after every model turn and every
 * batch of tool results (here in R2 — search results are big), so a redelivered queue message
 * resumes instead of starting again; a server-side `pause_turn` is resumed by calling again with
 * the paused turn as is. Opus 5.5 always thinks (adaptive), takes no forced tool_choice and no
 * `thinking` / `temperature`: effort is set explicitly, the prompt asks for the tool, and a turn
 * that ends without it gets one nudge.
 */
import Anthropic from '@anthropic-ai/sdk';
import { validateMemeIssue, type DerivePinyin, type MemeIssue } from '@shared/meme-review';
import { OPUS_MODEL } from '../models';

export const MEME_REVIEW_MODEL = OPUS_MODEL;
/** List prices, $ per million tokens (Opus 5.5) and per search / picture (estimates for the row's cost). */
export const MEME_PRICES = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, perSearch: 0.01, perImage: 0.067 };
export const MAX_SEARCHES = 25;
export const MAX_FETCHES = 10;
export const MAX_ROUNDS = 14;
/** submit_issue attempts: the first + two repair rounds. */
export const MAX_SUBMITS = 3;
/** Non-streaming (so the AI-usage wrapper sees the usage): the SDK refuses a max_tokens it expects past 10 minutes. */
const MAX_TOKENS = 20_000;
const SUBMIT_TOOL = 'submit_issue';

// ---------------- Prompt ----------------

export const MEME_SYSTEM = `You are the researcher and editor of "梗 Meme review", a monthly issue inside a Chinese-learning app. Each month you find out what the CHINESE internet has been saying over the last 6–8 weeks and explain 6–10 current memes / buzzwords (梗, 网络热词) to one learner.

The reader: an English-speaking adult around 30 (a late millennial / early Gen Z, online early, a bit online), an intermediate learner (≈ HSK 4). He already knows the classics (情绪价值, 搭子, 牛马, 打工人, 发疯文学, 破防, 绷不住, i人 / e人, 祛魅, City不City, 显眼包, 班味…) — so what he wants is what is CURRENT, with real sources.

RESEARCH with web_search (and web_fetch for a page you need to read). You have a limited budget (about ${MAX_SEARCHES} searches): plan them. Search mostly in Chinese. Good sources: buzzword round-ups and 年度/月度热词 lists in Chinese media (人民网, 新华网, 澎湃, 咬文嚼字, 新周刊…), meme encyclopedias (百度百科, 萌娘百科, 小鸡词典), Zhihu / Weibo / Bilibili / Douyin / Xiaohongshu pages about a meme, English explainers (What's on Weibo, Sixth Tone). Check a meme is genuinely current (from or newly popular in the window); prefer memes a learner would actually meet in comments, chats and videos. Find the original video or post when it is public (a Bilibili / YouTube / Douyin / Weibo / Xiaohongshu link that your search returned).

URLS — the most important rule: every URL you put in sources or media must be one your web_search / web_fetch results actually returned in this conversation. Never write a URL from memory, never guess or "fix" one. An item whose sources are not from your results is thrown away. LINK OUT only — media are links people open in their browser.

CONTENT RULES: skip anything politically sensitive (leaders, government, protests, territorial or ethnic disputes, censorship), sexual content, hate or slurs, and anything about a private person (no doxxing, no "this ordinary person went viral" when it mocks them). Public figures only for harmless entertainment memes. Mildly crude memes are fine — set register.crude true and say so. When you are unsure where a meme comes from, say so in origin.text and set confidence "medium"; if you are really unsure it is real or current, leave it out.

WRITING (for each item):
- hanzi: the meme / phrase exactly as people write it, ONE clean form (no slashes, brackets or ellipses; Latin letters are fine when that is how it is written, e.g. City不City, i人).
- pinyin: tone marks, spaces between words, the 一 / 不 tone changes written (yí gè, bú shì). The app re-derives it, so keep it simple.
- english: the gist in a few words.
- meaning_zh: what it means in SIMPLE Chinese (HSK 3–4): 2–4 short sentences. meaning_en: the same in natural English.
- origin: text (English, 1–3 sentences: where, when, who, how it spread — honest about uncertainty), when ("Sep 2026"), confidence high | medium.
- examples: 2–3 short realistic lines as people would type them in a chat or a comment, with english.
- register: who says it (age group / community), tone (ironic, affectionate…), where (online / spoken / both), crude, note.
- would_you_say_it: for a ~30-year-old foreigner using it with Chinese friends: verdict fine | cute | cringe | avoid + one honest line why.
- related: older memes it riffs on (hanzi + english), if any.
- sources: 1–3 {url, title} from your results. media: 0–3 {url, title} of the original video / post from your results.
- illustration_prompt: one sentence describing a playful cartoon picture in the meme's spirit for our own illustrator: no real people or their likeness, no logos, no brands, no text in the picture.

THE ISSUE: title (short Chinese title, e.g. "十月梗回顾"), title_en, intro_zh (2–3 short simple sentences introducing the month), intro_en; items (6–10, the most useful first); quiz: 3–5 multiple-choice questions on the items (prompt in English or simple Chinese, 3–4 options, answer = the index of the right option, a one-line explanation, item_hanzi = the meme it is about).

When your research is done, call ${SUBMIT_TOOL} ONCE with the whole issue. If it comes back with problems, fix exactly those (search again only if you must) and call ${SUBMIT_TOOL} again. The issue only exists when ${SUBMIT_TOOL} succeeds — never end your turn without calling it.`;

const LINE = {
  type: 'object',
  properties: { hanzi: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' } },
  required: ['hanzi', 'english'],
} as const;
const LINK = {
  type: 'object',
  properties: { url: { type: 'string', description: 'a URL returned by your web_search / web_fetch results' }, title: { type: 'string' } },
  required: ['url', 'title'],
} as const;

export const SUBMIT_ISSUE_TOOL: Anthropic.Tool = {
  name: SUBMIT_TOOL,
  description: 'Hand in the finished monthly meme review. It is checked; problems come back as the error — fix them and call again.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      title_en: { type: 'string' },
      intro_zh: { type: 'string' },
      intro_pinyin: { type: 'string' },
      intro_en: { type: 'string' },
      items: {
        type: 'array',
        description: '6–10 memes, most useful first',
        items: {
          type: 'object',
          properties: {
            hanzi: { type: 'string' },
            pinyin: { type: 'string' },
            english: { type: 'string' },
            meaning_zh: { type: 'string' },
            meaning_pinyin: { type: 'string' },
            meaning_en: { type: 'string' },
            origin: {
              type: 'object',
              properties: { text: { type: 'string' }, when: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
              required: ['text', 'when', 'confidence'],
            },
            examples: { type: 'array', items: LINE },
            register: {
              type: 'object',
              properties: {
                who: { type: 'string' },
                tone: { type: 'string' },
                where: { type: 'string', enum: ['online', 'spoken', 'both'] },
                crude: { type: 'boolean' },
                note: { type: 'string' },
              },
              required: ['who', 'tone', 'where', 'crude'],
            },
            would_you_say_it: {
              type: 'object',
              properties: { verdict: { type: 'string', enum: ['fine', 'cute', 'cringe', 'avoid'] }, note: { type: 'string' } },
              required: ['verdict', 'note'],
            },
            related: { type: 'array', items: LINE },
            sources: { type: 'array', items: LINK },
            media: { type: 'array', items: LINK },
            illustration_prompt: { type: 'string' },
          },
          required: ['hanzi', 'english', 'meaning_zh', 'meaning_en', 'origin', 'examples', 'register', 'would_you_say_it', 'sources', 'illustration_prompt'],
        },
      },
      quiz: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answer: { type: 'integer' },
            explanation: { type: 'string' },
            item_hanzi: { type: 'string' },
          },
          required: ['prompt', 'options', 'answer', 'explanation'],
        },
      },
    },
    required: ['title', 'intro_zh', 'items', 'quiz'],
  },
};

/**
 * The tools for one request. Only TWO shapes, so the cached conversation (tools come first in the
 * prompt-cache prefix) breaks at most once: up to 10 searches / 5 fetches a request while the
 * budget allows a whole request more, then 1 each (the API needs max_uses ≥ 1) — so the total stays
 * at about MAX_SEARCHES / MAX_FETCHES, plus one a round after that (bounded by MAX_ROUNDS).
 */
export function memeTools(state: Pick<MemeAgentState, 'searches' | 'fetches'>): Anthropic.Tool[] {
  const open = state.searches + 10 <= MAX_SEARCHES && state.fetches + 5 <= MAX_FETCHES;
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: open ? 10 : 1 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: open ? 5 : 1 },
    SUBMIT_ISSUE_TOOL,
  ] as unknown as Anthropic.Tool[];
}

export function memeBriefing(opts: { month: string; monthLabel: string; covers: { from: string; to: string }; today: string; earlier: string[] }): string {
  const earlier = opts.earlier.length
    ? `\nMemes covered in earlier issues (don't repeat them unless they had a big new twist): ${opts.earlier.slice(0, 80).join('、')}`
    : '';
  return `Write the ${opts.monthLabel} issue (${opts.month}). Today is ${opts.today}; cover what was current on the Chinese internet from about ${opts.covers.from} to ${opts.covers.to}.${earlier}

Research first, then call ${SUBMIT_TOOL} with the whole issue.`;
}

// ---------------- URLs seen in tool results ----------------

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\)\]}，。、]+/g;

/**
 * Every URL the tools RETURNED in these blocks: `url` fields and URLs in the text of any
 * `*_tool_result` block (web search / fetch results, and the code-execution output of dynamic
 * filtering), plus text citations. What the model wrote itself (its text, a tool's input) never
 * counts.
 */
export function urlsFromToolResults(content: ReadonlyArray<Record<string, unknown>>): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || out.size > 3000 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (v.length > 200_000) return;
      for (const m of v.matchAll(URL_IN_TEXT)) out.add(m[0].replace(/[.,;:!?]+$/, ''));
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.url === 'string') out.add(o.url);
      for (const [k, x] of Object.entries(o)) if (k !== 'encrypted_content' && k !== 'encrypted_index') walk(x, depth + 1);
    }
  };
  for (const block of content) {
    const type = String(block.type ?? '');
    if (type.endsWith('_tool_result')) walk(block.content, 0);
    else if (type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations as Array<Record<string, unknown>>) if (typeof c?.url === 'string') out.add(c.url);
    }
  }
  return [...out];
}

// ---------------- Usage ----------------

export interface MemeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface ApiUsage extends Partial<MemeUsage> {
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null;
}

export function addMemeUsage(total: MemeUsage, u: Partial<MemeUsage> | undefined): MemeUsage {
  return {
    input_tokens: total.input_tokens + (u?.input_tokens ?? 0),
    output_tokens: total.output_tokens + (u?.output_tokens ?? 0),
    cache_read_input_tokens: total.cache_read_input_tokens + (u?.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: total.cache_creation_input_tokens + (u?.cache_creation_input_tokens ?? 0),
  };
}

/** Estimated dollars: tokens at Opus 5.5 list prices + $10 / 1,000 searches + the pictures. */
export function memeCostUsd(u: MemeUsage, searches: number, images: number): number {
  const usd =
    (u.input_tokens * MEME_PRICES.input + u.output_tokens * MEME_PRICES.output + u.cache_read_input_tokens * MEME_PRICES.cacheRead + u.cache_creation_input_tokens * MEME_PRICES.cacheWrite) / 1e6 +
    searches * MEME_PRICES.perSearch +
    images * MEME_PRICES.perImage;
  return Math.round(usd * 10000) / 10000;
}

// ---------------- The model call ----------------

export type MemeModelCall = (req: { system: string; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[] }) => Promise<{
  content: Array<Record<string, unknown>>;
  usage?: ApiUsage;
  stop_reason?: string | null;
}>;

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) return error.status === 429 || error.status === 529 || (error.status ?? 0) >= 500;
  return error instanceof Anthropic.APIConnectionError;
}

/** A 400 while the refusal-fallback parameter was sent: the call is sent again once without it (and it stays off). */
function fallbackRejected(error: unknown): boolean {
  return error instanceof Anthropic.APIError && error.status === 400;
}

let fallbacksOff = false;

export function anthropicMemeCall(apiKey: string): MemeModelCall {
  const client = new Anthropic({ apiKey, timeout: 9 * 60 * 1000, maxRetries: 0 });
  return async ({ system, tools, messages }) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * attempt));
      try {
        // Opus 5.5: adaptive thinking always on (no `thinking`), effort explicit (default is medium),
        // tool_choice auto. Top-level cache_control caches the growing conversation between rounds.
        // Server-side refusal fallback ("default" routing) unless this API refused the parameter.
        const body: Record<string, unknown> = {
          model: MEME_REVIEW_MODEL,
          max_tokens: MAX_TOKENS,
          system,
          tools,
          messages,
          output_config: { effort: 'high' },
          cache_control: { type: 'ephemeral' },
          ...(fallbacksOff ? {} : { fallbacks: 'default' }),
        };
        const options = fallbacksOff ? undefined : { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } };
        const res = await client.messages.create(body as unknown as Anthropic.MessageCreateParamsNonStreaming, options);
        return res as unknown as Awaited<ReturnType<MemeModelCall>>;
      } catch (error) {
        lastError = error;
        if (!fallbacksOff && fallbackRejected(error)) {
          fallbacksOff = true;
          continue;
        }
        if (!isRetryable(error)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Claude request failed');
  };
}

// ---------------- The loop ----------------

export interface MemeAgentState {
  messages: Anthropic.MessageParam[];
  rounds: number;
  submits: number;
  searches: number;
  fetches: number;
  nudged: boolean;
  usage: MemeUsage;
  /** Every URL the tools returned so far. */
  seen_urls: string[];
  /** Illustrate phase: items whose picture was attempted (a failed one isn't retried forever). */
  pictures_tried?: string[];
}

export function newMemeAgentState(briefing: string): MemeAgentState {
  return {
    messages: [{ role: 'user', content: briefing }],
    rounds: 0,
    submits: 0,
    searches: 0,
    fetches: 0,
    nudged: false,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    seen_urls: [],
  };
}

export type MemeAgentOutcome =
  | { kind: 'done'; issue: MemeIssue; notes: string[]; state: MemeAgentState }
  | { kind: 'continue'; state: MemeAgentState }
  | { kind: 'failed'; reason: string; state: MemeAgentState };

export const MEME_NUDGE = `Please call ${SUBMIT_TOOL} now with the complete issue — it only exists once ${SUBMIT_TOOL} succeeds.`;

function progressFor(state: MemeAgentState): string {
  if (state.submits > 0) return 'Polishing the issue…';
  if (state.searches > 0) return `Researching… (${state.searches} search${state.searches === 1 ? '' : 'es'})`;
  return 'Researching…';
}

/**
 * Run until the issue is accepted, the deadline passes (→ continue, resumed by the next delivery
 * from the checkpoint) or a budget runs out. `checkpoint` runs after every model turn and every
 * batch of tool results.
 */
export async function runMemeAgent(args: {
  month: string;
  covers: { from: string; to: string };
  state: MemeAgentState;
  call: MemeModelCall;
  derivePinyin: DerivePinyin;
  checkpoint: (state: MemeAgentState, progress: string) => Promise<void>;
  deadline: number;
  now?: () => number;
}): Promise<MemeAgentOutcome> {
  const { state, call, checkpoint } = args;
  const now = args.now ?? Date.now;
  const seen = new Set(state.seen_urls);

  while (state.rounds < MAX_ROUNDS) {
    const last = state.messages[state.messages.length - 1];
    let content: Array<Record<string, unknown>>;
    let stop: string | null | undefined = null;
    const pendingTool = last.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => (b as { type: string }).type === 'tool_use');
    if (pendingTool) {
      // Resumed after a model turn whose submit_issue never got its result: run it now.
      content = last.content as unknown as Array<Record<string, unknown>>;
      stop = 'tool_use';
    } else {
      const res = await call({ system: MEME_SYSTEM, tools: memeTools(state), messages: state.messages });
      state.rounds += 1;
      state.usage = addMemeUsage(state.usage, res.usage);
      state.searches += res.usage?.server_tool_use?.web_search_requests ?? 0;
      state.fetches += res.usage?.server_tool_use?.web_fetch_requests ?? 0;
      content = res.content ?? [];
      stop = res.stop_reason;
      for (const u of urlsFromToolResults(content)) seen.add(u);
      state.seen_urls = [...seen];
      if (stop === 'refusal') return { kind: 'failed', reason: 'Claude declined to write this issue', state };
      state.messages.push({ role: 'assistant', content: content as unknown as Anthropic.ContentBlockParam[] });
      await checkpoint(state, progressFor(state));
      // A server-side tool loop paused: call again with the paused turn as is (no extra message).
      if (stop === 'pause_turn') {
        if (now() > args.deadline) return { kind: 'continue', state };
        continue;
      }
    }

    const uses = content.filter((b) => b.type === 'tool_use') as unknown as Anthropic.ToolUseBlock[];
    if (uses.length === 0) {
      if (state.nudged) return { kind: 'failed', reason: 'Claude stopped without handing in an issue', state };
      state.nudged = true;
      const budget = state.searches >= MAX_SEARCHES ? ' Your search budget is used up — write the issue from what you found.' : '';
      state.messages.push({ role: 'user', content: MEME_NUDGE + budget });
      await checkpoint(state, progressFor(state));
      continue;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let accepted: { issue: MemeIssue; notes: string[] } | null = null;
    for (const use of uses) {
      if (use.name !== SUBMIT_TOOL) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` });
        continue;
      }
      state.submits += 1;
      const check = validateMemeIssue(use.input, { month: args.month, covers: args.covers, seenUrls: seen, derivePinyin: args.derivePinyin });
      if (check.issue && !accepted) {
        accepted = { issue: check.issue, notes: check.notes };
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `Accepted with ${check.issue.items.length} memes. Thank you!` });
      } else {
        const notes = check.notes.length ? `\n\nAlso dropped:\n- ${check.notes.slice(0, 30).join('\n- ')}` : '';
        const budget = state.searches >= MAX_SEARCHES ? '\n(Your search budget is used up.)' : '';
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: `Not accepted — fix these and call ${SUBMIT_TOOL} again with the COMPLETE issue:\n- ${check.problems.slice(0, 20).join('\n- ')}${notes}${budget}`,
        });
      }
    }
    state.messages.push({ role: 'user', content: results });
    await checkpoint(state, accepted ? 'Issue written' : progressFor(state));
    if (accepted) return { kind: 'done', issue: accepted.issue, notes: accepted.notes, state };
    if (state.submits >= MAX_SUBMITS) return { kind: 'failed', reason: `The issue still had problems after ${MAX_SUBMITS} tries`, state };
    if (now() > args.deadline) return { kind: 'continue', state };
  }
  return { kind: 'failed', reason: `Claude didn't finish the issue in ${MAX_ROUNDS} rounds`, state };
}
