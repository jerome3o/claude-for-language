package dev.jeromeswannack.chineselearning.lab.core

/**
 * The answer side's example sentences follow the question side (shared/study/answerOrder.ts,
 * docs/STUDY_SESSION.md "The answer side keeps the question's order"): the sentences the question side showed
 * on this showing — "Listen in context" on a listening card, the Sentence round's exercises — come first in
 * exactly the order they were shown, then the rest in their usual order. The card's own sentence keeps its
 * "From the card" badge wherever it lands. Parity-tested (parity/fixtures/answer-order.ts).
 */
object AnswerOrder {
    /** `answerSentenceOrder`: [keys] with the [shown] ones first, in the order shown (missing skipped, duplicates once). */
    fun order(keys: List<String>, shown: List<String>): List<String> {
        val present = keys.toSet()
        val first = ArrayList<String>()
        val placed = HashSet<String>()
        for (k in shown) {
            if (k !in present || !placed.add(k)) continue
            first += k
        }
        if (first.isEmpty()) return keys.toList()
        return first + keys.filter { it !in placed }
    }

    /** `questionSentenceKeys`: the listening card's "Listen in context" rows, then the Sentence round's sentences. */
    fun questionKeys(listenShown: List<String>?, roundKeys: List<String>?): List<String> = listenShown.orEmpty() + roundKeys.orEmpty()
}
