/**
 * Story lessons — "Listen & repeat a story" (docs/AUDIO_LESSONS.md "Story"). The learner (or an
 * agent) pastes a longer Chinese story or conversation; the app splits it into chunks of one or
 * two sentences (here, deterministic — never Claude), Claude translates each chunk (worker
 * services/audio-lessons/story.ts), and the compiler (`compileStoryLesson`) says every chunk
 * three times, slowly, with a pause after each, then its English once.
 *
 * The splitter:
 * - breaks after 。！？!?… (a run of them, with the closing quotes / brackets after it), at line
 *   breaks and at speaker turns — never inside quotes (“”「」『』‘’《》 and ASCII ");
 * - takes speaker labels off the spoken text ("A：", "明慧：", "Speaker 1:") and keeps them to
 *   pick the voices — a label counts when it is Latin, or when the same label starts 2+ lines
 *   ("他说：…" is narration);
 * - headings (# …, 第一章 …, 【…】 on a line of its own) become chapters, not speech;
 * - merges a very short sentence into the next (a chunk is about 8–40 characters), never across a
 *   speaker turn or a heading; a sentence over 40 is cut at its commas, one over 80 harder;
 * - drops stage directions in brackets ("（笑）") and symbols a voice would read out.
 */
import { hasHan, RATES, ScriptBuilder, sleepTranslationText } from './compile';
import type { AudioLessonScript, ScriptSpeaker, StoryPlan, VoiceRole } from './types';

export const STORY_LIMITS = {
  /** Characters of pasted text the form / API accept (AUDIO_LESSON_INPUT_LIMITS.storyText). */
  maxTextChars: 6000,
  /** A chunk shorter than this (letters / characters, not punctuation) takes the next sentence in. */
  minChunkChars: 8,
  /** …unless that makes it longer than this; a longer sentence is cut at its commas. */
  maxChunkChars: 40,
  /** A piece still longer than this is cut at sentence ends inside quotes, then anywhere. */
  hardChunkChars: 80,
  /** A lesson holds this much audio at most (estimated); the rest of the text is left out — and the app says so. */
  maxMinutes: 60,
  /** And at most this many chunks (two clips each — the lesson's distinct-clip limit is 260). */
  maxChunks: 120,
  /** A chapter every this many chunks (or one per heading). */
  chunksPerChapter: 10,
  /** A chapter title: the first words of its first chunk, this many characters at most. */
  chapterTitleChars: 12,
  /** Chunks per translation call (worker). */
  translateBatch: 30,
} as const;

export interface StoryChunk {
  /** What is spoken, as written (label, stage directions and symbols removed). */
  hanzi: string;
  /** The speaker label ("A", "明慧"), null for narration. */
  speaker: string | null;
  /** The heading it is under, null before the first / without headings. */
  section: string | null;
}

/** Letters and digits (punctuation and spaces don't count toward a chunk's length). */
export function storyChunkLength(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

const OPENERS: Record<string, string> = { '“': '”', '「': '」', '『': '』', '‘': '’', '《': '》' };
const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '…']);
/** Closing quotes / brackets: after a sentence end they still belong to it. */
const CLOSERS = new Set(['”', '」', '』', '’', '》', '）', ')']);
const CLAUSE_MARKS = new Set(['，', '；', '：', '、', ',', ';']);

