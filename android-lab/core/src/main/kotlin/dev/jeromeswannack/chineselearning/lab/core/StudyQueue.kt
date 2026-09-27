package dev.jeromeswannack.chineselearning.lab.core

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import kotlin.random.Random

/**
 * The study session's queue rules, ported from the web app:
 * frontend/src/db/database.ts (getStudyCutoff, selectDueCards, countRawQueues,
 * allocateQueueCounts) and frontend/src/hooks/useStudySession.ts (selectNextItem,
 * pickWeightedLearningCard, pickPrioritizedNewCard). Pure — the app feeds it rows.
 */

object CardTypes {
    const val HANZI_TO_MEANING = "hanzi_to_meaning"
    const val MEANING_TO_HANZI = "meaning_to_hanzi"
    const val AUDIO_TO_HANZI = "audio_to_hanzi"
}

data class QueueCard(
    val id: String,
    val noteId: String,
    val deckId: String,
    val cardType: String,
    val state: ComputedCardState,
) {
    val queue: Int get() = state.queue
}

data class QueueDeck(
    val id: String,
    val priority: Int,
    val createdAt: String,
    /** deck.new_cards_per_day — a cap on this deck's share of the global budget. */
    val capPrimary: Int,
    /** deck.secondary_cards_per_day ?? 10. */
    val capSecondary: Int,
)

data class StudyCutoff(val ts: Long)

data class Introduced(val primary: Int, val secondary: Int)

data class QueueCounts(val new: Int, val secondaryNew: Int, val learning: Int, val review: Int) {
    val total get() = new + secondaryNew + learning + review
}

data class BuiltQueue(
    val dueCards: List<QueueCard>,
    /** Notes with any card past NEW when the queue was built. */
    val reviewedNoteIds: Set<String>,
    /** More new cards exist than today's budget admits — offer "Study 10 more". */
    val hasMoreNew: Boolean,
)

object StudyQueue {
    const val BONUS_INCREMENT = 10
    const val DEFAULT_SECONDARY_CAP = 10

    /** `getStudyCutoff`: the later of local 23:59:59.999 today and now + 1 hour. */
    fun cutoff(nowMs: Long, zone: ZoneId): StudyCutoff {
        val eod = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
            .atTime(LocalTime.of(23, 59, 59, 999_000_000)).atZone(zone).toInstant().toEpochMilli()
        return StudyCutoff(Math.max(eod, nowMs + 60 * 60 * 1000))
    }

    fun startOfDay(nowMs: Long, zone: ZoneId): Long =
        Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()

    fun reviewedNoteIds(cards: Collection<QueueCard>): Set<String> =
        cards.filter { it.queue != CardQueue.NEW }.mapTo(HashSet()) { it.noteId }

    /**
     * New cards introduced today per deck, from review history: a card counts on the
     * day of its first-ever review, and as secondary (purple) if another card of the
     * same note had been reviewed before it. (The web keeps a live counter seeded the
     * same way; deriving it keeps devices consistent.)
     */
    fun introducedToday(cards: Collection<QueueCard>, firstReviewAt: Map<String, Long>, dayStartMs: Long): Map<String, Introduced> {
        val byNote = cards.groupBy { it.noteId }
        val primary = HashMap<String, Int>()
        val secondary = HashMap<String, Int>()
        for (card in cards) {
            val first = firstReviewAt[card.id] ?: continue
            if (first < dayStartMs) continue
            val isSecondary = byNote[card.noteId].orEmpty().any { s -> s.id != card.id && (firstReviewAt[s.id]?.let { it < first } ?: false) }
            val target = if (isSecondary) secondary else primary
            target[card.deckId] = (target[card.deckId] ?: 0) + 1
        }
        return (primary.keys + secondary.keys).associateWith { Introduced(primary[it] ?: 0, secondary[it] ?: 0) }
    }

    private fun tier(card: QueueCard, reviewed: Set<String>): Int =
        (if (card.noteId !in reviewed) 0 else 2) + (if (card.cardType == CardTypes.HANZI_TO_MEANING) 0 else 1)

