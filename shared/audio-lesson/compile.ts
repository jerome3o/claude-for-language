/**
 * Plan → script (docs/AUDIO_LESSONS.md "Formats"). Pure: the same plan always
 * gives the same segments, rates and pauses.
 */
import type {
  AudioLessonScript,
  DialoguePlan,
  PlanLine,
  ScriptLang,
  ScriptSegment,
  SleepPlan,
  SpeechSegment,
  VoiceRole,
} from './types';

/** Speeds on the app's scale (MiniMax: 1 = normal; cards are 0.6). */
export const RATES = {
  /** English host. */
  en: 1.0,
  /** The dialogue at natural (lesson) speed — the conversation exercises' 0.9. */
  dialogue: 0.9,
  /** The third play, "a little slower". */
  dialogueSlow: 0.75,
  /** A line said on its own while explaining. */
  line: 0.8,
  /** A new word on its own. */
  word: 0.6,
  /** Chinese inside the English explanations. */
  teacher: 0.7,
  /** Sleep lessons: every sentence. The cards' speed — slow but still natural. */
  sleep: 0.6,
  /** Sleep lessons: the new word itself. MiniMax's floor is 0.5. */
  sleepWord: 0.55,
} as const;

/** Pauses in ms. */
export const PAUSES = {
  // Format A
  afterIntro: 1200,
  dialogueLine: 600,
  dialogueSlowLine: 900,
  betweenPlays: 2000,
  lineThenEnglish: 700,
  afterTranslation: 1300,
  wordRepeat: 900,
  afterPoint: 2000,
  short: 500,
  // Format B
  sleepWordRepeat: 2000,
  sleepSentence: 2000,
  sleepSentenceRepeat: 1800,
  sleepAfterSentences: 3000,
  sleepBetweenWords: 5000,
  sleepPhrase: 1200,
} as const;

/** Han ideographs (the main blocks — enough for splitting narration). */
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
/** A run of Chinese: Han characters with Chinese punctuation / digits between them. */
const HAN_RUN = /[㐀-䶿一-鿿豈-﫿][㐀-䶿一-鿿豈-﫿0-9　-〿！-｠·…·]*/g;

export function hasHan(text: string): boolean {
  return HAN.test(text);
}

/**
 * English narration with Chinese inside ("You already know 银行, the bank.")
 * → pieces in reading order: English for the English voice, Chinese for the
 * Chinese one. Quotes around a Chinese run are dropped.
 */
