/**
 * The ＋ Add tab's model calls (docs/ADD_TAB.md; rules in shared/add/add.ts):
 *
 * - `readChineseFromPhoto`: a photo (a laptop screen during a video lesson, a sign, a menu) → the
 *   Chinese lines on it, most prominent first. ONE Gemini Flash vision call through
 *   `geminiGenerateContent` (the model list, least thinking, JSON out), ~1k input tokens for a
 *   1280px photo + ~100 out ≈ $0.001. The photo is never stored.
 * - `englishToChineseWords`: English (or toneless pinyin) → up to 4 Chinese words that say it, a cheap
 *   `structuredCall` (forced tool, thinking off, the small model).
 *
 * E2E_TEST_MODE: the stand-ins below are used FIRST, whatever keys are set.
 */
import { HAIKU_MODEL } from './models';
import { GEMINI_FLASH_MODELS, GeminiError, geminiGenerateContent, leastThinking, type FetchLike } from './gemini';
import { structuredCall } from './structured-call';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { OCR_MAX_LINES, cleanOcrBox, orderOcrLines, type OcrLine } from '@shared/add/add';

// ---------------- photo → Chinese lines ----------------

export const OCR_PROMPT = `Read the CHINESE text in this photo. It may be a phone photo of a laptop or TV screen (at an angle, with glare), a sign, a menu or a page, with lots of other things around it: browser tabs, buttons, English, people.

Return JSON: {"lines": [{"text": "…", "box_2d": [ymin, xmin, ymax, xmax], "main": true|false}]}
- One entry per line of Chinese text, exactly as written (simplified or traditional as shown). Do not translate, correct or complete it.
- Ignore text with no Chinese characters (English, numbers, UI labels, logos). Drop English words inside a Chinese line.
- box_2d: the line's box on a 0–1000 grid of the image.
- main: true for the ONE line the photo is most likely about — usually the biggest, most central Chinese text, such as a subtitle or a sign. false for the others.
- No Chinese at all: {"lines": []}.`;

interface GeminiTextResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class OcrError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** The model's answer → raw lines (anything unusable dropped; a bare array accepted too). */
export function parseOcrAnswer(text: string): OcrLine[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new OcrError('The photo could not be read', true);
    try {
      data = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new OcrError('The photo could not be read', true);
    }
  }
  const list = Array.isArray(data) ? data : (data as { lines?: unknown })?.lines;
  if (!Array.isArray(list)) return [];
  const out: OcrLine[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as { text?: unknown; box_2d?: unknown; box?: unknown; main?: unknown };
    if (typeof o.text !== 'string' || !o.text.trim()) continue;
    out.push({ text: o.text, box: cleanOcrBox(o.box_2d ?? o.box), main: o.main === true });
  }
  return out;
}

export interface OcrResult {
  lines: OcrLine[];
  model: string;
}

export async function readChineseFromPhoto(
  apiKey: string,
  image: Uint8Array,
  mime: string,
  opts: { fetch?: FetchLike } = {},
): Promise<OcrResult> {
  const { data, model } = await geminiGenerateContent<GeminiTextResponse>({
    apiKey,
    models: GEMINI_FLASH_MODELS,
    fetch: opts.fetch,
    label: 'add ocr',
    body: (m) => {
      const thinkingConfig = leastThinking(m);
      return {
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: toBase64(image) } }, { text: OCR_PROMPT }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 4000,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      };
    },
  }).catch((err) => {
    const status = err instanceof GeminiError ? err.status : 0;
    throw new OcrError(`Reading the photo failed${err instanceof Error && err.message ? ` (${err.message})` : ''}`, status === 0 || status === 429 || status >= 500);
  });
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return { lines: orderOcrLines(parseOcrAnswer(text), OCR_MAX_LINES), model };
}

/**
 * The E2E stand-in: a busy laptop-screen photo — a tab title, a button, the subtitle in the middle.
 * (The synthetic fixture e2e/fixtures/subtitle-photo.png renders the same scene.)
 */
