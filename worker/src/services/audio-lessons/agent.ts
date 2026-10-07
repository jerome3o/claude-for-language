/**
 * The audio-lesson author (docs/AUDIO_LESSONS.md "Writing"): Claude Opus 5.5 in a
 * small tool loop. It sees the learner's vocabulary summary (and, for a sleep
 * lesson, an analysis of the pasted text against it), looks words up with
 * `check_known_words`, and hands in the lesson with `submit_lesson`. The plan is
 * validated and compiled; problems go back as the tool's error so the model
 * repairs it in the same conversation.
 *
 * Like the session-notes agent (tutor-notes-agent.ts): the transcript is
 * checkpointed after every model turn and every batch of tool results, so a
 * redelivered queue message resumes instead of starting again. Opus 5.5 always
 * thinks (adaptive) and takes no forced tool_choice, so the prompt asks for the
 * tool and a turn that ends without it gets one nudge.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  AUDIO_LESSON_INPUT_LIMITS,
  compileDialogueLesson,
  compileSleepLesson,
  estimateScriptMs,
  validateDialoguePlan,
  validateScript,
  validateSleepPlan,
  type AudioLessonFormat,
  type AudioLessonInput,
  type AudioLessonScript,
  type DialoguePlan,
  type SleepPlan,
} from '@shared/audio-lesson';
import { CARD_STANDARD_SHORT } from './prompt-bits';
import { analyseText, checkWords, levelSample, type VocabIndex } from './vocab';

export const AUDIO_LESSON_MODEL = 'claude-opus-5-5';
/** Opus 5.5 list price, $ per million tokens (input, output, cache read). */
export const MODEL_PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
export const MAX_AUTHOR_ROUNDS = 10;
/** Non-streaming: the SDK refuses a max_tokens it expects to run past 10 minutes (~21k). */
const MAX_TOKENS = 20_000;

// ---------------- Prompts ----------------

const COMMON = `You write audio lessons for ONE Chinese learner inside a flashcard app. The lesson is listened to, not read: on a train, or in bed falling asleep. Nothing you write is shown as text first — every word is spoken by text-to-speech voices, so write for the ear.

The learner: an adult English speaker, roughly HSK 3–4, with a few thousand flashcards. The briefing says how many words they know and shows a sample. "known" = a mature card (remembered for 3+ weeks); "learning" = they have the card but it is not solid yet; "in_deck" = a card they have never studied; "new" = no card at all.

Tools
- check_known_words: what the learner knows about words you are considering, and, for each character, words they KNOW that contain it ("银" → 银行). Call it with every candidate word or structure before you decide what to teach and how to explain it — it is cheap; batch up to 80 words per call.
- submit_lesson: hand in the finished lesson. It is checked; if it comes back with problems, fix exactly those and call submit_lesson again. The lesson is only made when submit_lesson succeeds — never end your turn without calling it.

Language rules
- Simplified characters, mainland Mandarin, natural and idiomatic.
- Pinyin with tone marks, spaces between words; 一 and 不 carry their tone changes (yí gè, yì tiān, bú shì, bù hǎo); no other tone sandhi (nǐ hǎo stays).
- English translations: natural English, one clear meaning.
- Chinese text that is spoken: no slashes, brackets, ellipses, blanks or alternatives — the voice reads every symbol.
${CARD_STANDARD_SHORT}`;

