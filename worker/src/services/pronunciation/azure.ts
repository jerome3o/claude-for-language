/**
 * Azure Speech Pronunciation Assessment (scripted, zh-CN) over the REST API for short audio.
 * https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short
 *
 * POST https://<region>.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
 *      ?language=zh-CN&format=detailed
 *   Ocp-Apim-Subscription-Key: AZURE_SPEECH_KEY (never logged)
 *   Content-Type: audio/wav; codecs=audio/pcm; samplerate=16000 | audio/ogg; codecs=opus
 *   Pronunciation-Assessment: base64(JSON { ReferenceText: <the card's hanzi>, GradingSystem:
 *     HundredMark, Granularity: Phoneme, Dimension: Comprehensive, EnableMiscue: True,
 *     PhonemeAlphabet: SAPI })
 * Audio ≤ 30 s for pronunciation assessment. The answer's NBest[0] carries AccuracyScore and
 * Words[] (Word, AccuracyScore, ErrorType None | Mispronunciation | Omission | Insertion), each
 * with Syllables[] (Syllable, Grapheme = the character for zh-CN, AccuracyScore) and Phonemes[]
 * (SAPI names; a zh-CN final carries its tone digit, e.g. "in 2"). Scores appear flat (REST) or
 * under `PronunciationAssessment` (SDK JSON) — both are read.
 *
 * Free tier (F0): 20 requests / minute and 5 audio hours / month — the queue consumer
 * (services/recording-checks.ts) paces calls and keeps a monthly budget.
 */
import type { CharErrorType, CharScore } from '@shared/recordings/queue';
import type { AzureAudio } from './audio-convert';

export const AZURE_PA_LANGUAGE = 'zh-CN';
export const AZURE_PA_MAX_MS = 30_000;

export interface AzureConfig {
  key: string;
  region: string;
}

export function azureConfig(env: { AZURE_SPEECH_KEY?: string; AZURE_SPEECH_REGION?: string }): AzureConfig | null {
  const key = (env.AZURE_SPEECH_KEY || '').trim();
  const region = (env.AZURE_SPEECH_REGION || '').trim();
  return key && region ? { key, region } : null;
}

export function azureSttEndpoint(region: string): string {
  return `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${AZURE_PA_LANGUAGE}&format=detailed`;
}

export function assessmentHeader(referenceText: string): string {
  const json = JSON.stringify({
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
    EnableMiscue: 'True',
    PhonemeAlphabet: 'SAPI',
  });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface PronunciationResult {
  /** 0–100 accuracy over the whole take (0 when nothing was recognised). */
  score: number;
  fluency: number | null;
  completeness: number | null;
  /** What Azure heard (biased to the reference — not used as the transcript). */
  recognized: string;
  char_scores: CharScore[];
  status: string;
}

export class AzureError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate_limited' | 'bad_audio' | 'server',
    message: string
  ) {
    super(message);
  }
}

type Scored = { AccuracyScore?: number; ErrorType?: string; FluencyScore?: number; CompletenessScore?: number };
interface AzPhoneme extends Scored { Phoneme?: string; Offset?: number; Duration?: number; PronunciationAssessment?: Scored }
interface AzSyllable extends Scored { Syllable?: string; Grapheme?: string; Offset?: number; Duration?: number; PronunciationAssessment?: Scored }
interface AzWord extends Scored { Word?: string; Syllables?: AzSyllable[]; Phonemes?: AzPhoneme[]; PronunciationAssessment?: Scored }
interface AzNBest extends Scored { Display?: string; Lexical?: string; Words?: AzWord[]; PronunciationAssessment?: Scored }
export interface AzureResponse { RecognitionStatus?: string; DisplayText?: string; NBest?: AzNBest[] }

const HAN = /[㐀-䶿一-鿿豈-﫿]/u;

function acc(x: { AccuracyScore?: number; PronunciationAssessment?: Scored } | undefined): number | null {
  const v = x?.PronunciationAssessment?.AccuracyScore ?? x?.AccuracyScore;
  return typeof v === 'number' && isFinite(v) ? v : null;
}
function errType(w: AzWord): CharErrorType {
  const e = w.PronunciationAssessment?.ErrorType ?? w.ErrorType;
  return e === 'Mispronunciation' || e === 'Omission' || e === 'Insertion' ? e : 'None';
}

