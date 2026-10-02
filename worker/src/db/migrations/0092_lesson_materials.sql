-- Lesson materials (round 4, docs/VIDEO_CALLS.md "Lesson materials"): a tutor's library of PDFs,
-- pictures and PowerPoints, shared with students, presented in a call (page turns synced through
-- the CallRoom, drawn / typed on like a shared screen) and read by the homework agent and the MCP.
-- The uploader's device renders the pages (PDF: pdf.js; PPTX: its slides' text and pictures;
-- pictures as they are) and uploads them as images, so every viewer only shows pictures.
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  -- pdf | image | pptx
  kind TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  -- R2 materials/<owner>/<id>/original.<ext> (protected: person-made)
  original_key TEXT,
  original_size INTEGER,
  -- uploading | ready | failed
  status TEXT NOT NULL DEFAULT 'uploading',
  page_count INTEGER NOT NULL DEFAULT 0,
  -- e.g. PPTX: "Slides drawn from their text and pictures — export as PDF for exact slides"
  render_note TEXT,
  -- Every page's text (+ speaker notes), for the homework agent and the MCP
  text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_materials_owner ON materials(owner_id, created_at);

CREATE TABLE IF NOT EXISTS material_pages (
  material_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  -- R2 materials/<owner>/<id>/p<N>.<ext>
  image_key TEXT,
  width INTEGER,
  height INTEGER,
  text TEXT,
  notes TEXT,
  PRIMARY KEY (material_id, page_index)
);

-- Shared with a student (either person of the relationship may view it). Presenting a material in a
-- call of that relationship shares it.
CREATE TABLE IF NOT EXISTS material_shares (
  material_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  shared_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (material_id, relationship_id)
);
CREATE INDEX IF NOT EXISTS idx_material_shares_rel ON material_shares(relationship_id);

-- Drawings and text on a material's page, per lesson (call_lessons.id): KeptAnnotations JSON.
CREATE TABLE IF NOT EXISTS material_annotations (
  lesson_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (lesson_id, material_id, page_index)
);

-- What a call presented (the homework agent reads those materials for the lesson).
CREATE TABLE IF NOT EXISTS call_materials (
  call_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  -- JSON array of page indexes shown
  pages_shown TEXT NOT NULL DEFAULT '[]',
  first_at INTEGER NOT NULL,
  PRIMARY KEY (call_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_call_materials_material ON call_materials(material_id);
