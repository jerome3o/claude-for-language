import type { ReaderWord } from '@shared/reader/words';

// Cloudflare bindings
export interface Env {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  AI: Ai;
  IMAGE_QUEUE: Queue<ImageGenerationMessage | CustomLessonImageMessage | import('./services/lesson-images').LessonImageMessage>;
  STORY_QUEUE: Queue<StoryGenerationMessage>;
  SENTENCE_SET_QUEUE: Queue<SentenceSetMessage>;
  QUEST_QUEUE: Queue<QuestGenerationMessage>;
  /** Picture hunts: picture → objects found → named (services/picture-hunt.ts). */
  PICTURE_HUNT_QUEUE: Queue<PictureHuntJobMessage>;
  /** Video calls (experimental): one CallRoom Durable Object per call + the after-call queue. */
  CALL_ROOM: DurableObjectNamespace<import('./durable/call-room').CallRoom>;
  CALL_QUEUE: Queue<CallProcessingMessage>;
  /** Chat live delivery: one ChatHub Durable Object per user (docs/CHAT.md §4). */
  CHAT_HUB: DurableObjectNamespace<import('./durable/chat-hub').ChatHub>;
  TUTOR_NOTES_QUEUE: Queue<TutorNotesJobMessage>;
  ANTHROPIC_API_KEY: string;
  GOOGLE_TTS_API_KEY: string;
  MINIMAX_API_KEY: string;
  GEMINI_API_KEY: string;
  /** Cloudflare Realtime TURN key for video calls (optional — STUN-only without it). */
  TURN_KEY_ID?: string;
  /** Web Push (call alerts). Optional: without them a key pair is generated once and kept in app_keys. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Firebase service-account JSON (project_id, client_email, private_key) — FCM chat pushes to the Lab app. Optional. */
  FCM_SERVICE_ACCOUNT_JSON?: string;
  TURN_KEY_API_TOKEN?: string;
  /** Call transcription: 'gemini' | 'whisper' | … (default: the best one with a key). */
  CALL_TRANSCRIBE_PROVIDER?: string;
  /** Override the Gemini model used for call transcription (default in services/calls/transcribe.ts). */
  CALL_GEMINI_MODEL?: string;
  /** Soniox API key — the best code-switching transcription; used for calls when set. */
  SONIOX_API_KEY?: string;
  CCR_FEATURE_REQUEST_ROUTINE_URL?: string;
  CCR_FEATURE_REQUEST_ROUTINE_KEY?: string;
  ENVIRONMENT: string;
  // Auth secrets
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ADMIN_EMAIL: string;
  NTFY_TOPIC: string;
  /** Public origin of this worker for links in e-mails (default: the workers.dev URL). */
  PUBLIC_API_URL?: string;
  // Email
  SENDGRID_API_KEY: string;
  // E2E testing - enables test auth endpoints (NEVER set in production)
  E2E_TEST_MODE?: string;
}

// Queue message types
// NOTE: Keep this message small. Cloudflare Queues enforce a 128 KB per-message
// limit, so we pass only the readerId — the vocabulary list is loaded from the
// reader record (vocabulary_used) in the queue consumer rather than embedded here.
export interface StoryGenerationMessage {
  readerId: string;
  topic?: string;
  difficulty: DifficultyLevel;
  // 'due_cards': vocabulary_used holds TARGET words (today's due cards) to
  // weave in best-effort; the allowed vocabulary is the learner's full
  // learned word list, loaded by the consumer.
  mode?: 'due_cards';
  // Thread the tutor's recent lesson notes into the story prompt so the
  // story can echo themes/phrasings the learner just covered in class.
  withLessonNotes?: boolean;
  // Daily reader: when lesson notes exist, ANCHOR the story on them (they
  // become the primary theme/content; due-card targets go secondary).
  anchorLessonNotes?: boolean;
}

export interface ImageGenerationMessage {
  readerId: string;
  pageId: string;
  imagePrompt: string;
  totalPages: number;
}

/** Illustration for a custom lesson's describe_image exercise. Shares the
 * image-generation queue with reader pages; distinguished by lessonId. */
