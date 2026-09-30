-- Video calls: the text board keeps its content per tutor relationship across calls, as pages
-- (shared/calls/pages.ts). A solo test call's pages belong to its caller (relationship_id NULL).
-- Each page is one text CRDT document (shared/calls/textDoc.ts); the CallRoom Durable Object holds
-- the relationship's pages during a call and writes them back here.
CREATE TABLE IF NOT EXISTS board_pages (
  id TEXT PRIMARY KEY,
  relationship_id TEXT,
  -- Who made the page (for a solo call's pages: whose they are).
  owner_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT,
  -- TextDocSnapshot JSON ({ v: 1, runs: [[counter, site, text, deleted]] }).
  doc_json TEXT,
  -- The page's plain text (lists, the offline cache, previews).
  text TEXT NOT NULL DEFAULT '',
  created_in_call_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- When a call last opened or edited it (the "continue today's page" rule).
  last_used_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_board_pages_relationship ON board_pages(relationship_id, position);
CREATE INDEX IF NOT EXISTS idx_board_pages_owner ON board_pages(owner_id);

-- The pages a call wrote on, with each page's text as it stood when that call ended — so the
-- review page, the lesson report and the homework agent read what was written in THAT call.
CREATE TABLE IF NOT EXISTS call_board_pages (
  call_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  edited INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (call_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_call_board_pages_page ON call_board_pages(page_id);

-- History starts populated: every earlier call's board text becomes a page of its relationship
-- (in call order), one run from the site "import:<call id>" — snapshotFromText() in pages.ts.
INSERT OR IGNORE INTO board_pages (id, relationship_id, owner_id, position, title, doc_json, text, created_in_call_id, created_at, updated_at, last_used_at)
SELECT
  'bp' || c.id,
  c.relationship_id,
  c.created_by,
  ROW_NUMBER() OVER (
    PARTITION BY COALESCE(c.relationship_id, 'user:' || c.created_by)
    ORDER BY COALESCE(c.started_at, CAST(strftime('%s', c.created_at) AS INTEGER) * 1000), c.id
  ),
  NULL,
  json_object('v', 1, 'runs', json_array(json_array(1, 'import:' || c.id, c.board_text, 0))),
  c.board_text,
  c.id,
  COALESCE(c.started_at, CAST(strftime('%s', c.created_at) AS INTEGER) * 1000),
  COALESCE(c.ended_at, c.started_at, CAST(strftime('%s', c.created_at) AS INTEGER) * 1000),
  COALESCE(c.ended_at, c.started_at, CAST(strftime('%s', c.created_at) AS INTEGER) * 1000)
FROM calls c
WHERE c.board_text IS NOT NULL AND TRIM(c.board_text) <> '';

INSERT OR IGNORE INTO call_board_pages (call_id, page_id, text, edited, opened_at)
SELECT c.id, 'bp' || c.id, c.board_text, 1, COALESCE(c.started_at, CAST(strftime('%s', c.created_at) AS INTEGER) * 1000)
FROM calls c
WHERE c.board_text IS NOT NULL AND TRIM(c.board_text) <> '';
