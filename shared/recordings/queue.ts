/**
 * "Needs your ear" — which of a learner's pronunciation recordings the tutor is asked
 * to listen to, and why. Pure, so the worker (GET …/recordings/queue, the MCP
 * `list_student_recordings` queue filter, the in-call Review activity) and the
 * tests share ONE rule; both apps render the server's `reasons` / `labels`.
 *
 * A recording is in the queue while the tutor hasn't marked it (Listened / Needs work)
 * and ANY of:
 *  - the transcript doesn't match the card (pinyin with tones, shared/recordings/transcript.ts),
 *    or nothing was heard;
 *  - the learner rated that review Again or Hard;
 *  - the pronunciation score is low, or a character sounded off (Azure Pronunciation
 *    Assessment, worker/src/services/azure-pronunciation.ts);
 *  - the learner flagged the card for the tutor (an open flag).
 * Everything else stays under "All recordings".
 *
 * Thresholds are tuned CONSERVATIVELY: better to show the tutor a few too many than to
 * miss a mistake. Azure's zh-CN accuracy is 0–100 (native speakers ≈ 90+; a clearly wrong
 * tone or initial pulls a character well under 70).
 */

/** Overall accuracy under this → "Pronunciation score 72". */
export const LOW_PRONUNCIATION_SCORE = 85;
/** A character whose accuracy is under this "sounded off". */
export const WEAK_CHAR_SCORE = 80;

export type CharErrorType = 'None' | 'Mispronunciation' | 'Omission' | 'Insertion';

/** One character of the reference as Azure scored it (stored per recording). */
export interface CharScore {
  char: string;
  /** 0–100, null when Azure gave no score (an omitted word). */
  score: number | null;
  error: CharErrorType;
  /** The weakest part of the syllable was its tone (Azure's SAPI phoneme carries the tone digit). */
  tone_suspect?: boolean;
}

export type WeakKind = 'tone' | 'sound' | 'missing' | 'extra';

export interface WeakChar {
  char: string;
  score: number | null;
  kind: WeakKind;
}

/** What the background check found for one recording (recording_checks row, parsed). */
export interface RecordingCheck {
  status: 'pending' | 'done' | 'failed' | 'skipped';
  transcript: string | null;
  /** null = no transcript (not transcribed yet / every provider failed). */
  transcript_match: boolean | null;
  /** Azure accuracy 0–100, null = not scored (unconfigured, over budget, unsupported audio). */
  score: number | null;
  char_scores: CharScore[];
}

export type QueueReason =
  | 'heard_different'
  | 'nothing_heard'
  | 'rated_again'
  | 'rated_hard'
  | 'low_score'
  | 'sounded_off'
  | 'flagged';

/** Characters that sounded off, in reference order (inserted extras last). */
export function weakChars(scores: CharScore[]): WeakChar[] {
  const out: WeakChar[] = [];
  const extras: WeakChar[] = [];
  for (const s of scores) {
    if (s.error === 'Insertion') {
      extras.push({ char: s.char, score: s.score, kind: 'extra' });
    } else if (s.error === 'Omission') {
      out.push({ char: s.char, score: s.score, kind: 'missing' });
    } else if (s.error === 'Mispronunciation' || (s.score != null && s.score < WEAK_CHAR_SCORE)) {
      out.push({ char: s.char, score: s.score, kind: s.tone_suspect ? 'tone' : 'sound' });
    }
  }
  return [...out, ...extras];
}

export interface QueueInput {
  rating: number; // 0 again, 1 hard, 2 good, 3 easy
  check: RecordingCheck | null;
  flagged: boolean;
  marked: boolean;
}