/** Legacy per-exercise lesson image message (before services/lesson-images.ts);
 * still accepted from the queue and handled as a by-prompt message. */
export interface CustomLessonImageMessage {
  lessonId: string;
  sectionIndex: number;
  exerciseIndex: number;
  imagePrompt: string;
}

/** After-call processing: transcribe one recording piece, or write the lesson report. */
export type CallProcessingMessage =
  | { kind: 'piece'; pieceId: string }
  | { kind: 'report'; callId: string }
  // The lesson report over all the lesson's calls (services/calls/lessons.ts).
  | { kind: 'lesson_report'; lessonId: string };

/** Background generation of a quest world (one Claude call + repair rounds). */
export interface PictureHuntJobMessage {
  huntId: string;
}

export interface QuestGenerationMessage {
  questId: string;
  goalCount?: number;
  deckIds?: string[];
}

/** One session-notes agent job (tutor_note_jobs, migration 0071). `resume` = a continuation after a checkpoint. */
export interface TutorNotesJobMessage {
  jobId: string;
  resume?: boolean;
}

/** Background generation of a note's graded sentence set (see 0055). */
export interface SentenceSetMessage {
  noteId: string;
  count?: number;
  /**
   * 'set' (the default) generates the note's sentence set. 'clue_audio' only
   * fills in missing TTS for the note's own example sentence — several write
   * paths save a clue without audio, which leaves its ▶ silent.
   * 'note_audio' / 'sentence_audio' regenerate a clip that was produced by the
   * Google fallback, replacing it with MiniMax (see /api/audio/regenerate-fallback).
   */
  kind?: 'set' | 'clue_audio' | 'note_audio' | 'sentence_audio';
  /** For 'sentence_audio': the note_sentences row to regenerate. */
  sentenceId?: string;
  /** For 'clue_audio': replace existing audio rather than only filling a gap. */
  force?: boolean;
  /**
   * For 'sentence_audio' on a row with no clip yet: which attempt this is.
   * A rate-limited MiniMax leaves the row silent, so the consumer re-queues
   * with a growing delay (see sentenceAudioRetryDelay) instead of giving up.
   */
  attempt?: number;
}

// Audio provider types
export type AudioProvider = 'minimax' | 'gtts';

// Card types
export type CardType = 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi';

// Rating values (SM-2)
export type Rating = 0 | 1 | 2 | 3; // 0=again, 1=hard, 2=good, 3=easy

// Card queue values (Anki-style)
export enum CardQueue {
  NEW = 0,
  LEARNING = 1,
  REVIEW = 2,
  RELEARNING = 3,
}

// User roles (for future tutor feature)
export type UserRole = 'student' | 'tutor';

// Database models
export interface User {
  id: string;
  email: string | null;
  google_id: string | null;
  name: string | null;
  picture_url: string | null;
  role: UserRole;
  is_admin: number;
  /** 1 if this user may create invites for new people (admins always may). */
  can_invite: number;
  last_login_at: string | null;
  bio: string | null;
  /** Profile screen (migration 0076): Google's own values, what the user replaced, public About me, time zone. */
  google_name?: string | null;
  google_picture_url?: string | null;
  name_custom?: number | null;
  picture_source?: 'google' | 'upload' | 'none' | null;
  picture_key?: string | null;
  about?: string | null;
  time_zone?: string | null;
  /** Voice for reading this person's chat messages aloud (migration 0098; shared/chats/voice.ts). */
  voice_gender?: 'male' | 'female' | 'other' | null;
  /** Which tab the app opens on; NULL = automatic (see PUT /api/profile/landing-page). */
  landing_page: LandingPage | null;
  /** Daily new-card budget across all decks (migration 0069); NULL = DEFAULT_STUDY_BUDGET. */
  new_cards_per_day?: number | null;
  secondary_cards_per_day?: number | null;
  /** JSON array of the conversation voices this account plays (migration 0078);
   * NULL = the admin's selection, else the shipped defaults (shared/lesson/voices.ts). */
  conversation_voices?: string | null;
  conversation_voices_updated_at?: string | null;
  /** Reported by the client during sync (migration 0064). */
  install_kind?: 'pwa' | 'android' | 'browser' | null;
  cached_audio_count?: number | null;
  last_opened_at?: string | null;
  created_at: string;
}

