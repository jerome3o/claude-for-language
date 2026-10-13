/**
 * One podcast episode from its RSS enclosure to listenable segments (docs/PODCASTS.md), run on
 * audio-lesson-queue (message `{ kind: 'podcast_episode', episodeId }`) in resumable stages —
 * the row is the checkpoint, every delivery does what is left and re-enqueues itself:
 *
 * 1. downloading  — the enclosure is streamed into R2 (`podcast-episodes/<id>.<ext>`, a multipart
 *                   upload, never held in memory) through the safe fetcher (public hosts only,
 *                   every redirect checked), at most MAX_AUDIO_BYTES. The app plays THIS copy.
 * 2. transcribing — a Soniox async transcription (stt-async-v5, zh + en hints, speaker
 *                   diarization) of a signed link to that copy; polled every ~20 s.
 * 3. translating  — timed tokens → segments (segments.ts, pinyin on the way), then the English
 *                   TRANSLATE_BATCH segments a call, written after every batch.
 *
 * A stage that fails is retried (with a delay) up to MAX_ATTEMPTS times, then the episode is
 * `failed` with a readable error; Retry starts the failed stage again. One transcription per
 * episode, shared by everyone who asks.
 */
import type { Env } from '../../types';
import { assembleMp3 } from '../audio-lessons/mp3';
import { SONIOX_MODEL } from '../calls/transcribe';
import { trackServer } from '../analytics/server-events';
import { safeFetch, FeedError, type Fetcher } from './rss';
import { tokensToSegments, untranslated, withPinyin, type PodcastSegment, type SttToken } from './segments';
import { sourceUrl } from './source-url';
import { audioKeyFor, getEpisode, parseSegments, updateEpisode, type EpisodeRow } from './store';
import { anthropicSegmentTranslate, fakeSegmentTranslate, TRANSLATE_BATCH, translateCostUsd, type SegmentTranslate } from './translate';

export interface PodcastEpisodeMessage {
  kind: 'podcast_episode';
  episodeId: string;
}

/** The biggest episode file copied (≈ 3 h of 128 kbps MP3; most are far smaller). */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
/** Longest episode transcribed. */
export const MAX_EPISODE_MINUTES = 150;
export const MAX_ATTEMPTS = 3;
/** Wall clock per delivery before the job re-enqueues itself. */
export const SOFT_DEADLINE_MS = 4 * 60 * 1000;
/** Give up on a Soniox transcription that hasn't finished after this long. */
const STT_TIMEOUT_MS = 60 * 60 * 1000;
const STT_POLL_S = 20;
/** R2 multipart part size (all parts but the last must be the same size). */
const PART_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export type PodcastJobOutcome = 'done' | 'continue' | 'waiting' | 'failed' | 'skipped';

/** What the job needs from a transcription service (Soniox async; a fake in tests). */
export interface SttClient {
  create(audioUrl: string, episodeId: string): Promise<string>;
  status(id: string): Promise<{ status: 'queued' | 'processing' | 'completed' | 'error'; error?: string | null; audio_duration_ms?: number | null }>;
  transcript(id: string): Promise<SttToken[]>;
  remove(id: string): Promise<void>;
}

export interface PodcastJobDeps {
  fetch?: Fetcher;
  stt?: SttClient | null;
  translate?: SegmentTranslate;
  requeue?: (msg: PodcastEpisodeMessage, delaySeconds: number) => Promise<void>;
  now?: () => number;
}

const SONIOX_API = 'https://api.soniox.com/v1';

/** The Soniox async client on the permanent key (never sent anywhere but Soniox). */
export function sonioxClient(apiKey: string, fetcher: Fetcher = fetch): SttClient {
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetcher(`${SONIOX_API}${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`Soniox ${path.split('/').slice(0, 2).join('/')}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  };
  return {
    async create(audioUrl, episodeId) {
      const job = await call<{ id: string }>('/transcriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: SONIOX_MODEL,
          audio_url: audioUrl,
          language_hints: ['zh', 'en'],
          enable_language_identification: true,
          enable_speaker_diarization: true,
          client_reference_id: episodeId,
        }),
      });
      return job.id;
    },
    async status(id) {
      const s = await call<{ status: string; error_message?: string | null; audio_duration_ms?: number | null }>(`/transcriptions/${id}`);
      const status = s.status === 'completed' || s.status === 'error' || s.status === 'queued' ? s.status : 'processing';
      return { status, error: s.error_message ?? null, audio_duration_ms: s.audio_duration_ms ?? null };
    },
    async transcript(id) {
      const t = await call<{ tokens?: SttToken[] }>(`/transcriptions/${id}/transcript`);
      return t.tokens ?? [];
    },
    async remove(id) {
      await call(`/transcriptions/${id}`, { method: 'DELETE' }).catch(() => {});
    },
  };
}

