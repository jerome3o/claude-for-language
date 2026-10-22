package dev.jeromeswannack.chineselearning.lab.core

/**
 * "⚡ Study it today" — the bump pocket. Port of shared/decks/bumps.ts (parity-tested
 * through parity/fixtures/study-queue.ts → StudyQueueParityTest).
 *
 * A learner bumps a note they already have; its cards come FIRST in today's session:
 *   - every NEW card not reviewed since the bump — over the daily budget (never takes from it);
 *   - every card already due by the cutoff — moved to the front;
 *   - plus ONE early review (the most important card not due yet, card-type order) unless the
 *     note already has a due card in the pocket, or a card in circulation before the bump has
 *     been reviewed since;
 *   - at most [MAX_BUMPED_CARDS_PER_NOTE], in card-type order.
 * A bump is DONE when its pocket is empty; an unfinished bump carries over to the next day.
 *
 * A CARD-LEVEL bump ([QueueBump.cardTypes] — the study card's "Practise this word other ways…",
 * core OtherCardTypes.kt) puts ONLY those card types of the note in the pocket: each one not
 * reviewed since the bump, whatever its state. Done when every chosen card was reviewed since.
 */

/**
 * An active bump (not cleared by hand). Reviews at or after [createdMs] cover a card.
 * [cardTypes]: a card-level bump — only these card types; null / empty = the whole note.
 */
data class QueueBump(val noteId: String, val createdMs: Long, val cardTypes: List<String>? = null)

/** What a new bump request does to a note (port of BumpMerge): add / already / replace. */
data class BumpMerge(val action: String, val cardTypes: List<String>?)

data class QueueBumps(
    val bumps: List<QueueBump>,
    /** card id → its latest review (epoch ms); absent = never reviewed. */
    val lastReviewMs: Map<String, Long>,
    /** card id → its first-ever review (epoch ms); absent = never reviewed. */
    val firstReviewMs: Map<String, Long>,
)

data class BumpPocket(
    /** The pocket's cards, bumps oldest first, card-type order within a note. */
    val cards: List<QueueCard>,
    /** Bumped notes that still have cards in the pocket (oldest bump first). */
    val activeNoteIds: List<String>,
    /** Bumped notes whose every bumped card has been reviewed since the bump. */
    val doneNoteIds: List<String>,
)

object Bumps {
    const val MAX_BUMPED_CARDS_PER_NOTE = 3

    /** Card types in the order the pocket prefers them. */
    val BUMP_CARD_TYPE_ORDER = listOf(CardTypes.HANZI_TO_MEANING, CardTypes.MEANING_TO_HANZI, CardTypes.AUDIO_TO_HANZI)

    /** Where a bump came from (analytics + the API's `source`). Port of BUMP_SOURCES. */
    val BUMP_SOURCES = listOf(
        "coach", "coach_chat", "ask_claude", "chat", "chat_discuss", "reader", "picture_hunt",
        "paste_list", "breakdown", "card_hub", "char_sheet", "explorer", "idioms", "homework_pass", "deck", "up_next", "study_card", "mcp", "tutor", "other",
    )

    /** Port of normalizeBumpSource(). */
    fun normalizeBumpSource(s: String?): String = if (s != null && s in BUMP_SOURCES) s else "other"

    /** Port of BUMP_SIBLING_GAP: a bumped card never jumps the queue within this many cards of its sibling. */
    const val BUMP_SIBLING_GAP = 3

    /** Port of normalizeBumpCardTypes(): the known types, each once, card-type order; null when none. */
    fun normalizeBumpCardTypes(types: List<String>?): List<String>? {
        if (types == null) return null
        val out = BUMP_CARD_TYPE_ORDER.filter { it in types }
        return out.ifEmpty { null }
    }

    /**
     * Port of mergeBumpCardTypes(): a request meets the note's ACTIVE bump ([hasExisting] false =
     * none; [existing] null = a whole-note bump). [stillOpen] = the existing types not reviewed since.
     */
    fun mergeBumpCardTypes(hasExisting: Boolean, existing: List<String>?, stillOpen: List<String>, incoming: List<String>?): BumpMerge {
        val want = normalizeBumpCardTypes(incoming)
        if (!hasExisting) return BumpMerge("add", want)
        val have = normalizeBumpCardTypes(existing) ?: return BumpMerge("already", null)
        if (want == null) return BumpMerge("replace", null)
        val open = normalizeBumpCardTypes(stillOpen) ?: emptyList()
        if (want.all { it in open }) return BumpMerge("already", have)
        return BumpMerge("replace", normalizeBumpCardTypes(open + want))
    }