export type LandingPage = 'study' | 'students' | 'decks';
export const LANDING_PAGES: readonly LandingPage[] = ['study', 'students', 'decks'];

export interface AuthSession {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface OAuthClient {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string; // JSON array
  grant_types: string;
  created_at: string;
}

export interface OAuthToken {
  id: string;
  client_id: string;
  user_id: string;
  access_token_hash: string;
  refresh_token_hash: string | null;
  scope: string | null;
  expires_at: string;
  created_at: string;
}

export interface OAuthCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  scope: string | null;
  expires_at: string;
}

export interface Deck {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  new_cards_per_day: number;
  secondary_cards_per_day: number;  // Daily quota for new cards whose note already has a reviewed card (additive to new_cards_per_day)
  // FSRS settings
  request_retention: number;    // Target retention (0.7-0.97), default 0.9
  fsrs_weights: string | null;  // JSON array of 21 weights, null = use defaults
  // Legacy SM-2 settings (kept for backward compatibility, not used by FSRS)
  learning_steps: string;  // Space-separated minutes, e.g., "1 10"
  graduating_interval: number;  // Days
  easy_interval: number;  // Days
  relearning_steps: string;  // Space-separated minutes, e.g., "10"
  starting_ease: number;  // Stored as percentage, e.g., 250 = 2.5
  minimum_ease: number;  // Stored as percentage, e.g., 130 = 1.3
  maximum_ease: number;  // Stored as percentage, e.g., 300 = 3.0
  interval_modifier: number;  // Stored as percentage, e.g., 100 = 1.0
  hard_multiplier: number;  // Stored as percentage, e.g., 120 = 1.2
  easy_bonus: number;  // Stored as percentage, e.g., 130 = 1.3
  maximum_interval: number;  // Maximum review interval in days, default 36500
  /** Place in the learner's new-card queue: higher goes first (migration 0069). */
  study_priority: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  deck_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  audio_url: string | null;
  audio_provider: AudioProvider | null;
  fun_facts: string | null;
  context: string | null;  // Conversation context shown on card front
  sentence_clue: string | null;  // Example sentence for disambiguation
  sentence_clue_pinyin: string | null;  // Pinyin for sentence clue
  sentence_clue_translation: string | null;  // English translation of sentence clue
  sentence_clue_audio_url: string | null;  // Audio for sentence clue
  multiple_choice_options: string | null;  // JSON: per-character multiple choice alternatives
  pinyin_only: number;  // 0 or 1 — when set, meaning_to_hanzi cards auto-show multiple choice
  alternatives: string | null;  // JSON array of acceptable alternative hanzi answers
  /** The learner's "long-term review" choice for this word: 1 in, 0 out, null = follow the deck (migration 0096). */
  long_term?: 0 | 1 | null;
  created_at: string;
  updated_at: string;
}

/**
 * One entry in a note's sentence set — a graded list of example sentences for
 * a word (see migration 0054). Ordered by `position`, easiest first.
 */
export interface NoteSentence {
  id: string;
  note_id: string;
  position: number;
  hanzi: string;
  pinyin: string | null;
  translation: string | null;
  audio_url: string | null;
  /** core | shared_character | contrast | collocation | complex */
  focus: string | null;
  /** Short learner-facing note explaining why this sentence is in the set */
  focus_note: string | null;
  /** JSON SentenceExplanation, generated on demand and cached (see 0055) */
  explanation: string | null;
  created_at: string;
  updated_at: string;
}

/** Brief, on-demand breakdown of one sentence. Kept small so it renders fast. */
export interface SentenceBriefExplanation {
  words: Array<{ hanzi: string; pinyin: string; gloss: string }>;
  /** One or two sentences on how the sentence is put together */
  construction: string;
  /** One-line English translation of the whole sentence (breakdowns made before it was added have none) */
  translation?: string;
}

