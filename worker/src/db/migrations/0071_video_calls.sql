-- Video calls (experimental): a live 1:1 lesson between a tutor and a
-- student — WebRTC media peer to peer, signalling / whiteboard / in-call chat
-- through the CallRoom Durable Object. Each participant records their OWN
-- microphone in the browser, in pieces of a few minutes, uploaded in small
-- chunks; after the call every piece is transcribed on call-processing-queue
-- and Claude writes a lesson report (summary, vocabulary, corrections).
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  relationship_id TEXT,
  created_by TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  -- none → waiting_uploads → transcribing → summarizing → done | failed
  processing_status TEXT NOT NULL DEFAULT 'none',
  processing_error TEXT,
  -- Epoch ms, server clock. started_at = first person in the room.
  started_at INTEGER,
  ended_at INTEGER,
  board_json TEXT,
  chat_json TEXT,
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calls_relationship ON calls(relationship_id, created_at);
CREATE INDEX IF NOT EXISTS idx_calls_created_by ON calls(created_by, created_at);

-- One continuous stretch of one person's microphone (a standalone webm/opus
-- file once assembled). The id is made by the client so registering is
-- idempotent when the upload queue retries.
CREATE TABLE IF NOT EXISTS call_recording_pieces (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  piece_index INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  duration_ms INTEGER,
  mime_type TEXT NOT NULL DEFAULT 'audio/webm',
  -- NULL until the client closes the piece (then: how many chunks to expect).
  chunk_count INTEGER,
  -- recording → ready (closed + every chunk uploaded) → queued → transcribing → done | failed
  status TEXT NOT NULL DEFAULT 'recording',
  audio_key TEXT,
  size_bytes INTEGER,
  provider TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_call_pieces_call ON call_recording_pieces(call_id, user_id, piece_index);

CREATE TABLE IF NOT EXISTS call_recording_chunks (
  piece_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (piece_id, idx)
);

CREATE TABLE IF NOT EXISTS call_transcript_segments (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  piece_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  language TEXT,
  pinyin TEXT,
  translation TEXT
);

CREATE INDEX IF NOT EXISTS idx_call_segments_call ON call_transcript_segments(call_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_call_segments_piece ON call_transcript_segments(piece_id);