    /**
     * Port of pickBumpedCard(): the first of [candidates] in [bumpedCardIds] whose note is not
     * among the last [BUMP_SIBLING_GAP] of [recentNoteIds] (oldest first).
     */
    fun <C> pickBumpedCard(candidates: List<C>, bumpedCardIds: Set<String>?, recentNoteIds: List<String>, id: (C) -> String, noteId: (C) -> String): C? {
        if (bumpedCardIds.isNullOrEmpty()) return null
        val tooRecent = recentNoteIds.takeLast(BUMP_SIBLING_GAP).toSet()
        return candidates.firstOrNull { id(it) in bumpedCardIds && noteId(it) !in tooRecent }
    }

    private fun typeRank(t: String): Int = BUMP_CARD_TYPE_ORDER.indexOf(t).let { if (it < 0) BUMP_CARD_TYPE_ORDER.size else it }

    private val byType = Comparator<QueueCard> { a, b ->
        val r = typeRank(a.cardType) - typeRank(b.cardType)
        if (r != 0) r else a.id.compareTo(b.id)
    }

    private fun isDue(c: QueueCard, cutoffMs: Long) =
        c.queue != CardQueue.NEW && (c.state.dueTimestamp == null || c.state.dueTimestamp <= cutoffMs)

    /** Port of bumpedCardsForNote(): the cards one bumped note puts in the pocket (empty = done). */
    fun bumpedCardsForNote(
        noteCards: List<QueueCard>,
        bump: QueueBump,
        lastReviewMs: Map<String, Long>,
        firstReviewMs: Map<String, Long>,
        cutoffMs: Long,
    ): List<QueueCard> {
        val sorted = noteCards.sortedWith(byType)
        fun reviewedSince(c: QueueCard): Boolean = lastReviewMs[c.id]?.let { it >= bump.createdMs } ?: false
        val chosen = normalizeBumpCardTypes(bump.cardTypes)
        if (chosen != null) {
            // Card-level: exactly the chosen cards still to review, whatever their state.
            return sorted.filter { it.cardType in chosen && !reviewedSince(it) }.take(MAX_BUMPED_CARDS_PER_NOTE)
        }
        val open = sorted.filter { !reviewedSince(it) }
        val picks = open.filter { it.queue == CardQueue.NEW || isDue(it, cutoffMs) }.toMutableList()
        val earlyUsed = picks.any { it.queue != CardQueue.NEW } ||
            sorted.any { c -> reviewedSince(c) && (firstReviewMs[c.id]?.let { it < bump.createdMs } ?: false) }
        if (!earlyUsed) {
            open.firstOrNull { it.queue != CardQueue.NEW && !isDue(it, cutoffMs) }?.let { picks += it }
        }
        return picks.sortedWith(byType).take(MAX_BUMPED_CARDS_PER_NOTE)
    }

    /**
     * Port of bumpPocket(): the pocket over [cards] (the cards in scope). A bump whose note has
     * no card in [cards] is neither active nor done here.
     */
    fun bumpPocket(cards: List<QueueCard>, bumps: QueueBumps?, cutoffMs: Long): BumpPocket {
        if (bumps == null || bumps.bumps.isEmpty()) return BumpPocket(emptyList(), emptyList(), emptyList())
        val wanted = bumps.bumps.mapTo(HashSet()) { it.noteId }
        val byNote = LinkedHashMap<String, MutableList<QueueCard>>()
        for (c in cards) if (c.noteId in wanted) byNote.getOrPut(c.noteId) { ArrayList() } += c
        val order = bumps.bumps.sortedWith(compareBy<QueueBump> { it.createdMs }.thenBy { it.noteId })
        val seen = HashSet<String>()
        val out = ArrayList<QueueCard>()
        val active = ArrayList<String>()
        val done = ArrayList<String>()
        for (bump in order) {
            if (!seen.add(bump.noteId)) continue
            val noteCards = byNote[bump.noteId]
            if (noteCards.isNullOrEmpty()) continue
            val picks = bumpedCardsForNote(noteCards, bump, bumps.lastReviewMs, bumps.firstReviewMs, cutoffMs)
            if (picks.isEmpty()) done += bump.noteId else { active += bump.noteId; out += picks }
        }
        return BumpPocket(out, active, done)
    }

    /** Home's line: "⚡ 2 bumped for today" ('' when none). */
    fun bumpedLabel(count: Int): String = if (count > 0) "⚡ $count bumped for today" else ""

    /** Toast / reply after bumping. Port of bumpedMessage(). */
    fun bumpedMessage(hanzi: List<String>, alreadyBumped: Int = 0): String {
        val n = hanzi.size
        if (n == 0) return if (alreadyBumped > 0) "Already in today’s pocket ⚡" else "Nothing to bump"
        val shown = when (n) {
            1 -> hanzi[0]
            2 -> "${hanzi[0]} and ${hanzi[1]}"
            else -> "${hanzi[0]}, ${hanzi[1]} and ${n - 2} more"
        }
        return "⚡ $shown will come first in today’s study"
    }
}