/** The Sentence Coach's Explain result: the brief breakdown of the learner's sentence. */
export interface CoachBreakdown extends SentenceBriefExplanation {
  /** The sentence as the learner gave it */
  hanzi: string;
  /** Sentence pinyin, joined from the word rows */
  pinyin: string;
}

export interface Card {
  id: string;
  note_id: string;
  card_type: CardType;
  // FSRS fields
  stability: number;            // Memory stability (days until R drops to 90%)
  difficulty: number;           // Card difficulty (1-10)
  lapses: number;               // Times forgotten (Again count)
  // Legacy SM-2 fields (kept for backward compatibility)
  ease_factor: number;
  interval: number;
  repetitions: number;
  next_review_at: string | null;
  queue: CardQueue;
  learning_step: number;
  due_timestamp: number | null;
  created_at: string;
  updated_at: string;
}

export interface StudySession {
  id: string;
  user_id: string | null;
  deck_id: string | null;
  started_at: string;
  completed_at: string | null;
  cards_studied: number;
}

export interface CardReview {
  id: string;
  session_id: string;
  card_id: string;
  rating: Rating;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
  reviewed_at: string;
}

export interface NoteQuestion {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
}

export interface NoteAudioRecording {
  id: string;
  note_id: string;
  audio_url: string;
  provider: string;
  is_primary: boolean;
  speaker_name: string | null;
  created_by: string | null;
  created_at: string;
}

// API request/response types
export interface CreateDeckRequest {
  name: string;
  description?: string;
}

export interface CreateNoteRequest {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
  context?: string;  // Conversation context to show on card front
}

export interface UpdateNoteRequest {
  hanzi?: string;
  pinyin?: string;
  english?: string;
  fun_facts?: string;
}

export interface StartSessionRequest {
  deck_id?: string; // null = all decks
  include_new?: boolean;
  limit?: number;
}

export interface RecordReviewRequest {
  card_id: string;
  rating: Rating;
  time_spent_ms?: number;
  user_answer?: string;
}

export interface GenerateDeckRequest {
  prompt: string;
  deck_name?: string;
}

export interface SuggestCardsRequest {
  context: string; // e.g., "words related to 吃饭"
  count?: number;
}

// Extended types for API responses (with joins)
export interface NoteWithCards extends Note {
  cards: Card[];
}

export interface DeckWithNotes extends Deck {
  notes: Note[];
}

export interface CardWithNote extends Card {
  note: Note;
}

export interface SessionWithReviews extends StudySession {
  reviews: (CardReview & { card: CardWithNote })[];
}

// AI generation types
export interface GeneratedNote {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
}

export interface GeneratedDeck {
  deck_name: string;
  deck_description: string;
  notes: GeneratedNote[];
}

// Statistics types
export interface OverviewStats {
  total_cards: number;
  cards_due_today: number;
  cards_studied_today: number;
  cards_studied_this_week: number;
  average_accuracy: number;
  streak_days: number;
}

export interface DeckStats {
  deck_id: string;
  deck_name: string;
  total_notes: number;
  total_cards: number;
  cards_due: number;
  cards_mastered: number; // interval > 21 days
  average_ease: number;
}

// Queue counts for Anki-style display
export interface QueueCounts {
  new: number;      // Blue - new cards
  learning: number; // Red - learning + relearning cards
  review: number;   // Green - review cards
}

// Daily counts for new card limits
export interface DailyCount {
  id: string;
  user_id: string;
  deck_id: string | null;
  date: string;
  new_cards_studied: number;
}

// ============ Tutor-Student Relationships ============

export type RelationshipStatus = 'pending' | 'active' | 'removed';
export type RelationshipRole = 'tutor' | 'student';

export interface TutorRelationship {
  id: string;
  requester_id: string;
  recipient_id: string;
  requester_role: RelationshipRole;
  status: RelationshipStatus;
  created_at: string;
  accepted_at: string | null;
}

export interface TutorRelationshipWithUsers extends TutorRelationship {
  requester: Pick<User, 'id' | 'email' | 'name' | 'picture_url' | 'about' | 'time_zone' | 'voice_gender'>;
  recipient: Pick<User, 'id' | 'email' | 'name' | 'picture_url' | 'about' | 'time_zone' | 'voice_gender'>;
}

