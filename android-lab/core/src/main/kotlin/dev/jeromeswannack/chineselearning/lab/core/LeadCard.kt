package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/decks/lead-card.ts — which card introduces a brand-new word (the ONE card of
 * an unseen note the primary, blue pool shows first). Default hanzi_to_meaning; with
 * "Words made of characters I know: start with English → Chinese" (NewCardOrder
 * `knownCharactersEnglishFirst`, on by default) a note whose Han characters are ALL known
 * (each in the hanzi of a note with a mature card: Review, stability > 21 days) leads with its
 * meaning_to_hanzi card instead, when it has one. Only the card type changes — never which
 * notes come or in what order. Parity-tested through the study-queue vectors (`leadCard`).
 */
object LeadCard {
    const val DEFAULT_TYPE = CardTypes.HANZI_TO_MEANING
    const val KNOWN_CHARACTERS_TYPE = CardTypes.MEANING_TO_HANZI
    const val KNOWN_STABILITY_DAYS = 21.0

    /** Mature: in Review with stability > 21 days (Progress mastery "mastered"). */
    fun isKnownState(queue: Int, stability: Double?): Boolean =
        queue == CardQueue.REVIEW && stability != null && stability > KNOWN_STABILITY_DAYS

    /** Notes with a known card. */
    fun knownNoteIds(cards: Collection<QueueCard>): Set<String> =
        cards.filter { isKnownState(it.queue, it.state.stability) }.mapTo(HashSet()) { it.noteId }

    /** Every Han character of the known notes' hanzi. */
    fun knownCharacters(hanzi: Iterable<String>): Set<String> {
        val out = HashSet<String>()
        for (h in hanzi) h.codePoints().forEach { cp -> if (Known.isHan(cp)) out += String(Character.toChars(cp)) }
        return out
    }

    /** Every Han character of [hanzi] is in [known]; false when it has none. */
    fun allCharactersKnown(hanzi: String, known: Set<String>): Boolean {
        var any = false
        val it = hanzi.codePoints().iterator()
        while (it.hasNext()) {
            val cp = it.nextInt()
            if (!Known.isHan(cp)) continue
            if (String(Character.toChars(cp)) !in known) return false
            any = true
        }
        return any
    }

    /** The unseen notes (of [newCards]) that lead with meaning_to_hanzi: a meaning_to_hanzi card + every character known. */
    fun knownCharacterNotes(newCards: Iterable<QueueCard>, hanziOf: (String) -> String, known: Set<String>): Set<String> {
        val out = HashSet<String>()
        if (known.isEmpty()) return out
        val checked = HashSet<String>()
        for (c in newCards) {
            if (c.cardType != KNOWN_CHARACTERS_TYPE || !checked.add(c.noteId)) continue
            if (allCharactersKnown(hanziOf(c.noteId), known)) out += c.noteId
        }
        return out
    }

    fun leadType(noteId: String, knownCharacterNoteIds: Set<String>?): String =
        if (knownCharacterNoteIds?.contains(noteId) == true) KNOWN_CHARACTERS_TYPE else DEFAULT_TYPE

    fun isLead(card: QueueCard, knownCharacterNoteIds: Set<String>?): Boolean =
        card.cardType == leadType(card.noteId, knownCharacterNoteIds)
}
