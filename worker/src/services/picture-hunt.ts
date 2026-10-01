/**
 * Picture hunt pipeline (看图找词) — runs on picture-hunt-queue, one hunt per
 * message, the way quests do (minutes of wall clock: too long for waitUntil).
 *
 *   1. Picture: generated with Gemini Flash Image from the learner's prompt
 *      (leaning toward words they are learning), or the upload already in R2.
 *   2. Detection: Gemini Flash (GEMINI_FLASH_MODELS, services/gemini.ts) finds up to 25 nameable objects — `box_2d`
 *      ([ymin, xmin, ymax, xmax] on a 0–1000 grid) plus, when it manages,
 *      a segmentation `mask` (base64 PNG over the box). The mask becomes an
 *      outline polygon (picture-hunt-mask.ts); without one the box is drawn.
 *      If the mask answer is unusable (cut off, not JSON) a boxes-only call is
 *      made instead. Tiny, whole-picture and duplicate detections are dropped.
 *   3. Naming: Claude (structuredCall: forced tool, thinking off) sees the
 *      picture and the numbered boxes and returns each object's Chinese name
 *      (card-standard hanzi, tone-marked pinyin, English, accepted
 *      alternatives, a card explanation + example sentence) or skips it.
 *      Items that break a rule get ONE repair round; what is still broken is
 *      dropped. Objects with the same hanzi merge (two cups = one object with
 *      two regions).
 *   4. Stored on the row with `progress` as the breadcrumb of the stage reached.
 *
 * Every model call is injectable (`deps`) so the whole pipeline is unit-tested
 * with canned Gemini / Claude responses.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { HuntBox, HuntObject, HuntRegion, PictureHuntDifficulty } from '@shared/picture-hunt';
import { PICTURE_HUNT_MAX_OBJECTS, cleanAlternatives, cleanBox, huntObjectProblems } from '@shared/picture-hunt';
import { CARD_STANDARD } from '@shared/cards/standard';
import type { Env, VocabularyItem } from '../types';
import * as huntDb from '../db/picture-hunt-queries';
import { getLearnedVocabulary } from '../db/queries';
import { polygonFromMaskData } from './picture-hunt-mask';
import { structuredCall } from './structured-call';
import { GEMINI_FLASH_MODELS, GEMINI_IMAGE_MODELS, GeminiError, geminiGenerateContent, leastThinking, type FetchLike } from './gemini';

export const HUNT_NAMING_MODEL = 'claude-sonnet-5';
/** Claude's image input limit is 5 MB of base64; stay under it. */
const CLAUDE_IMAGE_MAX_BYTES = 3_700_000;
/** A detection smaller than this share of the picture is too small to spot. */
const MIN_AREA = 0.0025;
/** …and one covering most of the picture is the scene, not a thing in it. */
const MAX_AREA = 0.85;
const JUNK_LABELS = new Set(['', 'object', 'objects', 'thing', 'item', 'unknown', 'background', 'scene', 'image', 'picture', 'photo', 'other']);

export type { FetchLike };

export interface HuntDeps {
  fetch?: FetchLike;
  /** Claude client (test seam for structuredCall). */
  claude?: Pick<Anthropic, 'messages'>;
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------- images

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** Width / height and type from the first bytes of a PNG, JPEG or WebP; null if unrecognised. */
export function sniffImage(bytes: Uint8Array): { mime: ImageMime; width: number; height: number } | null {
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const u16 = (o: number) => (bytes[o] << 8) | bytes[o + 1];
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: 'image/png', width: u32(16), height: u32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = bytes[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const len = u16(o + 2);
      // SOF0..SOF15 except DHT (c4), JPG (c8), DAC (cc)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: u16(o + 5), width: u16(o + 7) };
      }
      o += 2 + len;
    }
    return { mime: 'image/jpeg', width: 0, height: 0 };
  }
  if (bytes.length > 30 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    const le16 = (o: number) => bytes[o] | (bytes[o + 1] << 8);
    const le24 = (o: number) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: le24(24) + 1, height: le24(27) + 1 };
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = bytes.subarray(21, 25);
      const width = 1 + (((b[1] & 0x3f) << 8) | b[0]);
      const height = 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6));
      return { mime: 'image/webp', width, height };
    }
    return { mime: 'image/webp', width: 0, height: 0 };
  }
  return null;
}

