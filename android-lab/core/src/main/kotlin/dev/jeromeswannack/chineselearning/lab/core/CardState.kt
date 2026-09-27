package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/scheduler/compute-state.ts — card state is derived from review
 * events, never stored as truth. Same inputs → same outputs as the web app; the
 * parity tests (core/src/test/.../ParityTest.kt) hold this to the TypeScript.
 */

/** Legacy rating: 0 = again, 1 = hard, 2 = good, 3 = easy (FSRS grade = rating + 1). */
object Rating {
    const val AGAIN = 0
    const val HARD = 1
    const val GOOD = 2
    const val EASY = 3
    val ALL = listOf(AGAIN, HARD, GOOD, EASY)
}

/** CardQueue: NEW 0, LEARNING 1, REVIEW 2, RELEARNING 3 (same values as FsrsState). */
object CardQueue {
    const val NEW = 0
    const val LEARNING = 1
    const val REVIEW = 2
    const val RELEARNING = 3

    fun isLearning(queue: Int) = queue == LEARNING || queue == RELEARNING
}

data class ReviewEventInput(val id: String, val cardId: String, val rating: Int, val reviewedAt: String)

data class ComputedCardState(
    val queue: Int,
    val stability: Double,
    val difficulty: Double,
    val scheduledDays: Long,
    val reps: Int,
    val lapses: Int,
    val nextReviewAt: String?,
    val dueTimestamp: Long?,
    val lastReviewedAt: String?,
    val easeFactor: Double,
    val interval: Long,
    val repetitions: Int,
    val learningStep: Int,
)

data class IntervalPreview(val rating: Int, val intervalText: String, val intervalDays: Double, val nextState: Int)

object CardScheduler {
    /** FSRS_DEFAULT_W in compute-state.ts (w3 lowered to 2 days for Easy). */
    val DEFAULT_W: List<Double> = listOf(
        0.212, 1.2931, 2.3065, 2.0,
        6.4133, 0.8334, 3.0194, 0.001,
        1.8722, 0.1666, 0.796, 1.4835,
        0.0614, 0.2629, 1.6483, 0.6014,
        1.8729, 0.5425, 0.0912, 0.0658,
        0.1542,
    )

    /** DEFAULT_DECK_SETTINGS — deckSettingsFromDb always returns these, so every deck uses them. */
    private val fsrs = Fsrs(
        FsrsParameters.generate(
            requestRetention = 0.9,
            maximumInterval = 36500.0,
            w = DEFAULT_W,
            enableFuzz = true,
            enableShortTerm = true,
        ),
    )

    /** `initialCardState()`: a card that has never been reviewed. */
    fun initialCardState(): ComputedCardState = toComputed(emptyCard(System.currentTimeMillis()), null)

    private fun emptyCard(now: Long) = FsrsCard(
        due = now, stability = 0.0, difficulty = 0.0, elapsedDays = 0, scheduledDays = 0,
        learningSteps = 0, reps = 0, lapses = 0, state = FsrsState.New, lastReview = null,
    )

    private fun toComputed(card: FsrsCard, reviewedAt: String?): ComputedCardState {
        val isNew = card.state == FsrsState.New
        return ComputedCardState(
            queue = card.state.value,
            stability = card.stability,
            difficulty = card.difficulty,
            scheduledDays = card.scheduledDays,
            reps = card.reps,
            lapses = card.lapses,
            nextReviewAt = if (isNew) null else Js.toIsoString(card.due),
            dueTimestamp = if (isNew) null else card.due,
            lastReviewedAt = reviewedAt ?: card.lastReview?.let { Js.toIsoString(it) },
            easeFactor = stabilityToEaseFactor(card.stability),
            interval = card.scheduledDays,
            repetitions = card.reps,
            learningStep = 0,
        )
    }

    private fun stabilityToEaseFactor(stability: Double): Double {
        val ease = 1.3 + (stability / 30) * 1.2
        return Math.max(1.3, Math.min(3.0, ease))
    }

    private fun toFsrsCard(state: ComputedCardState, currentTime: String): FsrsCard {
        val now = Js.parseDate(currentTime)
        val due = if (state.queue == CardQueue.NEW) now else state.nextReviewAt?.let { Js.parseDate(it) } ?: now
        return FsrsCard(
            due = due,
            stability = state.stability,
            difficulty = state.difficulty,
            elapsedDays = 0,
            scheduledDays = state.scheduledDays,
            learningSteps = 0,
            reps = state.reps,
            lapses = state.lapses,
            state = FsrsState.of(state.queue),
            lastReview = state.lastReviewedAt?.let { Js.parseDate(it) },
        )
    }

    /** `applyReview(state, rating, DEFAULT_DECK_SETTINGS, reviewedAt)`. */
    fun applyReview(state: ComputedCardState, rating: Int, reviewedAt: String): ComputedCardState {
        val card = toFsrsCard(state, reviewedAt)
        val next = fsrs.next(card, Js.parseDate(reviewedAt), rating + 1)
        return toComputed(next, reviewedAt)
    }

    /**
     * `computeCardState(events)`: replay every event (sorted by reviewed_at ascending)
     * from a NEW card. This is the single source of truth for a card's state.
     */
    fun computeCardState(events: List<ReviewEventInput>): ComputedCardState {
        if (events.isEmpty()) return initialCardState()
        var card = toFsrsCard(initialCardState(), events[0].reviewedAt)
        var lastReviewedAt: String? = null
        for (event in events) {
            card = fsrs.next(card, Js.parseDate(event.reviewedAt), event.rating + 1)
            lastReviewedAt = event.reviewedAt
        }
        return toComputed(card, lastReviewedAt)
    }

    /** `getIntervalPreviews(state, DEFAULT_DECK_SETTINGS, now)` — the labels on the rating buttons. */
    fun intervalPreviews(state: ComputedCardState, nowMs: Long): List<IntervalPreview> {
        val card = toFsrsCard(state, Js.toIsoString(nowMs))
        return Rating.ALL.map { rating ->
            val next = fsrs.next(card, nowMs, rating + 1)
            val intervalMs = next.due - nowMs
            val intervalDays = intervalMs / (1000.0 * 60 * 60 * 24)
            IntervalPreview(
                rating = rating,
                intervalText = formatInterval(intervalDays * 24 * 60),
                intervalDays = intervalDays,
                nextState = next.state.value,
            )
        }
    }

    /** `getRetrievability(state, DEFAULT_DECK_SETTINGS, now)`. */
    fun retrievability(state: ComputedCardState, nowMs: Long): Double {
        if (state.queue == CardQueue.NEW) return 1.0
        return fsrs.retrievability(toFsrsCard(state, Js.toIsoString(nowMs)), nowMs)
    }

    /** `formatInterval(minutes, useLessThan)`. */
    fun formatInterval(minutes: Double, useLessThan: Boolean = false): String {
        if (useLessThan && minutes < 10) return "<10m"
        if (minutes < 60) return "${Js.numberToString(Js.round(minutes))}m"
        if (minutes < 1440) return "${Js.numberToString(Js.round(minutes / 60))}h"
        val days = Js.round(minutes / 1440)
        if (days < 7) return "${Js.numberToString(days)}d"
        fun unit(value: Double, suffix: String) =
            if (value == Math.floor(value)) "${Js.numberToString(value)}$suffix" else "${Js.toFixed(value, 1)}$suffix"
        if (days < 30) return unit(days / 7, "w")
        if (days < 365) return unit(days / 30, "mo")
        return unit(days / 365, "y")
    }
}
