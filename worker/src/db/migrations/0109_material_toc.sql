-- A material's Contents (shared/materials/toc.ts): JSON [{ title, page (0-based), level (0 | 1) }] read on the
-- uploader's device (PDF outline via pdf.js, PowerPoint slide titles). NULL = never computed (older materials:
-- the uploader's web app fills it in when it next opens the material; until then a page list is shown),
-- '[]' = computed, nothing found (the page list is shown).
ALTER TABLE materials ADD COLUMN toc TEXT;