export function extFor(mime: ImageMime): 'jpg' | 'png' | 'webp' {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** The prompt for a generated hunt picture: a busy scene full of distinct, nameable things. */
export function buildScenePrompt(prompt: string, vocabulary: VocabularyItem[]): string {
  const concrete = vocabulary
    .map((v) => v.english.split(/[;,/(]/)[0].trim())
    .filter((e) => e && e.split(/\s+/).length <= 3)
    .slice(0, 14);
  const lean = concrete.length
    ? `\nWhere they fit naturally, include some of these things: ${concrete.join(', ')}.`
    : '';
  return `A detailed, realistic photograph-style picture of: ${prompt}.
Fill the scene with 15–25 distinct, everyday, clearly visible objects that a language learner could name — furniture, food, tools, clothes, animals, vehicles, containers — each one separate and uncovered, none tiny.${lean}
Bright even lighting, sharp focus, eye-level view, no people's faces in close-up.
No text, letters, signs with writing, labels or watermarks anywhere in the picture.`;
}

/** Generate a picture with Gemini Flash Image. Throws with a readable message. */
export async function generateHuntPicture(
  geminiKey: string,
  prompt: string,
  deps: HuntDeps = {},
): Promise<{ bytes: Uint8Array; mime: ImageMime }> {
  const data = await geminiGenerateContent<GeminiResponse>({
    apiKey: geminiKey,
    models: GEMINI_IMAGE_MODELS,
    fetch: deps.fetch,
    label: 'picture-hunt draw',
    body: () => ({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  }).then((r) => r.data, (err) => {
    throw new Error(`The picture could not be drawn (${geminiReason(err)})`);
  });
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error('The picture could not be drawn (no image came back)');
  const bytes = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
  const sniffed = sniffImage(bytes);
  return { bytes, mime: sniffed?.mime ?? 'image/png' };
}

// ---------------------------------------------------------------- detection

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
  }>;
}

export interface Detection {
  label: string;
  box: HuntBox;
  mask?: string;
}

const DETECT_PROMPT_MASKS = `Find the distinct physical objects in this picture that a language learner could name — up to ${PICTURE_HUNT_MAX_OBJECTS} of them, the most visible and nameable first. Skip people's body parts, text, tiny things, and the room or background itself.
Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels (e.g. "teacup", "wooden chair").`;

const DETECT_PROMPT_BOXES = `Find the distinct physical objects in this picture that a language learner could name — up to ${PICTURE_HUNT_MAX_OBJECTS} of them, the most visible and nameable first. Skip people's body parts, text, tiny things, and the room or background itself.
Return a JSON list where each entry has "box_2d" ([ymin, xmin, ymax, xmax] normalised to 0-1000) and "label" (a short descriptive English name, e.g. "teacup").`;

/** Pull a JSON array out of a model's text (fenced or bare). Throws when there is none. */
export function parseJsonArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('no JSON list in the answer');
  const parsed = JSON.parse(body.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('answer is not a list');
  return parsed;
}

/** box_2d [ymin, xmin, ymax, xmax] on 0–1000 → normalised box; null if malformed. */
export function boxFrom2d(raw: unknown): HuntBox | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [y0, x0, y1, x1] = raw as number[];
  return cleanBox({ x: Math.min(x0, x1) / 1000, y: Math.min(y0, y1) / 1000, w: Math.abs(x1 - x0) / 1000, h: Math.abs(y1 - y0) / 1000 });
}

export function parseDetections(items: unknown[]): Detection[] {
  const out: Detection[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const box = boxFrom2d(r.box_2d);
    if (!box) continue;
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 60) : '';
    const mask = typeof r.mask === 'string' && r.mask.length > 20 ? r.mask : undefined;
    out.push({ label, box, ...(mask ? { mask } : {}) });
  }
  return out;
}

