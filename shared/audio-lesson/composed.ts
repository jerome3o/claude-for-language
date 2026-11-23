/**
 * Composed audio lessons (docs/AUDIO_LESSONS.md "Composed lessons"): a lesson an agent (Claude
 * through the MCP `compose_audio_lesson` tool) builds out of BLOCKS. The plan IS the lesson — no
 * model runs on the server: `compileComposedLesson` turns the blocks, deterministically, into the
 * same speech / pause script every other format compiles to (compile.ts), and the worker speaks and
 * joins it like any other lesson (synth.ts → mp3.ts), with chapters and a transcript.
 *
 * Two layers of blocks:
 * - LOW-LEVEL: `chapter`, `zh`, `en`, `pause`, `sequence` (one Chinese line + its English in a
 *   pattern such as ["zh","zh","zh","en","zh","zh"]);
 * - HIGH-LEVEL (macros that expand to low-level speech; every default overridable): `drill`,
 *   `word_focus`, `structure`, `exchange`, `retell`, `recall`.
 * `clip` (real audio cut from a lesson recording) is RESERVED: refused with a clear problem until
 * the renderer can take it.
 *
 * Built for experimenting with formats (Jerome, Nov 2026: a recap of a video lesson before the
 * homework — mostly Chinese, short English anchors, lots of repetition); the block reference is
 * COMPOSED_SPEC_DOC (composed-doc.ts), the one text the MCP tool and the docs show.
 */
import { pinyin as pinyinPro } from 'pinyin-pro';
import { applyYiBuToneChanges } from '../pinyin/toneChange';
import { hasHan, PAUSES, RATES, ScriptBuilder, sleepTranslationText, splitChineseSentences } from './compile';
import { dialogueToneLines } from './dialogue-tones';
import { buildTimeline, durationLabel, formatClock, repeatLabel, transcriptRows } from './timeline';
import { estimateScriptMs, speechKey, uniqueSpeech, validateScript } from './validate';
import type { AudioLessonScript, Gender, LessonWord, ScriptSpeaker, SpeechSegment, VoiceRole } from './types';
import {
  COMPOSED_BLOCK_TYPES,
  COMPOSED_DEFAULTS,
  COMPOSED_EN_VOICES,
  COMPOSED_LIMITS,
  COMPOSED_RATES,
  COMPOSED_SPEC_VERSION,
  COMPOSED_ZH_VOICES,
  type ComposedRate,
  type ComposedRateName,
} from './composed-limits';

export * from './composed-limits';

export type ComposedZhVoice = (typeof COMPOSED_ZH_VOICES)[number];
export type ComposedEnVoice = (typeof COMPOSED_EN_VOICES)[number];

/** One step of a sequence pattern: the Chinese, the English, or a pause in ms. */
export type ComposedStep = 'zh' | 'en' | number;

/** The drill's default pattern: three times slowly, the English once, twice more. */
export const DRILL_PATTERN: readonly ComposedStep[] = ['zh', 'zh', 'zh', 'en', 'zh', 'zh'];

export interface ComposedLine {
  hanzi: string;
  /** Tone marks; made automatically (pinyin-pro + the 一 / 不 rule) when missing — shown, never spoken. */
  pinyin?: string;
  english?: string;
}

/** Drill timing / speed, as a block or as the options of a macro's examples. */
export interface ComposedDrillOptions {
  pattern?: ComposedStep[];
  /** Pause between two Chinese plays (default 900 ms). */
  gap_ms?: number;
  /** Pause before and after the English (default 1300 ms). */
  en_gap_ms?: number;
  rate?: ComposedRate;
  voice?: ComposedZhVoice;
  en_voice?: ComposedEnVoice;
}

interface BlockBase {
  /** Pause after the block (each type has its own default). */
  after_ms?: number;
}

