import type { NoteRowInput } from '../../db/queries';

/**
 * Something that can run work after the response — Hono's
 * `c.executionCtx` satisfies it. Optional everywhere: without one, the
 * service awaits the work or hands it to a queue instead.
 */
export interface Background {
  waitUntil(promise: Promise<unknown>): void;
}

/** What a caller supplies for a new note. Snake_case, like the API and the MCP tools. */
export type NoteInput = NoteRowInput;

/**
 * How a new note's TTS clip (and its example sentence's clip) gets made:
 * - `background`: after the response via waitUntil (the app's "+ Add word").
 * - `queue`: on the sentence-set queue, for batches that would outlive a request.
 * - `await`: before returning, when the caller needs the clip URL in the response.
 * - `none`: the caller already has the clip or will make it (copies, tests).
 */
export type AudioMode = 'background' | 'queue' | 'await' | 'none';

export interface CreateNoteOptions {
  audio?: AudioMode;
  /** Queue the graded sentence set (default true). Big imports pass false; the hourly top-up covers them. */
  sentences?: boolean;
  bg?: Background;
}

/** Fields a note edit may change. Anything omitted is left alone. */
export interface NotePatch {
  hanzi?: string;
  pinyin?: string;
  english?: string;
  fun_facts?: string | null;
  sentence_clue?: string | null;
  sentence_clue_pinyin?: string | null;
  sentence_clue_translation?: string | null;
  /** Only when the caller made the clue's clip itself; otherwise the service does. */
  sentence_clue_audio_url?: string | null;
  pinyin_only?: number;
  alternatives?: string | null;
}