const DIALOGUE_PROMPT = `${COMMON}

FORMAT: "dialogue" — like a ChinesePod lesson, an English host with Chinese.
The learner describes a situation to practise (and may paste a dialogue). The app builds the audio from your plan like this — you write only the content:
1. Your intro_en (English, 2–5 sentences): set the scene and say what to listen for.
2. The dialogue three times: twice at natural speed, once a little slower, two different Chinese voices.
3. Line by line: each Chinese line, then its English translation.
4. For each point, in its own chapter: the word said slowly twice, your explanation_en, the dialogue line that uses it, your example (Chinese, English, Chinese again), the word once more.
5. The whole dialogue once more, then your outro_en.

The dialogue
- Two people (A and B) in the described situation, 6–12 short lines, natural spoken Chinese a real person would say there. Keep lines short (≤ 20 characters is ideal; never more than 40). If the learner pasted a dialogue, build on it: keep its content, fix mistakes, simplify or trim it to fit.
- Pitch it slightly above the learner's level: mostly words they know, with 3–6 genuinely useful new words or structures for this situation. Speakers get a short English role name ("Customer", "Cook") and a gender; prefer one female and one male voice.

The points (the teaching part)
- 3–7 points, most important first. Prioritise words and structures the learner does NOT know yet (status new / in_deck), then ones they are still learning. A known word only when it is used in a new way here.
- For each point: hanzi exactly as it appears in its dialogue line (kind "word"), or the structure as a short chunk ("structure", e.g. 粗的还是细的, 少放点) — still exactly a stretch of that line.
- explanation_en: 2–4 short spoken English sentences. Relate the new word to words the learner already KNOWS (use check_known_words: "You know 银行, the bank — 银 is the 银 there, silver"). Break a word into its characters when that helps. Mention a common mistake or contrast when there is one. Write Chinese words IN CHARACTERS inside the English (they are spoken by a Chinese voice); NEVER write pinyin or tone descriptions like "third tone" spelled in pinyin in the narration — an English voice would mangle it.
- example: one more short, simple sentence using the point (not from the dialogue), when it helps.

Length: aim for the target minutes in the briefing. A typical 12-minute lesson = 8–10 dialogue lines and 4–5 points.`;

const SLEEP_PROMPT = `${COMMON}

FORMAT: "sleep" — slow, calm, ALL-CHINESE immersion to fall asleep to, comprehensible-input style. No pinyin is ever spoken; the ONLY English is one short recap line per word (recap_en) and the translation of each example sentence (its english), each said once by a calm English voice. Everything else is Chinese, spoken very slowly by one gentle voice.
The learner pastes a Chinese text. You find the words in it they do not know yet and teach them, one by one. The app builds the audio from your plan like this — you write only the content:
- Your intro_zh, slowly.
- For each word, in its own chapter, in this order:
  a) "这是一个新词。我说三遍。" and the word three times.
  b) Each character with its tone, built from your char_tones ("导，第三声。航，第二声。" — plus "在‘任务’里，‘务’读轻声。" where the word is said with another tone), then your characters_zh.
  c) Your meaning_zh, sentence by sentence, slowly, with a pause after each — the heart of the lesson.
  d) ONE English line, "The word was <the word>: <your recap_en>".
  e) "我们听三个句子。", then each example sentence three times with pauses, then its english translation once; then the next sentence.
- Your outro_zh; a short text is read once more at the end.

Choosing the words
- Words from the text the learner does not know: status new or in_deck first, then learning. Use the text analysis in the briefing (stretches not covered by their known words) and check_known_words. Real words or set phrases as they appear in the text (1–4 characters), not single characters out of a known word, not names.
- Order them sensibly: most useful and frequent in the text first, or so that a word helps explain a later one.
- How many: the briefing gives a number for the target length — each word takes about 2½–3 minutes, so stay near that number (fewer is fine, never more: a lesson far over its length is refused). If the text has fewer new words, teach fewer — never pad with words they know.

Explaining — in VERY short, VERY simple Chinese built only from words the learner knows (check_known_words tells you which words, and which words containing these characters, they know). Never use a word harder than the one you explain. Quote words with ‘’ or “” if you like; no brackets.
- meaning_zh (REQUIRED, 5–8 sentences): comprehensible input, like a patient teacher talking to someone half asleep. Say what the word MEANS, then say it AGAIN in a slightly different simple way, and again: what it is, what you do with it, where or when you meet it, a tiny everyday situation ("你想给妈妈寄一封信，你去邮局。"), a contrast with a word they know ("邮局不是银行。银行里有钱，邮局里有信。"), and end by restating it plainly ("邮局，就是寄信的地方。"). Each sentence short (≤ 15 characters is ideal, never more than 30), each a little different — repetition with variation is the point, an identical sentence twice is not. Never where a character comes from (that is characters_zh). The learner must understand the word from meaning_zh alone.
  Example for 邮局: ["邮局是一个地方。", "在邮局，你可以寄信。", "你想给妈妈寄一封信，你去邮局。", "你想给朋友寄一本书，你也去邮局。", "邮局里有很多信，也有很多东西。", "邮局不是银行。银行里有钱，邮局里有信。", "邮局，就是寄信的地方。"]
- char_tones (REQUIRED): one entry per character of the word, in order: { char, pinyin, tone } with the character's CITATION (dictionary) tone — tone 1–4, or 5 for an inherently neutral character (了 le, 的 de, 吗 ma); pinyin = that one syllable with its tone mark, agreeing with the tone. 导航 → [{"char":"导","pinyin":"dǎo","tone":3},{"char":"航","pinyin":"háng","tone":2}]; 任务 → 务 wù 4; 你好 → 你 nǐ 3; 一样 → 一 yī 1; 不是 → 不 bù 4. Use the reading the word uses (银行 → 行 háng, not xíng). Don't write the tone lines yourself: the app says "导，第三声。" for each, and from the word's pinyin adds one short line where the word is said differently — a neutral syllable you write unmarked in the word's pinyin (任务 rènwu), third-tone sandhi (你好), 一 / 不 changes. So write the word's pinyin as it is really said (neutral syllables unmarked).
- characters_zh (0–2 sentences, may be empty): relate its characters to words they know: "'银'就是'银行'的'银'。" Skip it when the characters don't help.
- recap_en (REQUIRED): the meaning in plain English, spoken after "The word was <the word>: " — so write only what follows the colon, e.g. for 银行 "bank, as in the place where you keep your money, not the bank of a river." When the English word has several meanings, pin down the sense used here ("not the bank of a river", "to post a letter, not to send a text"). One short line, no pinyin, no Chinese needed.
Example sentences: exactly three per word, each SHORT (≤ 16 characters is ideal, never more than 24) and simple, each containing the word exactly as written, everyday situations, mostly known words, calm content (this is for falling asleep — nothing alarming). Each one's english is SPOKEN after it: a natural, plain English translation, one sentence, no pinyin.
intro_zh / outro_zh: one or two very simple sentences each (a calm hello; a calm goodnight).
title: a short Chinese title.`;

