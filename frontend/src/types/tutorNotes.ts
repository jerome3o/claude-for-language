/**
 * Session notes → agent jobs. Mirrors worker/src/db/tutor-notes-queries.ts
 * (the row minus its transcript) as served by worker/src/routes/tutor-notes.ts.
 */

export type SessionNotesJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type SessionNotesPriority = 'core' | 'non_urgent';

export interface SessionNotesStep {
  at: string;
  text: string;
  kind: 'info' | 'tool' | 'warn' | 'done' | 'error';
}

export interface SessionNotesResult {
  deck?: { id: string; name: string; note_count: number; target_deck_id?: string; shared_at?: string };
  lessons?: Array<{ library_item_id: string; title: string; lesson_id?: string; exercise_count: number }>;
  reader?: { id: string; title_english: string; title_chinese: string; page_count: number; target_reader_id?: string };
  summary?: string;
  skipped?: string[];
}

export interface SessionNotesJob {
  id: string;
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  title: string | null;
  notes: string;
  notes_chars: number;
  lesson_at: string | null;
  priority: SessionNotesPriority;
  auto_share: boolean;
  status: SessionNotesJobStatus;
  progress: string | null;
  steps: SessionNotesStep[];
  rounds: number;
  result: SessionNotesResult;
  error: string | null;
  lesson_log_id: string | null;
  /** The video call whose transcript these notes are, or null for pasted notes. */
  source_call_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface SubmitSessionNotesInput {
  notes: string;
  title?: string;
  lesson_at?: string;
  priority?: SessionNotesPriority;
  auto_share?: boolean;
  log_lesson?: boolean;
}

export function isActiveJob(job: Pick<SessionNotesJob, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'running';
}
