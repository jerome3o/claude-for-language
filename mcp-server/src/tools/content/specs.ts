/**
 * Pure helpers shared by the content tools: the spec documentation pasted
 * into tool descriptions (Claude authors readers and lessons from these),
 * local pre-validation with the same validators the API uses, and the
 * trimming of API responses into what the model needs to see.
 *
 * Nothing here touches the network, so it is unit-tested directly.
 */
import { validateReaderSpec } from '../../../../shared/reader/validate';
import { READER_STANDARD_SHORT } from '../../../../shared/reader/standard';
import type { ReaderSpec } from '../../../../shared/reader/types';
import { validateLessonSpec } from '../../../../shared/lesson/validate';
import { cardTextProblems } from '../../../../shared/cards/standard';
import { LESSON_SPEC_DOC as SHARED_LESSON_SPEC_DOC } from '../../../../shared/lesson/doc';
import type { CustomLessonSpec } from '../../../../shared/lesson/types';

export type { ReaderSpec, CustomLessonSpec };

// ============ Spec documentation for tool descriptions ============

export const READER_SPEC_DOC = `ReaderSpec shape (JSON):
{
  "title_chinese": string,              // required
  "title_english": string,              // required
  "difficulty_level": "beginner" | "elementary" | "intermediate" | "advanced",
  "topic"?: string | null,
  "vocabulary_used"?: [{ "hanzi": string, "pinyin": string, "english": string }],  // glossary in exports / Quizlet CSV
  "pages": [                            // 1-60 pages, in reading order
    {
      "id"?: string,                    // server-filled; keep it when editing an existing page (see update_reader)
      "content_chinese": string,        // required, simplified characters
      "content_pinyin": string,         // tone-marked pinyin (nǐ hǎo), may be "" to auto-fill later in the editor
      "content_english": string,        // required
      "image_prompt"?: string | null    // English scene description → illustration generated in the background; null = no picture
    }
  ]
}
Rules: ${READER_STANDARD_SHORT} Keep to the learner's level; always tone marks, never tone numbers; image_prompt in English, no text in the picture. Pages over the standard come back as warnings (the reader is still saved).`;

/** The lesson spec documentation — one text in shared/lesson/doc.ts, also read by the worker's lesson authors. */
export const LESSON_SPEC_DOC = SHARED_LESSON_SPEC_DOC;

// ============ Local pre-validation ============

/** Problems with a reader spec (empty = valid), using the API's own validator. */
export function readerSpecProblems(spec: unknown): string[] {
  return validateReaderSpec(spec);
}

/** Problems with a lesson spec (empty = valid), using the API's own validator. */
export function lessonSpecProblems(spec: unknown): string[] {
  return validateLessonSpec(spec);
}

export function formatProblems(what: string, problems: string[]): string {
  return `${what} is invalid — fix these and retry:\n- ${problems.join('\n- ')}`;
}

// ============ Trimming API responses ============

export interface ReaderListRow {
  id: string;
  title_chinese: string;
  title_english: string;
  difficulty_level: string;
  topic: string | null;
  status: string;
  error_message?: string | null;
  is_published?: number;
  creator_role?: string;
  created_at: string;
  pages?: unknown[];
}

export interface ReaderListItem {
  id: string;
  title_chinese: string;
  title_english: string;
  difficulty_level: string;
  topic: string | null;
  status: string;
  error_message?: string;
  page_count: number;
  created_at: string;
  creator_role: string;
  is_published: boolean;
}

export function trimReader(row: ReaderListRow): ReaderListItem {
  const item: ReaderListItem = {
    id: row.id,
    title_chinese: row.title_chinese,
    title_english: row.title_english,
    difficulty_level: row.difficulty_level,
    topic: row.topic ?? null,
    status: row.status,
    page_count: Array.isArray(row.pages) ? row.pages.length : 0,
    created_at: row.created_at,
    creator_role: row.creator_role ?? 'student',
    is_published: (row.is_published ?? 1) !== 0,
  };
  if (row.error_message) item.error_message = row.error_message;
  return item;
}

export type ReaderStatusFilter = 'ready' | 'generating' | 'failed' | 'all';

export function filterReaders(rows: ReaderListRow[], status: ReaderStatusFilter | undefined): ReaderListItem[] {
  const wanted = status ?? 'all';
  return rows.filter(r => wanted === 'all' || r.status === wanted).map(trimReader);
}

// ============ Notes for student decks ============

export interface NoteInput {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
  sentence_clue?: string;
}

export interface NormalizedNotes {
  notes: NoteInput[];
  /** Inputs dropped before any API call, with the reason. */
  rejected: Array<{ hanzi: string; reason: string }>;
}


/**
 * Trim, drop notes missing a required field, drop duplicate hanzi within the
 * batch, and flag tone-number pinyin (the app requires tone marks).
 */
export function normalizeNotes(input: NoteInput[]): NormalizedNotes {
  const notes: NoteInput[] = [];
  const rejected: NormalizedNotes['rejected'] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const hanzi = (raw.hanzi ?? '').trim();
    const pinyin = (raw.pinyin ?? '').trim();
    const english = (raw.english ?? '').trim();
    if (!hanzi || !pinyin || !english) {
      rejected.push({ hanzi: hanzi || '(blank)', reason: 'hanzi, pinyin and english are all required' });
      continue;
    }
    // The HARD rules of the card standard, checked here so Claude gets the
    // reason without a round trip (the API checks them again).
    const problems = cardTextProblems({ hanzi, pinyin, sentence_clue: raw.sentence_clue });
    if (problems.length) {
      rejected.push({ hanzi, reason: problems.map(p => p.message).join('; ') });
      continue;
    }
    if (seen.has(hanzi)) {
      rejected.push({ hanzi, reason: 'duplicate hanzi in this batch' });
      continue;
    }
    seen.add(hanzi);
    const note: NoteInput = { hanzi, pinyin, english };
    if (raw.fun_facts?.trim()) note.fun_facts = raw.fun_facts.trim();
    if (raw.sentence_clue?.trim()) note.sentence_clue = raw.sentence_clue.trim();
    notes.push(note);
  }
  return { notes, rejected };
}

/** Of `noteIds`, the ones whose note in `deckNotes` still has no audio_url. */
export function notesMissingAudio(
  deckNotes: Array<{ id: string; audio_url: string | null }>,
  noteIds: string[],
): string[] {
  const byId = new Map(deckNotes.map(n => [n.id, n.audio_url]));
  return noteIds.filter(id => !byId.get(id));
}