export function isFakeMode(env: Pick<Env, 'E2E_TEST_MODE'>): boolean {
  return env.E2E_TEST_MODE === 'true';
}

/** Can episodes be transcribed on this deployment? (The app hides / disables the button otherwise.) */
export function transcriptionAvailable(env: Pick<Env, 'SONIOX_API_KEY' | 'E2E_TEST_MODE'>): boolean {
  return isFakeMode(env) || !!(env.SONIOX_API_KEY || '').trim();
}

/** E2E_TEST_MODE: the transcript every fake episode gets (4 s a line over 30 s of silence). */
export const FAKE_LINES = [
  '你好，欢迎收听今天的节目。',
  '今天我们聊一聊周末去哪儿玩。',
  '我比较喜欢去公园散步。',
  '你呢？你周末一般做什么？',
  '我常常在家看书，有时候去咖啡馆。',
  '好的，今天的节目就到这里，下次见！',
];

export function fakeTokens(): SttToken[] {
  const out: SttToken[] = [];
  FAKE_LINES.forEach((line, n) => {
    const chars = [...line];
    const start = 500 + n * 4800;
    const step = Math.floor(3800 / chars.length);
    chars.forEach((ch, k) => out.push({ text: ch, start_ms: start + k * step, end_ms: start + (k + 1) * step, speaker: String((n % 2) + 1) }));
  });
  return out;
}

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 300) || 'unknown error';
}

/** Stream the enclosure into R2 without holding it in memory. Throws a FeedError with a readable reason. */
export async function copyEnclosureToR2(
  bucket: R2Bucket,
  row: Pick<EpisodeRow, 'id' | 'enclosure_url'>,
  fetcher: Fetcher,
  now: () => number = Date.now,
): Promise<{ key: string; bytes: number; mime: string }> {
  const { res } = await safeFetch(row.enclosure_url, fetcher, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChineseLearningPodcasts/1.0)', Accept: 'audio/*, */*;q=0.5' } }, 60_000);
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new FeedError(`The episode's audio couldn't be downloaded (HTTP ${res.status})`);
  }
  const declared = Number(res.headers.get('Content-Length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    await res.body.cancel().catch(() => {});
    throw new FeedError(`This episode is too big to transcribe (${Math.round(declared / 1048576)} MB; the limit is ${MAX_AUDIO_BYTES / 1048576} MB)`, 400);
  }
  const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (/^(text\/html|application\/json|text\/plain)/.test(type)) {
    await res.body.cancel().catch(() => {});
    throw new FeedError("The episode's link doesn't lead to an audio file", 400);
  }
  const mime = type.startsWith('audio/') ? type : 'audio/mpeg';
  const key = audioKeyFor(row.id, mime);
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: mime } });
  const parts: R2UploadedPart[] = [];
  const reader = res.body.getReader();
  const started = now();
  let buffered: Uint8Array[] = [];
  let bufferedBytes = 0;
  let total = 0;
  const take = (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const head = buffered[0];
      const want = n - off;
      if (head.byteLength <= want) {
        out.set(head, off);
        off += head.byteLength;
        buffered.shift();
      } else {
        out.set(head.subarray(0, want), off);
        buffered[0] = head.subarray(want);
        off += want;
      }
    }
    bufferedBytes -= n;
    return out;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) throw new FeedError(`This episode is too big to transcribe (over ${MAX_AUDIO_BYTES / 1048576} MB)`, 400);
      if (now() - started > DOWNLOAD_TIMEOUT_MS) throw new FeedError('The episode took too long to download');
      buffered.push(value);
      bufferedBytes += value.byteLength;
      while (bufferedBytes >= PART_BYTES) parts.push(await upload.uploadPart(parts.length + 1, take(PART_BYTES)));
    }
    if (total === 0) throw new FeedError("The episode's audio file is empty");
    if (bufferedBytes > 0) parts.push(await upload.uploadPart(parts.length + 1, take(bufferedBytes)));
    await upload.complete(parts);
    return { key, bytes: total, mime };
  } catch (err) {
    await reader.cancel().catch(() => {});
    await upload.abort().catch(() => {});
    buffered = [];
    throw err;
  }
}

