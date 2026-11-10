package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/decks/lead-card.ts — which card introduces a brand-new word (the ONE card of
 * an unseen note the primary, blue pool shows first). Default hanzi_to_meaning; with
 * "Words made of characters I know: start with English → Chinese" (NewCardOrder
 * `knownCharactersEnglishFirst`, on by default) a note whose Han characters are ALL known
 * (each in the hanzi of a note with a mature card: Review, stability > 21 days) leads with its
 * meaning_to_hanzi card instead, when it has one. "Start new words by ear" (NewCardOrder
 * `newWordsByEar`, on by default) wins over both: an unseen note with a NEW audio_to_hanzi card leads
 * with it, and the purple pool gives a started word's listening card first ([secondaryTypeRank]).
 * Only the card type changes — never which notes come or in what order. Parity-tested through the
 * study-queue vectors (`leadCard`, `byEar`).
 */
object LeadCard {
    const val DEFAULT_TYPE = CardTypes.HANZI_TO_MEANING
    const val KNOWN_CHARACTERS_TYPE = CardTypes.MEANING_TO_HANZI
    /** "Start new words by ear": the listening card. */
    const val EAR_TYPE = CardTypes.AUDIO_TO_HANZI
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

    /** Port of earLeadNotes(): the notes of [newCards] (unseen notes' NEW cards) with a NEW audio_to_hanzi card. */
    fun earLeadNotes(newCards: Iterable<QueueCard>): Set<String> =
        newCards.filter { it.cardType == EAR_TYPE }.mapTo(LinkedHashSet()) { it.noteId }

    /** Port of leadCardsFrom(): note id → lead type; the ear notes win over the known-character notes. */
    fun leadCardsFrom(knownCharacterNoteIds: Iterable<String>, earNoteIds: Iterable<String>): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (id in knownCharacterNoteIds) out[id] = KNOWN_CHARACTERS_TYPE
        for (id in earNoteIds) out[id] = EAR_TYPE
        return out
    }

    /** Port of leadCardType(): [leads] = note id → lead type, only the notes not on hanzi_to_meaning. */
    fun leadType(noteId: String, leads: Map<String, String>?): String = leads?.get(noteId) ?: DEFAULT_TYPE

    fun isLead(card: QueueCard, leads: Map<String, String>?): Boolean =
        card.cardType == leadType(card.noteId, leads)

    /** Port of readingInReviewNoteIds(): notes whose hanzi_to_meaning card is in Review. */
    fun readingInReviewNoteIds(cards: Iterable<QueueCard>): Set<String> =
        cards.filter { it.cardType == DEFAULT_TYPE && it.queue == CardQueue.REVIEW }.mapTo(HashSet()) { it.noteId }

    /**
     * Port of secondaryTypeRank(): the purple pool's order by card type, lower first —
     * hanzi_to_meaning before the rest; "by ear": the listening card first (of the notes whose
     * reading card is in Review first), then hanzi_to_meaning, then the rest.
     */
    fun secondaryTypeRank(card: QueueCard, byEar: Boolean, readingInReview: Set<String>?): Int {
        if (!byEar) return if (card.cardType == DEFAULT_TYPE) 0 else 1
        if (card.cardType == EAR_TYPE) return if (readingInReview?.contains(card.noteId) == true) 0 else 1
        return if (card.cardType == DEFAULT_TYPE) 2 else 3
    }
}
