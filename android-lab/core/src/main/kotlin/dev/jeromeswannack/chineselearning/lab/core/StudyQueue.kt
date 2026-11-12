package dev.jeromeswannack.chineselearning.lab.core

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
    /** The "Up next" cards today's budget takes (UpNext.kt), list order: blue ones, then purple ones. */
    val upNext: List<QueueCard> = emptyList(),
    /** Up next notes that hold cards in scope today (taken or still waiting for budget), list order. */
    val upNextNoteIds: List<String> = emptyList(),
    /** Unseen notes that start with meaning_to_hanzi (every character known, LeadCard.kt). */
    val knownCharacterNoteIds: Set<String> = emptySet(),
    /** Unseen notes that start with audio_to_hanzi ("Start new words by ear", LeadCard.kt) — they win over [knownCharacterNoteIds]. */
    val earLeadNoteIds: Set<String> = emptySet(),
    /** Note id → the card its unseen note starts with (only the notes not on hanzi_to_meaning): what the session's LeadCard.isLead reads. */
    val leadCards: Map<String, String> = emptyMap(),
    /** "Start new words by ear" applies (the notes' text given, the switch on): purple cards — listening first. */
    val newWordsByEar: Boolean = false,
)

/** Port of leadCardsInQueue()'s result. */
data class LeadCardsInfo(val leads: Map<String, String>, val knownCharacterNoteIds: Set<String>, val earNoteIds: Set<String>)

object StudyQueue {
    const val BONUS_INCREMENT = 10
    const val DEFAULT_SECONDARY_CAP = 10

    /**
     * `getStudyCutoff`: the later of the study day's last millisecond and now + 1 hour (StudyDay —
     * "New day starts at"; a rollover of 0 = local 23:59:59.999).
     */
    fun cutoff(nowMs: Long, zone: ZoneId, rolloverHour: Int = 0): StudyCutoff =
        StudyCutoff(StudyDay.cutoffMs(nowMs, StudyDay.at(nowMs, rolloverHour, zone)))

    /** When the study day of `nowMs` started (rollover 0 = local midnight). */
    fun startOfDay(nowMs: Long, zone: ZoneId, rolloverHour: Int = 0): Long =
        StudyDay.at(nowMs, rolloverHour, zone).startMs

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

    /**
     * Best first: unseen notes before started ones, the lead card (LeadCard.kt) first; started notes by
     * LeadCard.secondaryTypeRank (hanzi_to_meaning first; "by ear": the listening card first).
     */
    private fun tier(card: QueueCard, reviewed: Set<String>, lead: Map<String, String>, byEar: Boolean, readingInReview: Set<String>): Int =
        if (card.noteId in reviewed) 2 + LeadCard.secondaryTypeRank(card, byEar, readingInReview)
        else if (LeadCard.isLead(card, lead)) 0 else 1

    /** Port of newWordsByEarInQueue(): the notes' text given (it carries the order) and the switch on. */
    fun newWordsByEarInQueue(noteHanzi: Map<String, String>?, order: NewCardOrder): Boolean = noteHanzi != null && order.newWordsByEar

    /**
     * Port of `leadCardsInQueue` (study-queue.ts): which card each unseen note among [newCards] starts
     * with — "by ear" every note with a NEW audio_to_hanzi card leads with it; else a word of known
     * characters with meaning_to_hanzi; else hanzi_to_meaning (not in the map). Empty without the notes' text.
     */
    fun leadCardsInQueue(
        newCards: List<QueueCard>,
        reviewed: Set<String>,
        cards: Collection<QueueCard>,
        noteHanzi: Map<String, String>?,
        order: NewCardOrder,
        knownNoteIds: Collection<String>? = null,
    ): LeadCardsInfo {
        val known = runCatching { knownCharacterNotesInQueue(newCards, reviewed, cards, noteHanzi, order, knownNoteIds) }.getOrDefault(emptySet()).toMutableSet()
        val ear = if (newWordsByEarInQueue(noteHanzi, order)) LeadCard.earLeadNotes(newCards.filter { it.noteId !in reviewed }) else emptySet()
        known.removeAll(ear)
        return LeadCardsInfo(LeadCard.leadCardsFrom(known, ear), known, ear)
    }