/** Run what is left of one episode's transcription. Never throws for a job failure (written to the row). */
export async function runPodcastEpisodeJob(env: Env, episodeId: string, deps: PodcastJobDeps = {}): Promise<PodcastJobOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const fake = isFakeMode(env) && deps.stt === undefined;
  const requeue = deps.requeue ?? (async (msg, delaySeconds) => {
    await env.AUDIO_LESSON_QUEUE.send(msg as never, delaySeconds > 0 ? { delaySeconds } : undefined);
  });
  const again = async (delaySeconds: number): Promise<PodcastJobOutcome> => {
    await requeue({ kind: 'podcast_episode', episodeId }, delaySeconds);
    return delaySeconds > 0 ? 'waiting' : 'continue';
  };
  let row = await getEpisode(env.DB, episodeId);
  if (!row || row.status === 'ready' || row.status === 'failed') return 'skipped';

  const fail = async (stage: string, err: unknown, permanent = false): Promise<PodcastJobOutcome> => {
    const attempts = (row!.attempts ?? 0) + 1;
    const reason = message(err);
    console.error(`[podcasts] ${stage} failed for ${episodeId} (attempt ${attempts}):`, reason);
    if (permanent || attempts >= MAX_ATTEMPTS) {
      await updateEpisode(env.DB, episodeId, { status: 'failed', error: reason, attempts, progress: null });
      void trackServer('server.podcast_transcribed', { ok: false, stage, minutes: 0, segments: 0 }, { env, userId: row!.requested_by });
      return 'failed';
    }
    await updateEpisode(env.DB, episodeId, { attempts, error: reason });
    return again(60 * attempts);
  };

  // ---- 1. download
  if (row.status === 'queued' || row.status === 'downloading' || !row.audio_key) {
    await updateEpisode(env.DB, episodeId, { status: 'downloading', progress: 'Downloading the audio…' });
    try {
      if (fake) {
        const silence = assembleMp3([{ kind: 'silence', ms: 30_000 }]);
        const key = audioKeyFor(episodeId, 'audio/mpeg');
        await env.AUDIO_BUCKET.put(key, silence.bytes, { httpMetadata: { contentType: 'audio/mpeg' } });
        await updateEpisode(env.DB, episodeId, { audio_key: key, audio_bytes: silence.bytes.byteLength, audio_mime: 'audio/mpeg', status: 'transcribing', attempts: 0, error: null, progress: 'Transcribing…' });
      } else {
        const out = await copyEnclosureToR2(env.AUDIO_BUCKET, row, deps.fetch ?? fetch, now);
        await updateEpisode(env.DB, episodeId, { audio_key: out.key, audio_bytes: out.bytes, audio_mime: out.mime, status: 'transcribing', attempts: 0, error: null, progress: 'Transcribing…' });
      }
    } catch (err) {
      return fail('download', err, err instanceof FeedError && err.status === 400);
    }
    row = (await getEpisode(env.DB, episodeId))!;
  }

  // ---- 2. transcribe
  if (row.status === 'transcribing') {
    let tokens: SttToken[] | null = null;
    let durationMs = row.duration_ms;
    if (fake) {
      tokens = fakeTokens();
    } else {
      const stt = deps.stt ?? ((env.SONIOX_API_KEY || '').trim() ? sonioxClient(env.SONIOX_API_KEY!.trim(), deps.fetch ?? fetch) : null);
      if (!stt) return fail('transcribe', new Error('Transcription is not configured on the server'), true);
      try {
        if (!row.stt_job_id) {
          const origin = (env.PUBLIC_API_URL || row.api_origin || '').trim();
          if (!origin) return fail('transcribe', new Error('No public origin for the audio link'), true);
          const id = await stt.create(await sourceUrl(env.SESSION_SECRET, origin, episodeId, now()), episodeId);
          await updateEpisode(env.DB, episodeId, { stt_job_id: id, stt_started_at: new Date(now()).toISOString(), provider: 'soniox' });
          return again(STT_POLL_S);
        }
        const s = await stt.status(row.stt_job_id);
        if (s.status === 'error') {
          await stt.remove(row.stt_job_id);
          await updateEpisode(env.DB, episodeId, { stt_job_id: null });
          return fail('transcribe', new Error(`Transcription failed: ${s.error || 'unknown error'}`));
        }
        if (s.status !== 'completed') {
          if (now() - Date.parse(row.stt_started_at ?? '') > STT_TIMEOUT_MS) {
            await stt.remove(row.stt_job_id);
            await updateEpisode(env.DB, episodeId, { stt_job_id: null });
            return fail('transcribe', new Error('Transcription timed out'));
          }
          // Touch the row so the stale-job sweep (routes/podcasts.ts) sees the job is alive.
          await updateEpisode(env.DB, episodeId, { progress: s.status === 'queued' ? 'Waiting for the transcriber…' : 'Transcribing…' });
          return again(STT_POLL_S);
        }
        if (s.audio_duration_ms) durationMs = s.audio_duration_ms;
        tokens = await stt.transcript(row.stt_job_id);
        await stt.remove(row.stt_job_id);
      } catch (err) {
        return fail('transcribe', err);
      }
    }
    const segments = withPinyin(tokensToSegments(tokens));
    if (!segments.length) return fail('transcribe', new Error('No speech was found in this episode'), true);
    const lastEnd = segments[segments.length - 1].end_ms;
    await updateEpisode(env.DB, episodeId, {
      status: 'translating',
      stt_job_id: null,
      segments_json: JSON.stringify(segments),
      duration_ms: durationMs ?? (fake ? 30_000 : lastEnd),
      attempts: 0,
      error: null,
      progress: 'Translating…',
      progress_done: segments.length - untranslated(segments).length,
      progress_total: segments.length,
    });
    row = (await getEpisode(env.DB, episodeId))!;
  }

  // ---- 3. translate
  if (row.status === 'translating') {
    const translate = deps.translate ?? (fake ? fakeSegmentTranslate() : env.ANTHROPIC_API_KEY ? anthropicSegmentTranslate(env.ANTHROPIC_API_KEY) : null);
    const segments = parseSegments(row.segments_json);
    const usage = parseUsage(row.usage_json);
    if (!translate) {
      // No Claude key: the transcript is still useful (hanzi + pinyin), the English stays empty.
      return finish(env, row, segments, usage, now);
    }
    while (untranslated(segments).length) {
      if (now() - started > SOFT_DEADLINE_MS) return again(0);
      const todo = untranslated(segments).slice(0, TRANSLATE_BATCH);
      const first = todo[0];
      try {
        const out = await translate({
          segments: todo.map((i) => ({ i, text: segments[i].text, speaker: segments[i].speaker })),
          before: segments.slice(Math.max(0, first - 3), first).map((s) => s.text),
          podcastTitle: row.podcast_title,
          episodeTitle: row.title,
        });
        for (const it of out.items) if (segments[it.i]) segments[it.i].english = it.english;
        if (out.usage) {
          usage.input_tokens += out.usage.input_tokens;
          usage.output_tokens += out.usage.output_tokens;
        }
      } catch (err) {
        await updateEpisode(env.DB, episodeId, { segments_json: JSON.stringify(segments), usage_json: JSON.stringify(usage) });
        return fail('translate', err);
      }
      const done = segments.length - untranslated(segments).length;
      await updateEpisode(env.DB, episodeId, {
        segments_json: JSON.stringify(segments),
        usage_json: JSON.stringify(usage),
        progress: `Translating ${done} / ${segments.length}`,
        progress_done: done,
        progress_total: segments.length,
        attempts: 0,
        error: null,
      });
    }
    return finish(env, row, segments, usage, now);
  }
  return 'skipped';
}

