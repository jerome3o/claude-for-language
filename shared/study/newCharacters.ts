/**
 * "A character I've never seen before shimmers" (docs/STUDY_SESSION.md "New characters shimmer").
 *
 * Never seen = the SAME rule as the queue's "New characters first" (shared/decks/novelty.ts,
 * new-card-order.ts): seen = the Han characters in the hanzi of every note with at least one
 * REVIEWED card (any deck, any card type). Only the note's hanzi counts — not its example
 * sentence. A character on the card that is not in that set is new.
 *
 * The apps build the seen set once per session from what the queue already loads, add a note's
 * characters when one of its cards is rated, and work out a card's new characters ONCE when it is
 * shown — so the shimmer stays on that card while it is on screen, and the next card already
 * knows the character.
 *
 * ONLY in the regular flashcard study session (FSRS cards): never on the homework pass, the
 * tutor-notes practice or a Try-it / preview viewer — Jerome: "it should really only be in the
 * flashcard section". And never before the seen set has actually been loaded: "not loaded yet" is
 * NOT "nothing seen" (that made every character of a homework sentence shimmer). One rule for both
 * apps: `cardNewCharacters`.
 *
 * Ported to the Lab app (android-lab/core NewCharacters.kt), parity-tested through
 * android-lab/parity/fixtures/new-characters.ts.
 */
import { hanCharacters, isHanCodePoint } from '../progress/known';

/** The seen characters of these notes' hanzi (the notes with a reviewed card). */
export function seenCharactersOf(hanzi: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  for (const h of hanzi) markCharactersSeen(seen, h);
  return seen;
}

/** A card of this note was rated: its characters are seen from now on (mutates `seen`). */
export function markCharactersSeen(seen: Set<string>, hanzi: string): void {
  for (const c of hanCharacters(hanzi)) seen.add(c);
}

/** The distinct never-seen Han characters of `text`, in order of first appearance. */
export function newCharactersIn(text: string, seen: ReadonlySet<string>): string[] {
  return hanCharacters(text).filter(c => !seen.has(c));
}

/**
 * The new characters a card shows: none outside the flashcard study session (`inStudySession`
 * false: homework pass, tutor-notes practice, previews) and none while the seen set isn't loaded
 * (`seen` null / undefined). An EMPTY loaded set is real (an account with no reviews yet).
 */
export function cardNewCharacters(text: string, seen: ReadonlySet<string> | null | undefined, inStudySession: boolean): string[] {
  if (!inStudySession || !seen) return [];
  return newCharactersIn(text, seen);
}

/**
 * Per code point of `text` (`[...text]`): true where it is a never-seen Han character — every
 * occurrence of it, so 谢谢 shimmers both 谢.
 */
export function newCharacterMask(text: string, seen: ReadonlySet<string>): boolean[] {
  const out: boolean[] = [];
  for (const ch of text) out.push(isHanCodePoint(ch.codePointAt(0)!) && !seen.has(ch));
  return out;
}

/** What a screen reader says beside the hanzi: "New character: 银" / "New characters: 银, 行"; '' when none. */
export function newCharactersLabel(chars: readonly string[]): string {
  if (chars.length === 0) return '';
  return `${chars.length === 1 ? 'New character' : 'New characters'}: ${chars.join(', ')}`;
}