export interface ChapterBlock { type: 'chapter'; title: string }
export interface ZhBlock extends BlockBase, ComposedLine {
  type: 'zh';
  voice?: ComposedZhVoice;
  rate?: ComposedRate;
  /** Said this many times in a row (1–6, default 1). */
  repeat?: number;
  /** Between the repeats (default 900 ms). */
  gap_ms?: number;
}
export interface EnBlock extends BlockBase {
  type: 'en';
  /** English; Chinese inside it in Han characters is spoken by the Chinese teacher voice. No pinyin. */
  text: string;
  voice?: ComposedEnVoice;
}
export interface PauseBlock { type: 'pause'; ms: number }
export interface SequenceBlock extends BlockBase, ComposedLine, ComposedDrillOptions {
  type: 'sequence';
  pattern: ComposedStep[];
}
export interface DrillBlock extends BlockBase, ComposedLine, ComposedDrillOptions {
  type: 'drill';
  english: string;
}
export interface WordFocusBlock extends BlockBase {
  type: 'word_focus';
  hanzi: string;
  pinyin?: string;
  english: string;
  /** 0–6 very short, simple Chinese sentences saying what it means. */
  meaning_zh?: string[];
  /** Example sentences, each said as a drill (ideally the line from the lesson first). */
  examples?: ComposedLine[];
  /** The word this many times at the start (default 3). */
  repeat?: number;
  /** Each character's tone, by the English host ("打, third tone.") — default true. */
  tones?: boolean;
  /** Start a chapter "周末 — weekend" (default true). */
  chapter?: boolean;
  rate?: ComposedRate;
  drill?: ComposedDrillOptions;
}
export interface StructureBlock extends BlockBase {
  type: 'structure';
  /** The pattern as SHOWN (chapter title), e.g. "要是…就…"; never spoken. */
  pattern: string;
  /** One English line explaining it; Chinese inside it in Han characters is spoken by the teacher voice. */
  explanation_en: string;
  examples: ComposedLine[];
  chapter?: boolean;
  drill?: ComposedDrillOptions;
}
export interface ExchangeLine extends ComposedLine {
  speaker: 'A' | 'B';
}
export interface ExchangeBlock extends BlockBase {
  type: 'exchange';
  lines: ExchangeLine[];
  /** A chapter title to start with (optional). */
  title?: string;
  /** Slow plays first (default 2, at rate "slow"). */
  slow_plays?: number;
  slow_rate?: ComposedRate;
  /** The gist in English after the slow plays (Chinese inside in Han characters). Without it, each line's English is read. */
  gist_en?: string;
  /** Then at natural speed (default 1). */
  natural_plays?: number;
  natural_rate?: ComposedRate;
  /** Between lines (default 900 ms) and between plays (default 2000 ms). */
  line_gap_ms?: number;
  play_gap_ms?: number;
}
export interface RetellBlock extends BlockBase {
  type: 'retell';
  /** The paragraph, sentence by sentence; or `text`, split at 。！？. */
  sentences?: ComposedLine[];
  text?: string;
  title?: string;
  /** The whole paragraph this many times (default 2). */
  repeat?: number;
  rate?: ComposedRate;
  voice?: ComposedZhVoice;
  /** After each sentence (default 1500 ms) and between the repeats (default 3000 ms). */
  sentence_gap_ms?: number;
  repeat_gap_ms?: number;
}
export interface RecallBlock extends BlockBase {
  type: 'recall';
  /** The English prompt, spoken ("How do you say: I'm going hiking this weekend?"). */
  english: string;
  hanzi: string;
  pinyin?: string;
  /** Silence to answer in (default 3000 ms). */
  think_ms?: number;
  /** The answer this many times (default 2). */
  answer_repeats?: number;
  rate?: ComposedRate;
  voice?: ComposedZhVoice;
  en_voice?: ComposedEnVoice;
}
/** RESERVED — real audio from the lesson recording. Refused by validation for now. */
export interface ClipBlock { type: 'clip'; call_id?: string; start_ms?: number; end_ms?: number }

export type ComposedBlock =
  | ChapterBlock | ZhBlock | EnBlock | PauseBlock | SequenceBlock
  | DrillBlock | WordFocusBlock | StructureBlock | ExchangeBlock | RetellBlock | RecallBlock | ClipBlock;


export interface ComposedSpeaker { name?: string; gender?: Gender }

export interface ComposedPlan {
  version?: number;
  title: string;
  /** The two dialogue voices (speaker_a / speaker_b): default A female, B male. */
  speakers?: { A?: ComposedSpeaker; B?: ComposedSpeaker };
  /** The English voice `en` blocks and translations use unless a block says otherwise (default narrator). */
  english_voice?: ComposedEnVoice;
  blocks: ComposedBlock[];
}



// ---------- helpers ----------

const TONE_MARKS = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
const PUNCT_PINYIN: Record<string, string> = { '，': ',', '。': '.', '？': '?', '！': '!', '、': ',', '：': ':', '；': ';', '“': '"', '”': '"', '‘': "'", '’': "'" };

