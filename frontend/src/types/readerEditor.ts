/**
 * Types for the graded-reader editor (worker/src/routes/reader-editor.ts).
 * The spec itself lives in shared/reader so the worker, the editor and the
 * exports agree on one shape.
 */

import type { ReaderSpec, ReaderDiff } from '@shared/reader';
import type { EditorChatMessage, EditorChatState, SendEditorMessageResult } from './lessonEditor';

export type { ReaderSpec, ReaderPageSpec, ReaderDiff, ReaderDifficulty } from '@shared/reader';

/** GET|PUT /api/readers/:id/spec */
export interface EditableReader {
  id: string;
  status: 'generating' | 'ready' | 'failed';
  is_published: number;
  created_at: string;
  spec: ReaderSpec;
  /** PUT only: illustrations queued for generation. */
  image_jobs?: number;
}

/** POST /api/readers/import */
export interface ImportedReader extends EditableReader {
  user_id: string;
  title_chinese: string;
  title_english: string;
}

export type ReaderChatMessage = EditorChatMessage<ReaderSpec, ReaderDiff>;
export type ReaderChatState = EditorChatState<ReaderSpec, ReaderDiff>;
export type ReaderSendResult = SendEditorMessageResult<ReaderSpec, ReaderDiff>;

export type ReaderAssistField = 'english' | 'image_prompt';
