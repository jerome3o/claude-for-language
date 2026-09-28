package dev.jeromeswannack.chineselearning.lab.core

import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * The tutor side's homework date maths — what the Send-homework sheet, the assigned-homework
 * list and the draft review page compute on the device. Ports of `shared/homework/due.ts`
 * (dates as 'YYYY-MM-DD' calendar days in the student's zone, never timestamps) and
 * `shared/homework/split.ts` ("spread the words over N days"). Parity-tested against the
 * TypeScript (parity/fixtures/teaching.ts). The load gauge itself is computed by the server
 * (`GET /api/relationships/:relId/homework` → `load`) and only rendered here.
 */
object HomeworkPlan {
    private val DATE_RE = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")

    /** Port of isDateString(). */
    fun isDateString(value: String?): Boolean {
        if (value == null || !DATE_RE.matches(value)) return false
        return try {
            LocalDate.parse(value).toString() == value
        } catch (_: DateTimeParseException) {
            false
        }
    }

    /** Port of addDays(). */
    fun addDays(date: String, days: Int): String = LocalDate.parse(date).plusDays(days.toLong()).toString()

    /** Port of daysBetween(): whole days from [from] to [to] (negative when [to] is earlier). */
    fun daysBetween(from: String, to: String): Int = ChronoUnit.DAYS.between(LocalDate.parse(from), LocalDate.parse(to)).toInt()

    enum class DueTone { OVERDUE, TODAY, SOON, LATER, NONE }

    data class DueLabel(val text: String, val tone: DueTone, val days: Int?)

    /** Port of dueLabel(): "overdue", "due today", "due in 1 day", "due in 4 days", or "". */
    fun dueLabel(due: String?, today: String): DueLabel {
        if (due.isNullOrEmpty() || !isDateString(due)) return DueLabel("", DueTone.NONE, null)
        val days = daysBetween(today, due)
        if (days < 0) return DueLabel("overdue", DueTone.OVERDUE, days)
        if (days == 0) return DueLabel("due today", DueTone.TODAY, days)
        return DueLabel("due in $days ${if (days == 1) "day" else "days"}", if (days <= 2) DueTone.SOON else DueTone.LATER, days)
    }

    /** Port of compareDue(): earliest due first; undated last. */
    fun compareDue(a: String?, b: String?): Int = when {
        !a.isNullOrEmpty() && !b.isNullOrEmpty() -> a.compareTo(b).coerceIn(-1, 1)
        !a.isNullOrEmpty() -> -1
        !b.isNullOrEmpty() -> 1
        else -> 0
    }

    private val DAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** Port of shortDay(): "Tue 14 Oct". */
    fun shortDay(date: String): String {
        if (!isDateString(date)) return date
        val d = LocalDate.parse(date)
        return "${DAYS[d.dayOfWeek.value % 7]} ${d.dayOfMonth} ${MONTHS[d.monthValue - 1]}"
    }

    const val MAX_SPLIT_DAYS = 14

    /** DEFAULT_DUE_IN_DAYS in shared/homework/plan.ts. */
    const val DEFAULT_DUE_IN_DAYS = 2

    /** NEXT_LESSON_WINDOW_DAYS in shared/homework/plan.ts. */
    const val NEXT_LESSON_WINDOW_DAYS = 14

    /**
     * Port of defaultHomeworkDueDate(): the student's next logged lesson (the earliest lesson day
     * after today, within NEXT_LESSON_WINDOW_DAYS), else DEFAULT_DUE_IN_DAYS from today.
     * [lessonDays] are calendar days (see [lessonDay]) in any order.
     */
    fun defaultHomeworkDueDate(today: String, lessonDays: List<String?> = emptyList()): String {
        var next: String? = null
        for (d in lessonDays) {
            if (d == null || !isDateString(d)) continue
            val ahead = daysBetween(today, d)
            if (ahead < 1 || ahead > NEXT_LESSON_WINDOW_DAYS) continue
            if (next == null || d < next) next = d
        }
        return next ?: addDays(today, DEFAULT_DUE_IN_DAYS)
    }

    /** Port of lessonDay(): a lesson-log `lesson_at` (ISO timestamp or 'YYYY-MM-DD') as a calendar day in [zone]. */
    fun lessonDay(lessonAt: String, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String? {
        if (isDateString(lessonAt)) return lessonAt
        return try {
            java.time.OffsetDateTime.parse(lessonAt).atZoneSameInstant(zone).toLocalDate().toString()
        } catch (_: DateTimeParseException) {
            null
        }
    }

    /** Port of clampSplitDays() (a non-finite / missing value counts as 1). */
    fun clampSplitDays(days: Double?, itemCount: Int): Int {
        val n = if (days != null && days.isFinite()) Js.round(days).toInt() else 1
        return max(1, min(min(n, MAX_SPLIT_DAYS), max(1, itemCount)))
    }

    data class SplitPart<T>(val index: Int, val items: List<T>, val dueDate: String)

    /** Port of splitIntoDays(): consecutive, balanced slices, bigger first, one due date per day. */
    fun <T> splitIntoDays(items: List<T>, days: Int, firstDue: String): List<SplitPart<T>> {
        if (items.isEmpty()) return emptyList()
        val n = clampSplitDays(days.toDouble(), items.size)
        val base = items.size / n
        val extra = items.size % n
        val parts = ArrayList<SplitPart<T>>(n)
        var at = 0
        for (i in 0 until n) {
            val size = base + if (i < extra) 1 else 0
            parts += SplitPart(i, items.subList(at, at + size).toList(), addDays(firstDue, i))
            at += size
        }
        return parts
    }

    /** Port of suggestSplitDays(): about [perDay] words a day. */
    fun suggestSplitDays(wordCount: Int, perDay: Int = 10): Int {
        if (wordCount <= perDay) return 1
        return min(MAX_SPLIT_DAYS, ceil(wordCount.toDouble() / perDay).toInt())
    }
}
