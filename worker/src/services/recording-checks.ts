/**
 * The background check of a pronunciation recording, for the tutor's "Needs your ear" queue
 * (shared/recordings/queue.ts decides membership; GET /api/relationships/:relId/recordings/queue).
 *
 * When a take is uploaded (POST /api/audio/upload) — or when the tutor opens the queue and a
 * recording in range has no check yet — a `recording_checks` row is written and the event id is
 * sent to `recording-check-queue`. The consumer:
 *   1. transcribes the take (transcribeTake: Whisper → Soniox async → Gemini) and compares it with
 *      the card (shared/recordings/transcript.ts — the same rule as the study card's ✅ / ❌);
 *   2. scores it with Azure Pronunciation Assessment (services/pronunciation/azure.ts) after
 *      remuxing it into a format Azure takes (pronunciation/audio-convert.ts).
 * Both steps are best-effort: unconfigured, over budget, unsupported audio → the row says why
 * (`score_note`) and the queue still works from the transcript, the rating and flags. Study is
 * never blocked: nothing here runs in a request the learner waits on.
 *
 * Azure F0 (free) limits: 20 requests / minute, 5 audio hours / month. We stay under both:
 * AZURE_REQUESTS_PER_MINUTE counts rows scored in the last minute (a row is stamped `scoring`
 * BEFORE the call, so parallel consumers see it), AZURE_MONTHLY_BUDGET_MS sums `audio_ms` this
 * UTC month. Over the minute → the message is retried later; over the month → scored no more
 * until the 1st (`score_note: 'over_budget'`).
 */
import type { Env } from '../types';
import { trackServer } from './analytics/server-events';
import { transcriptMatches } from '@shared/recordings/transcript';
import { takeProviders, transcribeTake, describeProviderError, type TakeTranscription } from './take-transcription';
import { toAzureAudio, sniffAudio, type AzureAudio } from './pronunciation/audio-convert';
import {
  assessPronunciation,
  azureConfig,
  AzureError,
  AZURE_PA_MAX_MS,
  type AzureConfig,
  type PronunciationResult,
} from './pronunciation/azure';

export interface RecordingCheckMessage {
  eventId: string;
}

/** Stay a little under F0's 20 / minute. */
export const AZURE_REQUESTS_PER_MINUTE = 18;
/** F0 gives 5 audio hours a month; keep half an hour in reserve. */
export const AZURE_MONTHLY_BUDGET_MS = 4.5 * 60 * 60 * 1000;
/** Transient failures (network, 5xx) before a check gives up. */
export const MAX_CHECK_ATTEMPTS = 4;
/** Opening the queue starts at most this many missing checks. */
export const LAZY_CHECKS_PER_VIEW = 30;

export class RetryLater extends Error {
  constructor(readonly delaySeconds: number, message: string) {
    super(message);
  }
}

export interface CheckDeps {
  transcribe?: (bytes: Uint8Array, mime: string) => Promise<TakeTranscription>;
  assess?: (cfg: AzureConfig, audio: AzureAudio, reference: string) => Promise<PronunciationResult>;
  now?: () => Date;
}

const MIME: Record<string, string> = { webm: 'audio/webm', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'audio/mp4', unknown: 'audio/webm' };

