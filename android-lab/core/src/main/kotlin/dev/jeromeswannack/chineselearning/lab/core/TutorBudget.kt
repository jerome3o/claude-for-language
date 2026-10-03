package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/decks/tutor-budget.ts: the daily new-card budget as the tutor and the
 * learner both see it — who set it, and the words both sides read (the tutor's "Daily new
 * cards" row and sheet, the chat message her change posts, the learner's Settings
 * "Set by …" line). Parity-tested (parity/fixtures/tutor-budget.ts).
 */
data class StudyBudgetInfo(
    val newCardsPerDay: Int,
    val secondaryCardsPerDay: Int,
    /** Nothing set: both numbers are [StudyBudget.DEFAULT]. */
    val isDefault: Boolean = true,
    /** Who last changed it — null when never changed. */
    val setById: String? = null,
    val setByName: String? = null,
    /** Someone other than the learner (their tutor) set the current numbers. */
    val setByTutor: Boolean = false,
    /** When (server ISO time). */
    val setAt: String? = null,
) {
    val budget: StudyBudget get() = StudyBudget(newCardsPerDay, secondaryCardsPerDay)

    companion object {
        val DEFAULT = StudyBudgetInfo(StudyBudget.DEFAULT.newCardsPerDay, StudyBudget.DEFAULT.secondaryCardsPerDay)
    }
}

/** The user-row columns [TutorBudget.studyBudgetInfo] reads (`StudyBudgetRow`). */
data class StudyBudgetRow(
    val newCardsPerDay: Int? = null,
    val secondaryCardsPerDay: Int? = null,
    val studyBudgetSetBy: String? = null,
    val studyBudgetSetAt: String? = null,
    val studyBudgetSetByName: String? = null,
)

object TutorBudget {
    /** `studyBudgetInfo` (server side in the web app; ported for completeness). */
    fun studyBudgetInfo(row: StudyBudgetRow?, ownerId: String): StudyBudgetInfo {
        val p = row?.newCardsPerDay
        val s = row?.secondaryCardsPerDay
        val setBy = row?.studyBudgetSetBy
        return StudyBudgetInfo(
            newCardsPerDay = p ?: StudyBudget.DEFAULT.newCardsPerDay,
            secondaryCardsPerDay = s ?: StudyBudget.DEFAULT.secondaryCardsPerDay,
            isDefault = p == null && s == null,
            setById = setBy,
            setByName = if (!setBy.isNullOrEmpty()) row.studyBudgetSetByName else null,
            setByTutor = !setBy.isNullOrEmpty() && setBy != ownerId,
            setAt = row?.studyBudgetSetAt,
        )
    }

    private fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

    /** `budgetSummary`: "3 new words + 6 extra a day" — the tutor's row and the dashboard chip. */
    fun budgetSummary(b: StudyBudget): String =
        "${plural(b.newCardsPerDay, "new word", "new words")} + ${b.secondaryCardsPerDay} extra a day"

    /** `budgetChangeMessage`: the chat message the tutor's change posts as her. */
    fun budgetChangeMessage(b: StudyBudget, isDefault: Boolean): String {
        val extra = if (b.secondaryCardsPerDay > 0) " (+${b.secondaryCardsPerDay} extra)" else " (no extra cards)"
        return if (isDefault) "I've set your new cards back to the usual ${b.newCardsPerDay} a day$extra 📚"
        else "I've set your new cards to ${b.newCardsPerDay} a day$extra 📚"
    }

    private const val JS_SPACE = "\t\n\u000B\u000C\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
    private val JS_SPACE_RUN = Regex("[\\t\\n\\u000B\\u000C\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")

    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** `shortDay`: "3 Oct" of an ISO time in a zone given as Date.getTimezoneOffset() minutes. */
    fun shortDay(iso: String, tzOffsetMinutes: Int): String? {
        val t = try { Js.parseDate(iso) } catch (_: Exception) { return null }
        val d = java.time.Instant.ofEpochMilli(t - tzOffsetMinutes * 60_000L).atZone(java.time.ZoneOffset.UTC)
        return "${d.dayOfMonth} ${MONTHS[d.monthValue - 1]}"
    }

    /** `firstName`: "Minghui Wang" → "Minghui"; "your tutor" when there is none. */
    fun firstName(name: String?): String {
        // JS trim() and /\s+/: the same white-space set, spelled out (Java's \s is ASCII only).
        val trimmed = (name ?: "").trim { it in JS_SPACE }
        val first = trimmed.split(JS_SPACE_RUN)[0]
        return first.ifEmpty { "your tutor" }
    }

    /** `budgetSetByLabel`: "Set by Minghui · 3 Oct" while the numbers are the tutor's; null otherwise. */
    fun budgetSetByLabel(info: StudyBudgetInfo?, tzOffsetMinutes: Int): String? {
        if (info == null || !info.setByTutor) return null
        val day = info.setAt?.takeIf { it.isNotEmpty() }?.let { shortDay(it, tzOffsetMinutes) }
        return if (day != null) "Set by ${firstName(info.setByName)} · $day" else "Set by ${firstName(info.setByName)}"
    }

    /** `budgetFinishHint`: "At 5 a day, Lesson vocab finishes in ~9 days"; null without a deck or words. */
    fun budgetFinishHint(newPerDay: Int, deckName: String?, wordsToGo: Int?): String? {
        if (deckName.isNullOrEmpty() || wordsToGo == null || wordsToGo <= 0) return null
        if (newPerDay <= 0) return "At 0 a day, no new words from $deckName are introduced"
        val days = Budget.daysToIntroduce(wordsToGo, newPerDay)
        return "At $newPerDay a day, $deckName finishes in ~${plural(days, "day", "days")}"
    }
}