const HEADING_MD = /^#{1,6}\s*(.+)$/;
const HEADING_CHAPTER = /^第[一二三四五六七八九十百千零〇两0-9０-９]+[章节回幕场部课集篇](?:$|[\s:：、.．])/u;
const HEADING_BRACKET = /^【([^【】]{1,30})】$/;
/** "A：…" / "明慧：…" / "Speaker 1: …" / "B:" — a candidate speaker label at the start of a line. */
const LABEL = /^([A-Za-z][A-Za-z0-9 .'-]{0,15}|[\p{Script=Han}A-Za-z0-9·]{1,8})\s*[：:]\s*(.*)$/u;
/** "他说：" / "老师问：" — speech introduced inside narration, not a speaker label. */
const SPEECH_VERB_END = /[说道问答喊叫想写讲称]$/u;
const LIST_MARKER = /^(?:[-*•·]\s+|\d{1,3}[.、)）]\s*|[（(]\d{1,3}[)）]\s*)/;
/** Short asides in brackets — stage directions ("（笑）", "[laughs]"): not spoken. */
const ASIDE = /[（(][^（）()]{0,12}[）)]|\[[^[\]]{0,12}\]/g;
/** Symbols a voice reads out (or that are markup): dropped. Brackets left after the asides go too. */
const SYMBOLS = /[\/|\\_*#~^<>{}[\]【】（）()〔〕]/g;

type Line = { kind: 'heading'; title: string } | { kind: 'text'; label: string | null; body: string; labelCandidate: string | null };

function headingOf(line: string): string | null {
  const md = line.match(HEADING_MD);
  if (md) return cleanTitle(md[1]);
  const br = line.match(HEADING_BRACKET);
  if (br) return cleanTitle(br[1]);
  if (HEADING_CHAPTER.test(line) && storyChunkLength(line) <= 30 && !/[。！？!?]$/.test(line)) return cleanTitle(line);
  return null;
}

function cleanTitle(t: string): string {
  return t.replace(SYMBOLS, '').replace(/[\s:：，,。]+$/u, '').trim();
}

/** Clean one line's spoken text: list marker, asides, symbols, runs of spaces. */
export function cleanStoryText(body: string): string {
  return body
    .replace(LIST_MARKER, '')
    .replace(ASIDE, '')
    .replace(SYMBOLS, '')
    .replace(/[ \t　]+/g, ' ')
    .trim();
}

/** Sentences of one line, broken after 。！？!?… (with their closers), never inside quotes. */
export function splitStorySentences(text: string, opts: { ignoreQuotes?: boolean } = {}): string[] {
  const chars = [...text];
  const out: string[] = [];
  const stack: string[] = [];
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const before = [...buf.trimEnd()].pop() ?? '';
    buf += ch;
    let justClosed = false;
    if (!opts.ignoreQuotes) {
      if (ch === '"') {
        if (stack[stack.length - 1] === '"') {
          stack.pop();
          justClosed = true;
        } else {
          stack.push('"');
          continue;
        }
      } else if (OPENERS[ch]) {
        stack.push(OPENERS[ch]);
        continue;
      } else if (stack.length && ch === stack[stack.length - 1]) {
        stack.pop();
        justClosed = true;
      }
      // Inside a quote nothing ends.
      if (stack.length) continue;
    }
    // A closing quote right after a sentence end ends the sentence: 他说：“你好。”
    const ends = SENTENCE_END.has(ch) || ((justClosed || CLOSERS.has(ch)) && SENTENCE_END.has(before));
    if (!ends) continue;
    // Take the rest of the run: more ends (？！, ……) and stray closers — never an opening quote.
    while (i + 1 < chars.length && (SENTENCE_END.has(chars[i + 1]) || CLOSERS.has(chars[i + 1]))) buf += chars[++i];
    flush();
  }
  flush();
  return out;
}

/** Split after the marks in `marks` (outside quotes unless ignoreQuotes), each piece keeping its mark. */
function splitAfter(text: string, marks: Set<string>, ignoreQuotes: boolean): string[] {
  const chars = [...text];
  const out: string[] = [];
  const stack: string[] = [];
  let buf = '';
  for (const ch of chars) {
    buf += ch;
    if (!ignoreQuotes) {
      if (OPENERS[ch]) {
        stack.push(OPENERS[ch]);
        continue;
      }
      if (ch === '"') {
        if (stack[stack.length - 1] === '"') stack.pop();
        else stack.push('"');
        continue;
      }
      if (stack.length && ch === stack[stack.length - 1]) {
        stack.pop();
        continue;
      }
      if (stack.length) continue;
    }
    if (marks.has(ch)) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out.map((p) => p.trim()).filter(Boolean);
}

/**
 * Pieces packed into runs of at most `max`, about evenly (41 → 21 + 20, not 36 + 5); a piece
 * longer than max stays alone.
 */
function pack(pieces: string[], max: number): string[] {
  const total = pieces.reduce((n, p) => n + storyChunkLength(p), 0);
  const target = Math.ceil(total / Math.max(1, Math.ceil(total / max)));
  const out: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && (storyChunkLength(cur) + storyChunkLength(p) > max || storyChunkLength(cur) >= target)) {
      out.push(cur);
      cur = p;
    } else cur = join(cur, p);
  }
  if (cur) out.push(cur);
  return out;
}