export function reviewQueueReasons(input: Omit<QueueInput, 'marked'>): QueueReason[] {
  const reasons: QueueReason[] = [];
  const c = input.check;
  if (c && c.transcript_match === false) {
    reasons.push(c.transcript && c.transcript.trim() ? 'heard_different' : 'nothing_heard');
  }
  if (input.rating === 0) reasons.push('rated_again');
  else if (input.rating === 1) reasons.push('rated_hard');
  if (c && c.score != null && c.score < LOW_PRONUNCIATION_SCORE) reasons.push('low_score');
  if (c && weakChars(c.char_scores).some((w) => w.kind !== 'extra')) reasons.push('sounded_off');
  if (input.flagged) reasons.push('flagged');
  return reasons;
}

/** In the tutor's queue: not marked yet and at least one reason. */
export function isInReviewQueue(input: QueueInput): boolean {
  return !input.marked && reviewQueueReasons(input).length > 0;
}

const KIND_LABEL: Record<WeakKind, string> = { tone: 'tone', sound: 'sound', missing: 'missed', extra: 'extra' };

/** "银 (tone), 行 (sound)" */
export function weakCharsLabel(weak: WeakChar[]): string {
  return weak.map((w) => `${w.char} (${KIND_LABEL[w.kind]})`).join(', ');
}

/** One human line per reason, in the order the tutor should read them. */
export function queueReasonLabels(reasons: QueueReason[], check: RecordingCheck | null): string[] {
  const labels: string[] = [];
  for (const r of reasons) {
    switch (r) {
      case 'heard_different':
        labels.push(`Heard: ${check?.transcript?.trim() ?? ''}`);
        break;
      case 'nothing_heard':
        labels.push('Nothing was heard');
        break;
      case 'rated_again':
        labels.push('Rated Again');
        break;
      case 'rated_hard':
        labels.push('Rated Hard');
        break;
      case 'low_score':
        labels.push(`Pronunciation score ${Math.round(check?.score ?? 0)}`);
        break;
      case 'sounded_off': {
        const weak = weakChars(check?.char_scores ?? []).filter((w) => w.kind !== 'extra');
        labels.push(`Sounded off: ${weakCharsLabel(weak)}`);
        break;
      }
      case 'flagged':
        labels.push('Flagged for you');
        break;
    }
  }
  return labels;
}

/** Parse the stored JSON defensively (old / hand-edited rows never break the page). */
export function parseCharScores(raw: string | null | undefined): CharScore[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is CharScore => !!x && typeof x === 'object' && typeof (x as CharScore).char === 'string')
      .map((x) => ({
        char: x.char,
        score: typeof x.score === 'number' ? x.score : null,
        error: (['None', 'Mispronunciation', 'Omission', 'Insertion'] as const).includes(x.error) ? x.error : 'None',
        ...(x.tone_suspect ? { tone_suspect: true } : {}),
      }));
  } catch {
    return [];
  }
}

// ---------- The API shape (GET /api/relationships/:relId/recordings/queue) ----------

export interface RecordingQueueItem {
  event_id: string;
  note: { id: string; hanzi: string; pinyin: string; english: string; deck_name: string; audio_url: string | null };
  card_type: string;
  rating: number;
  reviewed_at: string;
  /** R2 key of the take (play at /api/audio/<key>). */
  recording_url: string;
  user_answer: string | null;
  mark: { status: 'listened' | 'needs_work'; comment: string | null; updated_at: string } | null;
  check: (RecordingCheck & { weak_chars: WeakChar[]; score_note: string | null }) | null;
  flag: { id: string; message: string; created_at: string } | null;
  reasons: QueueReason[];
  labels: string[];
  in_queue: boolean;
}

export interface RecordingQueueResponse {
  range: { from: string; to: string };
  view: 'queue' | 'all';
  items: RecordingQueueItem[];
  counts: { queue: number; all: number; checking: number };
  /** Azure scoring is set up on the server (else only transcripts / ratings / flags count). */
  scoring: boolean;
}

/** Build one item's verdict fields (the route fills the rest from SQL). */
export function queueVerdict(input: QueueInput): { reasons: QueueReason[]; labels: string[]; in_queue: boolean } {
  const reasons = reviewQueueReasons(input);
  return { reasons, labels: queueReasonLabels(reasons, input.check), in_queue: !input.marked && reasons.length > 0 };
}
