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
import { charToneLines } from './tones';
import { dialogueToneLines } from './dialogue-tones';
import { fillPhrase, NEW_CHARACTER_LINES, NEW_WORD_INTROS, pickVariant, RECAP_OPENINGS, SENTENCES_INTROS } from './phrases';

/** Speeds on the app's scale (MiniMax: 1 = normal; cards are 0.6). */
export const RATES = {
  /** English host. */
  en: 1.0,
  /**
   * The dialogue's first, second and final plays: a little under natural speed (0.9 until Oct 2026 —
   * Jerome: "the guy's voice was kind of hard to hear — maybe slow the audio a little"). Azure (the
   * provider while MiniMax is out of credit) maps it with its speed_factor: 0.75 → 0.81 (was 0.93).
   */
  dialogue: 0.75,
  /** The third play, "a little slower" (0.75 until Oct 2026; Azure 0.7, was 0.81). */
  dialogueSlow: 0.6,
  /** A line said on its own: line by line and the examples (0.8 until Oct 2026; Azure 0.77, was 0.85). */
  line: 0.7,
  /** A new word on its own. */
  word: 0.6,
  /** Chinese inside the English explanations. */
  teacher: 0.7,
  /**
   * Sleep lessons: every Chinese line, on the app's scale — MiniMax's floor (0.5). Each provider
   * actually speaks the sleep voice at its own slowest natural rate, `SLEEP_ZH_PROVIDER_RATE`.
   */
  sleep: 0.5,
  /** Sleep lessons: the new word itself (the same clip as the word inside the English recap). */
  sleepWord: 0.5,
  /** Sleep lessons: the English recap after each word and each example sentence's translation — calm, a little slow. */
  recap: 0.9,
} as const;

/**
 * The sleep voice's Chinese speaking rate per TTS provider, in the PROVIDER's own scale (1 = its
 * natural pace) — the slowest each still sounds natural at (docs/AUDIO_LESSONS.md "Speech rates"):
 * MiniMax re-synthesises at the pace and stays clean down to its floor, 0.5; Azure's neural zh-CN
 * voices drag and smear syllables below ~0.6 (`<prosody rate="-40%">`); Google's WaveNet turns
 * robotic below ~0.6. Applied by the worker to every `sleep`-voice clip instead of the app-scale
 * mapping (`providerRate`), so a sleep lesson is as slow as each voice allows.
 */
export const SLEEP_ZH_PROVIDER_RATE = { minimax: 0.5, azure: 0.6, google: 0.6 } as const;

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
  /** Between the Chinese and the English of a tone line ("打 … third tone."). */
  toneInner: 200,
  /** After each tone line — brisk: they come one after another, the word section stays ~1 minute. */
  toneLine: 450,
  // Format B (docs/AUDIO_LESSONS.md "Pacing")
  /** Between "这是一个新词。" and "我说三遍。" — heard every word, so short. */
  sleepIntroPhrase: 500,
  /** After "我说三遍。", before the word. */
  sleepAfterIntro: 900,
  /** Between the word's three repeats. */
  sleepWordRepeat: 1300,
  /** After the third repeat. */
  sleepAfterWord: 2000,
  /** After each character's tone line ("导，第三声。") — a beat to hear it, shorter than a sentence. */
  sleepCharTone: 1500,
  /** After each sentence of a character's line ("你学过‘导游’的‘导’。"), before the next character. */
  sleepCharNote: 1800,
  /** After each sentence of the intro / outro / characters. */
  sleepSentence: 2000,
  /** After each sentence of the meaning — slow comprehensible input, room to take it in. */
  sleepMeaning: 2200,
  /** Before and after a word's English recap line. */
  sleepRecap: 1500,
  /** After a fixed phrase ("我们听三个句子。"). */
  sleepPhrase: 1200,
  /** Between an example sentence's three repeats. */
  sleepSentenceRepeat: 1800,
  /** After its third repeat, before its English translation. */
  sleepBeforeTranslation: 1200,
  /** After a sentence's English translation, before the next sentence. */
  sleepAfterTranslation: 2500,
  /** After the word's last sentence (the next word's intro follows). */
  sleepBetweenWords: 3500,
  /** After the outro, before the source text. */
  sleepBeforeSource: 3000,
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

/** Builds a script segment by segment (also used by story.ts). */
export class ScriptBuilder {
  segments: ScriptSegment[] = [];
  chapters: Array<{ title: string }> = [];

