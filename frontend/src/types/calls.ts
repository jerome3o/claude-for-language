/** Video calls (experimental) — shapes returned by worker/src/routes/calls.ts. */

import type { BoardItem, CallChatMessage, TranscriptSegment } from '@shared/calls';

export type CallStatus = 'live' | 'ended';
export type CallProcessingStatus = 'none' | 'waiting_uploads' | 'transcribing' | 'summarizing' | 'done' | 'failed';

export interface CallListItem {
  id: string;
  relationship_id: string | null;
  created_by: string;
  title: string | null;
  status: CallStatus;
  processing_status: CallProcessingStatus;
  started_at: number | null;
  ended_at: number | null;
  created_at: string;
  other_user_name: string | null;
  segment_count: number;
  has_summary: boolean;
}

export interface CallInfo {
  id: string;
  relationship_id: string | null;
  created_by: string;
  title: string | null;
  status: CallStatus;
  processing_status: CallProcessingStatus;
  processing_error: string | null;
  started_at: number | null;
  ended_at: number | null;
  created_at: string;
}

export interface CallParticipant {
  id: string;
  name: string | null;
  email: string;
  picture_url: string | null;
}

export interface CallPieceInfo {
  id: string;
  user_id: string;
  piece_index: number;
  started_at: number;
  duration_ms: number | null;
  status: 'recording' | 'ready' | 'queued' | 'transcribing' | 'done' | 'failed';
  error: string | null;
  provider: string | null;
  audio_url: string | null;
}

export interface CallReportWord {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
  from_call?: string;
}

export interface CallReport {
  summary: string;
  topics: string[];
  vocabulary: CallReportWord[];
  corrections: Array<{ said: string; better: string; pinyin?: string; explanation: string }>;
  follow_ups: string[];
  model: string;
  generated_at: string;
}

export interface CallDetail {
  call: CallInfo;
  participants: CallParticipant[];
  board: BoardItem[];
  chat: CallChatMessage[];
  report: CallReport | null;
  pieces: CallPieceInfo[];
  transcript: TranscriptSegment[];
  transcriber: string;
}

export interface CallJoinInfo {
  ticket: string;
  ws_path: string;
  ice_servers: RTCIceServer[];
  turn: boolean;
}
