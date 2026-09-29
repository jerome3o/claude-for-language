package dev.jeromeswannack.chineselearning.lab.core

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * "Today is the session" (docs/STUDY_SESSION.md): ports of shared/study — parity-tested by
 * StudyDayParityTest against the TypeScript (android-lab/parity/fixtures/study.ts).
 */

/**
 * Active study time: port of shared/study/activeTime.ts. Every interaction on the study screen
 * credits the time since the previous one, capped at [IDLE_MS]; a pause (background, screen
 * off, leaving Study) credits the pending interval and stops the clock. Totals per local date.
 */
object ActiveTime {
    /** `ACTIVE_IDLE_MS` */
    const val IDLE_MS = 75_000L
    /** `ACTIVE_KEEP_DAYS` */
    const val KEEP_DAYS = 14

    data class Last(val at: Long, val day: String)

    /** `ActiveTimeState` */
    data class State(val totals: Map<String, Long> = emptyMap(), val last: Last? = null)

    /** `pendingActiveMs` */
    fun pending(state: State, now: Long): Long {
        val last = state.last ?: return 0
        val gap = now - last.at
        if (gap <= 0) return 0
        return min(gap, IDLE_MS)
    }

    private fun credited(state: State, now: Long): Map<String, Long> {
        val add = pending(state, now)
        val last = state.last
        if (last == null || add == 0L) return state.totals
        return state.totals + (last.day to ((state.totals[last.day] ?: 0L) + add))
    }

    /** `activeInteract` */
    fun interact(state: State, now: Long, day: String): State = State(credited(state, now), Last(now, day))

    /** `activePause` */
    fun pause(state: State, now: Long): State = if (state.last == null) state else State(credited(state, now), null)

    /** `activeTotal` */
    fun total(state: State, day: String, now: Long): Long {
        val base = state.totals[day] ?: 0L
        return if (state.last != null && state.last.day == day) base + pending(state, now) else base
    }

    /** `pruneActiveTime` */
    fun prune(state: State, firstKept: String): State = State(state.totals.filterKeys { it >= firstKept }, state.last)

    /** `dayTotalAcrossDevices` */
    fun acrossDevices(localMs: Long, serverTotal: Long, serverThisDevice: Long): Long =
        max(0L, serverTotal - serverThisDevice) + max(0L, localMs)

    /** `formatActiveMinutes`: "23 min", "1 h 5 min", "<1 min", "0 min". */
    fun formatMinutes(ms: Long): String {
        if (ms <= 0) return "0 min"
        if (ms < 60_000) return "<1 min"
        val minutes = floor(ms / 60_000.0 + 0.5).toLong() // JS Math.round (positive)
        if (minutes < 60) return "$minutes min"
        val h = minutes / 60
        val m = minutes % 60
        return if (m == 0L) "$h h" else "$h h $m min"
    }

    /** `todayStudyLine`: "Today: 23 min · 142 reviews". */
    fun todayLine(activeMs: Long, reviews: Int): String =
        "Today: ${formatMinutes(activeMs)} · $reviews review${if (reviews == 1) "" else "s"}"
}

/** Port of shared/study/resume.ts: the card left on screen comes back first while still due today. */
object StudyResume {
    /** `StudyResumePoint` */
    data class Point(
        val day: String,
        val scope: String,
        val cardId: String,
        val revealed: Boolean,
        val answer: String,
        val elapsedMs: Long,
    )

    /** `RESUME_MAX_ELAPSED_MS` */
    const val MAX_ELAPSED_MS = 3_600_000L

    /** `studyScope` */
    fun scope(deckId: String?): String = if (deckId.isNullOrEmpty()) "all" else deckId

    /** `resumeCardId` */
    fun cardId(point: Point?, day: String, scope: String, queueCardIds: Collection<String>): String? {
        if (point == null || point.day != day || point.scope != scope) return null
        return if (point.cardId in queueCardIds) point.cardId else null
    }

    /** `resumeElapsedMs` */
    fun elapsedMs(point: Point?): Long {
        val ms = point?.elapsedMs ?: 0L
        if (ms <= 0) return 0
        return min(ms, MAX_ELAPSED_MS)
    }
}

/** Port of shared/study/celebration.ts: confetti for emptying today's queue — once, again after more was cleared. */
object Celebration {
    /** `CelebrationMark` */
    data class Mark(val day: String, val reviews: Int)

    /** `shouldCelebrate` */
    fun should(mark: Mark?, day: String, reviewsToday: Int, queueEmpty: Boolean): Boolean {
        if (!queueEmpty || reviewsToday <= 0) return false
        if (mark == null || mark.day != day) return true
        return reviewsToday > mark.reviews
    }

    /** `celebrationMark` */
    fun mark(day: String, reviewsToday: Int) = Mark(day, reviewsToday)
}
