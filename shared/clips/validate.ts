/**
 * `validateClipSpec`: every rule of the clip spec (doc.ts) that a machine can check, as a list
 * of readable problems (empty = valid) — what `POST /api/clips` answers with 400 + `problems`,
 * what the generator's repair rounds feed back to Claude, and what the MCP `create_clip` tool
 * pre-checks. Like validateLessonSpec, it never changes the spec.
 */
import {
  CLIP_LAYOUTS,
  CLIP_THEMES,
  CLIP_VOICES,
  type ClipScene,
  type ClipSpec,
} from './types';

export const CLIP_LIMITS = {
  titleChars: 60,
  hookChars: 60,
  wordsMin: 1,
  wordsMax: 6,
  tagsMax: 6,
  scenesMin: 4,
  scenesMax: 10,
  sceneMinMs: 1500,
  sceneMaxMs: 9000,
  /** The target is 20–60 s; a clip outside 15–75 s is refused. */
  targetMinMs: 20_000,
  targetMaxMs: 60_000,
  totalMinMs: 15_000,
  totalMaxMs: 75_000,
  imagesMax: 3,
  storyLinesMax: 6,
  listItemsMax: 6,
  quizOptionsMin: 2,
  quizOptionsMax: 4,
  breakdownMax: 8,
  voiceChars: 220,
  textChars: 300,
  imagePromptChars: 600,
} as const;

const HAN = /\p{Script=Han}/u;
/** Tone NUMBERS in pinyin (ni3, hao3, lv4). */
const TONE_NUMBER = /[a-zü:v]+[1-5](?![0-9])/i;
/** What TTS would read aloud or pause at (the spec: no brackets / blanks in voice.text). */
const VOICE_FORBIDDEN = /[()（）[\]【】{}<>《》]|_{2,}|＿|…|\.\.\./;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function validateClipSpec(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The clip must be a JSON object'];
  const spec = input as Partial<ClipSpec> & Record<string, unknown>;
  const L = CLIP_LIMITS;

  if (spec.v !== 1) problems.push('v must be 1');
  const title = str(spec.title);
  if (!title) problems.push('title is required');
  else if ([...title].length > L.titleChars) problems.push(`title is ${[...title].length} characters; ${L.titleChars} at most`);
  const hook = str(spec.hook);
  if (!hook) problems.push('hook is required (big on screen in the first scene)');
  else if ([...hook].length > L.hookChars) problems.push(`hook is ${[...hook].length} characters; ${L.hookChars} at most`);

  if (!isObj(spec.style)) problems.push('style is required: { theme, accent? }');
  else {
    if (!(CLIP_THEMES as readonly string[]).includes(spec.style.theme as string)) problems.push(`style.theme must be one of ${CLIP_THEMES.join(' | ')}`);
    if (spec.style.accent !== undefined && spec.style.accent !== null && !(typeof spec.style.accent === 'string' && HEX.test(spec.style.accent))) {
      problems.push('style.accent must be a hex colour like "#FF3B6B"');
    }
  }

  if (!Array.isArray(spec.words) || spec.words.length < L.wordsMin || spec.words.length > L.wordsMax) {
    problems.push(`words must have ${L.wordsMin}–${L.wordsMax} focus words`);
  } else {
    spec.words.forEach((w, i) => checkTriple(problems, w, `words[${i}]`));
  }

  if (spec.tags !== undefined) {
    if (!Array.isArray(spec.tags) || spec.tags.some((t) => typeof t !== 'string')) problems.push('tags must be a list of strings');
    else if (spec.tags.length > L.tagsMax) problems.push(`tags: ${L.tagsMax} at most`);
  }
  if (spec.topic !== undefined && typeof spec.topic !== 'string') problems.push('topic must be a string');

  if (!Array.isArray(spec.scenes) || spec.scenes.length < L.scenesMin || spec.scenes.length > L.scenesMax) {
    problems.push(`scenes must have ${L.scenesMin}–${L.scenesMax} scenes`);
  } else {
    let total = 0;
    let images = 0;
    spec.scenes.forEach((scene, i) => {
      const at = `scenes[${i}]`;
      if (!isObj(scene)) {
        problems.push(`${at} must be an object`);
        return;
      }
      const d = scene.duration_ms;
      if (typeof d !== 'number' || !Number.isFinite(d) || d < L.sceneMinMs || d > L.sceneMaxMs) {
        problems.push(`${at}.duration_ms must be ${L.sceneMinMs}–${L.sceneMaxMs}`);
      } else total += d;
      if (scene.image_prompt !== undefined) {
        if (typeof scene.image_prompt !== 'string' || !scene.image_prompt.trim()) problems.push(`${at}.image_prompt must be a non-empty string`);
        else {
          images++;
          if (scene.image_prompt.length > L.imagePromptChars) problems.push(`${at}.image_prompt is too long (${L.imagePromptChars} characters at most)`);
        }
      }
      if (scene.emoji !== undefined && typeof scene.emoji !== 'string') problems.push(`${at}.emoji must be a string`);
      if (scene.voice !== undefined) checkVoice(problems, scene.voice, `${at}.voice`);
      if (!(CLIP_LAYOUTS as readonly string[]).includes(scene.layout as string)) {
        problems.push(`${at}.layout must be one of ${CLIP_LAYOUTS.join(' | ')}`);
        return;
      }
      checkScene(problems, scene as unknown as ClipScene, at);
    });
    if (images > L.imagesMax) problems.push(`${images} scenes have an image_prompt; ${L.imagesMax} at most per clip`);
    if (problems.every((p) => !p.includes('duration_ms')) && (total < L.totalMinMs || total > L.totalMaxMs)) {
      problems.push(`the scenes add up to ${(total / 1000).toFixed(1)} s; a clip runs 20–60 s (${L.totalMinMs / 1000}–${L.totalMaxMs / 1000} s at the outside)`);
    }
  }

  if (spec.ending !== undefined && spec.ending !== null) {
    if (!isObj(spec.ending)) problems.push('ending must be { question_en?, cta? }');
    else {
      if (spec.ending.question_en !== undefined && typeof spec.ending.question_en !== 'string') problems.push('ending.question_en must be a string');
      if (spec.ending.cta !== undefined && typeof spec.ending.cta !== 'string') problems.push('ending.cta must be a string');
    }
  }
  return problems;
}

