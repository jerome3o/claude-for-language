/**
 * Graded reader spec — the whole reader (meta + ordered pages) as one JSON
 * value, the unit the reader editor, its Claude co-editor chat, the exports
 * and the import path all work with.
 *
 * Server-filled fields (`id` on a page, `image_url`) are optional so an
 * agent-authored or imported spec validates without them; `readerToExportSpec`
 * strips them for re-importable JSON.
 */

export const READER_DIFFICULTIES = ['beginner', 'elementary', 'intermediate', 'advanced'] as const;
export type ReaderDifficulty = (typeof READER_DIFFICULTIES)[number];

export interface ReaderVocabularyItem {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface ReaderPageSpec {
  /** reader_pages.id — present for stored pages; omitted/unknown = new page. */
  id?: string;
  content_chinese: string;
  /** Tone-marked pinyin. May be blank (auto-fill in the editor). */
  content_pinyin: string;
  content_english: string;
  /** English scene description for the illustration; null/blank = no picture. */
  image_prompt?: string | null;
  /** Server-filled R2 key; never written by the client. */
  image_url?: string | null;
}

export interface ReaderSpec {
  title_chinese: string;
  title_english: string;
  difficulty_level: ReaderDifficulty;
  topic?: string | null;
  /** Vocabulary the story was built from (glossary in exports). */
  vocabulary_used?: ReaderVocabularyItem[];
  pages: ReaderPageSpec[];
}

/** A spec with server-filled fields removed — what the JSON export contains. */
export type ReaderExportSpec = Omit<ReaderSpec, 'pages'> & {
  pages: Array<Omit<ReaderPageSpec, 'id' | 'image_url'>>;
};