/** The automatic pinyin of a Chinese line, punctuation kept (pinyin-pro + the 一 / 不 tone changes). */
export function autoLinePinyin(hanzi: string): string {
  const text = hanzi.trim();
  if (!hasHan(text)) return '';
  try {
    const raw = pinyinPro(text, { toneType: 'symbol', type: 'array', nonZh: 'consecutive' }) as string[];
    let out = '';
    for (const token of raw) {
      const t = token.trim();
      if (!t) continue;
      const mapped = [...t].map((ch) => PUNCT_PINYIN[ch] ?? ch).join('');
      if (/^[,.?!:;"')]+$/.test(mapped)) out += mapped;
      else out += out ? ` ${mapped}` : mapped;
    }
    return applyYiBuToneChanges(text, out.replace(/\s+/g, ' ').trim());
  } catch {
    return '';
  }
}

export function composedRate(rate: ComposedRate | undefined, fallback: ComposedRateName): number {
  if (typeof rate === 'number' && Number.isFinite(rate)) return Math.round(rate * 100) / 100;
  if (typeof rate === 'string' && Object.prototype.hasOwnProperty.call(COMPOSED_RATES, rate)) return COMPOSED_RATES[rate as ComposedRateName];
  return COMPOSED_RATES[fallback];
}

function lineOf(l: ComposedLine): { hanzi: string; pinyin: string; english: string } {
  const hanzi = l.hanzi.trim();
  return { hanzi, pinyin: l.pinyin?.trim() || autoLinePinyin(hanzi), english: (l.english ?? '').trim() };
}

/**
 * A line said again: its pinyin kept (the transcript row shows it — a Chinese line without pinyin
 * reads as narration and would be glued to the English after it), its English only on the first play.
 */
function again(l: { hanzi: string; pinyin: string }): { hanzi: string; pinyin: string } {
  return { hanzi: l.hanzi, pinyin: l.pinyin };
}

function speakerRole(id: 'A' | 'B'): 'speaker_a' | 'speaker_b' {
  return id === 'A' ? 'speaker_a' : 'speaker_b';
}

/** The plan's two speakers as the voices see them (A female, B male unless the plan says otherwise). */
export function composedSpeakers(plan: Pick<ComposedPlan, 'speakers'>): ScriptSpeaker[] {
  const a = plan.speakers?.A ?? {};
  const b = plan.speakers?.B ?? {};
  return [
    { role: 'speaker_a', name: a.name?.trim() || 'A', gender: a.gender === 'male' ? 'male' : 'female' },
    { role: 'speaker_b', name: b.name?.trim() || 'B', gender: b.gender === 'female' ? 'female' : 'male' },
  ];
}

// ---------- compile ----------

class Composer {
  b = new ScriptBuilder();
  toneSaid = new Set<string>();
  words: LessonWord[] = [];
  constructor(private plan: ComposedPlan) {}

  get enVoice(): ComposedEnVoice {
    return this.plan.english_voice === 'recap' ? 'recap' : 'narrator';
  }

  /** Speech before any chapter opens one named after the lesson. */
  ensureChapter(): void {
    if (this.b.chapters.length === 0) this.b.chapter(this.plan.title.trim() || 'Lesson');
  }

  chapter(title: string): void {
    this.b.chapter(title.trim().slice(0, 80) || 'Chapter');
  }

  zh(voice: VoiceRole, line: { hanzi: string; pinyin?: string; english?: string } | string, rate: number): void {
    this.ensureChapter();
    if (typeof line === 'string') this.b.say('zh', voice, line, rate);
    else this.b.say('zh', voice, line.hanzi, rate, { pinyin: line.pinyin, english: line.english || undefined });
  }

  /** English (Chinese inside in Han characters spoken by the teacher voice at `zhRate`). */
  en(text: string, voice: ComposedEnVoice = this.enVoice, zhRate: number = RATES.teacher): void {
    this.ensureChapter();
    this.b.mixed(text, zhRate, { en: voice, zh: 'teacher', enRate: voice === 'recap' ? RATES.recap : RATES.en });
  }

  pause(ms: number): void {
    this.b.pause(Math.max(0, Math.round(ms)));
  }

  /** One line in a pattern of Chinese plays, its English and pauses (sequence / drill). */
  sequence(line: ComposedLine, opts: ComposedDrillOptions, pattern: readonly ComposedStep[], defaultRate: ComposedRateName = 'slow'): void {
    const l = lineOf(line);
    const voice = opts.voice ?? 'teacher';
    const enVoice = opts.en_voice ?? this.enVoice;
    const rate = composedRate(opts.rate, defaultRate);
    const gap = opts.gap_ms ?? COMPOSED_DEFAULTS.drillGap;
    const enGap = opts.en_gap_ms ?? COMPOSED_DEFAULTS.drillEnGap;
    let first = true;
    let prev: 'zh' | 'en' | 'pause' | null = null;
    for (const step of pattern) {
      if (typeof step === 'number') {
        this.pause(step);
        prev = 'pause';
        continue;
      }
      if (prev === 'zh' || prev === 'en') this.pause(prev === 'en' || step === 'en' ? enGap : gap);
      if (step === 'zh') {
        // The first play carries the pinyin + English (the transcript shows the line once, "×3 +2").
        this.zh(voice, first ? l : again(l), rate);
        first = false;
      } else if (l.english) {
        this.ensureChapter();
        this.b.say('en', enVoice, sleepTranslationText(l.english), enVoice === 'recap' ? RATES.recap : RATES.en);
      }
      prev = step;
    }
  }

  block(block: ComposedBlock): void {
    const D = COMPOSED_DEFAULTS;
    switch (block.type) {
      case 'chapter':
        this.chapter(block.title);
        return;
      case 'pause':
        this.pause(block.ms);
        return;
      case 'zh': {
        const l = lineOf(block);
        const rate = composedRate(block.rate, 'slow');
        const voice = block.voice ?? 'teacher';
        const n = block.repeat ?? 1;
        for (let i = 0; i < n; i++) {
          if (i > 0) this.pause(block.gap_ms ?? D.zhGap);
          this.zh(voice, i === 0 ? l : again(l), rate);
        }
        this.pause(block.after_ms ?? D.zhAfter);
        return;
      }
      case 'en':
        this.en(block.text, block.voice ?? this.enVoice);
        this.pause(block.after_ms ?? D.enAfter);
        return;
      case 'sequence':
        this.sequence(block, block, block.pattern);
        this.pause(block.after_ms ?? D.drillAfter);
        return;
      case 'drill':
        this.sequence(block, block, block.pattern ?? DRILL_PATTERN);
        this.pause(block.after_ms ?? D.drillAfter);
        return;
      case 'word_focus': {
        const l = lineOf(block);
        const rate = composedRate(block.rate, 'slow');
        if (block.chapter !== false) this.chapter(`${l.hanzi} — ${block.english.trim()}`);
        this.words.push({ hanzi: l.hanzi, pinyin: l.pinyin, english: block.english.trim() });
        const n = block.repeat ?? D.wordRepeat;
        for (let i = 0; i < n; i++) {
          if (i > 0) this.pause(PAUSES.wordRepeat);
          this.zh('teacher', i === 0 ? l : again(l), rate);
        }
        this.pause(PAUSES.wordRepeat);
        // The tones, from the word's own pinyin (dialogue-tones.ts): "周, first tone." per character.
        if (block.tones !== false) {
          const toneLines = dialogueToneLines(l, this.toneSaid);
          for (const line of toneLines) {
            line.parts.forEach((part, j) => {
              if (j > 0) this.pause(PAUSES.toneInner);
              if (part.lang === 'zh') this.b.say('zh', 'teacher', part.text, rate, { display: part.display });
              else this.b.say('en', 'narrator', part.text, RATES.en);
            });
            this.pause(PAUSES.toneLine);
          }
          if (toneLines.length) this.pause(PAUSES.wordRepeat - PAUSES.toneLine);
        }
        for (const s of block.meaning_zh ?? []) {
          for (const sentence of splitChineseSentences(s)) {
            this.zh('teacher', lineOf({ hanzi: sentence }), composedRate(block.rate, 'normal'));
            this.pause(D.meaningGap);
          }
        }
        // The English anchor, once: "周末 means weekend." — the word in the teacher voice (its own clip).
        this.en(`${l.hanzi} means ${sleepTranslationText(block.english)}`, block.drill?.en_voice ?? this.enVoice, rate);
        this.pause(PAUSES.wordRepeat);
        for (const ex of block.examples ?? []) {
          this.sequence(ex, block.drill ?? {}, block.drill?.pattern ?? DRILL_PATTERN);
          this.pause(D.drillAfter);
        }
        this.zh('teacher', again(l), rate);
        this.pause(block.after_ms ?? D.wordAfter);
        return;
      }
      case 'structure': {
        if (block.chapter !== false) this.chapter(block.pattern);
        this.en(block.explanation_en, block.drill?.en_voice ?? this.enVoice);
        this.pause(PAUSES.afterIntro);
        block.examples.forEach((ex, i) => {
          if (i > 0) this.pause(D.drillAfter);
          this.sequence(ex, block.drill ?? {}, block.drill?.pattern ?? DRILL_PATTERN);
        });
        this.pause(block.after_ms ?? D.wordAfter);
        return;
      }
      case 'exchange': {
        if (block.title?.trim()) this.chapter(block.title);
        const lines = block.lines.map((x) => ({ ...lineOf(x), speaker: x.speaker }));
        const lineGap = block.line_gap_ms ?? D.exchangeLineGap;
        const playGap = block.play_gap_ms ?? D.exchangePlayGap;
        let firstPlay = true;
        const play = (rate: number) => {
          lines.forEach((x, i) => {
            if (i > 0) this.pause(lineGap);
            this.zh(speakerRole(x.speaker), firstPlay ? x : again(x), rate);
          });
          firstPlay = false;
        };
        const slow = block.slow_plays ?? D.exchangeSlowPlays;
        for (let p = 0; p < slow; p++) {
          if (p > 0) this.pause(playGap);
          play(composedRate(block.slow_rate, 'slow'));
        }
        if (slow > 0) this.pause(playGap);
        if (block.gist_en?.trim()) {
          this.en(block.gist_en);
        } else {
          lines.forEach((x, i) => {
            if (!x.english) return;
            if (i > 0) this.pause(PAUSES.short);
            this.ensureChapter();
            this.b.say('en', this.enVoice, sleepTranslationText(x.english), this.enVoice === 'recap' ? RATES.recap : RATES.en);
          });
        }
        const natural = block.natural_plays ?? D.exchangeNaturalPlays;
        for (let p = 0; p < natural; p++) {
          this.pause(playGap);
          play(composedRate(block.natural_rate, 'natural'));
        }
        this.pause(block.after_ms ?? playGap);
        return;
      }
      case 'retell': {
        if (block.title?.trim()) this.chapter(block.title);
        const sentences = retellSentences(block);
        const rate = composedRate(block.rate, 'slow');
        const voice = block.voice ?? 'teacher';
        const n = block.repeat ?? D.retellRepeat;
        for (let r = 0; r < n; r++) {
          if (r > 0) this.pause(block.repeat_gap_ms ?? D.retellRepeatGap);
          sentences.forEach((s, i) => {
            if (i > 0) this.pause(block.sentence_gap_ms ?? D.retellSentenceGap);
            this.zh(voice, r === 0 ? s : again(s), rate);
          });
        }
        this.pause(block.after_ms ?? D.retellRepeatGap);
        return;
      }
      case 'recall': {
        const l = lineOf({ hanzi: block.hanzi, pinyin: block.pinyin, english: block.english });
        const enVoice = block.en_voice ?? this.enVoice;
        this.en(block.english, enVoice);
        this.pause(block.think_ms ?? D.recallThink);
        const n = block.answer_repeats ?? D.recallRepeats;
        const rate = composedRate(block.rate, 'slow');
        for (let i = 0; i < n; i++) {
          if (i > 0) this.pause(D.drillGap);
          // The answer's row in the transcript carries no English: its prompt is the row before.
          this.zh(block.voice ?? 'teacher', again(l), rate);
        }
        this.pause(block.after_ms ?? D.recallAfter);
        return;
      }
      case 'clip':
        // Reserved: validation refuses it, so a compiled plan never has one.
        return;
    }
  }
}

function retellSentences(block: RetellBlock): Array<{ hanzi: string; pinyin: string; english: string }> {
  if (Array.isArray(block.sentences) && block.sentences.length) return block.sentences.map(lineOf);
  return splitChineseSentences(block.text ?? '').map((s) => lineOf({ hanzi: s }));
}

/** A validated plan → the script (pure: the same plan always gives the same segments). */
export function compileComposedLesson(plan: ComposedPlan): AudioLessonScript {
  const c = new Composer(plan);
  for (const block of plan.blocks) c.block(block);
  c.ensureChapter();
  c.pause(1000);
  // Drop a chapter nothing was said in (e.g. two chapter blocks in a row): its start would be the next one's.
  const used = new Set(c.b.segments.map((s) => s.chapter));
  const keep = c.b.chapters.map((_, i) => used.has(i));
  const renumber = new Map<number, number>();
  let n = 0;
  keep.forEach((k, i) => {
    if (k) renumber.set(i, n++);
  });
  const segments = c.b.segments.map((s) => ({ ...s, chapter: renumber.get(s.chapter) ?? 0 }));
  return {
    version: 1,
    format: 'composed',
    title: plan.title.trim(),
    chapters: c.b.chapters.filter((_, i) => keep[i]),
    segments,
    speakers: composedSpeakers(plan),
    words: c.words,
  };
}

// ---------- validate ----------

function str(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isInt(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

class Checker {
  problems: string[] = [];
  push(p: string): void {
    if (this.problems.length < 60) this.problems.push(p);
  }

  zhText(where: string, v: unknown, required = true): void {
    if (!str(v)) {
      if (required) this.push(`${where}: Chinese characters are required`);
      return;
    }
    if (!hasHan(v)) this.push(`${where}: Chinese characters are required`);
    else if ([...v].length > COMPOSED_LIMITS.maxZhChars) this.push(`${where}: too long (${[...v].length} characters, at most ${COMPOSED_LIMITS.maxZhChars}) — split it into sentences`);
    else if (/[A-Za-z]/.test(v)) this.push(`${where}: Chinese only — no Latin letters or pinyin (the Chinese voice would read them out)`);
    else if (/[\/()（）\[\]{}|_<>]|\.\.\.|…/.test(v)) this.push(`${where}: no slashes, brackets, ellipses or blanks — it is read aloud`);
  }

  pinyin(where: string, v: unknown): void {
    if (v === undefined || v === null || v === '') return;
    if (typeof v !== 'string') this.push(`${where}: a string (tone marks) or leave it out to have it made automatically`);
    else if (/[a-zü][1-5]/i.test(v)) this.push(`${where}: use tone marks (nǐ hǎo), not numbers`);
    else if (hasHan(v)) this.push(`${where}: pinyin only, no Chinese characters`);
  }

  /** English spoken by an English voice: no Chinese characters (unless `mixed`), no pinyin. */
  english(where: string, v: unknown, opts: { required?: boolean; mixed?: boolean } = {}): void {
    if (!str(v)) {
      if (opts.required) this.push(`${where}: English is required`);
      return;
    }
    if (v.length > COMPOSED_LIMITS.maxEnChars) this.push(`${where}: too long (${v.length} characters, at most ${COMPOSED_LIMITS.maxEnChars})`);
    if (!opts.mixed && hasHan(v)) this.push(`${where}: no Chinese characters here (it is the English)`);
    if (!/[A-Za-z]/.test(v)) this.push(`${where}: English is required`);
    const englishOnly = v.replace(/[㐀-鿿豈-﫿][^A-Za-z]*/g, ' ');
    if (TONE_MARKS.test(englishOnly)) this.push(`${where}: no pinyin — an English voice reads it; write Chinese in characters (spoken by a Chinese voice)`);
  }

  line(where: string, v: unknown, opts: { english?: 'required' | 'optional' } = {}): void {
    if (!v || typeof v !== 'object') {
      this.push(`${where}: { hanzi, pinyin?, english${opts.english === 'required' ? '' : '?'} } is required`);
      return;
    }
    const l = v as Record<string, unknown>;
    this.zhText(`${where}.hanzi`, l.hanzi);
    this.pinyin(`${where}.pinyin`, l.pinyin);
    this.english(`${where}.english`, l.english, { required: opts.english === 'required' });
  }

  rate(where: string, v: unknown): void {
    if (v === undefined) return;
    if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(COMPOSED_RATES, v)) return;
    if (typeof v === 'number' && v >= COMPOSED_LIMITS.minRate && v <= COMPOSED_LIMITS.maxRate) return;
    this.push(`${where}: "sleep", "slow", "normal", "natural" or a number ${COMPOSED_LIMITS.minRate}–${COMPOSED_LIMITS.maxRate}`);
  }

  ms(where: string, v: unknown, min = 0): void {
    if (v === undefined) return;
    if (!isInt(v, min, COMPOSED_LIMITS.maxPauseMs)) this.push(`${where}: whole milliseconds ${min}–${COMPOSED_LIMITS.maxPauseMs}`);
  }

  count(where: string, v: unknown, min: number, max: number): void {
    if (v === undefined) return;
    if (!isInt(v, min, max)) this.push(`${where}: a whole number ${min}–${max}`);
  }

  zhVoice(where: string, v: unknown): void {
    if (v !== undefined && !(COMPOSED_ZH_VOICES as readonly string[]).includes(v as string)) this.push(`${where}: one of ${COMPOSED_ZH_VOICES.join(', ')}`);
  }

  enVoice(where: string, v: unknown): void {
    if (v !== undefined && !(COMPOSED_EN_VOICES as readonly string[]).includes(v as string)) this.push(`${where}: one of ${COMPOSED_EN_VOICES.join(', ')}`);
  }

  pattern(where: string, v: unknown, required: boolean, hasEnglish: boolean): void {
    if (v === undefined && !required) return;
    if (!Array.isArray(v) || v.length === 0 || v.length > COMPOSED_LIMITS.maxPatternSteps) {
      this.push(`${where}: a list of 1–${COMPOSED_LIMITS.maxPatternSteps} steps, each "zh", "en" or a pause in ms — e.g. ["zh","zh","zh","en","zh","zh"]`);
      return;
    }
    v.forEach((s, i) => {
      if (s === 'zh' || s === 'en') return;
      if (isInt(s, 0, COMPOSED_LIMITS.maxPauseMs)) return;
      this.push(`${where}[${i}]: "zh", "en" or a pause in ms (0–${COMPOSED_LIMITS.maxPauseMs})`);
    });
    if (!v.includes('zh')) this.push(`${where}: say the Chinese at least once ("zh")`);
    if (v.includes('en') && !hasEnglish) this.push(`${where}: has "en" but the line has no english`);
  }

  drillOptions(where: string, o: Record<string, unknown>, hasEnglish: boolean, patternRequired = false): void {
    this.pattern(`${where}.pattern`, o.pattern, patternRequired, hasEnglish);
    this.ms(`${where}.gap_ms`, o.gap_ms);
    this.ms(`${where}.en_gap_ms`, o.en_gap_ms);
    this.rate(`${where}.rate`, o.rate);
    this.zhVoice(`${where}.voice`, o.voice);
    this.enVoice(`${where}.en_voice`, o.en_voice);
  }

  examples(where: string, v: unknown, min: number): void {
    if (v === undefined && min === 0) return;
    if (!Array.isArray(v) || v.length < min || v.length > COMPOSED_LIMITS.maxExamples) {
      this.push(`${where}: ${min}–${COMPOSED_LIMITS.maxExamples} example lines { hanzi, pinyin?, english }`);
      return;
    }
    v.forEach((ex, i) => this.line(`${where}[${i}]`, ex, { english: 'required' }));
  }

  block(where: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      this.push(`${where}: a block object with a "type"`);
      return;
    }
    const b = raw as Record<string, unknown>;
    const type = b.type;
    if (type === 'clip') {
      this.push(`${where}: "clip" (real audio cut from the lesson recording) is reserved and not supported yet — say the line with a "zh" or "exchange" block instead`);
      return;
    }
    if (typeof type !== 'string' || !(COMPOSED_BLOCK_TYPES as readonly string[]).includes(type)) {
      this.push(`${where}: unknown block type ${JSON.stringify(type ?? null)} — one of ${COMPOSED_BLOCK_TYPES.join(', ')}`);
      return;
    }
    this.ms(`${where}.after_ms`, b.after_ms);
    const hasEnglish = str(b.english);
    switch (type) {
      case 'chapter':
        if (!str(b.title)) this.push(`${where}.title: required`);
        else if (b.title.length > 80) this.push(`${where}.title: at most 80 characters`);
        return;
      case 'pause':
        if (!isInt(b.ms, 100, COMPOSED_LIMITS.maxPauseMs)) this.push(`${where}.ms: whole milliseconds 100–${COMPOSED_LIMITS.maxPauseMs}`);
        return;
      case 'zh':
        this.line(where, b);
        this.zhVoice(`${where}.voice`, b.voice);
        this.rate(`${where}.rate`, b.rate);
        this.count(`${where}.repeat`, b.repeat, 1, COMPOSED_LIMITS.maxRepeat);
        this.ms(`${where}.gap_ms`, b.gap_ms);
        return;
      case 'en':
        this.english(`${where}.text`, b.text, { required: true, mixed: true });
        this.enVoice(`${where}.voice`, b.voice);
        return;
      case 'sequence':
        this.line(where, b);
        this.drillOptions(where, b, hasEnglish, true);
        return;
      case 'drill':
        this.line(where, b, { english: 'required' });
        this.drillOptions(where, b, hasEnglish);
        return;
      case 'word_focus':
        this.line(where, b, { english: 'required' });
        if (str(b.hanzi) && [...b.hanzi].length > 12) this.push(`${where}.hanzi: a word or short phrase (at most 12 characters) — use "structure" or "drill" for sentences`);
        if (b.meaning_zh !== undefined) {
          if (!Array.isArray(b.meaning_zh) || b.meaning_zh.length > COMPOSED_LIMITS.maxMeaningSentences) {
            this.push(`${where}.meaning_zh: a list of 0–${COMPOSED_LIMITS.maxMeaningSentences} very short, simple Chinese sentences`);
          } else {
            b.meaning_zh.forEach((s, i) => {
              this.zhText(`${where}.meaning_zh[${i}]`, s);
              if (str(s) && [...s].length > COMPOSED_LIMITS.maxMeaningChars) this.push(`${where}.meaning_zh[${i}]: one short sentence (at most ${COMPOSED_LIMITS.maxMeaningChars} characters)`);
            });
          }
        }
        this.examples(`${where}.examples`, b.examples, 0);
        this.count(`${where}.repeat`, b.repeat, 1, COMPOSED_LIMITS.maxRepeat);
        if (b.tones !== undefined && typeof b.tones !== 'boolean') this.push(`${where}.tones: true or false`);
        if (b.chapter !== undefined && typeof b.chapter !== 'boolean') this.push(`${where}.chapter: true or false`);
        this.rate(`${where}.rate`, b.rate);
        if (b.drill !== undefined) this.drillOptions(`${where}.drill`, (b.drill ?? {}) as Record<string, unknown>, true);
        return;
      case 'structure':
        if (!str(b.pattern)) this.push(`${where}.pattern: required — the pattern as shown, e.g. "要是…就…"`);
        else if (b.pattern.length > 40) this.push(`${where}.pattern: at most 40 characters`);
        this.english(`${where}.explanation_en`, b.explanation_en, { required: true, mixed: true });
        this.examples(`${where}.examples`, b.examples, 1);
        if (b.chapter !== undefined && typeof b.chapter !== 'boolean') this.push(`${where}.chapter: true or false`);
        if (b.drill !== undefined) this.drillOptions(`${where}.drill`, (b.drill ?? {}) as Record<string, unknown>, true);
        return;
      case 'exchange': {
        const lines = b.lines;
        if (!Array.isArray(lines) || lines.length < 2 || lines.length > COMPOSED_LIMITS.maxExchangeLines) {
          this.push(`${where}.lines: 2–${COMPOSED_LIMITS.maxExchangeLines} lines { speaker: "A" | "B", hanzi, pinyin?, english }`);
        } else {
          lines.forEach((l, i) => {
            this.line(`${where}.lines[${i}]`, l, { english: str(b.gist_en) ? 'optional' : 'required' });
            const sp = (l as { speaker?: unknown } | null)?.speaker;
            if (sp !== 'A' && sp !== 'B') this.push(`${where}.lines[${i}].speaker: "A" or "B"`);
          });
        }
        if (b.title !== undefined && (!str(b.title) || b.title.length > 80)) this.push(`${where}.title: 1–80 characters`);
        this.count(`${where}.slow_plays`, b.slow_plays, 0, 4);
        this.count(`${where}.natural_plays`, b.natural_plays, 0, 4);
        if ((b.slow_plays ?? 1) === 0 && (b.natural_plays ?? 1) === 0) this.push(`${where}: play the exchange at least once (slow_plays or natural_plays)`);
        this.rate(`${where}.slow_rate`, b.slow_rate);
        this.rate(`${where}.natural_rate`, b.natural_rate);
        if (b.gist_en !== undefined) this.english(`${where}.gist_en`, b.gist_en, { required: true, mixed: true });
        this.ms(`${where}.line_gap_ms`, b.line_gap_ms);
        this.ms(`${where}.play_gap_ms`, b.play_gap_ms);
        return;
      }
      case 'retell': {
        const hasSentences = Array.isArray(b.sentences) && b.sentences.length > 0;
        if (hasSentences) {
          const list = b.sentences as unknown[];
          if (list.length > COMPOSED_LIMITS.maxRetellSentences) this.push(`${where}.sentences: at most ${COMPOSED_LIMITS.maxRetellSentences}`);
          list.forEach((s, i) => this.line(`${where}.sentences[${i}]`, s));
        } else if (str(b.text)) {
          const parts = splitChineseSentences(b.text);
          if (parts.length === 0) this.push(`${where}.text: Chinese sentences are required`);
          if (parts.length > COMPOSED_LIMITS.maxRetellSentences) this.push(`${where}.text: at most ${COMPOSED_LIMITS.maxRetellSentences} sentences`);
          parts.forEach((s, i) => this.zhText(`${where}.text (sentence ${i + 1})`, s));
        } else {
          this.push(`${where}: "sentences" [{ hanzi, pinyin?, english? }] or "text" (a Chinese paragraph) is required`);
        }
        if (b.title !== undefined && (!str(b.title) || b.title.length > 80)) this.push(`${where}.title: 1–80 characters`);
        this.count(`${where}.repeat`, b.repeat, 1, 4);
        this.rate(`${where}.rate`, b.rate);
        this.zhVoice(`${where}.voice`, b.voice);
        this.ms(`${where}.sentence_gap_ms`, b.sentence_gap_ms);
        this.ms(`${where}.repeat_gap_ms`, b.repeat_gap_ms);
        return;
      }
      case 'recall':
        this.english(`${where}.english`, b.english, { required: true, mixed: true });
        this.zhText(`${where}.hanzi`, b.hanzi);
        this.pinyin(`${where}.pinyin`, b.pinyin);
        this.ms(`${where}.think_ms`, b.think_ms);
        this.count(`${where}.answer_repeats`, b.answer_repeats, 1, COMPOSED_LIMITS.maxRepeat);
        this.rate(`${where}.rate`, b.rate);
        this.zhVoice(`${where}.voice`, b.voice);
        this.enVoice(`${where}.en_voice`, b.en_voice);
        return;
    }
  }
}

/** The plan's own shape (blocks, fields, limits) — before compiling. */
export function composedPlanShapeProblems(raw: unknown): string[] {
  const c = new Checker();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['plan: an object { title, blocks: [...] } is required'];
  const p = raw as Record<string, unknown>;
  if (p.version !== undefined && p.version !== COMPOSED_SPEC_VERSION) c.push(`version: ${COMPOSED_SPEC_VERSION} (the only version so far)`);
  if (!str(p.title)) c.push('title: required');
  else if (p.title.length > COMPOSED_LIMITS.maxTitleChars) c.push(`title: at most ${COMPOSED_LIMITS.maxTitleChars} characters`);
  c.enVoice('english_voice', p.english_voice);
  if (p.speakers !== undefined) {
    if (!p.speakers || typeof p.speakers !== 'object') c.push('speakers: { A?: { name?, gender? }, B?: { name?, gender? } }');
    else {
      for (const [id, s] of Object.entries(p.speakers as Record<string, unknown>)) {
        if (id !== 'A' && id !== 'B') c.push(`speakers.${id}: only "A" and "B"`);
        const g = (s as { gender?: unknown } | null)?.gender;
        if (g !== undefined && g !== 'female' && g !== 'male') c.push(`speakers.${id}.gender: "female" or "male"`);
      }
    }
  }
  const blocks = p.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) c.push('blocks: a list of blocks is required');
  else if (blocks.length > COMPOSED_LIMITS.maxBlocks) c.push(`blocks: at most ${COMPOSED_LIMITS.maxBlocks}`);
  else blocks.forEach((b, i) => c.block(`blocks[${i}]`, b));
  if (Array.isArray(blocks) && !blocks.some((b) => b && typeof b === 'object' && (b as { type?: unknown }).type !== 'chapter' && (b as { type?: unknown }).type !== 'pause')) {
    c.push('blocks: nothing is said — add a zh / en / drill / … block');
  }
  return c.problems;
}

export interface ComposedPreview {
  /** Empty = it can be made. */
  problems: string[];
  /** Null when the plan's shape is wrong (nothing could be compiled). */
  script: AudioLessonScript | null;
  estimate_ms: number;
  estimate_minutes: number;
  /** Chapters with their estimated start ("4:05"). */
  chapters: Array<{ title: string; at: string; start_ms: number }>;
  /** The transcript as the player shows it, timed with estimated clip lengths. */
  transcript: Array<{ at: string; text: string; pinyin?: string; english?: string; repeat?: string }>;
  /** Distinct clips to record (the TTS cost) and script segments. */
  clips: number;
  segments: number;
  /** Characters sent to TTS. */
  tts_chars: { zh: number; en: number };
}

/** Estimated length of one clip (the same rule as estimateScriptMs). */
function estimateSpeechMs(s: SpeechSegment): number {
  if (s.lang === 'zh') return ([...s.text].filter((c) => hasHan(c)).length * 260) / s.rate + 300;
  return (s.text.split(/\s+/).length * 380) / s.rate + 200;
}

/**
 * Everything a dry run says, without TTS: the problems (shape, script limits, the length cap), the
 * estimated length, the chapters with estimated starts and the transcript as the player will show it.
 */
export function previewComposedLesson(raw: unknown): ComposedPreview {
  const empty: ComposedPreview = { problems: [], script: null, estimate_ms: 0, estimate_minutes: 0, chapters: [], transcript: [], clips: 0, segments: 0, tts_chars: { zh: 0, en: 0 } };
  const shape = composedPlanShapeProblems(raw);
  if (shape.length) return { ...empty, problems: shape };
  const script = compileComposedLesson(raw as ComposedPlan);
  const problems = validateScript(script).map((p) => `script: ${p}`);
  const estimate = estimateScriptMs(script);
  const minutes = Math.round((estimate / 60000) * 10) / 10;
  if (estimate > COMPOSED_LIMITS.maxMinutes * 60000) problems.push(`too long: about ${durationLabel(estimate)} (at most ${COMPOSED_LIMITS.maxMinutes} min) — fewer blocks, fewer repeats or shorter pauses`);
  const frameMs = 24;
  const frames = new Map<string, number>();
  for (const s of script.segments) if (s.kind === 'speech') frames.set(speechKey(s), Math.max(1, Math.round(estimateSpeechMs(s) / frameMs)));
  const timeline = buildTimeline(script, frames, frameMs);
  const rows = transcriptRows(timeline.transcript);
  const unique = uniqueSpeech(script);
  return {
    problems,
    script,
    estimate_ms: estimate,
    estimate_minutes: minutes,
    chapters: timeline.chapters.map((c) => ({ title: c.title, at: formatClock(c.start_ms), start_ms: c.start_ms })),
    transcript: rows.map((r) => {
      const label = repeatLabel(r).text;
      return { at: formatClock(r.start_ms), text: r.text, ...(r.pinyin ? { pinyin: r.pinyin } : {}), ...(r.english ? { english: r.english } : {}), ...(label ? { repeat: label } : {}) };
    }),
    clips: unique.length,
    segments: script.segments.length,
    tts_chars: {
      zh: unique.filter((u) => u.lang === 'zh').reduce((n, u) => n + [...u.text].length, 0),
      en: unique.filter((u) => u.lang === 'en').reduce((n, u) => n + u.text.length, 0),
    },
  };
}

/** The plan's problems (shape, then script limits and length) — what the API answers 400 with. */
export function validateComposedPlan(raw: unknown): string[] {
  return previewComposedLesson(raw).problems;
}

/**
 * Every Chinese line of a plan in order (deduplicated), with its pinyin / English — the companion
 * mini lesson's brief and the MCP's summaries.
 */
export function composedPlanLines(plan: ComposedPlan): Array<{ hanzi: string; pinyin: string; english: string }> {
  const out: Array<{ hanzi: string; pinyin: string; english: string }> = [];
  const seen = new Set<string>();
  const add = (l: ComposedLine | undefined) => {
    if (!l || !str(l.hanzi) || seen.has(l.hanzi.trim())) return;
    seen.add(l.hanzi.trim());
    out.push(lineOf(l));
  };
  for (const b of plan.blocks ?? []) {
    switch (b.type) {
      case 'zh': case 'sequence': case 'drill': add(b); break;
      case 'word_focus': add(b); (b.examples ?? []).forEach(add); break;
      case 'structure': b.examples.forEach(add); break;
      case 'exchange': b.lines.forEach(add); break;
      case 'retell': retellSentences(b).forEach(add); break;
      case 'recall': add({ hanzi: b.hanzi, pinyin: b.pinyin, english: b.english }); break;
      default: break;
    }
  }
  return out;
}