function checkPinyin(problems: string[], pinyin: unknown, hanzi: string, at: string): void {
  const p = str(pinyin);
  if (!p) {
    if (HAN.test(hanzi)) problems.push(`${at}.pinyin is required`);
    return;
  }
  if (TONE_NUMBER.test(p)) problems.push(`${at}.pinyin uses tone numbers ("${p}"); write tone marks (nǐ hǎo)`);
  if (HAN.test(p)) problems.push(`${at}.pinyin contains Chinese characters`);
}

/** hanzi + pinyin + english, all required (words, story lines, list items, compare sides…). */
function checkTriple(problems: string[], v: unknown, at: string, opts: { requireHan?: boolean } = {}): void {
  if (!isObj(v)) {
    problems.push(`${at} must be { hanzi, pinyin, english }`);
    return;
  }
  const hanzi = str(v.hanzi);
  if (!hanzi) problems.push(`${at}.hanzi is required`);
  else if (opts.requireHan !== false && !HAN.test(hanzi)) problems.push(`${at}.hanzi has no Chinese characters`);
  checkPinyin(problems, v.pinyin, hanzi, at);
  if (!str(v.english)) problems.push(`${at}.english is required`);
  for (const k of ['hanzi', 'pinyin', 'english'] as const) {
    if (typeof v[k] === 'string' && (v[k] as string).length > CLIP_LIMITS.textChars) problems.push(`${at}.${k} is too long`);
  }
}

function checkVoice(problems: string[], v: unknown, at: string): void {
  if (!isObj(v)) {
    problems.push(`${at} must be { text, lang, voice? }`);
    return;
  }
  const text = str(v.text);
  if (!text) problems.push(`${at}.text is required`);
  else {
    if (text.length > CLIP_LIMITS.voiceChars) problems.push(`${at}.text is too long (${CLIP_LIMITS.voiceChars} characters at most)`);
    if (VOICE_FORBIDDEN.test(text)) problems.push(`${at}.text is read aloud by TTS: no brackets, blanks (___) or ellipses`);
    if (v.lang === 'zh' && !HAN.test(text)) problems.push(`${at}.text is lang "zh" but has no Chinese`);
  }
  if (v.lang !== 'zh' && v.lang !== 'en') problems.push(`${at}.lang must be "zh" or "en"`);
  if (v.voice !== undefined && !(CLIP_VOICES as readonly string[]).includes(v.voice as string)) problems.push(`${at}.voice must be one of ${CLIP_VOICES.join(' | ')}`);
}

