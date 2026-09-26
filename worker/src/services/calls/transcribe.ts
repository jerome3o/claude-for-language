/**
 * Speech-to-text for call recordings. Each piece is one speaker's microphone
 * (≤ 5 minutes of webm/opus), so no diarization is needed; the hard part is
 * code-switching — Mandarin and English mixed inside one sentence.
 *
 * Providers (see docs/VIDEO_CALLS.md for the comparison):
 * - gemini  — Gemini Flash with audio input. Handles zh/en code-switching
 *             well, and returns pinyin + an English translation per line in
 *             the same call. Uses the GEMINI_API_KEY the app already has.
 * - soniox  — Soniox async (stt-async-v5): built for code-switching, token
 *             timestamps + per-token language, ~$0.10/audio hour. Needs a
 *             SONIOX_API_KEY; preferred when one is set. No pinyin /
 *             translation (the review page adds pinyin on the device).
 * - whisper — Workers AI whisper-large-v3-turbo. No key at all, but it
 *             tends to pick ONE language per window (drops or translates the
 *             English inside a Chinese sentence). The fallback.
 *
 * CALL_TRANSCRIBE_PROVIDER forces one; otherwise the best configured wins
 * (soniox → gemini → whisper). A failing provider falls back to Whisper so a
 * lesson is never left without a transcript.
 */

import { parseTimestamp } from '@shared/calls';
import { bytesToBase64 } from '../audio';
import type { Env } from '../../types';
import { baseMime } from './recording';

export type TranscriberId = 'soniox' | 'gemini' | 'whisper';

export interface RawSegment {
  /** Seconds from the start of the piece. */
  start: number;
  end: number;
  text: string;
  language?: string | null;
  pinyin?: string | null;
  translation?: string | null;
}

export interface TranscribeResult {
  provider: TranscriberId;
  segments: RawSegment[];
}

export function pickTranscriber(env: Pick<Env, 'CALL_TRANSCRIBE_PROVIDER' | 'GEMINI_API_KEY' | 'SONIOX_API_KEY'>): TranscriberId {
  const forced = (env.CALL_TRANSCRIBE_PROVIDER || '').trim().toLowerCase();
  if (forced === 'whisper') return 'whisper';
  if (forced === 'gemini' && env.GEMINI_API_KEY) return 'gemini';
  if (forced === 'soniox' && env.SONIOX_API_KEY) return 'soniox';
  if (env.SONIOX_API_KEY) return 'soniox';
  return env.GEMINI_API_KEY ? 'gemini' : 'whisper';
}

export async function transcribeAudio(env: Env, provider: TranscriberId, bytes: Uint8Array, mime: string): Promise<TranscribeResult> {
  if (bytes.byteLength === 0) return { provider, segments: [] };
  if (provider === 'whisper') return { provider, segments: await transcribeWithWhisper(env, bytes) };
  try {
    const segments = provider === 'soniox'
      ? await transcribeWithSoniox(env.SONIOX_API_KEY!, bytes, mime)
      : await transcribeWithGemini(env.GEMINI_API_KEY, bytes, mime, env.CALL_GEMINI_MODEL);
    return { provider, segments };
  } catch (err) {
    // An outage or a bad key shouldn't lose the lesson: fall back to Whisper.
    console.error(`[calls] ${provider} transcription failed, falling back to Whisper:`, err);
    return { provider: 'whisper', segments: await transcribeWithWhisper(env, bytes) };
  }
}

// ---------------------------------------------------------------- Gemini

export const GEMINI_TRANSCRIBE_MODEL = 'gemini-2.5-flash';

const GEMINI_PROMPT = `Transcribe this recording of ONE person speaking in a Mandarin Chinese lesson (a tutor or a learner on a video call).

The speech mixes Mandarin and English, often inside one sentence ("我想 order 一个 coffee"). Transcribe EXACTLY what is said, in the language it is said in:
- Chinese in simplified characters (never pinyin, never translated to English).
- English words in English (never translated to Chinese).
- Keep the learner's mistakes as spoken — do not correct grammar or tones.
- Skip silence, background noise and filler-only sounds. If nothing intelligible is said, return an empty list.

Split into short segments at natural pauses (one sentence or clause each, usually 2–10 seconds). For each segment give:
- start, end: time from the start of the recording as "MM:SS" (or "MM:SS.s")
- text: the transcription
- language: "zh", "en" or "mixed"
- pinyin: tone-marked pinyin of the Chinese parts only (empty string when the segment has no Chinese)
- translation: a natural English translation of the whole segment (empty string when it is already all English)`;

const GEMINI_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      start: { type: 'STRING' },
      end: { type: 'STRING' },
      text: { type: 'STRING' },
      language: { type: 'STRING', enum: ['zh', 'en', 'mixed'] },
      pinyin: { type: 'STRING' },
      translation: { type: 'STRING' },
    },
    required: ['start', 'end', 'text', 'language'],
    propertyOrdering: ['start', 'end', 'text', 'language', 'pinyin', 'translation'],
  },
};

/** Gemini is picky about audio mime types; MediaRecorder's webm/opus goes as audio/webm, Safari's mp4 as audio/mp4. */
function geminiMime(mime: string): string {
  const base = baseMime(mime);
  return base === 'audio/mp4' ? 'audio/mp4' : base === 'audio/ogg' ? 'audio/ogg' : base === 'audio/wav' ? 'audio/wav' : base === 'audio/mpeg' ? 'audio/mp3' : 'audio/webm';
}