export function systemPrompt(format: AudioLessonFormat): string {
  return format === 'dialogue' ? DIALOGUE_PROMPT : SLEEP_PROMPT;
}

// ---------------- Tools ----------------

const LINE = {
  type: 'object',
  properties: { hanzi: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' } },
  required: ['hanzi', 'pinyin', 'english'],
} as const;

const DIALOGUE_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short English title, e.g. "Ordering at a Lanzhou noodle shop".' },
    intro_en: { type: 'string' },
    speakers: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string', enum: ['A', 'B'] }, name: { type: 'string' }, gender: { type: 'string', enum: ['female', 'male'] } }, required: ['id', 'name', 'gender'] },
    },
    dialogue: { type: 'array', items: { ...LINE, properties: { ...LINE.properties, speaker: { type: 'string', enum: ['A', 'B'] } }, required: ['speaker', 'hanzi', 'pinyin', 'english'] } },
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...LINE.properties,
          kind: { type: 'string', enum: ['word', 'structure'] },
          status: { type: 'string', enum: ['new', 'learning', 'known'] },
          explanation_en: { type: 'string' },
          line: { type: 'integer', description: '0-based index of the dialogue line that uses it.' },
          example: LINE,
        },
        required: ['hanzi', 'pinyin', 'english', 'kind', 'status', 'explanation_en', 'line'],
      },
    },
    outro_en: { type: 'string' },
  },
  required: ['title', 'intro_en', 'speakers', 'dialogue', 'points', 'outro_en'],
};