function iou(a: HuntBox, b: HuntBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Drop junk labels, specks, the whole scene and near-duplicate boxes; keep at most the cap. */
export function cleanDetections(detections: Detection[]): Detection[] {
  const kept: Detection[] = [];
  for (const d of detections) {
    const area = d.box.w * d.box.h;
    if (JUNK_LABELS.has(d.label.toLowerCase())) continue;
    if (area < MIN_AREA || area > MAX_AREA) continue;
    if (kept.some((k) => iou(k.box, d.box) > 0.8)) continue;
    kept.push(d);
    if (kept.length >= PICTURE_HUNT_MAX_OBJECTS) break;
  }
  return kept;
}

/** "Gemini 404: models/… is not found …" — Google's reason, never the key. */
function geminiReason(err: unknown): string {
  if (err instanceof GeminiError) return err.message;
  return err instanceof Error ? err.message : 'Gemini request failed';
}

async function geminiDetect(geminiKey: string, image: Uint8Array, mime: string, prompt: string, deps: HuntDeps): Promise<Detection[]> {
  const data = await geminiGenerateContent<GeminiResponse>({
    apiKey: geminiKey,
    models: GEMINI_FLASH_MODELS,
    fetch: deps.fetch,
    label: 'picture-hunt detect',
    body: (model) => {
      // Google's guidance for detection / segmentation: no (or minimal) thinking.
      const thinkingConfig = leastThinking(model);
      return {
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: toBase64(image) } }, { text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.5,
          maxOutputTokens: 60_000,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      };
    },
  }).then((r) => r.data, (err) => {
    throw new DetectRequestError(`Finding the objects failed (${geminiReason(err)})`, err instanceof GeminiError ? err.status : 0);
  });
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('detection answer was cut off');
  return parseDetections(parseJsonArray(text));
}

/** The detection request itself failed (no model answered). */
class DetectRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Detect objects: first with segmentation masks; if that answer is unusable
 * (cut off, not JSON, or empty) once more asking for boxes only.
 */
export async function detectObjects(geminiKey: string, image: Uint8Array, mime: string, deps: HuntDeps = {}): Promise<{ detections: Detection[]; masks: boolean }> {
  try {
    const withMasks = cleanDetections(await geminiDetect(geminiKey, image, mime, DETECT_PROMPT_MASKS, deps));
    if (withMasks.length > 0) return { detections: withMasks, masks: withMasks.some((d) => d.mask) };
  } catch (err) {
    // A refused request (no model for this key, bad key, bad image) would be refused again for boxes.
    if (err instanceof DetectRequestError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
    console.warn('[picture-hunt] segmentation answer unusable, asking for boxes:', err instanceof Error ? err.message : err);
  }
  const boxes = cleanDetections(await geminiDetect(geminiKey, image, mime, DETECT_PROMPT_BOXES, deps));
  return { detections: boxes.map(({ label, box }) => ({ label, box })), masks: false };
}

// ---------------------------------------------------------------- naming

export interface NamedItem {
  n: number;
  skip?: boolean;
  hanzi?: string;
  pinyin?: string;
  english?: string;
  alternatives?: string[];
  difficulty?: PictureHuntDifficulty;
  fun_facts?: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
}

export interface NamingResult {
  title_hanzi: string;
  title_english: string;
  items: NamedItem[];
}

const NAMING_TOOL = {
  name: 'name_objects',
  description: 'Give each numbered object in the picture its Chinese name, or skip it.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title_hanzi: { type: 'string', description: 'A short Chinese title for the picture (2–8 characters), e.g. 热闹的厨房' },
      title_english: { type: 'string', description: 'The same title in English, e.g. "A busy kitchen"' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer', description: 'The object number from the list' },
            skip: { type: 'boolean', description: 'true when the box is not one nameable thing (a blur, a wall, a body part, text, or a mislabel you cannot fix)' },
            hanzi: { type: 'string', description: 'The everyday Mandarin name, ONE clean simplified form, no measure word, no punctuation' },
            pinyin: { type: 'string', description: 'Tone marks, spaces between words (e.g. "chábēi")' },
            english: { type: 'string', description: 'One clear English meaning' },
            alternatives: { type: 'array', items: { type: 'string' }, description: 'Other names a learner could fairly type for THIS object: common synonyms, the general word (杯子 for 茶杯), shorter/longer everyday forms. Hanzi only.' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            fun_facts: { type: 'string', description: 'Card explanation: each character (汉字 (pīnyīn) meaning) and how they combine, then usage / measure word / a common confusion. 2–4 short lines.' },
            sentence_clue: { type: 'string', description: 'One short, natural sentence containing the hanzi exactly' },
            sentence_clue_pinyin: { type: 'string' },
            sentence_clue_translation: { type: 'string' },
          },
          required: ['n'],
        },
      },
    },
    required: ['title_hanzi', 'title_english', 'items'],
  },
};