/** Hard cut at `max` letters / characters (punctuation rides along with the piece before it). */
function hardCut(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  let n = 0;
  for (const ch of text) {
    const counts = /[\p{L}\p{N}]/u.test(ch);
    if (counts && n >= max) {
      out.push(cur.trim());
      cur = '';
      n = 0;
    }
    cur += ch;
    if (counts) n++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A sentence over the chunk length → pieces: at its commas, then (over 80) sentence ends inside quotes, then anywhere. */
export function splitLongSentence(sentence: string): string[] {
  const { maxChunkChars: max, hardChunkChars: hard } = STORY_LIMITS;
  if (storyChunkLength(sentence) <= max) return [sentence];
  const pieces = pack(splitAfter(sentence, CLAUSE_MARKS, false), max);
  return pieces.flatMap((p) => {
    if (storyChunkLength(p) <= hard) return [p];
    const inner = pack(splitStorySentences(p, { ignoreQuotes: true }).flatMap((s) => (storyChunkLength(s) > max ? splitAfter(s, CLAUSE_MARKS, true) : [s])), max);
    return inner.flatMap((q) => (storyChunkLength(q) > hard ? hardCut(q, max) : [q]));
  });
}

/** Two sentences into one chunk: Chinese runs straight on; Latin text gets a space. */
function join(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return /[A-Za-z0-9.,!?]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : `${a}${b}`;
}

function parseLines(text: string): Line[] {
  const raw = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const parsed: Line[] = raw.flatMap((line): Line[] => {
    if (!line) return [];
    const heading = headingOf(line);
    if (heading !== null) return heading ? [{ kind: 'heading', title: heading }] : [];
    const m = line.match(LABEL);
    let candidate: string | null = null;
    if (m) {
      const label = m[1].trim();
      const latin = /^[A-Za-z]/.test(label);
      if (!/^\d+$/.test(label) && (latin || !SPEECH_VERB_END.test(label))) candidate = label;
    }
    return [{ kind: 'text', label: null, body: line, labelCandidate: candidate }];
  });
  // A Han label counts when it starts 2+ lines (A：/ 明慧：); a Latin one ("A:", "Speaker 1:") always.
  const counts = new Map<string, number>();
  for (const l of parsed) if (l.kind === 'text' && l.labelCandidate) counts.set(l.labelCandidate, (counts.get(l.labelCandidate) ?? 0) + 1);
  let lastLabel: string | null = null;
  return parsed.map((l) => {
    if (l.kind !== 'text') {
      lastLabel = null;
      return l;
    }
    const c = l.labelCandidate;
    if (c && (/^[A-Za-z]/.test(c) || (counts.get(c) ?? 0) >= 2)) {
      const body = l.body.match(LABEL)![2];
      lastLabel = body.trim() ? null : c;
      return { ...l, label: c, body };
    }
    // A line under a lone "A：" is A's turn.
    if (lastLabel) {
      const label = lastLabel;
      lastLabel = null;
      return { ...l, label };
    }
    return l;
  });
}

/** The pasted story / conversation → chunks of one or two sentences, in order. Pure. */
export function splitStoryText(text: string): StoryChunk[] {
  const { minChunkChars: min, maxChunkChars: max } = STORY_LIMITS;
  const chunks: StoryChunk[] = [];
  let section: string | null = null;
  // A group can merge short sentences into each other: one speaker's turn, or a run of narration.
  let group: { speaker: string | null; section: string | null; start: number } | null = null;
  let pending = '';

  const flush = () => {
    if (!pending) return;
    if (hasHan(pending) && group) {
      // Too short and the next sentence didn't fit: it joins the chunk before it (same turn) when that fits.
      const prev = chunks.length > group.start ? chunks[chunks.length - 1] : null;
      if (prev && storyChunkLength(pending) < min && storyChunkLength(prev.hanzi) + storyChunkLength(pending) <= max) prev.hanzi = join(prev.hanzi, pending);
      else chunks.push({ hanzi: pending, speaker: group.speaker, section: group.section });
    }
    pending = '';
  };
  const endGroup = () => {
    if (!group) return;
    flush();
    group = null;
  };

  for (const line of parseLines(text)) {
    if (line.kind === 'heading') {
      endGroup();
      section = line.title;
      continue;
    }
    const body = cleanStoryText(line.body);
    if (!hasHan(body)) continue;
    // Narration lines run on into one group; every labelled line is a turn of its own.
    if (!group || line.label !== null || group.speaker !== null) {
      endGroup();
      group = { speaker: line.label, section, start: chunks.length };
    }
    for (const sentence of splitStorySentences(body).flatMap(splitLongSentence)) {
      if (!pending) pending = sentence;
      else if (storyChunkLength(pending) < min && storyChunkLength(pending) + storyChunkLength(sentence) <= max) pending = join(pending, sentence);
      else {
        flush();
        pending = sentence;
      }
    }
  }
  endGroup();
  return chunks;
}

/** The speaker labels, in order of first appearance. */
export function storySpeakers(chunks: Array<Pick<StoryChunk, 'speaker'>>): string[] {
  const out: string[] = [];
  for (const c of chunks) if (c.speaker && !out.includes(c.speaker)) out.push(c.speaker);
  return out;
}

/**
 * Rough spoken length of one chunk (the same model as `estimateScriptMs`): the Chinese three
 * times at the slowest rate, three 2 s pauses, the English (about 0.7 words a character) and
 * the pause after it.
 */
export function estimateStoryChunkMs(hanzi: string, english?: string): number {
  const han = [...hanzi].filter((c) => hasHan(c)).length;
  const zh = (han * 260) / STORY_RATE + 300;
  const words = english ? english.trim().split(/\s+/).length : Math.max(2, Math.round(han * 0.7));
  const en = (words * 380) / 0.9 + 200;
  return 3 * zh + 3 * STORY_PAUSES.repeat + en + STORY_PAUSES.afterTranslation;
}

/** The app-scale rate of a story's Chinese — the slowest (each provider speaks it at its own slowest natural rate). */
export const STORY_RATE = 0.5;

/** Pauses of a story lesson (ms). */
export const STORY_PAUSES = {
  /** After each of the three times a chunk is said (the third one before its English). */
  repeat: 2000,
  /** After the English, before the next chunk. */
  afterTranslation: 2500,
  start: 1000,
  end: 3000,
} as const;

/** About how long a story lesson of this many Han characters runs (the forms' hint; both apps). */
export const STORY_MS_PER_HAN = 2350;

/** "about 9 minutes" for the form, from the pasted text's Han characters (capped at STORY_LIMITS.maxMinutes). */
export function storyMinutesForText(text: string): { minutes: number; han: number; capped: boolean } {
  const han = [...text].filter((c) => hasHan(c)).length;
  const raw = (han * STORY_MS_PER_HAN) / 60000;
  const capped = raw > STORY_LIMITS.maxMinutes;
  return { minutes: han === 0 ? 0 : Math.max(1, Math.round(capped ? STORY_LIMITS.maxMinutes : raw)), han, capped };
}

/** The line under a story's text box in both apps' forms: "About 9 minutes of audio." (Lab: AudioLessonFormats.storyEstimateLine). */
export function storyEstimateLine(text: string): string {
  const est = storyMinutesForText(text);
  if (est.han === 0) return 'Each line three times, slowly, then its English.';
  if (est.capped) return `Long text: the lesson covers about the first ${STORY_LIMITS.maxMinutes} minutes — paste the rest as another lesson.`;
  return `About ${est.minutes} minute${est.minutes === 1 ? '' : 's'} of audio.`;
}

/**
 * The chunks one lesson holds: the first ones whose estimated length stays within
 * STORY_LIMITS.maxMinutes (and maxChunks). `cut` is set when some were left out.
 */
export function fitStoryChunks(chunks: StoryChunk[]): { chunks: StoryChunk[]; cut: StoryPlan['cut'] | undefined } {
  const budget = STORY_LIMITS.maxMinutes * 60000 - STORY_PAUSES.start - STORY_PAUSES.end;
  let ms = 0;
  let n = 0;
  while (n < chunks.length && n < STORY_LIMITS.maxChunks) {
    const next = estimateStoryChunkMs(chunks[n].hanzi);
    if (n > 0 && ms + next > budget) break;
    ms += next;
    n++;
  }
  const kept = chunks.slice(0, n);
  if (n === chunks.length) return { chunks: kept, cut: undefined };
  const chars = (list: StoryChunk[]) => list.reduce((sum, c) => sum + storyChunkLength(c.hanzi), 0);
  return { chunks: kept, cut: { chunks: n, total_chunks: chunks.length, chars: chars(kept), total_chars: chars(chunks) } };
}

/** "The text is long: this lesson covers the first 1,480 of 3,900 characters (about 60 minutes)." */
export function storyCutNotice(cut: NonNullable<StoryPlan['cut']>): string {
  const n = (x: number) => x.toLocaleString('en');
  return `The text is long: this lesson covers the first ${n(cut.chars)} of ${n(cut.total_chars)} characters (about ${STORY_LIMITS.maxMinutes} minutes). Paste the rest as another lesson.`;
}

/** A chapter's title from its first chunk: its first words, without the punctuation at its ends. */
export function storyChapterTitle(hanzi: string): string {
  const t = hanzi.replace(/^[\s“”"‘’「」『』，。！？、：；…—-]+/u, '').replace(/[\s“”"‘’「」『』，。！？、：；…—-]+$/u, '');
  const chars = [...t];
  if (storyChunkLength(t) <= STORY_LIMITS.chapterTitleChars) return t;
  // Its first clause when that is a title's length ("小明每天早上七点起床…").
  const clause = t.match(/^[^，。！？；：、,;:!?]+/u)?.[0] ?? '';
  if (storyChunkLength(clause) >= 4 && storyChunkLength(clause) <= STORY_LIMITS.chapterTitleChars) return `${clause.trim()}…`;
  let out = '';
  let n = 0;
  for (const ch of chars) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      if (n >= STORY_LIMITS.chapterTitleChars) break;
      n++;
    }
    out += ch;
  }
  return `${out.replace(/[，、：；,\s]+$/u, '')}…`;
}

