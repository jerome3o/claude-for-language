/**
 * "▶ Watch the intro" on a structure card (docs/STUDY_SESSION.md "Structure intro"): Jerome, Nov 2026 — "a little
 * video with just the text on the screen, a few example sentences … a voice talking over it, introducing the
 * concepts with very simple things … in Chinese, using simple language".
 *
 * Not a video file: a 🎬 Clip (shared/clips, spec v1) built from the structure card and played by the clips
 * player — a title ("今天我们学一个新句型"), the pattern building up piece by piece, then each example big with its
 * colour-matched parts lighting up as the voice reads it, and a closing line; captions (拼 / EN) so it works muted.
 * The voice-over is the structure's own `intro` (≤ 6 short lines of simple Chinese, written by the lesson's
 * author), else a template made from the pattern. Every line is the app voice at the clip speed, so it is
 * prefetched with the lesson (exerciseTtsTexts → lessonAudioClips) and plays offline.
 *
 * Pure; the Lab port core/…/LessonPatternIntro.kt is parity-tested (android-lab/parity/fixtures/lesson-pattern-intro.ts).
 */
import type { ClipScene, ClipSpec, ClipWord } from '../clips/types';
import { clipUtterances } from '../clips/timeline';
import { karaokeActive, karaokeTimeline } from '../clips/karaoke';
import { isPunctuation, isSlotPiece, patternName, type StructureCard, type StructureNoteView } from './pattern';
import type { PatternExamplePart, PatternIntroLine } from './types';

/** At most this many examples are read in an intro. */
export const INTRO_MAX_EXAMPLES = 3;
/** At most this many voice-over lines. */
export const INTRO_MAX_LINES = 6;

const TITLE_MS = 3500;
const EXAMPLE_MS = 5000;
const CLOSING_MS = 3000;
const PIECE_MS = 450;

/** The structure's name to SAY: its fixed words with a pause where slots go ("除了……还……"). */
export function spokenPatternName(card: StructureCard): string {
  return patternName({ pieces: card.pattern.pieces }).replace(/…/g, '……');
}

/** The name to SHOW: the pattern's own name, else the fixed words with "…". */
function shownName(card: StructureCard): string {
  return patternName(card.pattern);
}

/** The template voice-over (simple Chinese, HSK 1–2 words) for a structure with no `intro` of its own. */
export function templateIntroLines(card: StructureCard): PatternIntroLine[] {
  const name = spokenPatternName(card);
  const examples = Math.min(card.examples.length, INTRO_MAX_EXAMPLES);
  const lines: PatternIntroLine[] = [
    name
      ? { zh: `今天我们学一个新句型：“${name}”。`, en: `Today's new structure: ${shownName(card)}` }
      : { zh: '今天我们学一个新句型。', en: "Today's new structure" },
    { zh: '我们先看看这个句型。', en: card.pattern.meaning ? `First, the pattern — ${card.pattern.meaning}` : 'First, the pattern.' },
  ];
  if (examples > 0) lines.push(examples === 1 ? { zh: '我们听一个例子。', en: "Let's hear an example." } : { zh: '我们听几个例子。', en: "Let's hear some examples." });
  lines.push({ zh: '现在你也试一试吧！', en: 'Now you try!' });
  return lines;
}

/** The voice-over used: the structure's own `intro` (cleaned, ≤ 6 lines) when it has one, else the template. */
export function patternIntroLines(card: StructureCard): PatternIntroLine[] {
  const own = (card.pattern.intro ?? [])
    .filter((l) => l && typeof l.zh === 'string' && l.zh.trim())
    .slice(0, INTRO_MAX_LINES)
    .map((l) => (typeof l.en === 'string' && l.en.trim() ? { zh: l.zh.trim(), en: l.en.trim() } : { zh: l.zh.trim() }));
  return own.length ? own : templateIntroLines(card);
}

/**
 * The intro as a clip. The lines go, in order, to: the title, the pattern building up, the examples (one line
 * before each example is read; lines with no example left get a pattern scene of their own), and the closing
 * (always the LAST line, when there are three or more). Examples: the card's first three.
 */
export function patternIntroClip(card: StructureCard): ClipSpec {
  const lines = patternIntroLines(card);
  const pieces = card.pattern.pieces;
  const name = shownName(card);
  const voice = (l: PatternIntroLine | undefined) => (l ? { voice: { text: l.zh, lang: 'zh' as const, ...(l.en ? { en: l.en } : {}) } } : {});
  const body = { ...(name ? { name } : {}), pieces, ...(card.pattern.meaning ? { meaning: card.pattern.meaning } : {}) };

  const closing = lines.length >= 3 ? lines[lines.length - 1] : undefined;
  const middle = lines.slice(2, closing ? lines.length - 1 : lines.length);
  const examples = card.examples.slice(0, INTRO_MAX_EXAMPLES);

  const scenes: ClipScene[] = [];
  scenes.push({
    layout: 'title',
    duration_ms: TITLE_MS,
    ...voice(lines[0]),
    title: { headline_zh: '新句型', ...(name ? { headline_en: name } : {}), ...(card.pattern.meaning ? { sub: card.pattern.meaning } : {}) },
  });
  scenes.push({ layout: 'pattern', duration_ms: Math.min(9000, 1500 + PIECE_MS * pieces.length), ...voice(lines[1]), pattern: body });
  // Lines beyond what the examples can carry come first, each over the pattern.
  const extra = Math.max(0, middle.length - examples.length);
  for (let i = 0; i < extra; i++) scenes.push({ layout: 'pattern', duration_ms: 3500, ...voice(middle[i]), pattern: body });
  examples.forEach((e, i) => {
    scenes.push({
      layout: 'pattern',
      duration_ms: EXAMPLE_MS,
      ...voice(middle[extra + i]),
      pattern: { ...body, example: { hanzi: e.hanzi, ...(e.pinyin ? { pinyin: e.pinyin } : {}), ...(e.english ? { english: e.english } : {}), parts: e.parts } },
    });
  });
  if (closing) scenes.push({ layout: 'title', duration_ms: CLOSING_MS, ...voice(closing), title: { headline_zh: '你也试一试！', headline_en: 'Now you try', ...(name ? { sub: name } : {}) } });

  const words: ClipWord[] = [];
  for (const p of pieces) {
    if (isSlotPiece(p) || p.optional || !p.hanzi || isPunctuation(p.hanzi) || words.length >= 6) continue;
    words.push({ hanzi: p.hanzi, pinyin: p.pinyin ?? '', english: p.english ?? '' });
  }
  return { v: 1, title: name ? `Intro · ${name}`.slice(0, 60) : 'Intro', hook: '', style: { theme: 'paper' }, words, scenes };
}

/** Every text the intros of a note's cards say, in order (the app voice at the clip speed) — for prefetch. */
export function patternIntroTexts(view: StructureNoteView): string[] {
  return view.cards.flatMap((card) => clipUtterances(patternIntroClip(card)).map((u) => u.text));
}

/**
 * The part of an example being read at `positionMs` of a `durationMs` clip (the karaoke timeline over the
 * parts: each part weighed like a karaoke word), -1 before the first. Lights the colour-matched parts in turn.
 */
export function introLitPart(parts: readonly PatternExamplePart[], positionMs: number, durationMs: number): number {
  const texts = parts.map((p) => p.text);
  const timeline = karaokeTimeline(texts.join(''), 'zh', durationMs, texts);
  if (timeline.length !== parts.length) return -1;
  return karaokeActive(timeline, positionMs);
}