    /**
     * `getStudyQueue(deckId)`: learning/relearning cards due by the cutoff, review cards
     * due by the cutoff, and new cards as allocated by the global budget from the deck
     * queue top-down. [deckId] = null studies all decks.
     */
    fun build(
        decks: List<QueueDeck>,
        cards: List<QueueCard>,
        budget: StudyBudget,
        bonus: Int,
        introduced: Map<String, Introduced>,
        cutoff: StudyCutoff,
        deckId: String?,
    ): BuiltQueue {
        val reviewed = reviewedNoteIds(cards)
        val inScope = if (deckId == null) decks else decks.filter { it.id == deckId }
        val scopeIds = inScope.mapTo(HashSet()) { it.id }

        val pools = inScope.map { d ->
            val newCards = cards.filter { it.deckId == d.id && it.queue == CardQueue.NEW }
            val intro = introduced[d.id] ?: Introduced(0, 0)
            DeckNewPool(
                deckId = d.id,
                priority = d.priority,
                createdAt = d.createdAt,
                totalNew = newCards.count { it.noteId !in reviewed },
                totalSecondaryNew = newCards.count { it.noteId in reviewed },
                capPrimary = d.capPrimary,
                capSecondary = d.capSecondary,
                studiedPrimary = intro.primary,
                studiedSecondary = intro.secondary,
            )
        }
        val elsewhere = introduced.filterKeys { it !in scopeIds }.values
        val spent = Spent(elsewhere.sumOf { it.primary }, elsewhere.sumOf { it.secondary })
        val alloc = Budget.allocateNewCards(pools, budget, bonus, spent)

        val due = ArrayList<QueueCard>()
        for (card in cards) {
            if (card.deckId !in scopeIds) continue
            when (card.queue) {
                CardQueue.LEARNING, CardQueue.RELEARNING ->
                    if (card.state.dueTimestamp == null || card.state.dueTimestamp <= cutoff.ts) due += card
                CardQueue.REVIEW ->
                    if (card.state.dueTimestamp == null || card.state.dueTimestamp <= cutoff.ts) due += card
            }
        }
        for ((id, a) in alloc) {
            var primary = a.primary
            var secondary = a.secondary
            val list = cards.filter { it.deckId == id && it.queue == CardQueue.NEW }
                .sortedWith(compareBy<QueueCard> { tier(it, reviewed) }.thenBy { it.id })
            for (card in list) {
                if (card.noteId in reviewed) {
                    if (secondary > 0) { secondary--; due += card }
                } else if (primary > 0) {
                    primary--; due += card
                }
            }
        }
        val hasMoreNew = pools.any { p ->
            val a = alloc[p.deckId] ?: DeckAllocation(0, 0)
            p.totalNew + p.totalSecondaryNew > a.primary + a.secondary
        }
        return BuiltQueue(due, reviewed, hasMoreNew)
    }

    fun counts(queue: Collection<QueueCard>, reviewedNoteIds: Set<String>): QueueCounts {
        var n = 0; var s = 0; var l = 0; var r = 0
        for (c in queue) when (c.queue) {
            CardQueue.NEW -> if (c.noteId in reviewedNoteIds) s++ else n++
            CardQueue.LEARNING, CardQueue.RELEARNING -> l++
            CardQueue.REVIEW -> r++
        }
        return QueueCounts(n, s, l, r)
    }

    /**
     * `selectNextItem` (cards part): learning due now (weighted by minutes overdue) →
     * proportional random mix of new and review → learning cards still on cooldown but
     * due today (shown at once — no waiting screen). Non-learning cards of the last 5
     * rated notes are skipped while anything else is available.
     */
    fun selectNext(
        queue: List<QueueCard>,
        reviewedNoteIds: Set<String>,
        recentNoteIds: List<String>,
        lastRatedCardId: String?,
        nowMs: Long,
        cutoff: StudyCutoff,
        random: Random,
    ): QueueCard? {
        if (queue.isEmpty()) return null
        val available = queue.filter { CardQueue.isLearning(it.queue) || it.noteId !in recentNoteIds }
        val choose = available.ifEmpty { queue }

        val learningDue = choose.filter { CardQueue.isLearning(it.queue) && it.state.dueTimestamp != null && it.state.dueTimestamp <= nowMs }
        if (learningDue.isNotEmpty()) return pickWeightedLearning(learningDue, nowMs, random)

        val newCards = choose.filter { it.queue == CardQueue.NEW }
        val reviewCards = choose.filter { it.queue == CardQueue.REVIEW }
        if (newCards.size + reviewCards.size > 0) {
            val newProbability = newCards.size.toDouble() / (newCards.size + reviewCards.size)
            if (random.nextDouble() < newProbability && newCards.isNotEmpty()) return pickPrioritizedNew(newCards, reviewedNoteIds, random)
            if (reviewCards.isNotEmpty()) return reviewCards[random.nextInt(reviewCards.size)]
            if (newCards.isNotEmpty()) return pickPrioritizedNew(newCards, reviewedNoteIds, random)
        }

        val cooldown = choose.filter { CardQueue.isLearning(it.queue) && (it.state.dueTimestamp == null || it.state.dueTimestamp <= cutoff.ts) }
            .sortedBy { it.state.dueTimestamp ?: 0L }
        if (cooldown.isNotEmpty()) {
            if (lastRatedCardId != null && cooldown.size > 1) cooldown.firstOrNull { it.id != lastRatedCardId }?.let { return it }
            return cooldown[0]
        }
        return null
    }

    private fun pickWeightedLearning(cards: List<QueueCard>, nowMs: Long, random: Random): QueueCard {
        val weights = cards.map { 1 + Math.max(0L, nowMs - (it.state.dueTimestamp ?: nowMs)) / 60000.0 }
        var r = random.nextDouble() * weights.sum()
        for ((i, w) in weights.withIndex()) {
            r -= w
            if (r <= 0) return cards[i]
        }
        return cards.last()
    }

    private fun pickPrioritizedNew(cards: List<QueueCard>, reviewedNoteIds: Set<String>, random: Random): QueueCard {
        val tiers = listOf<(QueueCard) -> Boolean>(
            { it.noteId !in reviewedNoteIds && it.cardType == CardTypes.HANZI_TO_MEANING },
            { it.noteId !in reviewedNoteIds },
            { it.cardType == CardTypes.HANZI_TO_MEANING },
            { true },
        )
        for (t in tiers) {
            val matches = cards.filter(t)
            if (matches.isNotEmpty()) return matches[random.nextInt(matches.size)]
        }
        return cards[0]
    }
}