/** A title for the list until the lesson has one: the first heading, else the first chunk's first words. */
export function storyFallbackTitle(chunks: StoryChunk[]): string {
  const heading = chunks.find((c) => c.section)?.section;
  if (heading) return heading.slice(0, 60);
  return chunks.length ? storyChapterTitle(chunks[0].hanzi) : 'Story';
}

/** The voice of each speaker label: the first label speaker A, the second B, then alternating; narration = the app's voice. */
export function storyVoiceOf(labels: string[], label: string | null): VoiceRole {
  if (label === null) return 'teacher';
  const i = labels.indexOf(label);
  return i < 0 || i % 2 === 0 ? 'speaker_a' : 'speaker_b';
}

/**
 * Story → script (docs/AUDIO_LESSONS.md "Story"). Per chunk: the Chinese, 2 s, again, 2 s, a third
 * time, 2 s, its English once (the calm English voice), 2.5 s. All the Chinese at the slowest rate.
 * A chapter per heading, else every 10 chunks, titled with the first words.
 */
export function compileStoryLesson(plan: StoryPlan): AudioLessonScript {
  const b = new ScriptBuilder();
  const labels = plan.speakers.length ? plan.speakers.map((s) => s.label) : storySpeakers(plan.chunks);
  const gender = (label: string, i: number) => plan.speakers.find((s) => s.label === label)?.gender ?? (i % 2 === 0 ? 'female' : 'male');
  let section: string | null = null;
  let inChapter = 0;
  plan.chunks.forEach((c, i) => {
    const sec = c.section ?? null;
    const canOpen = b.chapters.length < STORY_MAX_CHAPTERS;
    if (i === 0) {
      b.chapter(sec ?? storyChapterTitle(c.hanzi));
      b.pause(STORY_PAUSES.start);
      inChapter = 0;
    } else if (sec !== section && canOpen) {
      b.chapter(sec ?? storyChapterTitle(c.hanzi));
      inChapter = 0;
    } else if (inChapter >= STORY_LIMITS.chunksPerChapter && canOpen) {
      b.chapter(storyChapterTitle(c.hanzi));
      inChapter = 0;
    }
    section = sec;
    inChapter++;
    const voice = storyVoiceOf(labels, c.speaker ?? null);
    const display = c.speaker ? `${c.speaker}：${c.hanzi}` : undefined;
    for (let k = 0; k < 3; k++) {
      b.say('zh', voice, c.hanzi, STORY_RATE, k === 0 ? { pinyin: c.pinyin, english: c.english, display } : { display });
      b.pause(STORY_PAUSES.repeat);
    }
    if (c.english?.trim()) b.say('en', 'recap', sleepTranslationText(c.english), RATES.recap);
    b.pause(STORY_PAUSES.afterTranslation);
  });
  b.pause(STORY_PAUSES.end);
  const speakers: ScriptSpeaker[] = [];
  labels.forEach((label, i) => {
    const role = i % 2 === 0 ? 'speaker_a' : 'speaker_b';
    const have = speakers.find((s) => s.role === role);
    if (have) have.name = `${have.name} / ${label}`;
    else speakers.push({ role, name: label, gender: gender(label, i) });
  });
  return { version: 1, format: 'story', title: plan.title, chapters: b.chapters, segments: b.segments, speakers, words: [] };
}

