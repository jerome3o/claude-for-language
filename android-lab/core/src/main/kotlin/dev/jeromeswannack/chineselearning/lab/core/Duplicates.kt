package dev.jeromeswannack.chineselearning.lab.core

import java.text.Collator
import java.util.Locale

data class DupNote(val id: String, val deckId: String, val hanzi: String, val pinyin: String, val english: String)

data class DupItem(val note: DupNote, val totalReviews: Int, val totalRepetitions: Int)

/** Notes sharing one hanzi; the first item is the recommended keeper. */
data class DupGroup(val hanzi: String, val items: List<DupItem>) {
    val extras: List<DupItem> get() = items.drop(1)
}

/** Port of the Duplicate Finder's grouping (frontend/src/pages/DuplicateFinderPage.tsx). */
object Duplicates {
    /**
     * Notes with exactly the same hanzi (two or more), minus [deleted]. Within a group the
     * most-reviewed note comes first (ties: more card repetitions) — the one to keep; groups
     * are in hanzi order (`localeCompare`, here the root collator).
     */
    fun find(
        notes: List<DupNote>,
        reviewsByNote: Map<String, Int>,
        repetitionsByNote: Map<String, Int>,
        deleted: Set<String> = emptySet(),
    ): List<DupGroup> {
        val collator = Collator.getInstance(Locale.ROOT)
        return notes.asSequence()
            .filter { it.id !in deleted }
            .groupBy { it.hanzi }
            .filterValues { it.size >= 2 }
            .map { (hanzi, group) ->
                DupGroup(
                    hanzi,
                    group.map { DupItem(it, reviewsByNote[it.id] ?: 0, repetitionsByNote[it.id] ?: 0) }
                        .sortedWith(compareByDescending<DupItem> { it.totalReviews }.thenByDescending { it.totalRepetitions }),
                )
            }
            .sortedWith { a, b -> collator.compare(a.hanzi, b.hanzi) }
    }
}
