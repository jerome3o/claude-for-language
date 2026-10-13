package dev.jeromeswannack.chineselearning.lab.core

/**
 * "A character I've never seen before shimmers" on the study card. Port of
 * shared/study/newCharacters.ts (parity-tested: parity/fixtures/new-characters.ts →
 * NewCharactersParityTest).
 *
 * Never seen = the queue's "New characters first" rule (Novelty.kt / NewCardOrder.kt): seen =
 * the Han characters in the hanzi of every note with at least one REVIEWED card (any deck).
 * The study session builds the set once, adds a note's characters when one of its cards is
 * rated, and works out a card's new characters ONCE when it is shown — the shimmer stays on
 * that card while it is on screen.
 *
 * ONLY in the regular flashcard study session — never on the homework pass, the tutor-notes
 * practice or a preview — and never before the seen set is loaded ("not loaded" is NOT "nothing
 * seen": that made every character of a homework sentence shimmer). One rule: [forCard].
 */
object NewCharacters {
    /** Port of seenCharactersOf(). */
    fun seenCharactersOf(hanzi: Iterable<String>): MutableSet<String> {
        val seen = HashSet<String>()
        for (h in hanzi) markCharactersSeen(seen, h)
        return seen
    }

    /** Port of markCharactersSeen() (mutates [seen]). */
    fun markCharactersSeen(seen: MutableSet<String>, hanzi: String) {
        seen += Known.hanCharacters(hanzi)
    }

    /** Port of newCharactersIn(): distinct never-seen Han characters, in order of first appearance. */
    fun newCharactersIn(text: String, seen: Set<String>): List<String> =
        Known.hanCharacters(text).filter { it !in seen }

    /**
     * Port of cardNewCharacters(): none outside the flashcard study session ([inStudySession] false:
     * homework pass, tutor-notes practice, previews) and none while [seen] isn't loaded (null). An
     * EMPTY loaded set is real (no reviews on the account yet).
     */
    fun forCard(text: String, seen: Set<String>?, inStudySession: Boolean): List<String> =
        if (!inStudySession || seen == null) emptyList() else newCharactersIn(text, seen)

    /** Port of newCharacterMask(): per code point, true for a never-seen Han character. */
    fun newCharacterMask(text: String, seen: Set<String>): List<Boolean> =
        text.codePoints().toArray().map { cp -> Known.isHan(cp) && String(Character.toChars(cp)) !in seen }

    /** Port of newCharactersLabel(): "New character: 银" / "New characters: 银, 行"; "" when none. */
    fun label(chars: List<String>): String =
        if (chars.isEmpty()) "" else "${if (chars.size == 1) "New character" else "New characters"}: ${chars.joinToString(", ")}"
}