const SLEEP_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short Chinese title.' },
    intro_zh: { type: 'string' },
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...LINE.properties,
          meaning_zh: {
            type: 'array',
            items: { type: 'string' },
            minItems: 5,
            maxItems: 8,
            description:
              'What the word MEANS, comprehensible-input style: 5–8 very short, very simple Chinese sentences from words the learner knows that circle the meaning — say it, say it again another way, a tiny situation, a contrast with a known word, restate it. Required; not where its characters come from.',
          },
          char_tones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                char: { type: 'string', description: 'One character of the word.' },
                pinyin: { type: 'string', description: 'Its citation syllable with a tone mark ("dǎo"); no mark for 轻声.' },
                tone: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '1–4, 5 = 轻声.' },
              },
              required: ['char', 'pinyin', 'tone'],
            },
            description: 'One entry per character of the word, in order, with its citation tone. 导航 → 导 dǎo 3, 航 háng 2.',
          },
          characters_zh: { type: 'array', items: { type: 'string' }, maxItems: 3, description: "Its characters related to known words (\"'银'就是'银行'的'银'。\"); may be empty." },
          related_known: { type: 'array', items: { type: 'string' } },
          sentences: {
            type: 'array',
            items: LINE,
            minItems: 3,
            maxItems: 3,
            description: 'Three short example sentences containing the word. Each is said three times, then its english translation is SPOKEN once.',
          },
          recap_en: {
            type: 'string',
            description: 'English, spoken after "The word was <hanzi>: " — the meaning with the sense pinned down, e.g. "bank, as in the place where you keep your money, not the bank of a river."',
          },
        },
        required: ['hanzi', 'pinyin', 'english', 'meaning_zh', 'char_tones', 'characters_zh', 'related_known', 'sentences', 'recap_en'],
      },
    },
    outro_zh: { type: 'string' },
  },
  required: ['title', 'intro_zh', 'words', 'outro_zh'],
};

export function authorTools(format: AudioLessonFormat): Anthropic.Tool[] {
  return [
    {
      name: 'check_known_words',
      description:
        "What the learner's flashcards say about these words: status known / learning / in_deck / new (+ the card's pinyin and meaning), and for every character the words they know or are learning that contain it. Exact match on simplified hanzi.",
      input_schema: {
        type: 'object',
        properties: { words: { type: 'array', items: { type: 'string' }, description: 'Up to 80 words, phrases or single characters.' } },
        required: ['words'],
      },
    },
    {
      name: 'submit_lesson',
      description: format === 'dialogue' ? 'Hand in the dialogue lesson plan. Checked; problems come back to fix.' : 'Hand in the sleep lesson plan. Checked; problems come back to fix.',
      input_schema: {
        type: 'object',
        properties: { plan: format === 'dialogue' ? DIALOGUE_PLAN_SCHEMA : SLEEP_PLAN_SCHEMA },
        required: ['plan'],
      } as Anthropic.Tool.InputSchema,
    },
  ];
}

// ---------------- Briefing ----------------

/**
 * Format B: how many words for a target length. A word takes ~2.7 minutes (the intro and the
 * word ×3, its tones, 5–8 meaning sentences, the recap, three sentences ×3 with their English,
 * at the sleep voice's slowest rate), plus ~half a minute of hello / goodnight.
 */
export const SLEEP_MINUTES_PER_WORD = 2.7;
export function sleepWordTarget(minutes: number): number {
  return Math.max(2, Math.min(12, Math.round((minutes - 0.5) / SLEEP_MINUTES_PER_WORD)));
}

export function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[… cut at ${max} characters]` : text;
}

export function buildBriefing(format: AudioLessonFormat, input: AudioLessonInput, index: VocabIndex, title?: string | null): string {
  const minutes = input.target_minutes ?? AUDIO_LESSON_INPUT_LIMITS.defaultMinutes[format];
  const parts: string[] = [];
  parts.push(`# The learner\nKnows ${index.knownWords} words (mature cards), is learning ${index.learningWords} more. A sample of words they know: ${levelSample(index).join('、') || '(none yet)'}.`);
  parts.push(`# The lesson\nFormat: ${format}. Target length: about ${minutes} minutes.${title ? ` Title the learner gave: "${title}".` : ''}`);
  if (format === 'dialogue') {
    parts.push(`# The situation to practise\n${input.description?.trim() || '(none given — choose an everyday situation)'}`);
    if (input.dialogue?.trim()) parts.push(`# A dialogue the learner pasted (build on it)\n${clipText(input.dialogue.trim(), AUDIO_LESSON_INPUT_LIMITS.dialogue)}`);
    parts.push('Plan the dialogue, call check_known_words with the words and structures you might teach (and words you might relate them to), then call submit_lesson.');
  } else {
    const text = clipText(input.text?.trim() ?? '', AUDIO_LESSON_INPUT_LIMITS.text);
    const a = analyseText(index, text);
    parts.push(`# The text\n${text}`);
    parts.push(
      `# How the text looks against their cards (a greedy match, not a real segmenter)\n` +
        `${Math.round(a.coverage * 100)}% of its Han characters fall inside words they know or are learning.\n` +
        `Stretches NOT covered by any of their words (count): ${a.unfamiliar.slice(0, 150).map((u) => `${u.text}×${u.count}`).join('、') || '(none)'}\n` +
        `Their words found in it: ${a.familiar.slice(0, 150).map((f) => `${f.hanzi}${f.status === 'learning' ? '(learning)' : ''}`).join('、') || '(none)'}`,
    );
    parts.push(`Teach about ${sleepWordTarget(minutes)} words (fewer if the text has fewer new words). Check candidates with check_known_words, then call submit_lesson.`);
  }
  return parts.join('\n\n');
}