export function fakeOcrLines(): OcrLine[] {
  return orderOcrLines([
    { text: '新标签页 - Google Chrome', box: [10, 20, 40, 320], main: false },
    { text: 'Share screen', box: [940, 420, 975, 580], main: false },
    { text: '太体面了', box: [690, 330, 790, 670], main: true },
    { text: '视频通话 · Video call', box: [50, 20, 80, 260], main: false },
  ]);
}

// ---------------- English → Chinese words ----------------

export interface ChineseCandidate {
  hanzi: string;
  pinyin: string;
  english: string;
  /** A few words on when to use this one rather than the others. */
  note?: string;
}

export const ENGLISH_WORDS_MAX = 4;
export const ENGLISH_INPUT_MAX = 120;

const ENGLISH_SYSTEM = `You help a learner of Mandarin Chinese find the Chinese word for something. They type or say an English word or short phrase (sometimes pinyin without tones). Give the Chinese words a native speaker would actually use for it, most common first: 1 to ${ENGLISH_WORDS_MAX} of them.
- hanzi: simplified characters, ONE clean form — no slashes, brackets or ellipses.
- pinyin: tone marks, spaces between words.
- english: the meaning in a few words.
- note: when the choice matters (formal vs spoken, a different sense) — at most 10 words; else empty.
Call give_words.`;

const ENGLISH_TOOL = {
  name: 'give_words',
  description: 'The Chinese words for what the learner asked, most common first.',
  input_schema: {
    type: 'object' as const,
    properties: {
      words: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hanzi: { type: 'string' },
            pinyin: { type: 'string' },
            english: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['hanzi', 'pinyin', 'english'],
        },
      },
    },
    required: ['words'],
  },
};

const BAD_HANZI = /[/\\()（）[\]【】|｜…_]|\.\.\./;

export function cleanCandidates(input: unknown): ChineseCandidate[] {
  const list = (input as { words?: unknown })?.words;
  if (!Array.isArray(list)) throw new Error('No words');
  const out: ChineseCandidate[] = [];
  const seen = new Set<string>();
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const o = w as Record<string, unknown>;
    const hanzi = typeof o.hanzi === 'string' ? o.hanzi.trim() : '';
    if (!hanzi || BAD_HANZI.test(hanzi) || !/\p{Script=Han}/u.test(hanzi) || seen.has(hanzi)) continue;
    seen.add(hanzi);
    const pinyin = typeof o.pinyin === 'string' ? applyYiBuToneChanges(hanzi, o.pinyin.trim()) : '';
    const english = typeof o.english === 'string' ? o.english.trim().slice(0, 80) : '';
    const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 80) : undefined;
    out.push({ hanzi, pinyin, english, ...(note ? { note } : {}) });
    if (out.length >= ENGLISH_WORDS_MAX) break;
  }
  if (out.length === 0) throw new Error('No usable words');
  return out;
}

export async function englishToChineseWords(apiKey: string, text: string): Promise<ChineseCandidate[]> {
  return structuredCall<ChineseCandidate[]>({
    apiKey,
    model: HAIKU_MODEL,
    fallbackModel: null,
    attempts: 2,
    timeoutMs: 15_000,
    system: ENGLISH_SYSTEM,
    user: text.slice(0, ENGLISH_INPUT_MAX),
    tool: ENGLISH_TOOL,
    maxTokens: 600,
    validate: cleanCandidates,
  });
}

/** The E2E stand-in: a few known lookups, else one generic word. */
export function fakeEnglishWords(text: string): ChineseCandidate[] {
  const t = text.trim().toLowerCase();
  if (t.includes('bank')) return [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank' }];
  if (t.includes('decent') || t.includes('dignified')) {
    return [
      { hanzi: '体面', pinyin: 'tǐmiàn', english: 'dignified; decent', note: 'about looks / reputation' },
      { hanzi: '像样', pinyin: 'xiàngyàng', english: 'presentable', note: 'spoken' },
    ];
  }
  return [{ hanzi: '东西', pinyin: 'dōngxi', english: 'thing' }];
}
