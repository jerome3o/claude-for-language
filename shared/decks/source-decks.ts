/**
 * Source decks (docs/STUDY_SESSION.md "Source decks"): a card added from around the app goes
 * straight into a deck PER SOURCE — "From readers", "From chats", … — with no deck to choose.
 * Jerome (Nov 2026): "I don't care which deck a card lands in".
 *
 * - One deck per source FAMILY (not per screen), made on first use by the content service
 *   (`ensureSourceDeck`, worker services/content/decks.ts) with the shared new-deck defaults, and
 *   found again by its stable `decks.source_key` (migration 0150), never by name — renaming the
 *   deck keeps it the source deck.
 * - The note-create routes take a deck REF `source:<key>` in place of a deck id
 *   (`POST /api/decks/source:readers/notes`, `/notes/batch`), so a sheet adds in ONE request; the
 *   reply carries the deck (`deck: { id, name, source_key }`) for "Added to From readers · Change".
 * - "Change" moves the just-added note(s) to another deck (`POST /api/notes/move`).
 *
 * Ported to android-lab/core (SourceDecks.kt), parity-tested (parity/fixtures/source-decks.ts).
 */

export const SOURCE_DECK_KEYS = ['readers', 'chats', 'sentences', 'claude', 'explorer', 'practice'] as const;
export type SourceDeckKey = (typeof SOURCE_DECK_KEYS)[number];

export interface SourceDeckDef {
  key: SourceDeckKey;
  /** The deck's name when it is made (plain English; he may rename it — the key keeps it). */
  name: string;
  description: string;
  /**
   * Decks made by name before source keys existed (the reader word recap's "From my readers"):
   * the first one without a key is ADOPTED as this source deck instead of making a second one.
   */
  legacyNames: readonly string[];
}

export const SOURCE_DECKS: Readonly<Record<SourceDeckKey, SourceDeckDef>> = {
  readers: {
    key: 'readers',
    name: 'From readers',
    description: 'Words added while reading graded readers.',
    legacyNames: ['From my readers'],
  },
  chats: {
    key: 'chats',
    name: 'From chats',
    description: 'Words and sentences added from your chats.',
    legacyNames: [],
  },
  sentences: {
    key: 'sentences',
    name: 'From example sentences',
    description: 'Words and sentences added from the example sentences on your cards.',
    legacyNames: [],
  },
  claude: {
    key: 'claude',
    name: 'From Claude',
    description: 'Cards Claude made for you, and words added from your chats with Claude.',
    legacyNames: [],
  },
  explorer: {
    key: 'explorer',
    name: 'From the explorer',
    description: 'Words added from the word and character explorer.',
    legacyNames: [],
  },
  practice: {
    key: 'practice',
    name: 'From lessons & practice',
    description: 'Words added from lessons, video calls, picture hunts, clips, idioms, podcasts and other practice.',
    legacyNames: [],
  },
};

export function isSourceDeckKey(value: unknown): value is SourceDeckKey {
  return typeof value === 'string' && (SOURCE_DECK_KEYS as readonly string[]).includes(value);
}

export function sourceDeckName(key: SourceDeckKey): string {
  return SOURCE_DECKS[key].name;
}

const REF_PREFIX = 'source:';

/** The deck ref the note-create routes accept in place of a deck id: `source:readers`. */
export function sourceDeckRef(key: SourceDeckKey): string {
  return `${REF_PREFIX}${key}`;
}

/** The key of a deck ref (`source:readers` → readers; also URL-encoded `source%3Areaders`), else null. */
export function parseSourceDeckRef(ref: string | null | undefined): SourceDeckKey | null {
  if (typeof ref !== 'string') return null;
  let s = ref.trim();
  if (/^source%3a/i.test(s)) s = REF_PREFIX + s.slice('source%3a'.length);
  if (!s.startsWith(REF_PREFIX)) return null;
  const key = s.slice(REF_PREFIX.length);
  return isSourceDeckKey(key) ? key : null;
}

/** The learner's source deck for a key among their decks (by `source_key`, never by name). */
export function findSourceDeck<T extends { source_key?: string | null }>(decks: readonly T[], key: SourceDeckKey): T | null {
  return decks.find((d) => d.source_key === key) ?? null;
}

/** The deck to ADOPT for a key when none carries it yet: the oldest keyless deck with a legacy name. */
export function legacySourceDeck<T extends { name: string; source_key?: string | null; created_at?: string | null }>(
  decks: readonly T[],
  key: SourceDeckKey,
): T | null {
  const names = SOURCE_DECKS[key].legacyNames;
  if (names.length === 0) return null;
  const hits = decks.filter((d) => !d.source_key && names.includes(d.name.trim()));
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0];
}

function lookup(table: Readonly<Record<string, SourceDeckKey>>, source: string | null | undefined): SourceDeckKey {
  return source && Object.prototype.hasOwnProperty.call(table, source) ? table[source] : 'explorer';
}

/** Where the language explorer was opened from (frontend ExplorerSource / Lab ExplorerSource). */
export const EXPLORER_SOURCE_DECKS: Readonly<Record<string, SourceDeckKey>> = {
  reader: 'readers',
  read_aloud: 'readers',
  chat: 'chats',
  ask_claude: 'claude',
  claude_chat: 'claude',
  claude_card: 'claude',
  coach: 'claude',
  breakdown: 'sentences',
  sentence_round: 'sentences',
  lesson: 'practice',
  idioms: 'practice',
  audio_lesson: 'practice',
  meme_review: 'practice',
  clips: 'practice',
  phone: 'practice',
  podcast: 'practice',
  call: 'practice',
  picture_hunt: 'practice',
};

/**
 * The explorer's "+ Add as card": the source deck of the place it was opened from (a reader word
 * → From readers), else "From the explorer" (the study card, homework, the card hub, word tags…).
 */
export function sourceDeckForExplorer(source: string | null | undefined): SourceDeckKey {
  return lookup(EXPLORER_SOURCE_DECKS, source);
}

/** The add-card sheets' bump source (shared/decks/bumps.ts BumpSource) → its source deck. */
export const BUMP_SOURCE_DECKS: Readonly<Record<string, SourceDeckKey>> = {
  reader: 'readers',
  chat: 'chats',
  chat_discuss: 'chats',
  coach: 'claude',
  coach_chat: 'claude',
  ask_claude: 'claude',
  breakdown: 'sentences',
  homework_pass: 'sentences',
  picture_hunt: 'practice',
  idioms: 'practice',
};

export function sourceDeckForBump(source: string | null | undefined): SourceDeckKey {
  return lookup(BUMP_SOURCE_DECKS, source);
}

/** "Added to From readers" (the sheet adds " · Change" as its button). */
export function addedToDeckLine(deckName: string, count = 1): string {
  const name = deckName.trim() || 'your deck';
  return count > 1 ? `${count} cards added to ${name}` : `Added to ${name}`;
}

/** After "Change": "Moved to HSK 2". */
export function movedToDeckLine(deckName: string, count = 1): string {
  const name = deckName.trim() || 'your deck';
  return count > 1 ? `${count} cards moved to ${name}` : `Moved to ${name}`;
}