export function splitMixedText(text: string): Array<{ lang: ScriptLang; text: string }> {
  const out: Array<{ lang: ScriptLang; text: string }> = [];
  let last = 0;
  const push = (lang: ScriptLang, raw: string) => {
    const t = lang === 'en' ? raw.replace(/[“"'‘「『(]\s*$/u, '').replace(/^\s*[”"'’」』)]/u, '').trim() : raw.replace(/[，、。！？」』）)\s]+$/u, '').trim();
    if (!t || (lang === 'en' && !/[A-Za-z0-9]/.test(t))) return;
    out.push({ lang, text: t });
  };
  for (const m of text.matchAll(HAN_RUN)) {
    push('en', text.slice(last, m.index));
    push('zh', m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  push('en', text.slice(last));
  return out;
}

/** Chinese text → sentences at 。！？ (each keeps its mark). */
export function splitChineseSentences(text: string): string[] {
  return (text.match(/[^。！？!?]+[。！？!?]*/gu) ?? []).map((s) => s.trim()).filter((s) => hasHan(s));
}

class ScriptBuilder {
  segments: ScriptSegment[] = [];
  chapters: Array<{ title: string }> = [];

  chapter(title: string): void {
    this.chapters.push({ title });
  }

  private get ch(): number {
    return Math.max(0, this.chapters.length - 1);
  }

  say(lang: ScriptLang, voice: VoiceRole, text: string, rate: number, extra: Pick<SpeechSegment, 'pinyin' | 'english'> = {}): void {
    const t = text.trim();
    if (!t) return;
    const seg: SpeechSegment = { kind: 'speech', lang, voice, text: t, rate, chapter: this.ch };
    if (extra.pinyin) seg.pinyin = extra.pinyin;
    if (extra.english) seg.english = extra.english;
    this.segments.push(seg);
  }

  zh(voice: VoiceRole, line: PlanLine | string, rate: number): void {
    if (typeof line === 'string') this.say('zh', voice, line, rate);
    else this.say('zh', voice, line.hanzi, rate, { pinyin: line.pinyin, english: line.english });
  }

  en(text: string): void {
    this.say('en', 'narrator', text, RATES.en);
  }

  /** English with Chinese inside: each piece in its own voice, a beat around the Chinese. */
  mixed(text: string, teacherRate: number = RATES.teacher): void {
    const parts = splitMixedText(text);
    parts.forEach((p, i) => {
      if (p.lang === 'en') this.en(p.text);
      else {
        if (i > 0) this.pause(250);
        this.say('zh', 'teacher', p.text, teacherRate);
        if (i < parts.length - 1) this.pause(250);
      }
    });
  }

  pause(ms: number): void {
    if (ms <= 0) return;
    const prev = this.segments[this.segments.length - 1];
    if (prev && prev.kind === 'pause' && prev.chapter === this.ch) prev.ms += ms;
    else this.segments.push({ kind: 'pause', ms, chapter: this.ch });
  }
}

function speakerRole(id: 'A' | 'B'): 'speaker_a' | 'speaker_b' {
  return id === 'A' ? 'speaker_a' : 'speaker_b';
}

/** Format A: English host + a Chinese dialogue played three times, then the words. */
export function compileDialogueLesson(plan: DialoguePlan): AudioLessonScript {
  const b = new ScriptBuilder();
  const playDialogue = (rate: number, gap: number) => {
    for (const line of plan.dialogue) {
      b.zh(speakerRole(line.speaker), line, rate);
      b.pause(gap);
    }
  };

  b.chapter('Introduction');
  b.pause(400);
  b.mixed(plan.intro_en);
  b.pause(PAUSES.short);
  b.en('First, just listen to the conversation.');
  b.pause(PAUSES.afterIntro);

  b.chapter('First listen');
  playDialogue(RATES.dialogue, PAUSES.dialogueLine);
  b.pause(PAUSES.betweenPlays);

  b.chapter('Second listen');
  b.en("Let's hear it again.");
  b.pause(PAUSES.afterIntro);
  playDialogue(RATES.dialogue, PAUSES.dialogueLine);
  b.pause(PAUSES.betweenPlays);

  b.chapter('Third listen, a little slower');
  b.en('One more time, a little slower.');
  b.pause(PAUSES.afterIntro);
  playDialogue(RATES.dialogueSlow, PAUSES.dialogueSlowLine);
  b.pause(PAUSES.betweenPlays);

  b.chapter('Line by line');
  b.en("Now line by line, with the English.");
  b.pause(PAUSES.afterIntro);
  for (const line of plan.dialogue) {
    b.zh(speakerRole(line.speaker), line, RATES.line);
    b.pause(PAUSES.lineThenEnglish);
    b.en(line.english);
    b.pause(PAUSES.afterTranslation);
  }
  b.pause(PAUSES.short);

  plan.points.forEach((point, i) => {
    b.chapter(`${point.hanzi} — ${point.english}`);
    if (i === 0) {
      b.en("Let's look at the words and phrases.");
      b.pause(PAUSES.afterIntro);
    }
    b.zh('teacher', point, RATES.word);
    b.pause(PAUSES.wordRepeat);
    b.zh('teacher', point.hanzi, RATES.word);
    b.pause(PAUSES.wordRepeat);
    b.mixed(point.explanation_en);
    b.pause(PAUSES.wordRepeat);
    const line = plan.dialogue[point.line];
    if (line) {
      b.en('In the conversation:');
      b.pause(PAUSES.short);
      b.zh(speakerRole(line.speaker), line, RATES.dialogueSlow);
      b.pause(PAUSES.wordRepeat);
    }
    if (point.example) {
      b.en('Another example:');
      b.pause(PAUSES.short);
      b.zh('teacher', point.example, RATES.line);
      b.pause(PAUSES.lineThenEnglish);
      b.en(point.example.english);
      b.pause(PAUSES.lineThenEnglish);
      b.zh('teacher', point.example.hanzi, RATES.line);
      b.pause(PAUSES.wordRepeat);
    }
    b.zh('teacher', point.hanzi, RATES.word);
    b.pause(PAUSES.afterPoint);
  });

  b.chapter('Final listen');
  b.en("Let's finish with the whole conversation once more. Listen for the words we just practised.");
  b.pause(PAUSES.afterIntro);
  playDialogue(RATES.dialogue, PAUSES.dialogueLine);
  b.pause(PAUSES.betweenPlays);
  b.mixed(plan.outro_en);
  b.pause(1000);

  return {
    version: 1,
    format: 'dialogue',
    title: plan.title,
    chapters: b.chapters,
    segments: b.segments,
    speakers: plan.speakers.map((s) => ({ role: speakerRole(s.id), name: s.name, gender: s.gender })),
    words: plan.points.map((p) => ({ hanzi: p.hanzi, pinyin: p.pinyin, english: p.english, status: p.status })),
  };
}

/** The fixed phrases of a sleep lesson. */
export const SLEEP_PHRASES = {
  newWord: '这是一个新词。',
  sayThree: '我说三遍。',
  sentences: '我们听三个句子。',
  sourceIntro: '最后，我们慢慢地听一遍原文。',
} as const;

/** Read the source text at the end of a sleep lesson only when it is this short. */
export const SLEEP_SOURCE_MAX_CHARS = 600;

/** Format B: all Chinese, very slow, every word three times, long pauses. */
export function compileSleepLesson(plan: SleepPlan, opts: { sourceText?: string } = {}): AudioLessonScript {
  const b = new ScriptBuilder();
  const sleepy = (text: string, rate: number = RATES.sleep, extra: PlanLine | null = null) =>
    extra ? b.zh('sleep', extra, rate) : b.say('zh', 'sleep', text, rate);

  b.chapter('开始');
  b.pause(1000);
  for (const s of splitChineseSentences(plan.intro_zh)) {
    sleepy(s);
    b.pause(PAUSES.sleepSentence);
  }
  b.pause(PAUSES.sleepAfterSentences);

  plan.words.forEach((w) => {
    b.chapter(`${w.hanzi} ${w.pinyin}`);
    sleepy(SLEEP_PHRASES.newWord);
    b.pause(PAUSES.sleepPhrase);
    sleepy(SLEEP_PHRASES.sayThree);
    b.pause(PAUSES.sleepPhrase + 300);
    for (let i = 0; i < 3; i++) {
      if (i === 0) b.zh('sleep', w, RATES.sleepWord);
      else sleepy(w.hanzi, RATES.sleepWord);
      b.pause(PAUSES.sleepWordRepeat);
    }
    b.pause(PAUSES.sleepPhrase);
    for (const s of w.explanation_zh.flatMap(splitChineseSentences)) {
      sleepy(s);
      b.pause(PAUSES.sleepSentence);
    }
    b.pause(PAUSES.sleepPhrase);
    sleepy(SLEEP_PHRASES.sentences);
    b.pause(PAUSES.sleepPhrase + 300);
    for (const s of w.sentences) {
      for (let i = 0; i < 3; i++) {
        if (i === 0) sleepy(s.hanzi, RATES.sleep, s);
        else sleepy(s.hanzi);
        b.pause(i < 2 ? PAUSES.sleepSentenceRepeat : PAUSES.sleepAfterSentences);
      }
    }
    b.pause(PAUSES.sleepBetweenWords);
  });

  b.chapter('结束');
  for (const s of splitChineseSentences(plan.outro_zh)) {
    sleepy(s);
    b.pause(PAUSES.sleepSentence);
  }
  const source = (opts.sourceText ?? '').trim();
  if (source && source.length <= SLEEP_SOURCE_MAX_CHARS) {
    b.chapter('原文');
    b.pause(PAUSES.sleepPhrase);
    sleepy(SLEEP_PHRASES.sourceIntro);
    b.pause(PAUSES.sleepAfterSentences);
    for (const s of splitChineseSentences(source)) {
      sleepy(s);
      b.pause(2500);
    }
  }
  b.pause(3000);

  return {
    version: 1,
    format: 'sleep',
    title: plan.title,
    chapters: b.chapters,
    segments: b.segments,
    speakers: [],
    words: plan.words.map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.english, status: 'new' as const })),
  };
}