function checkScene(problems: string[], scene: ClipScene, at: string): void {
  const L = CLIP_LIMITS;
  const body = (scene as unknown as Record<string, unknown>)[scene.layout];
  const where = `${at}.${scene.layout}`;
  if (!isObj(body)) {
    problems.push(`${at} has layout "${scene.layout}" but no "${scene.layout}" object`);
    return;
  }
  switch (scene.layout) {
    case 'title': {
      if (!str(body.headline_zh) && !str(body.headline_en)) problems.push(`${where} needs headline_zh or headline_en`);
      break;
    }
    case 'big_word': {
      checkTriple(problems, body, where);
      const hanzi = str(body.hanzi);
      if (body.breakdown !== undefined) {
        if (!Array.isArray(body.breakdown)) problems.push(`${where}.breakdown must be a list of { char, meaning }`);
        else {
          if (body.breakdown.length > L.breakdownMax) problems.push(`${where}.breakdown: ${L.breakdownMax} at most`);
          body.breakdown.forEach((b, i) => {
            if (!isObj(b) || !str(b.char) || !str(b.meaning)) problems.push(`${where}.breakdown[${i}] must be { char, meaning }`);
            else if (hanzi && !hanzi.includes(str(b.char))) problems.push(`${where}.breakdown[${i}].char "${str(b.char)}" is not in "${hanzi}"`);
          });
        }
      }
      break;
    }
    case 'sentence': {
      checkTriple(problems, body, where);
      const hl = str(body.highlight);
      if (hl && !str(body.hanzi).includes(hl)) problems.push(`${where}.highlight "${hl}" does not occur in the sentence`);
      break;
    }
    case 'compare': {
      for (const side of ['left', 'right'] as const) {
        checkTriple(problems, body[side], `${where}.${side}`);
        const ex = isObj(body[side]) ? (body[side] as Record<string, unknown>).example : undefined;
        if (ex !== undefined && typeof ex !== 'string') problems.push(`${where}.${side}.example must be a string`);
      }
      const extra = Object.keys(body).filter((k) => !['left', 'right', 'rule_en'].includes(k));
      if (extra.length) problems.push(`${where} has exactly two sides (left, right) — not ${extra.join(', ')}`);
      break;
    }
    case 'quiz': {
      if (!str(body.prompt_zh) && !str(body.prompt_en)) problems.push(`${where} needs prompt_zh or prompt_en`);
      const options = body.options;
      if (!Array.isArray(options) || options.length < L.quizOptionsMin || options.length > L.quizOptionsMax || options.some((o) => !str(o))) {
        problems.push(`${where}.options must be ${L.quizOptionsMin}–${L.quizOptionsMax} non-empty strings`);
      } else {
        if (new Set(options.map((o) => str(o))).size !== options.length) problems.push(`${where}.options must all be different`);
        const a = body.answer_index;
        if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a >= options.length) problems.push(`${where}.answer_index must be 0–${options.length - 1}`);
      }
      break;
    }
    case 'story': {
      const lines = body.lines;
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > L.storyLinesMax) problems.push(`${where}.lines must have 1–${L.storyLinesMax} lines`);
      else lines.forEach((line, i) => checkTriple(problems, line, `${where}.lines[${i}]`));
      break;
    }
    case 'list': {
      const items = body.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > L.listItemsMax) problems.push(`${where}.items must have 1–${L.listItemsMax} items`);
      else items.forEach((item, i) => checkTriple(problems, item, `${where}.items[${i}]`));
      break;
    }
    case 'fact': {
      if (!str(body.text_en)) problems.push(`${where}.text_en is required`);
      if (body.pinyin !== undefined) checkPinyin(problems, body.pinyin, str(body.hanzi), where);
      break;
    }
  }
}

/** A stored spec (JSON text or object) → the spec when it still validates, else null. */
export function parseStoredClipSpec(raw: unknown): ClipSpec | null {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return validateClipSpec(value).length === 0 ? (value as ClipSpec) : null;
}
