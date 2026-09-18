/**
 * Types for the lesson editor, its Claude side-chat and the tutor's lesson
 * library (worker/src/routes/lesson-editor.ts).
 */

import type { CustomLessonSpec, LessonDiff } from '@shared/lesson';
import type { UserSummary } from '../types';

export interface LibraryItemSummary {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  assignment_count: number;
  exercise_count: number;
}

export interface LibraryItem {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  spec: CustomLessonSpec;
  assignment_count: number;
}

export interface EditableLesson {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
  library_item_id: string | null;
  assigned_by: string | null;
  assigned_relationship_id: string | null;
  spec: CustomLessonSpec;
  is_owner: boolean;
}

export interface LibraryAssignment {
  lesson_id: string;
  relationship_id: string | null;
  assigned_at: string;
  student: UserSummary;
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
  last_score: { correct: number; total: number } | null;
  up_to_date: boolean;
}

export interface AssignResult {
  assigned: Array<{ relationship_id: string; lesson_id: string; student_id: string }>;
  already_had: Array<{ relationship_id: string; lesson_id: string; student_id: string }>;
  errors: Array<{ relationship_id: string; error: string }>;
}

export interface PushUpdateResult {
  updated: number;
  skipped: number;
  image_jobs: number;
}

export interface StudentLessonSummary {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  exercise_count: number;
  library_item_id: string | null;
  assigned_by: string | null;
  assigned_by_me: boolean;
  completions: number;
  last_completed_at: string | null;
  last_rating: number | null;
  last_score: { correct: number; total: number } | null;
}

export type EditorTargetType = 'lesson' | 'library';

export interface EditorChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  proposal_status: 'pending' | 'accepted' | 'rejected' | null;
  proposed_spec: CustomLessonSpec | null;
  proposal_diff: LessonDiff | null;
  author_changes: string[];
}

export interface EditorChatState {
  chat: { id: string; target_type: string; target_id: string };
  ai_available: boolean;
  messages: EditorChatMessage[];
}

export interface SendEditorMessageResult {
  user_message: EditorChatMessage;
  message: EditorChatMessage;
  proposal: { id: string; spec: CustomLessonSpec; diff: LessonDiff | null } | null;
}

export type ExportFormat = 'md' | 'json' | 'csv';
