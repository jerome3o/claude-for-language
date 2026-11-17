package dev.jeromeswannack.chineselearning.lab.core

/**
 * What is left of "revisit later" (the schedule mini lessons and graded readers were on until
 * Oct 2026). Nothing is scheduled with gaps any more: a mini lesson revises until it is right first
 * time ([LessonRevision], shared/study/lessonRevision.ts) and a story is read once ([DailyReader]).
 * The old "Done for good" / "Bring back" marks ([RevisitMark], `revisit_events`) are still read by
 * the revision rule.
 */

/** A lesson / reader row's state: NEW until finished (a reader: read), retired = done for good. */
data class RevisitState(
    /** new / scheduled / retired. */
    val status: String,
    /** When it is next due (ms since epoch); null when new, retired or never due again. */
    val dueMs: Long?,
    /** Legacy: the gap in days (0 for everything made now). */
    val gapDays: Double,
    /** The last finish (ms), null before the first. */
    val lastMs: Long?,
    /** How many times it was finished. */
    val finishes: Int,
) {
    val isNew: Boolean get() = status == NEW
    val isRetired: Boolean get() = status == RETIRED
    val isScheduled: Boolean get() = status == SCHEDULED

    companion object {
        const val NEW = "new"
        const val SCHEDULED = "scheduled"
        const val RETIRED = "retired"
        val INITIAL = RevisitState(NEW, null, 0.0, null, 0)
    }
}

object Revisit {
    private val SHORT_DAY = java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.ENGLISH)

    /**
     * The tutor's line from an OLDER server that sends no `revision_label` (web utils/revisitLabel.ts
     * `nextRevisitLabel`'s fallback): "next revisit 20 Oct" / "due now" / "done for good".
     */
    fun tutorLabel(nextRevisitAt: String?, retired: Boolean, nowMs: Long = System.currentTimeMillis(), zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String? {
        if (retired) return "done for good"
        if (nextRevisitAt.isNullOrEmpty()) return null
        val t = runCatching { Js.parseDate(nextRevisitAt) }.getOrNull() ?: return null
        if (t <= nowMs) return "due now"
        return "next revisit ${SHORT_DAY.format(java.time.Instant.ofEpochMilli(t).atZone(zone))}"
    }
}