/** Was the weakest phoneme inside this syllable its tone (SAPI final with a tone digit)? */
function toneSuspect(syl: AzSyllable | undefined, phonemes: AzPhoneme[]): boolean {
  if (!syl || !phonemes.length) return false;
  let inside = phonemes;
  if (typeof syl.Offset === 'number' && typeof syl.Duration === 'number') {
    const s = syl.Offset;
    const e = syl.Offset + syl.Duration;
    const within = phonemes.filter((p) => typeof p.Offset === 'number' && p.Offset >= s && p.Offset < e);
    if (within.length) inside = within;
    else return false;
  } else if (phonemes.length > 4) {
    return false; // can't tell which phonemes belong to this syllable
  }
  let worst: AzPhoneme | null = null;
  for (const p of inside) if (!worst || (acc(p) ?? 100) < (acc(worst) ?? 100)) worst = p;
  return !!worst && /[1-5]\s*$/.test(worst.Phoneme ?? '') && (acc(worst) ?? 100) < 100;
}

/** Azure's words → one score per reference character (in order). */
export function parseAzureResult(res: AzureResponse, reference: string): PronunciationResult {
  const status = res.RecognitionStatus ?? 'Unknown';
  const best = res.NBest?.[0];
  const refChars = Array.from(reference).filter((ch) => HAN.test(ch));
  if (status !== 'Success' || !best) {
    // Silence / nothing recognisable: every character counts as missed (conservative).
    return {
      score: 0,
      fluency: null,
      completeness: null,
      recognized: '',
      char_scores: refChars.map((char) => ({ char, score: null, error: 'Omission' as const })),
      status,
    };
  }
  const chars: CharScore[] = [];
  for (const w of best.Words ?? []) {
    const wordChars = Array.from(w.Word ?? '').filter((ch) => HAN.test(ch));
    const error = errType(w);
    const wordScore = error === 'Omission' ? null : acc(w);
    const syllables = w.Syllables ?? [];
    const phonemes = w.Phonemes ?? [];
    wordChars.forEach((char, i) => {
      const syl = syllables.find((s) => s.Grapheme === char) ?? (syllables.length === wordChars.length ? syllables[i] : undefined);
      const score = error === 'Omission' ? null : (acc(syl) ?? wordScore);
      const charErr: CharErrorType =
        error === 'Mispronunciation' && syl && acc(syl) != null && (acc(syl) as number) >= 90 ? 'None' : error;
      const cs: CharScore = { char, score: score == null ? null : Math.round(score * 10) / 10, error: charErr };
      if (charErr !== 'Omission' && charErr !== 'Insertion' && toneSuspect(syl, phonemes)) cs.tone_suspect = true;
      chars.push(cs);
    });
  }
  const top = (k: 'FluencyScore' | 'CompletenessScore') => {
    const v = best.PronunciationAssessment?.[k] ?? best[k];
    return typeof v === 'number' ? v : null;
  };
  return {
    score: Math.round((acc(best) ?? 0) * 10) / 10,
    fluency: top('FluencyScore'),
    completeness: top('CompletenessScore'),
    recognized: (best.Display ?? res.DisplayText ?? '').trim(),
    char_scores: chars,
    status,
  };
}

export async function assessPronunciation(
  cfg: AzureConfig,
  audio: AzureAudio,
  referenceText: string,
  fetcher: typeof fetch = fetch
): Promise<PronunciationResult> {
  let response: Response;
  try {
    response = await fetcher(azureSttEndpoint(cfg.region), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': cfg.key,
        'Content-Type': audio.contentType,
        Accept: 'application/json',
        'Pronunciation-Assessment': assessmentHeader(referenceText),
      },
      body: audio.body,
    });
  } catch (err) {
    throw new AzureError('server', `azure request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    const msg = `azure http ${response.status}${body ? ' ' + body : ''}`;
    if (response.status === 401 || response.status === 403) throw new AzureError('auth', msg);
    if (response.status === 429) throw new AzureError('rate_limited', msg);
    if (response.status === 400 || response.status === 415) throw new AzureError('bad_audio', msg);
    throw new AzureError('server', msg);
  }
  const json = (await response.json()) as AzureResponse;
  return parseAzureResult(json, referenceText);
}
