/**
 * The slices of the main API's responses that the student tools read.
 *
 * These mirror the worker's types (worker/src/services/tutor-dashboard.ts,
 * worker/src/services/insights.ts, worker/src/types.ts, worker/src/db/
 * invite-queries.ts) but only the fields we forward or summarise — the MCP
 * worker cannot import the API worker's sources, and keeping the list short
 * documents exactly what each tool depends on.
 */
import type { StudyBudgetInfo } from '../../../../shared/decks/tutor-budget';


export type CardType = 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi';

export interface UserSummary {
  id: string;
  email: string | null;
  name: string | null;
  picture_url?: string | null;
}

// ---------- Tutor dashboard / overview ----------

export interface NoteRef {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface NeedsAttentionItem {
  note: NoteRef;
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
  /** How it was sent (one_off / fsrs / both; null = before assignments); missing on an older API. */
  mode?: 'one_off' | 'fsrs' | 'both' | null;
  /** Part of long-term learning (anything but a one-off-only copy). */
  long_term?: boolean;
  /** 1-based place of the student's copy in their deck queue (first = studied first); null when the copy is gone. */
  queue_position?: number | null;
  queue_total?: number;
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

export interface HomeworkLesson {
  lesson_id: string;
  title: string;
  icon: string | null;
  created_at: string;
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
}

/** The one-off headline (shared/homework/summary.ts OneOffSummary). */
export interface OneOffHomework {
  state: 'none' | 'all_done' | 'open' | 'overdue';
  total: number;
  done: number;
  open: number;
  overdue: number;
  due_today: number;
  percent: number | null;
  label: string;
  pill: string;
}

export interface HomeworkSummary {
  /** One-off homework only (= one_off.percent). */
  percent: number | null;
  /** Missing on an older API. */
  one_off?: OneOffHomework;
  cards_total: number;
  cards_started: number;
  cards_mastered: number;
  lessons_total: number;
  lessons_completed: number;
  decks: HomeworkDeck[];
  lessons: HomeworkLesson[];
}

export interface SetupStep {
  key: 'signed_in' | 'homework' | 'installed' | 'first_session';
  title: string;
  done: boolean;
  detail: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  done_count: number;
  install_kind: 'pwa' | 'android' | 'browser' | null;
  audio: { cached: number | null; total: number };
  last_opened_at: string | null;
  invite: { id: string; url: string; status: string; redeemed_at: string | null } | null;
}

export interface StudentOverview {
  relationship_id: string;
  student: UserSummary;
  joined_at: string;
  joined_via_invite: boolean;
  is_new: boolean;
  status: {
    last_studied_at: string | null;
    studied_today: boolean;
    streak_days: number;
    active_days_30?: number;
    today: { reviews: number; accuracy: number | null; time_ms: number };
  };
  pills: {
    struggling_words: number;
    recordings_to_hear: number;
    /** One-off homework only (0..100); long-term decks never count. */
    homework_percent: number | null;
    /** The one-off headline; missing on an older API. */
    homework?: OneOffHomework;
    /** Flagged cards waiting for a reply */
    flags_open: number;
  };
  needs_attention: NeedsAttentionItem[];
  homework: HomeworkSummary;
  setup: SetupStatus;
  activity: Array<{ day: string; reviews: number; accuracy: number | null; time_ms: number }>;
  last_conversation_id: string | null;
  /** The tutor has written a private student profile (get_student_profile). */
  has_profile?: boolean;
  /** The student's daily new-card budget and who set it (worker: shared/decks/tutor-budget.ts). */
  study_budget?: StudyBudgetInfo;
}

export interface DashboardInvite {
  id: string;
  url: string;
  email: string | null;
  inviter_role: 'tutor' | 'student' | null;
  created_at: string;
  expires_at: string | null;
  note: string | null;
  share_deck_count: number;
  opened_at: string | null;
}

export interface TutorDashboard {
  students: StudentOverview[];
  invites: DashboardInvite[];
  homework_decks: Array<Record<string, unknown>>;
  generated_at: string;
}

// ---------- Relationships ----------

export interface RelationshipWithUsers {
  id: string;
  requester_id: string;
  recipient_id: string;
  requester_role: 'tutor' | 'student';
  status: 'pending' | 'active' | 'removed';
  created_at: string;
  accepted_at: string | null;
  requester: UserSummary;
  recipient: UserSummary;
}

export interface MyRelationships {
  tutors: RelationshipWithUsers[];
  students: RelationshipWithUsers[];
  pending_incoming: RelationshipWithUsers[];
  pending_outgoing: RelationshipWithUsers[];
}

// ---------- Insights ----------

export interface CardTypeStats {
  attempts: number;
  again_count: number;
  accuracy: number;
}

export interface StrugglingNote {
  note: NoteRef;
  score: number;
  attempts: number;
  again_count: number;
  again_rate: number;
  hard_count: number;
  forgot_count: number;
  avg_time_ms: number | null;
  last_reviewed_at: string;
  by_card_type: Partial<Record<CardType, CardTypeStats>>;
  wrong_answers: string[];
  wrong_typed_count: number;
  recordings_count: number;
  /** Every attempt in the range — bulky, dropped by the tools. */
  events?: unknown[];
}

export interface GoingWellNote {
  note: NoteRef;
  attempts: number;
  easy_count: number;
  reason: 'consistent' | 'graduated';
  max_interval_days: number | null;
  last_reviewed_at: string;
}

export interface RecordingMark {
  review_event_id: string;
  status: 'listened' | 'needs_work';
  comment: string | null;
  updated_at: string;
}

export interface InsightRecording {
  event_id: string;
  note: NoteRef;
  card_type: CardType;
  rating: number;
  reviewed_at: string;
  recording_url: string;
  user_answer: string | null;
  mark: RecordingMark | null;
}

export interface InsightsResponse {
  range: { from: string; to: string };
  since_lesson: { id: string; lesson_at: string } | null;
  latest_lesson: { id: string; lesson_at: string } | null;
  totals: Record<string, unknown>;
  struggling: StrugglingNote[];
  going_well: GoingWellNote[];
  activity: Record<string, unknown[]>;
  recordings: InsightRecording[];
  mix_ups?: Array<{ a: string; b: string; count: number; last_at: string; examples: Array<{ expected: string; answer: string }> }>;
}

export interface HistoryEvent {
  event_id: string;
  card_id: string;
  card_type: CardType;
  note_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  rating: number;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
  reviewed_at: string;
}

export interface HistoryResponse {
  range: { from: string; to: string };
  events: HistoryEvent[];
  next_cursor: string | null;
  decks?: Array<{ id: string; name: string }>;
}

export interface StudentSummaryRow {
  id: string;
  relationship_id: string;
  range_from: string;
  range_to: string;
  narrative_en: string;
  narrative_zh: string;
  stats_json?: string | null;
  created_at: string;
}

export interface LessonLogEntry {
  id: string;
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  lesson_at: string;
  notes: string | null;
  created_at: string;
}

// ---------- Conversations ----------

export interface ConversationRow {
  id: string;
  relationship_id: string;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
  is_ai_conversation: boolean | number;
  last_message?: { id: string; sender_id: string; content: string; created_at: string } | null;
  other_user: UserSummary;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  check_status: 'correct' | 'needs_improvement' | null;
  check_feedback: string | null;
  recording_url: string | null;
  reply_to_message_id: string | null;
  translation: string | null;
  sender: { id: string; name: string | null };
  reply_to?: { id: string; content: string; sender: { id: string; name: string | null } } | null;
}

// ---------- Homework decks ----------

export interface SharedDeckRow {
  id: string;
  relationship_id: string;
  source_deck_id: string;
  target_deck_id: string;
  shared_at: string;
  source_deck_name: string;
  target_deck_name: string;
}

/** GET /relationships/:relId/shared-readers row (worker services/shared-readers.ts). */
export interface SharedReaderListRow {
  id: string;
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

export interface SharedDeckProgress {
  deck_name: string;
  shared_at: string;
  student: UserSummary;
  completion: {
    total_cards: number;
    cards_seen: number;
    cards_mastered: number;
    percent_seen: number;
    percent_mastered: number;
  };
  card_type_breakdown: Record<CardType, { total: number; new: number; learning: number; familiar: number; mastered: number }>;
  notes: Array<{
    hanzi: string;
    pinyin: string;
    english: string;
    mastery_percent: number;
    recent_ratings: Record<CardType, number[]>;
  }>;
  activity: {
    last_studied_at: string | null;
    total_study_time_ms: number;
    reviews_last_7_days: number;
  };
}

export interface StudentLessonRow {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  source: string;
  created_at: string;
  exercise_count: number;
  library_item_id: string | null;
  assigned_by: string | null;
  assigned_by_me: boolean;
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
  last_score: { correct: number; total: number } | null;
}

// ---------- Invites ----------

export interface InviteRow {
  id: string;
  url: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  created_by?: string;
  email: string | null;
  inviter_role: 'tutor' | 'student' | null;
  share_deck_ids: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  note: string | null;
  welcome_message: string | null;
  opened_at: string | null;
  creator_name?: string | null;
  creator_email?: string | null;
  redemptions: Array<{ user_id: string; redeemed_at: string; user_name: string | null; user_email: string | null }>;
}

// ---------- Card flags & Ask-Claude history (worker routes/card-flags.ts, routes/claude-chats.ts) ----------

export interface CardFlagRow {
  id: string;
  relationship_id: string;
  student_id: string;
  tutor_id: string;
  note_id: string;
  card_id: string | null;
  message: string;
  status: 'open' | 'resolved';
  tutor_reply: string | null;
  replied_at: string | null;
  student_seen_reply_at: string | null;
  created_at: string;
  resolved_at: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  card_type: string | null;
  student_name: string | null;
  tutor_name: string | null;
}

export interface ClaudeChatQuestionRow {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

// ---------- Session notes → agent jobs (worker/src/routes/tutor-notes.ts) ----------

export interface SessionNotesStep {
  at: string;
  text: string;
  kind: 'info' | 'tool' | 'warn' | 'done' | 'error';
}

export interface SessionNotesJobRow {
  id: string;
  relationship_id: string;
  title: string | null;
  notes: string;
  notes_chars: number;
  lesson_at: string | null;
  priority: 'core' | 'non_urgent';
  auto_share: boolean;
  /** 1 = a homework draft (reviewed, then assigned). */
  review?: number | boolean;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: string | null;
  steps: SessionNotesStep[];
  rounds: number;
  result: {
    deck?: { id: string; name: string; note_count: number; target_deck_id?: string; removed_at?: string };
    lessons?: Array<{ library_item_id: string; title: string; lesson_id?: string; exercise_count: number; removed_at?: string }>;
    reader?: { id: string; title_english: string; title_chinese: string; page_count: number; target_reader_id?: string; removed_at?: string };
    summary?: string;
    skipped?: string[];
  };
  error: string | null;
  created_at: string;
  finished_at: string | null;
}
