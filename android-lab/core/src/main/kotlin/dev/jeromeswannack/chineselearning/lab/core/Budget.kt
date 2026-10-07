package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/decks/budget.ts: ONE daily new-card budget per learner, filled
 * from the deck queue top-down; a deck's own limits are only caps.
 */

data class StudyBudget(val newCardsPerDay: Int, val secondaryCardsPerDay: Int) {
    companion object {
        val DEFAULT = StudyBudget(3, 6)
        const val MAX = 200
    }
}

data class DeckNewPool(
    val deckId: String,
    /** Higher goes first. Ties: newer deck first. */
    val priority: Int,
    val createdAt: String,
    /** NEW cards on notes with no reviewed card yet (the primary pool). */
    val totalNew: Int,
    /** NEW cards on notes that already have a reviewed card (the secondary pool). */
    val totalSecondaryNew: Int,
    val capPrimary: Int,
    val capSecondary: Int,
    val studiedPrimary: Int,
    val studiedSecondary: Int,
)

data class DeckAllocation(val primary: Int, val secondary: Int)

data class Spent(val primary: Int = 0, val secondary: Int = 0)

object Budget {
    /** `sortDecksForQueue`: highest priority first, then newest first (string compare of created_at). */
    fun <T> sortForQueue(items: List<T>, priority: (T) -> Int, createdAt: (T) -> String): List<T> =
        items.sortedWith { a, b ->
            val pa = priority(a)
            val pb = priority(b)
            if (pa != pb) pb.compareTo(pa) else jsCompare(createdAt(b), createdAt(a))
        }

    /** String.prototype.localeCompare for the ASCII timestamps we compare; UTF-16 order otherwise. */
    private fun jsCompare(a: String, b: String): Int = a.compareTo(b).coerceIn(-1, 1)

    /** Port of `primaryCapLeft`: what is left of a deck's primary cap today (secondary spill counts against it). */
    fun primaryCapLeft(p: DeckNewPool): Int {
        val deckOverflow = Math.max(0, p.studiedSecondary - p.capSecondary)
        return Math.max(0, p.capPrimary - p.studiedPrimary - deckOverflow)
    }

    /**
     * Port of `respreadPrimary`: keep the TOTAL primary allocation, give each deck its
     * [firstPicks] ("new characters first across all decks") and fill the rest deck queue
     * top-down within min(unseen cards, primary cap left). Secondary counts unchanged.
     */
    fun respreadPrimary(
        pools: List<DeckNewPool>,
        allocation: Map<String, DeckAllocation>,
        firstPicks: Map<String, Int>,
    ): LinkedHashMap<String, DeckAllocation> {
        var left = allocation.values.sumOf { it.primary } - firstPicks.values.sum()
        val out = LinkedHashMap<String, DeckAllocation>()
        for (p in sortForQueue(pools, { it.priority }, { it.createdAt })) {
            val a = allocation[p.deckId] ?: DeckAllocation(0, 0)
            val first = firstPicks[p.deckId] ?: 0
            val room = minOf(p.totalNew, primaryCapLeft(p))
            val take = Math.max(0, minOf(room - first, left))
            left -= take
            out[p.deckId] = DeckAllocation(first + take, a.secondary)
        }
        return out
    }

    /** `allocateNewCards(pools, budget, bonus, spentElsewhere)`. Iteration order of the result = queue order. */
    fun allocateNewCards(
        pools: List<DeckNewPool>,
        budget: StudyBudget,
        bonus: Int = 0,
        spentElsewhere: Spent = Spent(),
    ): LinkedHashMap<String, DeckAllocation> {
        val ordered = sortForQueue(pools, { it.priority }, { it.createdAt })
        val studiedPrimary = pools.sumOf { it.studiedPrimary } + spentElsewhere.primary
        val studiedSecondary = pools.sumOf { it.studiedSecondary } + spentElsewhere.secondary
        val overflow = Math.max(0, studiedSecondary - budget.secondaryCardsPerDay)
        var primaryLeft = Math.max(0, budget.newCardsPerDay + bonus - studiedPrimary - overflow)
        var secondaryLeft = Math.max(0, budget.secondaryCardsPerDay - studiedSecondary)

        val primary = HashMap<String, Int>()
        val secondary = HashMap<String, Int>()
        val capPrimary = HashMap<String, Int>()
        val capSecondary = HashMap<String, Int>()
        for (p in ordered) {
            primary[p.deckId] = 0
            secondary[p.deckId] = 0
            capPrimary[p.deckId] = primaryCapLeft(p)
            capSecondary[p.deckId] = Math.max(0, p.capSecondary - p.studiedSecondary)
        }

        for (p in ordered) {
            if (primaryLeft <= 0) break
            val take = minOf(p.totalNew, capPrimary.getValue(p.deckId), primaryLeft)
            if (take > 0) {
                primary[p.deckId] = primary.getValue(p.deckId) + take
                capPrimary[p.deckId] = capPrimary.getValue(p.deckId) - take
                primaryLeft -= take
            }
        }
        for (p in ordered) {
            if (secondaryLeft <= 0) break
            val take = minOf(p.totalSecondaryNew, capSecondary.getValue(p.deckId), secondaryLeft)
            if (take > 0) {
                secondary[p.deckId] = secondary.getValue(p.deckId) + take
                capSecondary[p.deckId] = capSecondary.getValue(p.deckId) - take
                secondaryLeft -= take
            }
        }
        // Spill: primary budget nobody used goes to secondary cards, bounded by the
        // deck's remaining primary cap.
        for (p in ordered) {
            if (primaryLeft <= 0) break
            val take = minOf(p.totalSecondaryNew - secondary.getValue(p.deckId), capPrimary.getValue(p.deckId), primaryLeft)
            if (take > 0) {
                secondary[p.deckId] = secondary.getValue(p.deckId) + take
                capPrimary[p.deckId] = capPrimary.getValue(p.deckId) - take
                primaryLeft -= take
            }
        }

        val out = LinkedHashMap<String, DeckAllocation>()
        for (p in ordered) out[p.deckId] = DeckAllocation(primary.getValue(p.deckId), secondary.getValue(p.deckId))
        return out
    }

    /** `daysToIntroduce`. */
    fun daysToIntroduce(wordsLeft: Int, newCardsPerDay: Int): Int {
        if (wordsLeft <= 0) return 0
        val perDay = Math.max(1, newCardsPerDay)
        return (wordsLeft + perDay - 1) / perDay
    }
}
