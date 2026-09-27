package dev.jeromeswannack.chineselearning.lab.ui.decks

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.ReplayEvent

/** The web's `getMasteryLevel(queue, stability)` (DeckDetailPage.tsx). */
enum class Mastery { NEW, LEARNING, FAMILIAR, MASTERED }

object DeckStats {
    val CARD_TYPES = listOf(CardTypes.HANZI_TO_MEANING, CardTypes.MEANING_TO_HANZI, CardTypes.AUDIO_TO_HANZI)

    /** Short labels the web uses in rating rows. */
    val SHORT = mapOf(CardTypes.HANZI_TO_MEANING to "字→义", CardTypes.MEANING_TO_HANZI to "义→字", CardTypes.AUDIO_TO_HANZI to "听→字")
    val LONG = mapOf(CardTypes.HANZI_TO_MEANING to "Hanzi → Meaning", CardTypes.MEANING_TO_HANZI to "Meaning → Hanzi", CardTypes.AUDIO_TO_HANZI to "Audio → Hanzi")

    fun mastery(queue: Int, stability: Double): Mastery = when {
        queue == 0 -> Mastery.NEW
        queue == 1 || queue == 3 -> Mastery.LEARNING
        stability <= 7 -> Mastery.LEARNING
        stability <= 21 -> Mastery.FAMILIAR
        else -> Mastery.MASTERED
    }

    /** A note's mastery %: `min(100, round(avg stability / 30 × 100))` over its cards. */
    fun notePercent(cards: List<CardEntity>): Int {
        if (cards.isEmpty()) return 0
        val avg = cards.sumOf { it.stability } / cards.size
        return minOf(100.0, Js.round(avg / 30 * 100)).toInt()
    }

    /**
     * Most recent first, up to 8 ratings per card type, per note (the web's `ratingsByNote`).
     * [events] may come in any order.
     */
    fun recentRatings(cards: List<CardEntity>, events: List<ReplayEvent>, perType: Int = 8): Map<String, Map<String, List<Int>>> {
        val info = cards.associateBy { it.id }
        val out = HashMap<String, MutableMap<String, MutableList<Int>>>()
        for (e in events.sortedWith(compareByDescending<ReplayEvent> { it.reviewedAt }.thenByDescending { it.id })) {
            val c = info[e.cardId] ?: continue
            val byType = out.getOrPut(c.noteId) { CARD_TYPES.associateWithTo(LinkedHashMap()) { ArrayList() } }
            val list = byType.getOrPut(c.cardType) { ArrayList() }
            if (list.size < perType) list += e.rating
        }
        return out
    }

    data class Completion(val total: Int, val seen: Int, val mastered: Int, val learning: Int) {
        val percentSeen: Int get() = if (total > 0) Js.round(seen.toDouble() / total * 100).toInt() else 0
        val percentMastered: Int get() = if (total > 0) Js.round(mastered.toDouble() / total * 100).toInt() else 0
    }

    data class TypeBreakdown(val total: Int, val new: Int, val learning: Int, val familiar: Int, val mastered: Int)

    fun completion(cards: List<CardEntity>): Completion {
        var seen = 0
        var mastered = 0
        var learning = 0
        for (c in cards) {
            when (mastery(c.queue, c.stability)) {
                Mastery.NEW -> Unit
                Mastery.MASTERED -> { seen++; mastered++ }
                Mastery.LEARNING -> { seen++; learning++ }
                Mastery.FAMILIAR -> seen++
            }
        }
        return Completion(cards.size, seen, mastered, learning)
    }

    fun breakdown(cards: List<CardEntity>): Map<String, TypeBreakdown> = CARD_TYPES.associateWith { type ->
        val of = cards.filter { it.cardType == type }.map { mastery(it.queue, it.stability) }
        TypeBreakdown(of.size, of.count { it == Mastery.NEW }, of.count { it == Mastery.LEARNING }, of.count { it == Mastery.FAMILIAR }, of.count { it == Mastery.MASTERED })
    }
}