// ---------------- Submit ----------------

/** The longest a lesson may run for its target before it is sent back ("teach fewer words"). */
export function maxLessonMinutes(format: AudioLessonFormat, minutes: number): number {
  return format === 'sleep' ? minutes * 1.3 + 2 : minutes * 1.8 + 3;
}

export type SubmitResult =
  | { ok: true; plan: DialoguePlan | SleepPlan; script: AudioLessonScript }
  | { ok: false; problems: string[] };

/** Validate + compile what the model handed in. Pure. */
export function acceptPlan(format: AudioLessonFormat, raw: unknown, input: AudioLessonInput): SubmitResult {
  const plan = raw && typeof raw === 'object' && 'plan' in (raw as Record<string, unknown>) ? (raw as { plan: unknown }).plan : raw;
  const problems = format === 'dialogue' ? validateDialoguePlan(plan) : validateSleepPlan(plan);
  if (problems.length) return { ok: false, problems };
  const script = format === 'dialogue' ? compileDialogueLesson(plan as DialoguePlan) : compileSleepLesson(plan as SleepPlan, { sourceText: input.text });
  const scriptProblems = validateScript(script);
  if (scriptProblems.length) return { ok: false, problems: scriptProblems };
  const minutes = input.target_minutes ?? AUDIO_LESSON_INPUT_LIMITS.defaultMinutes[format];
  const estimate = estimateScriptMs(script) / 60000;
  if (estimate > maxLessonMinutes(format, minutes)) {
    const fewer = format === 'dialogue' ? 'points or shorten the dialogue' : `words (about ${sleepWordTarget(minutes)}; each takes ~${SLEEP_MINUTES_PER_WORD} minutes)`;
    return { ok: false, problems: [`This would run about ${Math.round(estimate)} minutes; the target is ${minutes}. Teach fewer ${fewer}.`] };
  }
  return { ok: true, plan: plan as DialoguePlan | SleepPlan, script };
}

// ---------------- The loop ----------------

export interface AuthorUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export function addUsage(total: AuthorUsage, u: Partial<AuthorUsage> | undefined): AuthorUsage {
  return {
    input_tokens: total.input_tokens + (u?.input_tokens ?? 0),
    output_tokens: total.output_tokens + (u?.output_tokens ?? 0),
    cache_read_input_tokens: total.cache_read_input_tokens + (u?.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: total.cache_creation_input_tokens + (u?.cache_creation_input_tokens ?? 0),
  };
}

export function claudeCostUsd(u: AuthorUsage): number {
  const usd = (u.input_tokens * MODEL_PRICE.input + u.output_tokens * MODEL_PRICE.output + u.cache_read_input_tokens * MODEL_PRICE.cacheRead + u.cache_creation_input_tokens * MODEL_PRICE.cacheWrite) / 1e6;
  return Math.round(usd * 10000) / 10000;
}

/** The model call: one seam for tests and the E2E fake. */
export type ModelCall = (req: { system: string; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[] }) => Promise<{
  content: Array<Record<string, unknown>>;
  usage?: Partial<AuthorUsage>;
  stop_reason?: string | null;
}>;

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) return error.status === 429 || error.status === 529 || (error.status ?? 0) >= 500;
  return error instanceof Anthropic.APIConnectionError;
}

export function anthropicModelCall(apiKey: string): ModelCall {
  const client = new Anthropic({ apiKey, timeout: 9 * 60 * 1000, maxRetries: 0 });
  return async ({ system, tools, messages }) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
      try {
        // Opus 5.5: thinking is adaptive and always on (no `thinking` param), effort set explicitly
        // (its default is medium), tool_choice auto (forced tool use is refused). Top-level
        // cache_control caches the growing conversation between rounds.
        const body = {
          model: AUDIO_LESSON_MODEL,
          max_tokens: MAX_TOKENS,
          system,
          tools,
          messages,
          output_config: { effort: 'high' },
          cache_control: { type: 'ephemeral' },
        };
        const res = await client.messages.create(body as unknown as Anthropic.MessageCreateParamsNonStreaming);
        return res as unknown as Awaited<ReturnType<ModelCall>>;
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Claude request failed');
  };
}

