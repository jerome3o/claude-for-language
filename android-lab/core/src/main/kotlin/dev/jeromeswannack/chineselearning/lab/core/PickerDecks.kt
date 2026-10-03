package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of `decksInQueueOrder` / `defaultPickerDeckId` in shared/decks/queue.ts: the add-card
 * pickers (chat word sheet, Save as flashcard, Make flashcards, …) list decks in study-queue
 * order and start on the top deck. Nothing is remembered between sheets.
 */
object PickerDecks {
    /** Decks in queue order (`sortDecksForQueue`: priority high → low, ties newest first). Missing priority = 0, missing date = "". */
    fun <T> inQueueOrder(decks: List<T>, priority: (T) -> Int?, createdAt: (T) -> String?): List<T> =
        Budget.sortForQueue(decks, { priority(it) ?: 0 }, { createdAt(it).orEmpty() })

    /**
     * The deck a picker starts on: [preferred] when it is one of the decks (a sheet opened for
     * one deck, e.g. the study card's own), else the top of the queue; null with no decks
     * (the picker offers a new deck).
     */
    fun <T> defaultId(decks: List<T>, id: (T) -> String, priority: (T) -> Int?, createdAt: (T) -> String?, preferred: String? = null): String? {
        if (!preferred.isNullOrEmpty() && decks.any { id(it) == preferred }) return preferred
        return inQueueOrder(decks, priority, createdAt).firstOrNull()?.let(id)
    }
}
