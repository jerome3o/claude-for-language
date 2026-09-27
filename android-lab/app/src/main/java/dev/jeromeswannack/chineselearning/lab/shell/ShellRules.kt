package dev.jeromeswannack.chineselearning.lab.shell

import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * The native shell's decisions, pure so they can be tested without a device: when a due-card
 * notification may be posted (the hybrid app's `HomeworkWorker.java`, made local-first),
 * which card it shows, which one-off homework is due, and what the widget says.
 */
object ShellRules {
    /** No notifications before 08:00 or from 22:00 (the hybrid's QUIET_BEFORE_HOUR / QUIET_FROM_HOUR). */
    const val QUIET_UNTIL_HOUR = 8
    const val QUIET_FROM_HOUR = 22

    /** ~20 s a card — the Home screen's "about N min" (HomeScreen.kt / the web's StudyTodayButton). */
    const val SECONDS_PER_CARD = 20

    fun isQuietHour(hour: Int): Boolean = hour < QUIET_UNTIL_HOUR || hour >= QUIET_FROM_HOUR

    /**
     * The card a notification asks about: a hanzi → meaning card that is due right now and
     * has been seen before (review, relearning or learning — never a NEW card, so the daily
     * new-card budget is only ever spent in a session). Taken from the study queue the
     * session would build, most overdue first. The hybrid asked `/api/cards/due?include_new=false`
     * for the same thing.
     */
    fun pickNotificationCard(dueCards: Collection<QueueCard>, nowMs: Long): QueueCard? = notificationCandidates(dueCards, nowMs).firstOrNull()

    /** Every card a notification may ask about, in the order it would (see [pickNotificationCard]). */
    fun notificationCandidates(dueCards: Collection<QueueCard>, nowMs: Long): List<QueueCard> =
        dueCards.asSequence()
            .filter { it.cardType == CardTypes.HANZI_TO_MEANING && it.queue != CardQueue.NEW }
            .filter { card -> card.state.dueTimestamp.let { it != null && it <= nowMs } }
            .sortedWith(compareBy<QueueCard>({ it.state.dueTimestamp }, { it.id }))
            .toList()

    enum class Silent { DISABLED, NO_PERMISSION, SIGNED_OUT, TUTOR_ACCOUNT, QUIET_HOURS, NOTHING_DUE }

    /** What the hourly check does about the due-card notification. */
    sealed interface CardDecision {
        data class Show(val cardId: String) : CardDecision
        /** A card notification is up and its card is still due: leave it (the user may be on its answer side). */
        data object Keep : CardDecision
        data class Stay(val reason: Silent) : CardDecision
    }

    data class CheckInput(
        val enabled: Boolean,
        val permitted: Boolean,
        val signedIn: Boolean,
        val tutorAccount: Boolean,
        val hour: Int,
    )

    /** First reason to stay silent, or null when the check may notify. */
    fun silentReason(input: CheckInput): Silent? = when {
        !input.enabled -> Silent.DISABLED
        !input.permitted -> Silent.NO_PERMISSION
        !input.signedIn -> Silent.SIGNED_OUT
        input.tutorAccount -> Silent.TUTOR_ACCOUNT
        isQuietHour(input.hour) -> Silent.QUIET_HOURS
        else -> null
    }

    fun decideCard(input: CheckInput, candidate: QueueCard?, showingStillDue: Boolean = false): CardDecision {
        silentReason(input)?.let { return CardDecision.Stay(it) }
        if (showingStillDue) return CardDecision.Keep
        return if (candidate == null) CardDecision.Stay(Silent.NOTHING_DUE) else CardDecision.Show(candidate.id)
    }

    // ---------------- one-off homework ----------------

    /** One assignment as the shell needs it (`HomeworkAssignment` in shared/homework/types.ts). */
    data class HomeworkItem(
        val id: String,
        val title: String,
        val kind: String,
        val mode: String,
        val dueDate: String?,
        val status: String,
        val tutorName: String? = null,
        val itemCount: Int = 0,
        val doneCount: Int = 0,
    )

    data class HomeworkDue(val item: HomeworkItem, val days: Int) {
        /** `dueLabel(...).text` from shared/homework/due.ts ("overdue", "due today"). */
        val label: String get() = if (days < 0) "overdue" else "due today"
    }

    /**
     * Active one-off homework due today or overdue (a `one_off` / `both` assignment with a
     * due date on or before [today]), overdue first — the web Home's Homework card rows that
     * need doing now.
     */
    fun homeworkDueNow(items: Collection<HomeworkItem>, today: LocalDate): List<HomeworkDue> =
        items.asSequence()
            .filter { it.status == "active" && (it.mode == "one_off" || it.mode == "both") }
            .mapNotNull { a ->
                val due = a.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return@mapNotNull null
                val days = ChronoUnit.DAYS.between(today, due).toInt()
                if (days > 0) null else HomeworkDue(a, days)
            }
            .sortedWith(compareBy<HomeworkDue>({ it.days }, { it.item.title }))
            .toList()

    /**
     * Homework to notify about now: due, not yet notified today (one reminder per assignment
     * per day), and only outside quiet hours with notifications allowed.
     */
    fun homeworkToNotify(input: CheckInput, due: List<HomeworkDue>, notifiedToday: Set<String>): List<HomeworkDue> {
        if (silentReason(input) != null) return emptyList()
        return due.filter { it.item.id !in notifiedToday }
    }

    fun homeworkTitle(due: List<HomeworkDue>): String = when (due.size) {
        0 -> ""
        1 -> "Homework ${due[0].label}: ${due[0].item.title}"
        else -> {
            val overdue = due.count { it.days < 0 }
            "${due.size} homework assignments " + if (overdue > 0) "($overdue overdue)" else "due today"
        }
    }

    fun homeworkLine(d: HomeworkDue): String {
        val what = when (d.item.kind) {
            "deck" -> if (d.item.itemCount > 0) "${d.item.itemCount} words" else "words"
            "lesson" -> "mini lesson"
            "reader" -> "story"
            else -> d.item.kind
        }
        val from = d.item.tutorName?.takeIf { it.isNotBlank() }?.let { " · from $it" }.orEmpty()
        return "${d.item.title} — $what, ${d.label}$from"
    }

    // ---------------- widget ----------------

    data class WidgetModel(
        val signedIn: Boolean,
        val due: QueueCounts,
        val homework: List<HomeworkDue> = emptyList(),
        val tutorAccount: Boolean = false,
    ) {
        val total get() = due.total
    }

    data class WidgetText(val count: String, val caption: String, val detail: String, val homework: String?)

    fun widgetText(m: WidgetModel): WidgetText {
        if (!m.signedIn) return WidgetText("学", "Lab", "Sign in to start studying", null)
        val hw = when {
            m.homework.isEmpty() -> null
            m.homework.size == 1 -> "📝 ${m.homework[0].item.title} · ${m.homework[0].label}"
            else -> "📝 ${m.homework.size} homework " + if (m.homework.any { it.days < 0 }) "· overdue" else "· due today"
        }
        if (m.total == 0) return WidgetText("✓", "All done", "Nothing due today", hw)
        val minutes = maxOf(1, Math.round(m.total * SECONDS_PER_CARD / 60f))
        return WidgetText(
            count = m.total.toString(),
            caption = if (m.total == 1) "card due" else "cards due",
            detail = "about $minutes min",
            homework = hw,
        )
    }
}