export async function transcribeWithGemini(apiKey: string, bytes: Uint8Array, mime: string, model = GEMINI_TRANSCRIBE_MODEL): Promise<RawSegment[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_TRANSCRIBE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: geminiMime(mime), data: bytesToBase64(bytes) } }, { text: GEMINI_PROMPT }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
        // Transcription needs no deliberation; thinking only adds latency and cost.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return parseGeminiSegments(text);
}

/** Parse Gemini's JSON reply into segments; tolerant of a code fence and of bad rows. */
export function parseGeminiSegments(text: string): RawSegment[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  if (!cleaned) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(cleaned);
  } catch {
    throw new Error('Gemini returned unreadable JSON');
  }
  if (!Array.isArray(rows)) return [];
  const out: RawSegment[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const t = typeof r?.text === 'string' ? r.text.trim() : '';
    const start = parseTimestamp(r?.start);
    if (!t || start === null) continue;
    const endRaw = parseTimestamp(r?.end);
    const end = endRaw !== null && endRaw >= start ? endRaw : start + 2;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    out.push({ start, end, text: t, language: str(r.language), pinyin: str(r.pinyin), translation: str(r.translation) });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- Whisper (Workers AI)

export async function transcribeWithWhisper(env: Pick<Env, 'AI'>, bytes: Uint8Array): Promise<RawSegment[]> {
  const result = (await env.AI.run('@cf/openai/whisper-large-v3-turbo' as any, {
    audio: bytesToBase64(bytes),
    // No fixed language: forcing 'zh' turns the English parts into Chinese.
    // The prompt (in simplified characters) nudges it toward simplified
    // output and mixed speech. VAD matters: one person's track is mostly
    // silence while the other talks, and Whisper hallucinates on silence.
    initial_prompt: '以下是普通话和English混合的中文课，用简体字。',
    vad_filter: true,
    condition_on_previous_text: false,
  })) as { text?: string; segments?: Array<{ start?: number; end?: number; text?: string }> };
  return parseWhisperSegments(result);
}

export function parseWhisperSegments(result: { text?: string; segments?: Array<{ start?: number; end?: number; text?: string }> }): RawSegment[] {
  const segs = (result.segments ?? [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || Number(s.start) || 0, text: (s.text || '').trim() }))
    .filter((s) => s.text);
  if (segs.length === 0 && result.text?.trim()) return [{ start: 0, end: 0, text: result.text.trim() }];
  return segs;
}

// ---------------------------------------------------------------- Soniox (async)

const SONIOX_API = 'https://api.soniox.com/v1';
export const SONIOX_MODEL = 'stt-async-v5';

interface SonioxToken {
  text: string;
  start_ms: number;
  end_ms: number;
  language?: string;
}

async function sonioxFetch<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SONIOX_API}${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Soniox ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function transcribeWithSoniox(apiKey: string, bytes: Uint8Array, mime: string): Promise<RawSegment[]> {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: baseMime(mime) }), 'piece.webm');
  const file = await sonioxFetch<{ id: string }>(apiKey, '/files', { method: 'POST', body: form });
  let transcriptionId: string | null = null;
  try {
    const job = await sonioxFetch<{ id: string }>(apiKey, '/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: SONIOX_MODEL, file_id: file.id, language_hints: ['zh', 'en'], enable_language_identification: true }),
    });
    transcriptionId = job.id;
    // A 5-minute piece usually finishes in seconds; give up after ~4 minutes.
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, i < 10 ? 1000 : 3000));
      const status = await sonioxFetch<{ status: string; error_message?: string }>(apiKey, `/transcriptions/${job.id}`);
      if (status.status === 'completed') break;
      if (status.status === 'error') throw new Error(`Soniox: ${status.error_message || 'transcription failed'}`);
      if (i === 79) throw new Error('Soniox: timed out');
    }
    const transcript = await sonioxFetch<{ tokens?: SonioxToken[] }>(apiKey, `/transcriptions/${job.id}/transcript`);
    return sonioxTokensToSegments(transcript.tokens ?? []);
  } finally {
    // Soniox keeps files for 30 days and caps stored transcriptions; clean up.
    if (transcriptionId) await sonioxFetch(apiKey, `/transcriptions/${transcriptionId}`, { method: 'DELETE' }).catch(() => {});
    await sonioxFetch(apiKey, `/files/${file.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

/** Soniox returns sub-word tokens; cut them into segments at pauses and sentence ends. */
export function sonioxTokensToSegments(tokens: readonly SonioxToken[], pauseMs = 800): RawSegment[] {
  const out: RawSegment[] = [];
  let cur: { start: number; end: number; text: string; langs: Set<string> } | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) {
      const langs = [...cur.langs];
      out.push({
        start: cur.start / 1000,
        end: cur.end / 1000,
        text: cur.text.trim(),
        language: langs.length > 1 ? 'mixed' : langs[0] ?? null,
      });
    }
    cur = null;
  };
  for (const t of tokens) {
    if (typeof t?.text !== 'string' || !Number.isFinite(t.start_ms)) continue;
    if (cur && t.start_ms - cur.end > pauseMs) flush();
    if (!cur) cur = { start: t.start_ms, end: t.end_ms, text: '', langs: new Set() };
    cur.text += t.text;
    cur.end = Math.max(cur.end, t.end_ms);
    if (t.language && t.text.trim()) cur.langs.add(t.language);
    if (/[。？！?!.]\s*$/.test(t.text) && cur.end - cur.start > 1500) flush();
  }
  flush();
  return out;
}
