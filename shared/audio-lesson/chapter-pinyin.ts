/**
 * Pinyin for an audio lesson's chapter titles (docs/AUDIO_LESSONS.md "Chapter titles").
 *
 * Chapter titles are stored as the compiler wrote them: "打扰了 — sorry to bother you" (dialogue,
 * one per taught point), "自驾游 zìjiàyóu" (sleep, already with pinyin), "开始", "小明每天早上七点起床…"
 * (story, the first words of a chunk), "Introduction". This module adds the pinyin of the Chinese
 * part when the title doesn't carry it yet — computed when the title is SHOWN (podcast feed,
 * chapters JSON, the in-app player), so every lesson made before gets it too:
 *
 * - the pinyin of a taught word comes from the lesson's own `words` (exact, as the lesson says it:
 *   "打扰了" → "dǎrǎo le");
 * - anything else is the device-style automatic pinyin: pinyin-pro, then `applyYiBuToneChanges`;
 * - a title that already has its pinyin ("自驾游 zìjiàyóu") is split, never doubled;
 * - a title without Chinese ("Introduction", "First listen") is left alone.
 */
import { pinyin as pinyinPro } from 'pinyin-pro';
import { applyYiBuToneChanges } from '../pinyin/toneChange';
import type { LessonWord } from './types';

export interface ChapterTitleSplit {
  /** The Chinese part as written ("打扰了", "小明每天早上七点起床…"), or the whole title when it has no Chinese. */
  head: string;
  /** Its pinyin, or null (no Chinese in the title). */
  pinyin: string | null;
  /** What follows the Chinese part (" — sorry to bother you"), else ''. */
  rest: string;
}

const HAN = /\p{Script=Han}/u;
const TONE_MARK = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
/** Latin pinyin after the Chinese: letters (with tone marks / ü), apostrophes and spaces. */
const TRAILING_PINYIN = /^(.*\p{Script=Han}[^A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]*?)\s+([A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ'’ ]+)$/u;
/** The separator the dialogue compiler puts between a point and its English. */
const SEPARATOR = ' — ';

function normalise(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** The automatic pinyin of the Chinese characters in `text` (pinyin-pro + the 一 / 不 tone changes). */
export function autoChapterPinyin(text: string): string {
  const han = [...text].filter((ch) => HAN.test(ch)).join('');
  if (!han) return '';
  try {
    const raw = pinyinPro(han, { toneType: 'symbol', type: 'string' });
    return applyYiBuToneChanges(han, raw).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** A chapter title split into its Chinese part, that part's pinyin and the rest. */
export function splitChapterTitle(title: string, words: readonly LessonWord[] = []): ChapterTitleSplit {
  const sep = title.indexOf(SEPARATOR);
  const head = sep > 0 ? title.slice(0, sep) : title;
  const rest = sep > 0 ? title.slice(sep) : '';
  if (!HAN.test(head)) return { head: title, pinyin: null, rest: '' };

  // Already with its pinyin ("自驾游 zìjiàyóu"): split it off, don't add a second one.
  const trailing = head.match(TRAILING_PINYIN);
  if (trailing) {
    const [, zh, py] = trailing;
    const word = words.find((w) => normalise(w.hanzi) === normalise(zh));
    const isPinyin = TONE_MARK.test(py) || (!!word && normalise(word.pinyin).toLowerCase() === normalise(py).toLowerCase());
    if (isPinyin) return { head: zh.trim(), pinyin: py.trim(), rest };
  }

  const key = normalise(head);
  const word = words.find((w) => w.pinyin?.trim() && normalise(w.hanzi) === key);
  const auto = word ? word.pinyin.trim() : autoChapterPinyin(head);
  if (!auto) return { head: title, pinyin: null, rest: '' };
  // A title cut short ("小明每天早上七点起床…") has its pinyin cut short too.
  const pinyin = !word && /…$/.test(head.trim()) ? `${auto}…` : auto;
  return { head: head.trim(), pinyin, rest };
}

/** What the player shows: the title without its pinyin (`label`) and the pinyin on its own line. */
export function chapterTitleParts(title: string, words: readonly LessonWord[] = []): { label: string; pinyin: string | null } {
  const s = splitChapterTitle(title, words);
  return { label: s.pinyin ? `${s.head}${s.rest}` : title, pinyin: s.pinyin };
}

/** One line with the pinyin after the Chinese (podcast chapters, show notes): "打扰了 dǎrǎo le — sorry to bother you". */
export function chapterTitleWithPinyin(title: string, words: readonly LessonWord[] = []): string {
  const s = splitChapterTitle(title, words);
  return s.pinyin ? `${s.head} ${s.pinyin}${s.rest}` : title;
}