/** At most this many chapters (validateScript's limit). */
export const STORY_MAX_CHAPTERS = 40;

/** Checks the story plan the worker put together (the splitter's chunks + Claude's translations). */
export function validateStoryPlan(raw: unknown): string[] {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') return ['The plan is missing'];
  const p = raw as Partial<StoryPlan>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  if (!str(p.title)) problems.push('title: required');
  const chunks = Array.isArray(p.chunks) ? p.chunks : [];
  if (chunks.length === 0) problems.push('chunks: nothing to say — the text has no Chinese sentences');
  if (chunks.length > STORY_LIMITS.maxChunks) problems.push(`chunks: at most ${STORY_LIMITS.maxChunks}`);
  chunks.forEach((c, i) => {
    if (!c || typeof c !== 'object') {
      problems.push(`chunks[${i}]: missing`);
      return;
    }
    if (!str(c.hanzi) || !hasHan(c.hanzi)) problems.push(`chunks[${i}].hanzi: Chinese is required`);
    else if ([...c.hanzi].length > 160) problems.push(`chunks[${i}].hanzi: too long for one clip`);
    if (!str(c.pinyin)) problems.push(`chunks[${i}].pinyin: required`);
    if (!str(c.english) || !/[A-Za-z]/.test(c.english)) problems.push(`chunks[${i}].english: an English translation is required`);
    else if (hasHan(c.english)) problems.push(`chunks[${i}].english: no Chinese characters — it is read by an English voice`);
    else if (c.english.length > 280) problems.push(`chunks[${i}].english: too long (${c.english.length} characters, at most 280)`);
  });
  const speakers = Array.isArray(p.speakers) ? p.speakers : [];
  speakers.forEach((s, i) => {
    if (!s || !str(s.label)) problems.push(`speakers[${i}].label: required`);
    if (!s || (s.gender !== 'female' && s.gender !== 'male')) problems.push(`speakers[${i}].gender: "female" or "male"`);
  });
  return problems;
}