const NAMING_SYSTEM = `You label pictures for a Mandarin learner's game: they look at the picture and type the Chinese names of the things they can see. Each correct answer lights up that object.

You get the picture and a numbered list of boxes an object detector found (its English label and where the box is). For EVERY number, either name the object in the box or skip it.

Naming rules:
- Name what is actually in the box as a Chinese speaker would say it in everyday life (冰箱, not 电冰箱 unless that is what people say; 杯子 or 茶杯 — pick the one that fits what is shown). Correct the detector's label when it is wrong.
- hanzi is ONE clean simplified form with no measure word (苹果, not 一个苹果), no punctuation, no slashes or brackets. At most 6 characters.
- alternatives are the other answers a learner could fairly type for this same object — the more general word, a common synonym, the regional or colloquial variant. Never a word for a different object. Up to 5.
- Two boxes showing the same kind of thing get the same hanzi (they become one object with two places).
- Skip: people's faces / hands / body parts, text and signs, blurs, parts of the room or background (wall, floor, sky) unless clearly a thing in itself, and anything you cannot name confidently.
- difficulty: easy = HSK 1–2 everyday word, medium = HSK 3–4, hard = rarer.

The card fields (fun_facts, sentence_clue) follow the app's card standard below — the learner can add any object as a flashcard.

${CARD_STANDARD}

Return everything through the name_objects tool.`;

function describeBox(box: HuntBox): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `left ${pct(box.x)}, top ${pct(box.y)}, width ${pct(box.w)}, height ${pct(box.h)}`;
}

export function buildNamingPrompt(detections: Detection[], vocabulary: VocabularyItem[], repair?: string[]): string {
  const list = detections.map((d, i) => `${i + 1}. "${d.label || 'unlabelled'}" — ${describeBox(d.box)}`).join('\n');
  const vocab = vocabulary.length
    ? `\n\nWords this learner is studying (when one of these IS the right name for an object, use it as the hanzi): ${vocabulary.slice(0, 60).map((v) => v.hanzi).join('、')}`
    : '';
  const fix = repair?.length
    ? `\n\nYour previous answer had these problems. Return the WHOLE list again with them fixed (skip an item if it cannot be fixed):\n- ${repair.join('\n- ')}`
    : '';
  return `Objects found in the picture (boxes are relative to the whole picture):\n${list}${vocab}${fix}`;
}

function validateNaming(input: unknown): NamingResult {
  if (!input || typeof input !== 'object') throw new Error('naming answer is not an object');
  const r = input as Record<string, unknown>;
  if (!Array.isArray(r.items)) throw new Error('naming answer has no items');
  const items: NamedItem[] = [];
  for (const raw of r.items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const n = typeof it.n === 'number' ? Math.round(it.n) : Number(it.n);
    if (!Number.isFinite(n)) continue;
    const str = (k: string) => (typeof it[k] === 'string' ? (it[k] as string).trim() : undefined);
    items.push({
      n,
      skip: it.skip === true,
      hanzi: str('hanzi'),
      pinyin: str('pinyin'),
      english: str('english'),
      alternatives: Array.isArray(it.alternatives) ? (it.alternatives.filter((a) => typeof a === 'string') as string[]) : [],
      difficulty: ['easy', 'medium', 'hard'].includes(it.difficulty as string) ? (it.difficulty as PictureHuntDifficulty) : undefined,
      fun_facts: str('fun_facts'),
      sentence_clue: str('sentence_clue'),
      sentence_clue_pinyin: str('sentence_clue_pinyin'),
      sentence_clue_translation: str('sentence_clue_translation'),
    });
  }
  return {
    title_hanzi: typeof r.title_hanzi === 'string' ? r.title_hanzi.trim() : '',
    title_english: typeof r.title_english === 'string' ? r.title_english.trim() : '',
    items,
  };
}

