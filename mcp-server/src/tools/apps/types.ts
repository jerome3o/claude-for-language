/**
 * Payloads the tutor apps receive as `structuredContent` and the shapes the
 * app-only tools return. Shared between the server modules (src/tools/apps)
 * and the UIs (src/ui/apps) as `import type` only, so nothing here may have a
 * runtime export.
 *
 * The dashboard shapes mirror `worker/src/services/tutor-dashboard.ts`
 * (StudentOverview) trimmed to what the UI reads.
 */
import type { ReaderSpec } from '../../../../shared/reader/types';
import type { CustomLessonSpec } from '../../../../shared/lesson/types';

export type { ReaderSpec, ReaderPageSpec, ReaderDifficulty } from '../../../../shared/reader/types';
export type {
  CustomLessonSpec,
  LessonSection,
  LessonExercise,
  LessonSentence,
} from '../../../../shared/lesson/types';

// ---------- Students ----------

export interface StudentPick {
  relationship_id: string;
  student_id: string;
  name: string;
  email: string | null;
  picture_url: string | null;
}

export interface DashNoteRef {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface DashNeedsAttention {
  note: DashNoteRef;
  attempts: number;
  again_count: number;
  hard_count: number;
  /** Distinct wrong typed answers, most recent first (max 5). */
  wrong_answers: string[];
  wrong_typed_count: number;
  last_reviewed_at: string;
  recording: { event_id: string; recording_url: string } | null;
  recordings_unheard: number;
}

export interface DashHomeworkDeck {
  shared_deck_id: string;
  source_deck_id: string;
  target_deck_id: string;
  source_deck_name: string;
  target_deck_name: string | null;
  shared_at: string;
  cards_total: number;
  cards_started: number;
  cards_mastered: number;
  notes_missing: number;
  percent_started: number;
  percent_mastered: number;
}

export interface DashHomeworkLesson {
  lesson_id: string;
  title: string;
  icon: string | null;
  created_at: string;
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
}

export interface DashSetupStep {
  key: 'signed_in' | 'homework' | 'installed' | 'first_session';
  title: string;
  done: boolean;
  detail: string;
}

export interface DashStudent {
  relationship_id: string;
  student: { id: string; name: string | null; email: string | null; picture_url: string | null };
  joined_at: string;
  joined_via_invite: boolean;
  is_new: boolean;
  status: {
    last_studied_at: string | null;
    studied_today: boolean;
    streak_days: number;
    active_days_30: number;
    today: { reviews: number; accuracy: number | null; time_ms: number };
  };
  pills: { struggling_words: number; recordings_to_hear: number; homework_percent: number | null };
  needs_attention: DashNeedsAttention[];
  homework: {
    percent: number | null;
    cards_total: number;
    cards_started: number;
    cards_mastered: number;
    lessons_total: number;
    lessons_completed: number;
    decks: DashHomeworkDeck[];
    lessons: DashHomeworkLesson[];
  };
  setup: {
    steps: DashSetupStep[];
    done_count: number;
    install_kind: 'pwa' | 'android' | 'browser' | null;
    audio: { cached: number | null; total: number };
    last_opened_at: string | null;
    invite: { id: string; url: string; status: string; redeemed_at: string | null } | null;
  };
  activity: Array<{ day: string; reviews: number; accuracy: number | null; time_ms: number }>;
  last_conversation_id: string | null;
}

export interface DashInvite {
  id: string;
  url: string;
  email: string | null;
  inviter_role: string | null;
  created_at: string;
  expires_at: string | null;
  note: string | null;
  share_deck_count: number;
  opened_at: string | null;
}

export interface DashHomeworkDeckSummary {
  deck_id: string;
  name: string;
  note_count: number;
  student_count: number;
  last_shared_at: string;
}

export interface DashboardPayload {
  kind: 'students_dashboard';
  /** Prefix for R2 keys (recordings, images): `${media_base}${key}`. */
  media_base: string;
  generated_at: string;
  tz_offset_minutes: number;
  students: DashStudent[];
  invites: DashInvite[];
  homework_decks: DashHomeworkDeckSummary[];
}

export interface DashRecording {
  event_id: string;
  note: DashNoteRef;
  card_type: string;
  rating: number;
  reviewed_at: string;
  recording_url: string;
  user_answer: string | null;
  mark: { status: 'listened' | 'needs_work'; comment: string | null; updated_at: string } | null;
}

/** `app_student_detail` — what the expanded student card shows. */
export interface StudentDetailPayload {
  overview: DashStudent;
  recordings: DashRecording[];
  range: { from: string; to: string } | null;
  since_lesson: boolean;
}

// ---------- Reader ----------

export interface ReaderPayload {
  kind: 'review_reader';
  reader: { id: string; status: string; is_published: number; created_at: string };
  spec: ReaderSpec;
  media_base: string;
  students: Array<StudentPick & { already_shared: boolean }>;
}

export interface ReaderSaveResult {
  ok: boolean;
  problems?: string[];
  spec?: ReaderSpec;
  image_jobs?: number;
}

// ---------- Lesson ----------

export interface LessonAssignment {
  lesson_id: string;
  relationship_id: string;
  assigned_at: string;
  student: { id: string; name: string | null; email: string | null; picture_url: string | null };
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
  last_score: { correct: number; total: number } | null;
  up_to_date: boolean;
}

export interface LessonPayload {
  kind: 'review_lesson';
  /** `library`: a tutor's master copy; `lesson`: a student's own copy. */
  target: 'library' | 'lesson';
  item: {
    id: string;
    title: string;
    version: number | null;
    tags: string[];
    updated_at: string | null;
    /** For a student's copy: whether the caller owns it (else the tutor who assigned it). */
    is_owner: boolean | null;
    library_item_id: string | null;
  };
  spec: CustomLessonSpec;
  /** Prefix for describe_image illustrations (R2 keys). */
  media_base: string;
  assignments: LessonAssignment[];
  students: StudentPick[];
}

export interface LessonSaveResult {
  ok: boolean;
  problems?: string[];
  spec?: CustomLessonSpec;
  version?: number | null;
}

export interface AssignResult {
  assigned: Array<{ relationship_id: string; lesson_id: string; student_id: string }>;
  already_had: Array<{ relationship_id: string; lesson_id: string; student_id: string }>;
  errors: Array<{ relationship_id: string; error: string }>;
  assignments: LessonAssignment[];
}

// ---------- Deck ----------

export interface DeckNote {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  sentence_clue: string | null;
  sentence_clue_pinyin: string | null;
  sentence_clue_translation: string | null;
  audio_url: string | null;
  fun_facts: string | null;
  created_at: string;
}

export interface DeckStudent extends StudentPick {
  /** Set when this deck was already sent to the student. */
  shared: { shared_deck_id: string; notes_missing: number; cards_total: number; percent_started: number } | null;
}

export interface DeckPayload {
  kind: 'review_deck';
  deck: { id: string; name: string; description: string | null; note_count: number };
  notes: DeckNote[];
  media_base: string;
  students: DeckStudent[];
}

export interface NoteSaveResult {
  ok: boolean;
  problems?: string[];
  note?: DeckNote;
}

export interface ShareDeckResult {
  ok: boolean;
  shared_deck_id?: string;
  added?: number;
  kept?: number;
  message: string;
}
