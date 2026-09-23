-- Tombstones for deleted decks and notes, so that offline-first clients can
-- drop them from IndexedDB on their next sync (the sync route used to return
-- empty deletion lists, and a deleted deck stayed on every phone until a full
-- resync). Written by DELETE /api/decks/:id, DELETE /api/notes/:id, the Ask
-- Claude delete_current_card tool and the MCP server's delete_deck /
-- delete_note. Rows can be pruned once older than any client's last sync.
CREATE TABLE IF NOT EXISTS deleted_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deck', 'note')),
  item_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deleted_items_user_time ON deleted_items(user_id, deleted_at);
