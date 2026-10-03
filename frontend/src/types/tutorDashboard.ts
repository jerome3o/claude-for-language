/**
 * Types for the tutor dashboard and the student page. Mirrors
 * worker/src/services/tutor-dashboard.ts and routes/tutor-dashboard.ts.
 */
import type { StudyBudgetInfo } from '@shared/decks';

import type { UserSummary, RelationshipRole } from '../types';
import type { InsightNoteRef } from './insights';

export type InstallKind = 'pwa' | 'android' | 'browser' | null;

export interface StudyStatus {
  last_studied_at: string | null;
  studied_today: boolean;
  streak_days: number;
  active_days_30: number;
  today: { reviews: number; accuracy: number | null; time_ms: number };
}

export interface NeedsAttentionItem {
  note: InsightNoteRef;
  attempts: number;
  again_count: number;
  hard_count: number;
  wrong_answers: string[];
  wrong_typed_count: number;
  last_reviewed_at: string;
  recording: { event_id: string; recording_url: string } | null;
  recordings_unheard: number;
}

export interface HomeworkDeck {
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
  /** Words in the student's copy and how many they have met; days to go at their daily budget. */
  notes_total: number;
  notes_introduced: number;
  /** Words the student left out of long-term review in a homework pass (not counted in words_to_go). */
  notes_left_out?: number;
  words_to_go: number;
  days_to_go: number;
  /** The copy's place in the student's queue (higher = sooner). */
  study_priority?: number;
  /** 1-based place in the student's deck queue (first = studied first); null when the copy is gone. */
  queue_position: number | null;
  queue_total: number;
}

export interface SharedDeckMoveResult {
  shared_deck_id: string;
  target_deck_id: string;
  queue_position: number;
  queue_total: number;
}

export interface HomeworkLesson {
  lesson_id: string;
  title: string;
  icon: string | null;
  created_at: string;
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
}

export interface HomeworkSummary {
  percent: number | null;
  cards_total: number;
  cards_started: number;
  cards_mastered: number;
  lessons_total: number;
  lessons_completed: number;
  decks: HomeworkDeck[];
  lessons: HomeworkLesson[];
}

export type SetupStepKey = 'signed_in' | 'homework' | 'installed' | 'first_session';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  done: boolean;
  detail: string;
}

export interface InviteRef {
  id: string;
  url: string;
  status: string;
  redeemed_at: string | null;
}

export interface SetupStatus {
  steps: SetupStep[];
  done_count: number;
  install_kind: InstallKind;
  audio: { cached: number | null; total: number };
  last_opened_at: string | null;
  invite: InviteRef | null;
}

export interface ActivityDay {
  day: string;
  reviews: number;
  accuracy: number | null;
  time_ms: number;
}

export interface StudentOverview {
  relationship_id: string;
  student: UserSummary;
  joined_at: string;
  joined_via_invite: boolean;
  is_new: boolean;
  status: StudyStatus;
  pills: {
    struggling_words: number;
    recordings_to_hear: number;
    homework_percent: number | null;
    /** Flagged cards waiting for a reply */
    flags_open: number;
  };
  needs_attention: NeedsAttentionItem[];
  homework: HomeworkSummary;
  setup: SetupStatus;
  activity: ActivityDay[];
  last_conversation_id: string | null;
  /** The tutor has written a private student profile (StudentProfileSection). */
  has_profile?: boolean;
  /** The student's daily new-card budget and who set it ("Daily new cards" row; older servers omit it). */
  study_budget?: StudyBudgetInfo;
}

export interface PendingInvite {
  id: string;
  url: string;
  email: string | null;
  inviter_role: RelationshipRole | null;
  created_at: string;
  expires_at: string | null;
  note: string | null;
  share_deck_count: number;
  /** Set when the join page has been opened (only if the server tracks it). */
  opened_at: string | null;
}

export interface HomeworkDeckSummary {
  deck_id: string;
  name: string;
  note_count: number;
  student_count: number;
  last_shared_at: string;
}

export interface TutorDashboard {
  students: StudentOverview[];
  invites: PendingInvite[];
  homework_decks: HomeworkDeckSummary[];
  generated_at: string;
}

export interface SharedDeckUpdateResult {
  shared_deck_id: string;
  target_deck_id: string;
  added: number;
  kept: number;
  audio_filled: number;
  /** Existing copies whose text took the tutor's newer edits (pinyin, meaning, notes, example sentence). */
  updated: number;
}

// ============ Take homework back (worker services/homework-removal.ts) ============

export interface DeckRemovalPreview {
  kind: 'deck';
  shared_deck_id: string;
  target_deck_id: string;
  /** The student's copy; null when they already deleted it. */
  deck_name: string | null;
  source_deck_id: string;
  source_deck_name: string | null;
  words_total: number;
  words_met: number;
  reviews: number;
  can_delete_source: boolean;
}

export interface LessonRemovalPreview {
  kind: 'lesson';
  lesson_id: string;
  title: string;
  completions: number;
  library_item_id: string | null;
}

export interface ReaderRemovalPreview {
  kind: 'reader';
  shared_reader_id: string;
  target_reader_id: string;
  title: string | null;
  page_count: number;
  readings: number;
}

export type RemovalPreview = DeckRemovalPreview | LessonRemovalPreview | ReaderRemovalPreview;

export interface HomeworkRemovalResult {
  removed: true;
  words_met: number;
  reviews: number;
  assignments_cancelled: number;
  source_deleted: boolean;
}

/** GET /relationships/:relId/shared-readers row. */
export interface SharedReaderRow {
  id: string;
  relationship_id: string;
  source_reader_id: string;
  target_reader_id: string;
  shared_at: string;
  source_title_chinese: string | null;
  source_title_english: string | null;
  target_title_chinese: string | null;
  target_title_english: string | null;
  target_deleted: boolean;
  page_count: number;
  read_count: number;
  last_read_at: string | null;
}