async function callNaming(
  apiKey: string,
  image: { bytes: Uint8Array; mime: string } | null,
  detections: Detection[],
  vocabulary: VocabularyItem[],
  repair: string[] | undefined,
  deps: HuntDeps,
): Promise<NamingResult> {
  const text = buildNamingPrompt(detections, vocabulary, repair);
  const user: Anthropic.ContentBlockParam[] = [];
  if (image && image.bytes.length <= CLAUDE_IMAGE_MAX_BYTES) {
    user.push({ type: 'image', source: { type: 'base64', media_type: image.mime as 'image/jpeg', data: toBase64(image.bytes) } });
  }
  user.push({ type: 'text', text });
  return structuredCall({
    apiKey,
    model: HUNT_NAMING_MODEL,
    system: NAMING_SYSTEM,
    user,
    tool: NAMING_TOOL,
    maxTokens: 12_000,
    validate: validateNaming,
    timeoutMs: 120_000,
    client: deps.claude,
    sleep: deps.sleep,
  });
}

/**
 * Turn detections + names into HuntObjects: skipped / unknown numbers dropped,
 * each item checked (hanzi rules, tone marks, clue contains the word), same
 * hanzi merged into one object with several regions. Returns the objects and
 * the problems of the items that were dropped for breaking a rule.
 */
export function assembleObjects(
  detections: Detection[],
  polygons: Array<Array<[number, number]> | null>,
  naming: NamingResult,
): { objects: HuntObject[]; problems: string[] } {
  const byHanzi = new Map<string, HuntObject>();
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const item of naming.items) {
    const index = item.n - 1;
    if (item.skip || index < 0 || index >= detections.length || seen.has(index)) continue;
    seen.add(index);
    const hanzi = (item.hanzi ?? '').replace(/[\s。．.，,！!？?]+$/g, '').trim();
    const region: HuntRegion = { box: detections[index].box };
    const polygon = polygons[index];
    if (polygon && polygon.length >= 3) region.polygon = polygon;
    const candidate: HuntObject = {
      id: '',
      hanzi,
      pinyin: (item.pinyin ?? '').trim(),
      english: (item.english ?? '').trim(),
      alternatives: cleanAlternatives(hanzi, item.alternatives),
      ...(item.difficulty ? { difficulty: item.difficulty } : {}),
      ...(item.fun_facts ? { fun_facts: item.fun_facts } : {}),
      ...(item.sentence_clue ? { sentence_clue: item.sentence_clue } : {}),
      ...(item.sentence_clue_pinyin ? { sentence_clue_pinyin: item.sentence_clue_pinyin } : {}),
      ...(item.sentence_clue_translation ? { sentence_clue_translation: item.sentence_clue_translation } : {}),
      regions: [region],
    };
    const issues = huntObjectProblems(candidate).map((p) => `#${item.n} ${p}`);
    if (issues.length) {
      problems.push(...issues);
      continue;
    }
    const existing = byHanzi.get(hanzi);
    if (existing) {
      existing.regions.push(region);
      for (const alt of candidate.alternatives) if (!existing.alternatives.includes(alt)) existing.alternatives.push(alt);
    } else {
      byHanzi.set(hanzi, candidate);
    }
  }
  const objects = Array.from(byHanzi.values()).slice(0, PICTURE_HUNT_MAX_OBJECTS).map((o, i) => ({ ...o, id: `o${i + 1}` }));
  return { objects, problems };
}