export interface Conversation {
  id: string;
  relationship_id: string;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
  // AI conversation fields
  scenario: string | null;
  user_role: string | null;
  ai_role: string | null;
  is_ai_conversation: boolean;
  voice_id: string | null;
  voice_speed: number | null;
}

export interface ConversationWithLastMessage extends Conversation {
  last_message?: Message & { attachment_kind?: ChatAttachment['kind'] | null };
  /** Messages from the other person after my read marker (not deleted). */
  unread?: number;
  other_user: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
}

export type MessageCheckStatus = 'correct' | 'needs_improvement';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  // Check status for user messages
  check_status: MessageCheckStatus | null;
  check_feedback: string | null;
  recording_url: string | null;
  reply_to_message_id: string | null;
  // Interactive translation fields
  translation: string | null;
  segmentation: string | null; // JSON-stringified SentenceBreakdown
  /** The sender's idempotency key (docs/CHAT.md §2), when the client sent one. */
  client_id?: string | null;
  /** Rich messages (docs/CHAT.md PR 2): set on ANY change after creation. */
  updated_at?: string | null;
  edited_at?: string | null;
  /** Soft delete: content '' and attachment null. */
  deleted_at?: string | null;
  attachment?: ChatAttachment | null;
  /** `/api/chat-media/<messageId>` when there is an attachment, else null. */
  media_url?: string | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
  /** The message this one was forwarded from (round 2 PR 3); shown as "↪ Forwarded". */
  forwarded_from?: string | null;
  /**
   * Listening mode (docs/CHAT.md "Listening mode"): the id of the message's
   * pre-generated read-aloud clip (`<messageId>-<hash>`, the hash covering
   * text + voice), null until made / after an edit. `GET /api/messages/:id/audio`.
   */
  audio_clip?: string | null;
  /**
   * Learning tools (docs/CHAT.md PR 3): the text split into word chips
   * (shared/reader/words.ts), concatenating exactly to `content` — or, for a
   * voice message, to `attachment.transcript` (`words_source`). Null until
   * made, and whenever the text changed since.
   */
  words?: ChatWord[] | null;
  words_source?: 'content' | 'transcript' | null;
  /** The tutor's corrected version of this (student's) message. */
  correction?: ChatCorrection | null;
}

/** One segment of a chat message's text (same shape as a reader page's word chip). */
export interface ChatWord {
  text: string;
  pinyin: string;
  gloss: string;
}

/** The tutor's correction of a message (docs/CHAT.md PR 3). */
export interface ChatCorrection {
  text: string;
  note: string | null;
  /** The tutor's user id. */
  by: string;
  at: string;
}

/** A photo or voice message (docs/CHAT.md PR 2) as clients see it — the R2 key is never sent. */
export type ChatAttachment =
  | { kind: 'image'; width: number; height: number; bytes: number; mime: string }
  | {
      kind: 'voice';
      duration_ms: number;
      bytes: number;
      mime: string;
      transcript_status: 'pending' | 'done' | 'failed';
      transcript?: string | null;
      translation?: string | null;
    }
  /** A document (PDF, Word, Excel, PowerPoint, text, zip…) — round 2 PR 3. */
  | { kind: 'file'; name: string; bytes: number; mime: string }
  /** A short video clip (MP4 / WebM / MOV ≤ 25 MB); size and length as the sender's device measured them. */
  | { kind: 'video'; bytes: number; mime: string; duration_ms?: number | null; width?: number | null; height?: number | null };

export interface MessageReaction {
  emoji: string;
  users: Array<{ id: string; name: string | null }>;
  count: number;
}

export interface MessageWithSender extends Message {
  sender: Pick<User, 'id' | 'name' | 'picture_url'>;
  reply_to?: (Pick<MessageWithSender, 'id' | 'content' | 'sender'> & { deleted_at?: string | null }) | null;
  reactions?: MessageReaction[];
  has_discussion?: boolean;
}