    /**
     * Port of `knownCharacterNotesInQueue` (study-queue.ts): the unseen notes among [newCards] that
     * lead with meaning_to_hanzi — every Han character known (in a note with a known card: [knownNoteIds],
     * default the notes of [cards] with a mature card), the switch on. Empty without the notes' text.
     */
    fun knownCharacterNotesInQueue(
        newCards: Iterable<QueueCard>,
        reviewed: Set<String>,
        cards: Collection<QueueCard>,
        noteHanzi: Map<String, String>?,
        order: NewCardOrder,
        knownNoteIds: Collection<String>? = null,
    ): Set<String> {
        if (noteHanzi == null || !order.knownCharactersEnglishFirst) return emptySet()
        val known = LeadCard.knownCharacters((knownNoteIds ?: LeadCard.knownNoteIds(cards)).map { noteHanzi[it] ?: "" })
        if (known.isEmpty()) return emptySet()
        return LeadCard.knownCharacterNotes(newCards.filter { it.noteId !in reviewed }, { noteHanzi[it] ?: "" }, known)
    }

    /**
     * `getStudyQueue(deckId)`: learning/relearning cards due by the cutoff, review cards
     * due by the cutoff, and new cards as allocated by the global budget from the deck
     * queue top-down. [deckId] = null studies all decks.
     *
     * [noteHanzi] (note id → hanzi; null = plain tier / id order) turns on the account's
     * "Order new cards by" [order] (NewCardOrder.kt): the budget's brand-new words go first, in
     * any deck, to never-seen characters, then never-met words, then (sentences last) words
     * before sentences — the most common first ([frequency], WordFrequency.shipped) — and the
     * rest deck by deck. Studied = the notes in [seenNoteIds], default the notes of [cards]
     * with a reviewed card.
     *
     * [longTerm] (note id → 0 / 1, only notes with a choice) is the learner's "long-term review"
     * choice (LongTerm.kt): opted-out words never enter a pool, and a deck out of daily review
     * (caps 0 + 0) holds only its opted-in words, at the new-deck default caps.
     *
     * [bumps] ("⚡ Study it today", Bumps.kt): the pocket over the cards in scope heads the
     * queue; its NEW cards are outside the budget (removed from the pools, never taking from
     * them) and its learning / review cards are not repeated below.
     *
     * [upNext] ("Up next", UpNext.kt — the account's ordered note ids) takes the budget FIRST:
     * one blue card per unstarted note, the started notes' NEW cards from the purple budget,
     * ignoring deck caps but counted against them for the rest of the deck's words; its notes
     * never feed the regular pools.
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
        order: NewCardOrder = NewCardOrder.DEFAULT,
        frequency: FrequencyIndex? = null,
        upNext: List<String>? = null,
        /** Notes with a known card across ALL decks (LeadCard.kt); default: from [cards]. */
        knownNoteIds: Collection<String>? = null,
        /**
         * "Everyday words before formal ones": note id → Formality.kt class (missing = neutral),
         * from Formality.noteFormalityMap, built once per queue; null = that switch does nothing.
         */
        formality: Map<String, Int>? = null,
        /** Suspended / snoozed cards and sibling burying (CardHolds.kt): they leave everything. */
        holds: QueueHolds? = null,
    ): BuiltQueue {
        val reviewed = reviewedNoteIds(cards)
        // Held cards leave study (they still make their note "started" above, and known below).
        val live = CardHolds.cardsInStudy(cards, holds, bumps?.bumps?.map { it.noteId })
        val inScope = if (deckId == null) decks else decks.filter { it.id == deckId }
        val scopeIds = inScope.mapTo(HashSet()) { it.id }
        val inReview = inScope.associate { it.id to LongTerm.deckInDailyReview(it.capPrimary, it.capSecondary) }
        val pocket = Bumps.bumpPocket(live.filter { it.deckId in scopeIds }, bumps, cutoff.ts)
        val pocketIds = pocket.cards.mapTo(HashSet()) { it.id }
        // The pocket's cards and, for an unstarted note bumped card by card, its other NEW cards
        // (they wait until the bumped card is reviewed — Bumps.pocketSiblingIds).
        val skipIds: Set<String> = pocketIds + Bumps.pocketSiblingIds(live.filter { it.deckId in scopeIds }, pocket.cards, reviewed)
        // Up next: its notes never feed the regular pools; it takes the budget first.
        val slots = UpNext.slots(live.filter { it.deckId in scopeIds }, upNext, reviewed, skipIds, longTerm)
        // The NEW cards each deck may introduce (opted-out words and a one-off copy's words
        // nobody opted in are left out; bumped cards are over the budget).
        val newByDeck = live.filter {
            it.queue == CardQueue.NEW && it.deckId in scopeIds && it.id !in skipIds && it.noteId !in slots.noteIds &&
                LongTerm.admitsNewCards(longTerm?.get(it.noteId), inReview.getValue(it.deckId), it.noteId in reviewed)
        }.groupBy { it.deckId }

        val basePools = inScope.map { d ->
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
        val studiedAll = Spent(introduced.values.sumOf { it.primary }, introduced.values.sumOf { it.secondary })
        // Which card each unseen note leads with (hanzi_to_meaning, or meaning_to_hanzi for a word of
        // known characters, LeadCard.kt) — the pools' notes and Up next's alike.
        val scopeNew = live.filter { it.queue == CardQueue.NEW && it.deckId in scopeIds && it.id !in skipIds }
        val leadInfo = leadCardsInQueue(scopeNew, reviewed, cards, noteHanzi, order, knownNoteIds)
        val lead = leadInfo.leads
        // "Start new words by ear": in the purple pool a started word's listening card comes first.
        val byEar = newWordsByEarInQueue(noteHanzi, order)
        val readingInReview = if (byEar) LeadCard.readingInReviewNoteIds(cards) else emptySet()
        val taken = UpNext.take(slots.primary.size, slots.secondary.size, Budget.newBudgetLeft(budget, bonus, studiedAll))
        val upPrimary = withLeadCards(slots.primary.take(taken.primary), scopeNew, lead)
        val upSecondary = (if (byEar) earFirstWithinNotes(slots.secondary, readingInReview) else slots.secondary).take(taken.secondary)
        // What Up next takes counts as introduced today in its deck (caps) and in the budget.
        val pools = UpNext.withPicks(basePools, upPrimary.map { it.deckId }, upSecondary.map { it.deckId })
        var alloc: Map<String, DeckAllocation> = Budget.allocateNewCards(pools, budget, bonus, spent)

        val due = ArrayList<QueueCard>(pocket.cards)
        for (card in live) {
            if (card.deckId !in scopeIds || card.id in pocketIds) continue
            when (card.queue) {
                CardQueue.LEARNING, CardQueue.RELEARNING ->
                    if (card.state.dueTimestamp == null || card.state.dueTimestamp <= cutoff.ts) due += card
                CardQueue.REVIEW ->
                    if (card.state.dueTimestamp == null || card.state.dueTimestamp <= cutoff.ts) due += card
            }
        }
        // New cards: the global "Order new cards by" picks, then deck queue order; within a deck
        // the primary cards (best tier first; the hanzi_to_meaning cards sentences-last /
        // most-common-first when ordering), then the secondary ones (best tier, then id).
        val hanziOf = { c: QueueCard -> noteHanzi?.get(c.noteId) ?: "" }
        val formalityOf: ((QueueCard) -> Int)? = if (formality.isNullOrEmpty()) null else { c -> formality[c.noteId] ?: Formality.NEUTRAL }
        val newCards = ArrayList<QueueCard>()
        // The order only changes WHICH new words come; if it ever fails, the plain order is used
        // rather than failing the queue (Home, the session, the widget build it).
        val ordering: NewCardOrder? = if (noteHanzi != null) order else null
        val tiered = ordering != null && (ordering.newCharactersFirst || ordering.newWordsFirst || ordering.sentencesLast)
        val studied = if (tiered) {
            runCatching { NewCardOrdering.studiedFrom((seenNoteIds ?: reviewed).map { noteHanzi!![it] ?: "" }, ordering!!.newWordsFirst) }.getOrNull()
        } else null
        val globalPicks = HashSet<String>()
        var pickedIn: Map<String, Int> = emptyMap()
        if (studied != null) {
            runCatching {
                val picked = pickNewCardsFirst(pools, newByDeck, reviewed, alloc.values.sumOf { it.primary }, hanziOf, studied, ordering!!, frequency, lead, formality)
                if (picked.isNotEmpty()) {
                    val per = picked.groupingBy { it.deckId }.eachCount()
                    val respread = Budget.respreadPrimary(pools, alloc, per)
                    picked.mapTo(globalPicks) { it.id }
                    pickedIn = per
                    alloc = respread
                    newCards += picked
                }
            }.onFailure { globalPicks.clear(); newCards.clear(); pickedIn = emptyMap() }
        }
        val byTierThenId = compareBy<QueueCard> { tier(it, reviewed, lead, byEar, readingInReview) }.thenBy { it.id }
        for ((id, a) in alloc) {
            val all = newByDeck[id].orEmpty()
            val take = a.primary - (pickedIn[id] ?: 0)
            if (take > 0) {
                val primaryList = all.filter { it.noteId !in reviewed && it.id !in globalPicks }.sortedWith(byTierThenId)
                if (ordering != null) {
                    val firstType = primaryList.filter { LeadCard.isLead(it, lead) }
                    val first = runCatching { NewCardOrdering.orderWithinDeck(firstType, hanziOf, ordering, frequency, formalityOf) }.getOrDefault(firstType).take(take)
                    val others = primaryList.filter { !LeadCard.isLead(it, lead) }.take(Math.max(0, take - first.size))
                    newCards += first
                    newCards += others
                } else {
                    newCards += primaryList.take(take)
                }
            }
            if (a.secondary > 0) newCards += all.filter { it.noteId in reviewed }.sortedWith(byTierThenId).take(a.secondary)
        }
        due += upPrimary
        due += upSecondary
        due += newCards
        val hasMoreNew = slots.primary.size > taken.primary || slots.secondary.size > taken.secondary || pools.any { p ->
            val a = alloc[p.deckId] ?: DeckAllocation(0, 0)
            p.totalNew + p.totalSecondaryNew > a.primary + a.secondary
        }
        return BuiltQueue(
            due, reviewed, hasMoreNew, pools, alloc, pocket.cards, pocket.activeNoteIds, upPrimary + upSecondary, slots.noteIds.toList(),
            leadInfo.knownCharacterNoteIds, leadInfo.earNoteIds, lead, byEar,
        )
    }

    /**
     * Port of `withLeadCards` (study-queue.ts): Up next's blue card per unstarted note swapped for
     * the note's lead card when it leads with another one ([lead]: audio_to_hanzi "by ear",
     * meaning_to_hanzi for a word of known characters); the first such card of a note in [candidates] wins.
     */
    fun withLeadCards(primary: List<QueueCard>, candidates: List<QueueCard>, lead: Map<String, String>): List<QueueCard> {
        if (lead.isEmpty() || primary.isEmpty()) return primary
        val swapped = HashMap<String, QueueCard>()
        for (c in candidates) {
            val type = LeadCard.leadType(c.noteId, lead)
            if (type != LeadCard.DEFAULT_TYPE && c.cardType == type && c.noteId !in swapped) swapped[c.noteId] = c
        }
        return primary.map { swapped[it.noteId] ?: it }
    }

    /**
     * Port of `earFirstWithinNotes` (study-queue.ts): Up next's purple cards with the listening card
     * first inside each note (LeadCard.secondaryTypeRank), the notes kept in list order. Stable.
     */
    fun earFirstWithinNotes(secondary: List<QueueCard>, readingInReview: Set<String>): List<QueueCard> {
        val noteIndex = HashMap<String, Int>()
        for (c in secondary) if (c.noteId !in noteIndex) noteIndex[c.noteId] = noteIndex.size
        return secondary.withIndex()
            .sortedWith(compareBy<IndexedValue<QueueCard>>({ noteIndex.getValue(it.value.noteId) }, { LeadCard.secondaryTypeRank(it.value, true, readingInReview) }, { it.index }))
            .map { it.value }
    }

    /**
     * Port of `pickNewCardsFirst` (study-queue.ts): the first [take] primary picks —
     * the lead cards of unseen notes (LeadCard.kt: hanzi_to_meaning, or the type [leadCards]
     * gives — audio_to_hanzi "by ear", meaning_to_hanzi for a word of known characters) in ANY deck of [pools] that fall in one of the
     * account's tiers (NewCardOrdering.pickByOrder), each deck within min(unseen cards, primary
     * cap left); ties by deck queue position, shorter, card id. Mutates [studied].
     */
    fun pickNewCardsFirst(
        pools: List<DeckNewPool>,
        newByDeck: Map<String, List<QueueCard>>,
        reviewed: Set<String>,
        take: Int,
        hanziOf: (QueueCard) -> String,
        studied: StudiedIndex,
        order: NewCardOrder = NewCardOrder.DEFAULT,
        frequency: FrequencyIndex? = null,
        leadCards: Map<String, String>? = null,
        /** note id → Formality.kt class (missing = neutral), for "Everyday words before formal ones". */
        formality: Map<String, Int>? = null,
    ): List<QueueCard> {
        if (take <= 0) return emptyList()
        val position = Budget.sortForQueue(pools, { it.priority }, { it.createdAt }).withIndex().associate { (i, p) -> p.deckId to i }
        val room = pools.associate { it.deckId to minOf(it.totalNew, Budget.primaryCapLeft(it)) }
        val candidates = ArrayList<QueueCard>()
        for ((deckId, list) in newByDeck) {
            if ((room[deckId] ?: 0) <= 0) continue
            for (c in list) if (LeadCard.isLead(c, leadCards) && c.noteId !in reviewed) candidates += c
        }
        val formalityOf: ((QueueCard) -> Int)? = if (formality.isNullOrEmpty()) null else { c -> formality[c.noteId] ?: Formality.NEUTRAL }
        return NewCardOrdering.pickByOrder(candidates, take, hanziOf, { it.deckId }, { position[it] ?: 0 }, room, { it.id }, order, studied, frequency, formalityOf)
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
        /** Which card each unseen note starts with when not hanzi_to_meaning (BuiltQueue.leadCards). */
        leadCards: Map<String, String> = emptyMap(),
        /** "Start new words by ear" (BuiltQueue.newWordsByEar): a started word's listening card before its other new cards. */
        newWordsByEar: Boolean = false,
    ): QueueCard? {
        if (queue.isEmpty()) return null
        val available = queue.filter { CardQueue.isLearning(it.queue) || it.noteId !in recentNoteIds }
        val choose = available.ifEmpty { queue }
        // Bumped cards first — never within Bumps.BUMP_SIBLING_GAP cards of a sibling (pickBumpedCard).
        Bumps.pickBumpedCard(choose, bumpedCardIds, recentNoteIds, { it.id }, { it.noteId })?.let { return it }

        val learningDue = choose.filter { CardQueue.isLearning(it.queue) && it.state.dueTimestamp != null && it.state.dueTimestamp <= nowMs }
        if (learningDue.isNotEmpty()) return pickWeightedLearning(learningDue, nowMs, random)

        val newCards = choose.filter { it.queue == CardQueue.NEW }
        val reviewCards = choose.filter { it.queue == CardQueue.REVIEW }
        if (newCards.size + reviewCards.size > 0) {
            val newProbability = newCards.size.toDouble() / (newCards.size + reviewCards.size)
            if (random.nextDouble() < newProbability && newCards.isNotEmpty()) return pickPrioritizedNew(newCards, reviewedNoteIds, random, leadCards, newWordsByEar)
            if (reviewCards.isNotEmpty()) return reviewCards[random.nextInt(reviewCards.size)]
            if (newCards.isNotEmpty()) return pickPrioritizedNew(newCards, reviewedNoteIds, random, leadCards, newWordsByEar)
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

    private fun pickPrioritizedNew(cards: List<QueueCard>, reviewedNoteIds: Set<String>, random: Random, leadCards: Map<String, String>, newWordsByEar: Boolean): QueueCard {
        val startedFirst = if (newWordsByEar) CardTypes.AUDIO_TO_HANZI else CardTypes.HANZI_TO_MEANING
        val tiers = listOf<(QueueCard) -> Boolean>(
            { it.noteId !in reviewedNoteIds && LeadCard.isLead(it, leadCards) },
            { it.noteId !in reviewedNoteIds },
            { it.cardType == startedFirst },
            { true },
        )
        for (t in tiers) {
            val matches = cards.filter(t)
            if (matches.isNotEmpty()) return matches[random.nextInt(matches.size)]
        }
        return cards[0]
    }
}
