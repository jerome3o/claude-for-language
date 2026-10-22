package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/homework/retry-bar.ts (docs/HOMEWORK.md §3c), parity-tested
 * (parity/fixtures/retry-bar.ts → RetryBarParityTest).
 *
 * The bar is a row of slots, one per showing of a card: slots = answered + fresh + retries
 * (= items + every "Not yet" so far). Blue = answered / slots (every Got it AND every Not yet is a
 * step done), the track = fresh, orange = retries at the RIGHT end. A Not yet turns answered/slots
 * into (answered+1)/(slots+1) — never smaller, so the blue never goes backwards; the orange grows
 * instead. When nothing is fresh the blue meets the orange ([onRetries]). Finished = full blue.
 */
data class RetryBar(
    val answered: Int,
    val fresh: Int,
    val retries: Int,
    val itemsDone: Int,
    val items: Int,
    val slots: Int,
    /** 0..1: the blue, from the left. */
    val doneFraction: Double,
    /** 0..1: the orange, from the right end leftwards. */
    val retryFraction: Double,
    val onRetries: Boolean,
    val complete: Boolean,
)

/** What an item is called in the label. */
data class RetryBarUnit(val one: String, val other: String)

object RetryBars {
    val WORD_UNIT = RetryBarUnit("word", "words")

    private fun nonNeg(n: Int) = if (n > 0) n else 0

    /** Port of retryBar. */
    fun retryBar(answered: Int, fresh: Int, retries: Int, itemsDone: Int, items: Int): RetryBar {
        val a = nonNeg(answered)
        val f = nonNeg(fresh)
        val r = nonNeg(retries)
        val n = nonNeg(items)
        val d = minOf(nonNeg(itemsDone), n)
        val slots = a + f + r
        return RetryBar(
            answered = a, fresh = f, retries = r, itemsDone = d, items = n, slots = slots,
            doneFraction = if (slots == 0) 0.0 else a.toDouble() / slots,
            retryFraction = if (slots == 0) 0.0 else r.toDouble() / slots,
            onRetries = f == 0 && r > 0,
            complete = slots > 0 && f + r == 0,
        )
    }

    /** Port of passRetryBar: the bar of a one-off pass from its (live) events. */
    fun passRetryBar(itemIds: List<String>, events: List<HomeworkEvent>): RetryBar {
        val unique = LinkedHashSet(itemIds).toList()
        val wanted = unique.toHashSet()
        val right = HashSet<String>()
        val wrongs = HashMap<String, Int>()
        for (e in Homework.livePassEvents(events)) {
            if (e.item_id !in wanted) continue
            if (e.result == "right" || e.result == "done") right += e.item_id
            else if (e.result == "wrong") wrongs[e.item_id] = (wrongs[e.item_id] ?: 0) + 1
        }
        var answered = 0
        var fresh = 0
        var retries = 0
        for (id in unique) {
            val w = wrongs[id] ?: 0
            answered += w + if (id in right) 1 else 0
            if (id in right) continue
            if (w > 0) retries++ else fresh++
        }
        return retryBar(answered, fresh, retries, right.size, unique.size)
    }

    private fun plural(n: Int, unit: RetryBarUnit) = if (n == 1) unit.one else unit.other

    /** "5 of 12 words done · 3 to retry" / "All 12 words done". */
    fun label(bar: RetryBar, unit: RetryBarUnit = WORD_UNIT): String {
        if (bar.complete) return "All ${bar.items} ${plural(bar.items, unit)} done"
        val head = "${bar.itemsDone} of ${bar.items} ${plural(bar.items, unit)} done"
        return if (bar.retries > 0) "$head · ${bar.retries} to retry" else head
    }

    /** "↺ 3" at the bar's right end; null = no retries. */
    fun badge(bar: RetryBar): String? = if (bar.retries > 0) "↺ ${bar.retries}" else null

    /** "3 to try again" / "Trying again · 3 left" (on retries); null = no retries. */
    fun note(bar: RetryBar): String? = when {
        bar.retries == 0 -> null
        bar.onRetries -> "Trying again · ${bar.retries} left"
        else -> "${bar.retries} to try again"
    }
}