export interface SharedDeck {
  id: string;
  relationship_id: string;
  source_deck_id: string;
  target_deck_id: string;
  shared_at: string;
}

export interface SharedDeckWithDetails extends SharedDeck {
  source_deck_name: string;
  target_deck_name: string;
}

// Request/Response types for relationships
export interface CreateRelationshipRequest {
  recipient_email: string;
  role: RelationshipRole; // The role the requester wants to be
}

export interface CreateConversationRequest {
  title?: string;
  // AI conversation fields (optional for regular conversations)
  scenario?: string;
  user_role?: string;
  ai_role?: string;
  voice_id?: string;
  voice_speed?: number;
}

export interface SendMessageRequest {
  content: string;
  reply_to_message_id?: string;
  /** Idempotency key: a second send with the same (sender, client_id) returns the first message. */
  client_id?: string;
}

export interface ShareDeckRequest {
  deck_id: string;
  /** Where the packet lands in the student's queue: 'core' (top, default) or 'non_urgent' (bottom). */
  priority?: 'core' | 'non_urgent';
}

export interface GenerateFlashcardRequest {
  message_ids?: string[]; // Optional: specific messages to use as context
}

// Pending invitations for non-users
export type PendingInvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

export interface PendingInvitation {
  id: string;
  inviter_id: string;
  recipient_email: string;
  inviter_role: RelationshipRole;
  status: PendingInvitationStatus;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface PendingInvitationWithInviter extends PendingInvitation {
  inviter: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
}

// Response types
export interface MyRelationships {
  tutors: TutorRelationshipWithUsers[];
  students: TutorRelationshipWithUsers[];
  pending_incoming: TutorRelationshipWithUsers[];
  pending_outgoing: TutorRelationshipWithUsers[];
  pending_invitations: PendingInvitationWithInviter[];
}

export interface StudentProgress {
  user: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
  stats: {
    total_cards: number;
    cards_due_today: number;
    cards_studied_today: number;
    cards_studied_this_week: number;
    average_accuracy: number;
  };
  decks: Array<{
    id: string;
    name: string;
    total_notes: number;
    cards_due: number;
    cards_mastered: number;
  }>;
}

// ============ AI Conversation Types ============

export const CLAUDE_AI_USER_ID = 'claude-ai';

export interface CreateAIConversationRequest {
  title?: string;
  scenario: string;
  user_role: string;
  ai_role: string;
  voice_id?: string;
  voice_speed?: number;
}

export interface AIRespondRequest {
  // Optional: override voice settings for this response
  voice_id?: string;
  voice_speed?: number;
}

export interface AIRespondResponse {
  message: MessageWithSender;
  audio_base64: string | null;
  audio_content_type: string | null;
}

export interface ConversationTTSRequest {
  text: string;
  voice_id?: string;
  voice_speed?: number;
}

export interface ConversationTTSResponse {
  audio_base64: string;
  content_type: string;
  provider: 'minimax' | 'gtts';
}

export interface CheckMessageResponse {
  status: MessageCheckStatus;
  feedback: string;
  corrections: GeneratedNote[] | null;  // Suggested flashcards for corrections
}

export interface UpdateConversationVoiceRequest {
  voice_id?: string;
  voice_speed?: number;
}

// Generated note with context for conversation-based flashcards
export interface GeneratedNoteWithContext extends GeneratedNote {
  context?: string;
}

// ============ Sentence Breakdown (Learning Subtitles) ============

// A chunk represents an aligned segment across hanzi, pinyin, and english
export interface SentenceChunk {
  hanzi: string;
  pinyin: string;
  english: string;
  // Indices into the full English sentence for highlighting (0-based, end is exclusive)
  englishStart: number;
  englishEnd: number;
  // Optional grammar/usage note for this chunk
  note?: string;
}

// The full breakdown of a sentence
export interface SentenceBreakdown {
  // Original input from user
  originalInput: string;
  // What language was the input
  inputLanguage: 'chinese' | 'english';
  // Full sentence in each form
  hanzi: string;
  pinyin: string;
  english: string;
  // Aligned chunks for stepping through
  chunks: SentenceChunk[];
  // Optional overall notes about the sentence
  grammarNotes?: string;
}

// Request to analyze a sentence
export interface AnalyzeSentenceRequest {
  sentence: string;
}

// Response from the API
export interface AnalyzeSentenceResponse extends SentenceBreakdown {}

// ============ Sentence Coach ============

export type SentenceIssueType = 'grammar' | 'word_choice' | 'word_order' | 'naturalness' | 'typo';

export interface SentenceIssue {
  type: SentenceIssueType;
  original: string;
  suggestion: string;
  explanation: string;
}

export interface SentenceAlternative {
  hanzi: string;
  pinyin: string;
  english: string;
  note?: string;
}

export interface VocabSuggestion {
  hanzi: string;
  pinyin: string;
  english: string;
  reason?: string;
}

export interface ExplainedWord {
  hanzi: string;
  pinyin: string;
  english: string;
  role?: string;
  notes?: string;
}

export interface GrammarPointExplanation {
  pattern: string;
  explanation: string;
  example?: string;
}

export interface SentenceExplanation {
  originalInput: string;
  hanzi: string;
  pinyin: string;
  english: string;
  overview: string;
  words: ExplainedWord[];
  grammar_points: GrammarPointExplanation[];
  nuance?: string;
  similar_examples: SentenceAlternative[];
}

export interface SentenceCoachResult {
  originalInput: string;
  inputLanguage: 'chinese' | 'english';
  // True when the learner's sentence was already correct and natural
  isCorrect: boolean;
  corrected: {
    hanzi: string;
    pinyin: string;
    english: string;
  };
  // Overall assessment in English
  critique: string;
  issues: SentenceIssue[];
  alternatives: SentenceAlternative[];
  // Words worth adding to a flashcard deck
  vocabSuggestions: VocabSuggestion[];
}

// English -> Chinese translation with explanation (Sentence Coach)
export interface SentenceTranslation {
  originalInput: string;
  primary: SentenceAlternative;
  alternatives: SentenceAlternative[];
  words: ExplainedWord[];
  grammar_points: GrammarPointExplanation[];
  usage_note?: string;
}

// ============ Sentence Coach conversations ============

export type CoachInputLanguage = 'zh' | 'en';

// Structured payload stored in the first assistant message of a conversation
export type CoachAnalysis =
  // explanation is legacy: older conversations stored a full word-by-word
  // breakdown alongside the coach result. New conversations omit it to keep the
  // initial analysis short and fast.
  | { kind: 'chinese'; coach: SentenceCoachResult; explanation?: SentenceExplanation }
  | { kind: 'english'; translation: SentenceTranslation }
  // Explain (Chinese input): translation + the word-by-word breakdown, each word addable as a card.
  | { kind: 'explain'; breakdown: CoachBreakdown };

export interface CoachConversation {
  id: string;
  user_id: string;
  title: string;
  input_language: CoachInputLanguage;
  /** Which button started it: check | explain | translate (NULL on rows from before 0084) */
  action?: 'check' | 'explain' | 'translate' | null;
  created_at: string;
  updated_at: string;
}

export interface CoachMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content_type: 'text' | 'analysis';
  content: string;
  tool_results: string | null;
  created_at: string;
}