  chapter(title: string): void {
    this.chapters.push({ title });
  }

  get ch(): number {
    return Math.max(0, this.chapters.length - 1);
  }

  say(lang: ScriptLang, voice: VoiceRole, text: string, rate: number, extra: Pick<SpeechSegment, 'pinyin' | 'english' | 'display'> = {}): void {
    const t = text.trim();
    if (!t) return;
    const seg: SpeechSegment = { kind: 'speech', lang, voice, text: t, rate, chapter: this.ch };
    if (extra.pinyin) seg.pinyin = extra.pinyin;
    if (extra.english) seg.english = extra.english;
    if (extra.display && extra.display.trim() !== t) seg.display = extra.display.trim();
    this.segments.push(seg);
  }

  zh(voice: VoiceRole, line: PlanLine | string, rate: number): void {
    if (typeof line === 'string') this.say('zh', voice, line, rate);
    else this.say('zh', voice, line.hanzi, rate, { pinyin: line.pinyin, english: line.english });
  }

  en(text: string): void {
    this.say('en', 'narrator', text, RATES.en);
  }

  /**
   * English with Chinese inside: each piece in its own voice, a beat around the Chinese.
   * Format A: the host + the teacher; a sleep lesson's recap: the recap voice + the sleep voice.
   */
  mixed(
    text: string,
    teacherRate: number = RATES.teacher,
    voices: { en: VoiceRole; zh: VoiceRole; enRate: number } = { en: 'narrator', zh: 'teacher', enRate: RATES.en },
  ): void {
    const parts = splitMixedText(text);
    parts.forEach((p, i) => {
      if (p.lang === 'en') this.say('en', voices.en, p.text, voices.enRate);
      else {
        if (i > 0) this.pause(250);
        this.say('zh', voices.zh, p.text, teacherRate);
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

  // A character whose tone line an earlier point already said (same syllable) is not said again.
  const toneSaid = new Set<string>();
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
    // The tones, from the point's own pinyin (dialogue-tones.ts): "打, third tone." per character,
    // then "In 打扰了, 打 is said with a second tone, before another third tone." The Chinese is the
    // teacher voice at the word's rate (a one-character word reuses the word's own clip).
    const toneLines = dialogueToneLines(point, toneSaid);
    for (const line of toneLines) {
      line.parts.forEach((part, j) => {
        if (j > 0) b.pause(PAUSES.toneInner);
        if (part.lang === 'zh') b.say('zh', 'teacher', part.text, RATES.word, { display: part.display });
        else b.say('en', 'narrator', part.text, RATES.en);
      });
      b.pause(PAUSES.toneLine);
    }
    if (toneLines.length) b.pause(PAUSES.wordRepeat - PAUSES.toneLine);
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

/**
 * The English recap line after a sleep-lesson word: "The word was 银行: bank, as in the
 * place where you keep your money, not the bank of a river." The word itself is said by
 * the sleep voice (the same clip as its three repeats), the English by the recap voice.
 */
export function sleepRecapText(hanzi: string, recapEn: string, opening: string = RECAP_OPENINGS[0]): string {
  const body = recapEn.trim().replace(/^(the|that|our|our new|the new) word (was|is)\s+[^\s:：]*\s*[:：,，]?\s*/i, '').trim();
  const sentence = /[.!?]["”’)]?$/.test(body) ? body : `${body}.`;
  return `${opening} ${hanzi}: ${sentence}`;
}

/** The seed of a lesson's wordings (phrases.ts): the same plan always compiles to the same lines. */
export function sleepVariationSeed(plan: Pick<SleepPlan, 'title' | 'words'>): string {
  return `${plan.title}|${(plan.words ?? []).map((w) => w.hanzi).join(',')}`;
}

/** An example sentence's English translation as spoken after its three repeats: one sentence, closed. */
export function sleepTranslationText(english: string): string {
  const t = english.trim();
  return /[.!?]["”’)]?$/.test(t) ? t : `${t}.`;
}

/** Read the source text at the end of a sleep lesson only when it is this short. */
export const SLEEP_SOURCE_MAX_CHARS = 600;

/**
 * Format B: Chinese, as slow as the voice allows, every word three times. Per word
 * (docs/AUDIO_LESSONS.md "Sleep"):
 * a) "这是一个新词。我说三遍。" and the word ×3 — short pauses, it comes every word;
 * b) each character: its tone ("导，第三声。") then its line (char_notes: "你学过‘导游’的‘导’。" /
 *    "‘航’也在‘航空’里。" / "‘驶’是一个新字，你以前没见过。"), then where the word says a tone differently;
 * c) what it means: 5–8 short sentences circling the meaning (comprehensible input), slowly, with room after each;
 * d) ONE English recap line ("The word was 银行: bank, as in …");
 * e) "我们听三个句子。" and each example sentence three times, then its English translation once.
 */
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
  b.pause(PAUSES.sleepPhrase);

  // The fixed lines vary between words (phrases.ts): seeded by the lesson, never twice in a row.
  const seed = sleepVariationSeed(plan);
  let newCharacters = 0;
  plan.words.forEach((w, wi) => {
    b.chapter(`${w.hanzi} ${w.pinyin}`);
    // a) The intro and the word ×3.
    const [newWord, sayThree] = pickVariant(NEW_WORD_INTROS, seed, 'newWord', wi);
    sleepy(newWord);
    b.pause(PAUSES.sleepIntroPhrase);
    sleepy(sayThree);
    b.pause(PAUSES.sleepAfterIntro);
    for (let i = 0; i < 3; i++) {
      if (i === 0) b.zh('sleep', w, RATES.sleepWord);
      else sleepy(w.hanzi, RATES.sleepWord);
      b.pause(i < 2 ? PAUSES.sleepWordRepeat : PAUSES.sleepAfterWord);
    }
    // b) Its characters, one by one: the tone ("导，第三声。") and the character's line — words he
    // has with it, common words, or "a new character" (char_notes, characters.ts); then where the
    // word says a tone differently ("在‘任务’里，‘务’读轻声。"); plans before round 4: characters_zh.
    const notes = Array.isArray(w.char_notes) ? w.char_notes : [];
    const noted = new Set<string>();
    const sayNote = (char: string) => {
      if (noted.has(char)) return;
      noted.add(char);
      const note = notes.find((n) => n && n.char === char);
      // A new character: the app's own line, in one of its wordings (never the model's).
      const text = note?.kind === 'new' ? fillPhrase(pickVariant(NEW_CHARACTER_LINES, seed, 'newCharacter', newCharacters++), { c: char }) : note?.zh ?? '';
      for (const s of splitChineseSentences(text)) {
        sleepy(s);
        b.pause(PAUSES.sleepCharNote);
      }
    };
    for (const line of charToneLines(w, { seed, index: wi })) {
      b.say('zh', 'sleep', line.spoken, RATES.sleep, { display: line.display });
      b.pause(PAUSES.sleepCharTone);
      if (line.char) sayNote(line.char);
    }
    for (const n of notes) if (n && typeof n.char === 'string') sayNote(n.char);
    for (const s of (w.characters_zh ?? []).flatMap(splitChineseSentences)) {
      sleepy(s);
      b.pause(PAUSES.sleepSentence);
    }
    // c) What it means, said over and over in simple words.
    for (const s of (w.meaning_zh ?? []).flatMap(splitChineseSentences)) {
      sleepy(s);
      b.pause(PAUSES.sleepMeaning);
    }
    // d) The English recap.
    if (w.recap_en?.trim()) {
      b.mixed(sleepRecapText(w.hanzi, w.recap_en, pickVariant(RECAP_OPENINGS, seed, 'recap', wi)), RATES.sleepWord, { en: 'recap', zh: 'sleep', enRate: RATES.recap });
      b.pause(PAUSES.sleepRecap);
    }
    // e) The example sentences: each ×3, then its English once.
    sleepy(pickVariant(SENTENCES_INTROS, seed, 'sentences', wi));
    b.pause(PAUSES.sleepPhrase + 300);
    w.sentences.forEach((s, j) => {
      for (let i = 0; i < 3; i++) {
        if (i === 0) sleepy(s.hanzi, RATES.sleep, s);
        else sleepy(s.hanzi);
        b.pause(i < 2 ? PAUSES.sleepSentenceRepeat : PAUSES.sleepBeforeTranslation);
      }
      if (s.english?.trim()) b.say('en', 'recap', sleepTranslationText(s.english), RATES.recap);
      if (j < w.sentences.length - 1) b.pause(PAUSES.sleepAfterTranslation);
    });
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
    b.pause(PAUSES.sleepBeforeSource);
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
