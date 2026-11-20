/**
 * What the sentence generator knows about the learner a note belongs to (services/sentence-set.ts;
 * docs/STUDY_SESSION.md "Listen in context"): his bio, a sample of the words he has started (the same
 * deterministic sample the Claude chats use, claude-agent/learner.ts) and a short mix of the grammar
 * structures from his done mini lessons (services/learner-structures.ts → structuresForPrompt) and his
 * "Example sentence style" (`users.sentence_style`, shared/study/sentenceStyle.ts; NULL = everyday). The
 * learner's OWN rows only — never a tutor's private student profile. Each part is best-effort: a failure
 * leaves it empty, never in the way of the sentences.
 */
import { structuresForPrompt, type LearnerStructure } from '../../../shared/lesson/learnerStructures';
import { sampleKnownWords } from './claude-agent/learner';
import { getLearnerStructures } from './learner-structures';
import { sentenceStyleOf, type SentenceStyle } from '../../../shared/study/sentenceStyle';

/** At most this many known words go into one sentence prompt. */
export const SENTENCE_KNOWN_WORDS_MAX = 60;

export interface SentenceLearnerContext {
  userId: string | null;
  bio: string | null;
  knownWords: string[];
  structures: LearnerStructure[];
  /** The register his new sentences are written in (the note OWNER's setting; default everyday). */
  style: SentenceStyle;
}

export async function sentenceLearnerContext(db: D1Database, noteId: string, word?: string | null): Promise<SentenceLearnerContext> {
  const owner = await db
    .prepare(`SELECT d.user_id AS user_id, u.bio AS bio, u.sentence_style AS sentence_style FROM notes n JOIN decks d ON d.id = n.deck_id JOIN users u ON u.id = d.user_id WHERE n.id = ?`)
    .bind(noteId)
    .first<{ user_id: string; bio: string | null; sentence_style: string | null }>()
    .catch(() => null);
  if (!owner?.user_id) return { userId: null, bio: null, knownWords: [], structures: [], style: sentenceStyleOf(null) };
  const [known, structures] = await Promise.all([
    sampleKnownWords(db, owner.user_id, SENTENCE_KNOWN_WORDS_MAX).catch(() => [] as string[]),
    getLearnerStructures(db, owner.user_id).catch(() => [] as LearnerStructure[]),
  ]);
  return {
    userId: owner.user_id,
    bio: owner.bio ?? null,
    knownWords: known.filter((w) => w !== word),
    structures: structuresForPrompt(structures),
    style: sentenceStyleOf(owner.sentence_style),
  };
}
