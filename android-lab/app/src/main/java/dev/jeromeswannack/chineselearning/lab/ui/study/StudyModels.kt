package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity

/** One presentation of a card. [presentation] changes even when the same card comes back. */
data class CardView(
    val card: QueueCard,
    val note: NoteEntity,
    val sentences: List<SentenceEntity>,
    val previews: List<IntervalPreview>,
    val alternatives: List<String>,
    val presentation: Int,
    val deckName: String?,
)

data class SessionStats(
    val reviews: Int = 0,
    val correct: Int = 0,
    val streak: Int = 0,
    val bestStreak: Int = 0,
    val againCount: Int = 0,
    val againByNote: Map<String, Int> = emptyMap(),
    val leeches: List<String> = emptyList(),
    val startedAt: Long = System.currentTimeMillis(),
) {
    val accuracy: Int get() = if (reviews == 0) 0 else Math.round(correct * 100f / reviews)
}

sealed interface StudyPhase {
    data object Loading : StudyPhase
    data class Showing(val view: CardView) : StudyPhase
    data object Done : StudyPhase
}

data class StudyUi(
    val phase: StudyPhase = StudyPhase.Loading,
    val counts: QueueCounts = QueueCounts(0, 0, 0, 0),
    val stats: SessionStats = SessionStats(),
    val canUndo: Boolean = false,
    val hasMoreNew: Boolean = false,
    val bonus: Int = 0,
    /** Rating that sent the previous card away — picks the exit animation. */
    val lastRating: Int? = null,
    val online: Boolean = true,
    val deckName: String? = null,
) {
    val progress: Float get() {
        val total = stats.reviews + counts.total
        return if (total == 0) 1f else stats.reviews.toFloat() / total
    }
}
