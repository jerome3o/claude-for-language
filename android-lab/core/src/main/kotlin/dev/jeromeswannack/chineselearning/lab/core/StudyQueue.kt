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
    /** The per-deck new-card pools fed to the budget (in scope), for debug reports. */
    val pools: List<DeckNewPool> = emptyList(),
    /** What the budget gave each deck in scope (queue order). */
    val allocation: Map<String, DeckAllocation> = emptyMap(),
    /** The bump pocket's cards ("⚡ Study it today", Bumps.kt) — also the head of [dueCards]. */
    val bumped: List<QueueCard> = emptyList(),
    /** Bumped notes with cards in the pocket (in scope), oldest bump first. */
    val bumpedNoteIds: List<String> = emptyList(),
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
     *
     * [noteHanzi] (note id → hanzi; null = plain tier / id order) turns on "new characters
     * first" (Novelty.kt): a deck's brand-new words are the ones with never-seen characters.
     * Seen = the notes in [seenNoteIds], default the notes of [cards] with a reviewed card.
     *
     * [longTerm] (note id → 0 / 1, only notes with a choice) is the learner's "long-term review"
     * choice (LongTerm.kt): opted-out words never enter a pool, and a deck out of daily review
     * (caps 0 + 0) holds only its opted-in words, at the new-deck default caps.
     *
     * [bumps] ("⚡ Study it today", Bumps.kt): the pocket over the cards in scope heads the
     * queue; its NEW cards are outside the budget (removed from the pools, never taking from
     * them) and its learning / review cards are not repeated below.
     */
    fun build(
        decks: List<QueueDeck>,
        cards: List<QueueCard>,
        budget: StudyBudget,
        bonus: Int,
        introduced: Map<String, Introduced>,
        cutoff: StudyCutoff,
        deckId: String?,
        noteHanzi: Map<String, String>? = null,
        seenNoteIds: Collection<String>? = null,
        longTerm: Map<String, Int>? = null,
        bumps: QueueBumps? = null,
    ): BuiltQueue {
        val reviewed = reviewedNoteIds(cards)
        val inScope = if (deckId == null) decks else decks.filter { it.id == deckId }
        val scopeIds = inScope.mapTo(HashSet()) { it.id }
        val inReview = inScope.associate { it.id to LongTerm.deckInDailyReview(it.capPrimary, it.capSecondary) }
        val pocket = Bumps.bumpPocket(cards.filter { it.deckId in scopeIds }, bumps, cutoff.ts)
        val pocketIds = pocket.cards.mapTo(HashSet()) { it.id }
        // The NEW cards each deck may introduce (opted-out words and a one-off copy's words
        // nobody opted in are left out; bumped cards are over the budget).
        val newByDeck = cards.filter {
            it.queue == CardQueue.NEW && it.deckId in scopeIds && it.id !in pocketIds &&
                LongTerm.admitsNewCards(longTerm?.get(it.noteId), inReview.getValue(it.deckId), it.noteId in reviewed)
        }.groupBy { it.deckId }

        val pools = inScope.map { d ->
            val newCards = newByDeck[d.id].orEmpty()
            val intro = introduced[d.id] ?: Introduced(0, 0)
            val (capPrimary, capSecondary) = LongTerm.caps(d.capPrimary, d.capSecondary)
            DeckNewPool(
                deckId = d.id,
                priority = d.priority,
                createdAt = d.createdAt,
                totalNew = newCards.count { it.noteId !in reviewed },
                totalSecondaryNew = newCards.count { it.noteId in reviewed },
                capPrimary = capPrimary,
                capSecondary = capSecondary,
                studiedPrimary = intro.primary,
                studiedSecondary = intro.secondary,
            )
        }
        val elsewhere = introduced.filterKeys { it !in scopeIds }.values
        val spent = Spent(elsewhere.sumOf { it.primary }, elsewhere.sumOf { it.secondary })
        var alloc: Map<String, DeckAllocation> = Budget.allocateNewCards(pools, budget, bonus, spent)

        val due = ArrayList<QueueCard>(pocket.cards)
        for (card in cards) {
            if (card.deckId !in scopeIds || card.id in pocketIds) continue
            when (card.queue) {
                CardQueue.LEARNING, CardQueue.RELEARNING ->
                    if (card.state.dueTimestamp == null || card.state.dueTimestamp <= cutoff.ts) due += card
                CardQueue.REVIEW ->
                    if (card.state.dueTimestamp == null || card.state.dueTimestamp <= cutoff.ts) due += card
            }
        }
        // New cards: deck queue order; within a deck the primary cards (best tier first, the
        // hanzi_to_meaning cards by novelty), then the secondary ones (best tier, then id).
        val hanziOf = { c: QueueCard -> noteHanzi?.get(c.noteId) ?: "" }
        val newCards = ArrayList<QueueCard>()
        // "New characters first" only changes WHICH new words come; if it ever fails, the plain
        // order is used rather than failing the queue (Home, the session, the widget build it).
        var seen = noteHanzi?.let { h -> runCatching { NoveltyRank.seenFrom((seenNoteIds ?: reviewed).map { h[it] ?: "" }) }.getOrNull() }
        // "New characters first across all decks": the budget's primary picks go first to unseen
        // words in ANY deck in scope that bring never-seen characters; the rest deck by deck.
        val globalPicks = HashSet<String>()
        seen?.let { s ->
            runCatching {
                val picked = pickNewCharactersFirst(pools, newByDeck, reviewed, alloc.values.sumOf { it.primary }, hanziOf, s)
                if (picked.isNotEmpty()) {
                    val respread = Budget.respreadPrimary(pools, alloc, picked.groupingBy { it.deckId }.eachCount())
                    picked.mapTo(globalPicks) { it.id }
                    alloc = respread
                    newCards += picked
                }
            }.onFailure { seen = null; globalPicks.clear(); newCards.clear() }
        }
        for ((id, a) in alloc) {
            if (a.primary <= 0 && a.secondary <= 0) continue
            val list = newByDeck[id].orEmpty()
                .sortedWith(compareBy<QueueCard> { tier(it, reviewed) }.thenBy { it.id })
            val primaryList = list.filter { it.noteId !in reviewed }
            val take = Math.max(0, a.primary - primaryList.count { it.id in globalPicks })
            val byNovelty = seen?.let { s ->
                runCatching {
                    val first = primaryList.filter { it.cardType == CardTypes.HANZI_TO_MEANING && it.id !in globalPicks }
                    val picked = NoveltyRank.pick(first, take, hanziOf, s)
                    val others = primaryList.filter { it.cardType != CardTypes.HANZI_TO_MEANING }.take(Math.max(0, take - picked.size))
                    for (c in others) NoveltyRank.markSeen(s, hanziOf(c))
                    picked + others
                }.onFailure { seen = null }.getOrNull()
            }
            newCards += byNovelty ?: primaryList.filter { it.id !in globalPicks }.take(take)
            newCards += list.filter { it.noteId in reviewed }.take(Math.max(0, a.secondary))
        }
        due += newCards
        val hasMoreNew = pools.any { p ->
            val a = alloc[p.deckId] ?: DeckAllocation(0, 0)
            p.totalNew + p.totalSecondaryNew > a.primary + a.secondary
        }
        return BuiltQueue(due, reviewed, hasMoreNew, pools, alloc, pocket.cards, pocket.activeNoteIds)
    }

    /**
     * Port of `pickNewCharactersFirst` (study-queue.ts): the first [take] primary picks —
     * hanzi_to_meaning cards of unseen notes in ANY deck of [pools] that bring never-seen
     * characters, each deck within min(unseen cards, primary cap left); ties by deck queue
     * position, shorter, card id. Mutates [seen].
     */
    fun pickNewCharactersFirst(
        pools: List<DeckNewPool>,
        newByDeck: Map<String, List<QueueCard>>,
        reviewed: Set<String>,
        take: Int,
        hanziOf: (QueueCard) -> String,
        seen: SeenText,
    ): List<QueueCard> {
        if (take <= 0) return emptyList()
        val position = Budget.sortForQueue(pools, { it.priority }, { it.createdAt }).withIndex().associate { (i, p) -> p.deckId to i }
        val room = pools.associate { it.deckId to minOf(it.totalNew, Budget.primaryCapLeft(it)) }
        val candidates = ArrayList<QueueCard>()
        for ((deckId, list) in newByDeck) {
            if ((room[deckId] ?: 0) <= 0) continue
            for (c in list) if (c.cardType == CardTypes.HANZI_TO_MEANING && c.noteId !in reviewed) candidates += c
        }
        return NoveltyRank.pickAcrossGroups(candidates, take, hanziOf, { it.deckId }, { position[it] ?: 0 }, room, { it.id }, seen)
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
     *
     * [bumpedCardIds] ("⚡ Study it today"): among the available cards, the FIRST one (queue
     * order) in the set comes before everything else, learning-due-now included. The session
     * drops a card from the set once it is rated.
     */
    fun selectNext(
        queue: List<QueueCard>,
        reviewedNoteIds: Set<String>,
        recentNoteIds: List<String>,
        lastRatedCardId: String?,
        nowMs: Long,
        cutoff: StudyCutoff,
        random: Random,
        bumpedCardIds: Set<String> = emptySet(),
    ): QueueCard? {
        if (queue.isEmpty()) return null
        val available = queue.filter { CardQueue.isLearning(it.queue) || it.noteId !in recentNoteIds }
        val choose = available.ifEmpty { queue }
        if (bumpedCardIds.isNotEmpty()) choose.firstOrNull { it.id in bumpedCardIds }?.let { return it }

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