/** Write the pending row (idempotent) and queue the check. Never throws. */
export async function enqueueRecordingCheck(env: Env, eventId: string, userId: string): Promise<void> {
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO recording_checks (review_event_id, user_id, status) VALUES (?, ?, 'pending')`
    )
      .bind(eventId, userId)
      .run();
    const fresh = (res.meta?.changes ?? 0) > 0;
    if (!fresh) {
      // A re-upload (new take for the same review): check again from scratch.
      await env.DB.prepare(
        `UPDATE recording_checks SET status = 'pending', attempts = 0, transcript = NULL, transcript_provider = NULL,
           transcript_match = NULL, score = NULL, fluency = NULL, completeness = NULL, char_scores = NULL,
           score_note = NULL, error = NULL, updated_at = datetime('now')
         WHERE review_event_id = ? AND status != 'scoring'`
      )
        .bind(eventId)
        .run();
    }
    if (env.RECORDING_CHECK_QUEUE && !env.E2E_TEST_MODE) await env.RECORDING_CHECK_QUEUE.send({ eventId });
  } catch (err) {
    console.error('[recording-check] enqueue failed', eventId, describeProviderError(err));
  }
}

/** Recordings of this student in the range that were never checked → queue them (capped). */
export async function enqueueMissingChecks(env: Env, studentId: string, from: string, to: string): Promise<number> {
  const res = await env.DB.prepare(
    `SELECT re.id FROM review_events re
     LEFT JOIN recording_checks rc ON rc.review_event_id = re.id
     WHERE re.user_id = ? AND re.reviewed_at >= ? AND re.reviewed_at <= ? AND re.recording_url IS NOT NULL
       AND rc.review_event_id IS NULL
     ORDER BY re.reviewed_at DESC LIMIT ?`
  )
    .bind(studentId, from, to, LAZY_CHECKS_PER_VIEW)
    .all<{ id: string }>();
  const ids = (res.results ?? []).map((r) => r.id);
  for (const id of ids) await enqueueRecordingCheck(env, id, studentId);
  return ids.length;
}

interface EventRow {
  user_id: string;
  recording_url: string | null;
  hanzi: string;
}

interface CheckRow {
  status: string;
  attempts: number;
  transcript: string | null;
  transcript_provider: string | null;
  score: number | null;
  score_note: string | null;
}

function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type CheckOutcome = 'gone' | 'done' | 'already_done' | 'failed';

export async function runRecordingCheck(env: Env, eventId: string, deps: CheckDeps = {}): Promise<CheckOutcome> {
  const now = deps.now ?? (() => new Date());
  const db = env.DB;
  const ev = await db
    .prepare(
      `SELECT re.user_id, re.recording_url, n.hanzi FROM review_events re
       JOIN cards c ON c.id = re.card_id JOIN notes n ON n.id = c.note_id WHERE re.id = ?`
    )
    .bind(eventId)
    .first<EventRow>();
  if (!ev || !ev.recording_url) {
    await db.prepare(`DELETE FROM recording_checks WHERE review_event_id = ?`).bind(eventId).run();
    return 'gone';
  }
  await db
    .prepare(`INSERT OR IGNORE INTO recording_checks (review_event_id, user_id, status) VALUES (?, ?, 'pending')`)
    .bind(eventId, ev.user_id)
    .run();
  const row = await db
    .prepare(`SELECT status, attempts, transcript, transcript_provider, score, score_note FROM recording_checks WHERE review_event_id = ?`)
    .bind(eventId)
    .first<CheckRow>();
  if (!row) return 'gone';
  if (row.status === 'done') return 'already_done';

  const attempts = row.attempts + 1;
  await db.prepare(`UPDATE recording_checks SET attempts = ?, updated_at = datetime('now') WHERE review_event_id = ?`).bind(attempts, eventId).run();

  const object = await env.AUDIO_BUCKET.get(ev.recording_url);
  if (!object) {
    await finish(db, eventId, { status: 'failed', error: 'recording file missing' });
    return 'failed';
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const mime = MIME[sniffAudio(bytes)];

  // 1. Transcript (kept across retries).
  let transcript = row.transcript;
  let provider = row.transcript_provider;
  let transcriptError: string | null = null;
  if (transcript == null) {
    try {
      const out = await (deps.transcribe ?? ((b, m) => transcribeTake(takeProviders(env), b, m)))(bytes, mime);
      transcript = out.text.trim();
      provider = out.provider;
    } catch (err) {
      transcriptError = describeProviderError(err);
    }
    if (transcript != null) {
      await db
        .prepare(
          `UPDATE recording_checks SET transcript = ?, transcript_provider = ?, transcript_match = ?, updated_at = datetime('now') WHERE review_event_id = ?`
        )
        .bind(transcript, provider, transcriptMatches(transcript, ev.hanzi) ? 1 : 0, eventId)
        .run();
    }
  }

  // 2. Azure score.
  const cfg = azureConfig(env);
  let scoreNote: string | null = null;
  let result: PronunciationResult | null = null;
  let audioMs: number | null = null;
  if (!cfg) scoreNote = 'not_configured';
  else {
    const audio = toAzureAudio(bytes);
    if ('unsupported' in audio) scoreNote = `unsupported_audio: ${audio.unsupported}`;
    else if (audio.durationMs > AZURE_PA_MAX_MS) scoreNote = 'too_long';
    else if (audio.durationMs < 200) scoreNote = 'too_short';
    else {
      const t = now();
      const usage = await db
        .prepare(
          `SELECT (SELECT COALESCE(SUM(audio_ms), 0) FROM recording_checks WHERE scored_at >= ?) AS month_ms,
                  (SELECT COUNT(*) FROM recording_checks WHERE scored_at >= ?) AS last_minute`
        )
        .bind(monthStart(t), new Date(t.getTime() - 60_000).toISOString())
        .first<{ month_ms: number; last_minute: number }>();
      if ((usage?.month_ms ?? 0) + audio.durationMs > AZURE_MONTHLY_BUDGET_MS) scoreNote = 'over_budget';
      else if ((usage?.last_minute ?? 0) >= AZURE_REQUESTS_PER_MINUTE) {
        throw new RetryLater(20 + Math.floor(Math.random() * 20), 'azure per-minute limit');
      } else {
        // Reserve the slot (and the audio seconds) before the call.
        await db
          .prepare(`UPDATE recording_checks SET status = 'scoring', scored_at = ?, audio_ms = ?, updated_at = datetime('now') WHERE review_event_id = ?`)
          .bind(t.toISOString(), audio.durationMs, eventId)
          .run();
        audioMs = audio.durationMs;
        try {
          result = await (deps.assess ?? ((c, a, r) => assessPronunciation(c, a, r)))(cfg, audio, ev.hanzi);
        } catch (err) {
          if (err instanceof AzureError && err.kind === 'rate_limited') {
            await db.prepare(`UPDATE recording_checks SET status = 'pending', scored_at = NULL, audio_ms = NULL WHERE review_event_id = ?`).bind(eventId).run();
            throw new RetryLater(60, err.message);
          }
          if (err instanceof AzureError && (err.kind === 'auth' || err.kind === 'bad_audio')) {
            console.error('[recording-check] azure', err.kind, err.message);
            scoreNote = `azure_${err.kind}`;
          } else {
            const message = describeProviderError(err);
            if (attempts < MAX_CHECK_ATTEMPTS) {
              await db.prepare(`UPDATE recording_checks SET status = 'pending', scored_at = NULL, audio_ms = NULL, error = ? WHERE review_event_id = ?`).bind(message, eventId).run();
              throw new RetryLater(30 * attempts, message);
            }
            scoreNote = 'azure_failed';
            transcriptError = transcriptError ?? message;
          }
        }
      }
    }
  }

  if (transcript == null && transcriptError && attempts < MAX_CHECK_ATTEMPTS && !result) {
    await db.prepare(`UPDATE recording_checks SET status = 'pending', error = ? WHERE review_event_id = ?`).bind(transcriptError, eventId).run();
    throw new RetryLater(30 * attempts, transcriptError);
  }

  await finish(db, eventId, {
    status: 'done',
    score: result?.score ?? null,
    fluency: result?.fluency ?? null,
    completeness: result?.completeness ?? null,
    char_scores: result ? JSON.stringify(result.char_scores) : null,
    score_note: result ? null : scoreNote,
    audio_ms: result ? audioMs : null,
    error: transcriptError,
  });
  void trackServer(
    'server.recording_check',
    { scored: !!result, match: transcript == null ? null : transcriptMatches(transcript, ev.hanzi), note: result ? null : (scoreNote?.split(":")[0] ?? null), audio_ms: result ? audioMs : null },
    { env, userId: ev.user_id }
  ).catch(() => undefined);
  return 'done';
}

async function finish(
  db: D1Database,
  eventId: string,
  v: {
    status: 'done' | 'failed';
    score?: number | null;
    fluency?: number | null;
    completeness?: number | null;
    char_scores?: string | null;
    score_note?: string | null;
    audio_ms?: number | null;
    error?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE recording_checks SET status = ?, score = ?, fluency = ?, completeness = ?, char_scores = ?, score_note = ?,
         audio_ms = ?, scored_at = CASE WHEN ? IS NULL THEN NULL ELSE scored_at END, error = ?, updated_at = datetime('now')
       WHERE review_event_id = ?`
    )
    .bind(
      v.status,
      v.score ?? null,
      v.fluency ?? null,
      v.completeness ?? null,
      v.char_scores ?? null,
      v.score_note ?? null,
      v.audio_ms ?? null,
      v.audio_ms ?? null,
      v.error ?? null,
      eventId
    )
    .run();
}