export interface AuthorState {
  messages: Anthropic.MessageParam[];
  rounds: number;
  usage: AuthorUsage;
}

export type AuthorOutcome =
  | { kind: 'done'; plan: DialoguePlan | SleepPlan; script: AudioLessonScript; state: AuthorState }
  | { kind: 'continue'; state: AuthorState }
  | { kind: 'failed'; reason: string; state: AuthorState };

const NUDGE = 'Please call submit_lesson now with the complete plan — the lesson is only made when submit_lesson succeeds.';

/**
 * Run the loop until the plan is accepted, the deadline passes (→ continue,
 * resumed by the next delivery from the checkpoint) or the rounds run out.
 * `checkpoint` is called after every model turn and every batch of tool results.
 */
export async function runAuthor(args: {
  format: AudioLessonFormat;
  input: AudioLessonInput;
  index: VocabIndex;
  state: AuthorState;
  call: ModelCall;
  checkpoint: (state: AuthorState, progress: string) => Promise<void>;
  deadline: number;
}): Promise<AuthorOutcome> {
  const { format, input, index, call, checkpoint } = args;
  const state = args.state;
  const system = systemPrompt(format);
  const tools = authorTools(format);
  let nudged = state.messages.some((m) => m.role === 'user' && m.content === NUDGE);

  while (state.rounds < MAX_AUTHOR_ROUNDS) {
    const last = state.messages[state.messages.length - 1];
    let content: Array<Record<string, unknown>>;
    if (last.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => (b as { type: string }).type === 'tool_use')) {
      // Resumed after a model turn whose tools never ran: run them now.
      content = last.content as unknown as Array<Record<string, unknown>>;
    } else {
      const res = await call({ system, tools, messages: state.messages });
      state.rounds += 1;
      state.usage = addUsage(state.usage, res.usage);
      if (res.stop_reason === 'refusal') return { kind: 'failed', reason: 'Claude declined to write this lesson — try describing it differently', state };
      content = res.content;
      state.messages.push({ role: 'assistant', content: content as unknown as Anthropic.ContentBlockParam[] });
      await checkpoint(state, 'Writing the lesson…');
    }

    const uses = content.filter((b) => b.type === 'tool_use') as unknown as Anthropic.ToolUseBlock[];
    if (uses.length === 0) {
      if (nudged) return { kind: 'failed', reason: 'Claude stopped without handing in a lesson', state };
      nudged = true;
      state.messages.push({ role: 'user', content: NUDGE });
      await checkpoint(state, 'Writing the lesson…');
      continue;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let accepted: Extract<SubmitResult, { ok: true }> | null = null;
    let progress = 'Writing the lesson…';
    for (const use of uses) {
      const toolInput = (use.input ?? {}) as Record<string, unknown>;
      if (use.name === 'check_known_words') {
        const words = Array.isArray(toolInput.words) ? toolInput.words.filter((w): w is string => typeof w === 'string') : [];
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(checkWords(index, words)) });
        progress = `Checking ${words.length} word${words.length === 1 ? '' : 's'} against your cards…`;
      } else if (use.name === 'submit_lesson') {
        const out = acceptPlan(format, toolInput, input);
        if (out.ok) {
          accepted = out;
          results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Accepted. The lesson is being recorded.' });
        } else {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Not accepted — fix these and call submit_lesson again:\n- ${out.problems.slice(0, 40).join('\n- ')}` });
          progress = 'Polishing the lesson…';
        }
      } else {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` });
      }
    }
    state.messages.push({ role: 'user', content: results });
    await checkpoint(state, accepted ? 'Lesson written' : progress);
    if (accepted) return { kind: 'done', plan: accepted.plan, script: accepted.script, state };
    if (Date.now() > args.deadline) return { kind: 'continue', state };
  }
  return { kind: 'failed', reason: `Claude didn't produce a valid lesson in ${MAX_AUTHOR_ROUNDS} rounds`, state };
}