// ============ Graded Readers ============

export type DifficultyLevel = 'beginner' | 'elementary' | 'intermediate' | 'advanced';

export interface VocabularyItem {
  hanzi: string;
  pinyin: string;
  english: string;
}

export type ReaderStatus = 'generating' | 'ready' | 'failed';

export interface GradedReader {
  id: string;
  user_id: string;
  title_chinese: string;
  title_english: string;
  difficulty_level: DifficultyLevel;
  topic: string | null;
  source_deck_ids: string[];
  vocabulary_used: VocabularyItem[];
  status: ReaderStatus;
  error_message?: string | null;
  is_published?: number;
  creator_role?: string;
  created_at: string;
}

export interface ReaderPage {
  id: string;
  reader_id: string;
  page_number: number;
  content_chinese: string;
  content_pinyin: string;
  content_english: string;
  image_url: string | null;
  image_prompt: string | null;
  /** Word chips (shared/reader/words.ts): parsed, null when missing or stale. Raw JSON in the column. */
  words?: ReaderWord[] | null;
}

export interface GradedReaderWithPages extends GradedReader {
  pages: ReaderPage[];
}

export interface GenerateReaderRequest {
  // 'decks' (default): story from learned vocabulary of the given decks.
  // 'due_cards': story that best-effort features the given notes' words
  // (the client sends the note ids of today's due cards).
  source?: 'decks' | 'due_cards';
  deck_ids?: string[];
  note_ids?: string[];
  topic?: string;
  difficulty?: DifficultyLevel;
}