function parseUsage(raw: string | null): { input_tokens: number; output_tokens: number } {
  try {
    const u = raw ? (JSON.parse(raw) as { input_tokens?: number; output_tokens?: number }) : {};
    return { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 };
  } catch {
    return { input_tokens: 0, output_tokens: 0 };
  }
}

async function finish(env: Env, row: EpisodeRow, segments: PodcastSegment[], usage: { input_tokens: number; output_tokens: number }, now: () => number): Promise<PodcastJobOutcome> {
  await updateEpisode(env.DB, row.id, {
    status: 'ready',
    progress: null,
    progress_done: segments.length,
    progress_total: segments.length,
    error: null,
    segments_json: JSON.stringify(segments),
    usage_json: JSON.stringify({ ...usage, cost_usd: Number(translateCostUsd(usage).toFixed(4)) }),
    finished_at: new Date(now()).toISOString(),
  });
  const minutes = Math.round((row.duration_ms ?? segments[segments.length - 1]?.end_ms ?? 0) / 60000);
  void trackServer('server.podcast_transcribed', { ok: true, stage: 'done', minutes, segments: segments.length }, { env, userId: row.requested_by });
  return 'done';
}

/** Retry a failed transcription from the stage it failed in. */
export async function resetFailedEpisode(db: D1Database, row: EpisodeRow): Promise<void> {
  const status = !row.audio_key ? 'queued' : row.segments_json ? 'translating' : 'transcribing';
  await updateEpisode(db, row.id, { status, error: null, attempts: 0, stt_job_id: null, progress: 'Waiting to start…' });
}