/** Name the detections, with one repair round for items that broke a rule. */
export async function nameObjects(
  apiKey: string,
  image: { bytes: Uint8Array; mime: string } | null,
  detections: Detection[],
  polygons: Array<Array<[number, number]> | null>,
  vocabulary: VocabularyItem[],
  deps: HuntDeps = {},
): Promise<{ objects: HuntObject[]; title: string; repaired: boolean }> {
  let naming = await callNaming(apiKey, image, detections, vocabulary, undefined, deps);
  let assembled = assembleObjects(detections, polygons, naming);
  let repaired = false;
  if (assembled.problems.length > 0) {
    try {
      const second = await callNaming(apiKey, image, detections, vocabulary, assembled.problems.slice(0, 30), deps);
      const again = assembleObjects(detections, polygons, second);
      if (again.objects.length >= assembled.objects.length) {
        naming = second;
        assembled = again;
      }
      repaired = true;
    } catch (err) {
      console.warn('[picture-hunt] repair round failed, keeping the first answer:', err instanceof Error ? err.message : err);
    }
  }
  const title = naming.title_hanzi && naming.title_english
    ? `${naming.title_hanzi} · ${naming.title_english}`
    : naming.title_hanzi || naming.title_english || 'Picture hunt';
  return { objects: assembled.objects, title, repaired };
}

// ---------------------------------------------------------------- the job

type JobEnv = Pick<Env, 'DB' | 'AUDIO_BUCKET' | 'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY'>;

/** Build one hunt end to end. Records success or a readable error on the row; never throws. */
export async function runPictureHuntJob(env: JobEnv, huntId: string, deps: HuntDeps = {}): Promise<'ready' | 'error' | 'missing'> {
  const hunt = await huntDb.getPictureHuntUnscoped(env.DB, huntId);
  if (!hunt) return 'missing';
  const progress = (stage: string) => huntDb.setPictureHuntProgress(env.DB, huntId, stage).catch(() => {});
  try {
    if (!env.GEMINI_API_KEY) throw new Error('Picture hunts need the Gemini key (GEMINI_API_KEY), which is not set');
    if (!env.ANTHROPIC_API_KEY) throw new Error('Picture hunts need the Claude key (ANTHROPIC_API_KEY), which is not set');

    const deckIds = hunt.deck_ids ? (JSON.parse(hunt.deck_ids) as string[]) : undefined;
    const vocabulary = await getLearnedVocabulary(env.DB, hunt.user_id, deckIds?.length ? deckIds : undefined).catch(() => [] as VocabularyItem[]);

    // 1. The picture
    let image: { bytes: Uint8Array; mime: ImageMime } | null = null;
    if (hunt.image_key) {
      await progress('reading the picture');
      const obj = await env.AUDIO_BUCKET.get(hunt.image_key);
      if (obj) {
        const bytes = new Uint8Array(await obj.arrayBuffer());
        image = { bytes, mime: sniffImage(bytes)?.mime ?? 'image/jpeg' };
      }
    }
    if (!image) {
      if (hunt.source === 'upload') throw new Error('The uploaded photo is missing — delete this hunt and upload it again');
      await progress('drawing the picture');
      const drawn = await generateHuntPicture(env.GEMINI_API_KEY, buildScenePrompt(hunt.prompt || 'a busy kitchen', vocabulary), deps);
      const key = huntDb.pictureHuntImageKey(huntId, extFor(drawn.mime));
      await env.AUDIO_BUCKET.put(key, drawn.bytes, { httpMetadata: { contentType: drawn.mime } });
      const dims = sniffImage(drawn.bytes);
      await huntDb.setPictureHuntImage(env.DB, huntId, key, dims?.width || null, dims?.height || null);
      image = drawn;
    }

    // 2. Detection (+ outlines)
    await progress('finding the objects');
    const { detections, masks } = await detectObjects(env.GEMINI_API_KEY, image.bytes, image.mime, deps);
    if (detections.length === 0) throw new Error('No nameable objects were found in this picture — try a busier one');
    await progress(masks ? 'tracing outlines' : 'finding the objects');
    const polygons = await Promise.all(detections.map((d) => (d.mask ? polygonFromMaskData(d.mask, d.box) : Promise.resolve(null))));

    // 3. Names
    await progress(`naming ${detections.length} objects`);
    const { objects, title } = await nameObjects(env.ANTHROPIC_API_KEY, image, detections, polygons, vocabulary, deps);
    if (objects.length === 0) throw new Error('None of the objects could be named — try another picture');

    await huntDb.setPictureHuntReady(env.DB, huntId, title, objects);
    return 'ready';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Building the hunt failed';
    console.error('[picture-hunt] job failed:', huntId, message);
    await huntDb.setPictureHuntError(env.DB, huntId, message);
    return 'error';
  }
}