export interface GeneratedStory {
  title_chinese: string;
  title_english: string;
  characters: Record<string, string>;  // name -> description
  locations: Record<string, string>;   // name -> description
  pages: Array<{
    content_chinese: string;
    content_pinyin: string;
    content_english: string;
    characters_in_scene: string[];     // character names in this scene
    location: string;                   // location name for this scene
    image_prompt: string;
  }>;
}

// ============ Shared Deck Progress (Tutor View) ============

// Tutor-friendly mastery levels (no FSRS jargon)
export type MasteryLevel = 'new' | 'learning' | 'familiar' | 'mastered';

export interface SharedDeckProgress {
  // Deck info
  deck_name: string;
  shared_at: string;
  student: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;

  // Completion stats
  completion: {
    total_cards: number;
    cards_seen: number;
    cards_mastered: number;
    percent_seen: number;
    percent_mastered: number;
  };

  // Breakdown by card type
  card_type_breakdown: {
    hanzi_to_meaning: CardTypeStats;
    meaning_to_hanzi: CardTypeStats;
    audio_to_hanzi: CardTypeStats;
  };

  // All notes with mastery info, sorted by mastery descending
  notes: NoteProgress[];

  // Recent activity
  activity: {
    last_studied_at: string | null;
    total_study_time_ms: number;
    reviews_last_7_days: number;
  };
}

export interface CardTypeStats {
  total: number;
  new: number;
  learning: number;
  familiar: number;
  mastered: number;
}

export interface NoteProgress {
  hanzi: string;
  pinyin: string;
  english: string;
  mastery_percent: number;  // 0-100, based on average stability
  recent_ratings: {         // Last N review ratings (0-3) per card type, newest first
    hanzi_to_meaning: number[];
    meaning_to_hanzi: number[];
    audio_to_hanzi: number[];
  };
}

// Progress view for a user's own deck (not shared)
export interface DeckProgress {
  deck_name: string;
  deck_id: string;

  // Completion stats
  completion: {
    total_cards: number;
    cards_seen: number;
    cards_mastered: number;
    percent_seen: number;
    percent_mastered: number;
  };

  // Breakdown by card type
  card_type_breakdown: {
    hanzi_to_meaning: CardTypeStats;
    meaning_to_hanzi: CardTypeStats;
    audio_to_hanzi: CardTypeStats;
  };

  // All notes with mastery info, sorted by mastery descending
  notes: NoteProgress[];

  // Recent activity
  activity: {
    last_studied_at: string | null;
    total_study_time_ms: number;
    reviews_last_7_days: number;
  };
}

// ============ Student Shared Decks ============
// Different from tutor->student sharing: this grants view access to student's existing deck

export interface StudentSharedDeck {
  id: string;
  relationship_id: string;
  deck_id: string;
  shared_at: string;
}

export interface StudentSharedDeckWithDetails extends StudentSharedDeck {
  deck_name: string;
  deck_description: string | null;
  note_count: number;
}

export interface StudentShareDeckRequest {
  deck_id: string;
}

// For the deck detail page: shows which tutors a deck has been shared with
export interface DeckTutorShare {
  relationship_id: string;
  shared_deck_id: string;
  shared_at: string;
  tutor: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
}

// ============ Notifications ============

export type NotificationType = 'new_chat_message';

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  note_id: string | null;
  conversation_id: string | null;
  relationship_id: string | null;
  is_read: boolean;
  created_at: string;
}
