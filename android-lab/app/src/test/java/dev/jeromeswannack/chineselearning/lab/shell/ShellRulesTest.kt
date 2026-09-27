package dev.jeromeswannack.chineselearning.lab.shell

import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.shell.ShellRules.CardDecision
import dev.jeromeswannack.chineselearning.lab.shell.ShellRules.CheckInput
import dev.jeromeswannack.chineselearning.lab.shell.ShellRules.HomeworkItem
import dev.jeromeswannack.chineselearning.lab.shell.ShellRules.Silent
import org.junit.Test
import java.time.LocalDate
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The notification / widget decisions (pure — no device). */
class ShellRulesTest {
    private val now = 1_790_000_000_000L
    private val ok = CheckInput(enabled = true, permitted = true, signedIn = true, tutorAccount = false, hour = 12)

    private fun card(id: String, queue: Int, due: Long?, type: String = CardTypes.HANZI_TO_MEANING) =
        QueueCard(id, "n-$id", "d1", type, CardScheduler.initialCardState().copy(queue = queue, dueTimestamp = due))

    @Test
    fun quietHoursAreTenPmToEightAm() {
        assertEquals(listOf(0, 1, 2, 3, 4, 5, 6, 7, 22, 23), (0..23).filter(ShellRules::isQuietHour))
    }

    @Test
    fun silentReasonsInOrder() {
        val c = card("a", CardQueue.REVIEW, now - 1000)
        assertEquals(CardDecision.Show("a"), ShellRules.decideCard(ok, c))
        assertEquals(CardDecision.Stay(Silent.DISABLED), ShellRules.decideCard(ok.copy(enabled = false, signedIn = false), c))
        assertEquals(CardDecision.Stay(Silent.NO_PERMISSION), ShellRules.decideCard(ok.copy(permitted = false), c))
        assertEquals(CardDecision.Stay(Silent.SIGNED_OUT), ShellRules.decideCard(ok.copy(signedIn = false), c))
        assertEquals(CardDecision.Stay(Silent.TUTOR_ACCOUNT), ShellRules.decideCard(ok.copy(tutorAccount = true), c))
        assertEquals(CardDecision.Stay(Silent.QUIET_HOURS), ShellRules.decideCard(ok.copy(hour = 22), c))
        assertEquals(CardDecision.Stay(Silent.QUIET_HOURS), ShellRules.decideCard(ok.copy(hour = 7), c))
        assertEquals(CardDecision.Show("a"), ShellRules.decideCard(ok.copy(hour = 8), c))
        assertEquals(CardDecision.Show("a"), ShellRules.decideCard(ok.copy(hour = 21), c))
        assertEquals(CardDecision.Stay(Silent.NOTHING_DUE), ShellRules.decideCard(ok, null))
    }

    @Test
    fun aShowingCardThatIsStillDueIsLeftAlone() {
        val c = card("a", CardQueue.REVIEW, now - 1000)
        assertEquals(CardDecision.Keep, ShellRules.decideCard(ok, c, showingStillDue = true))
        // …unless the check must go quiet.
        assertEquals(CardDecision.Stay(Silent.SIGNED_OUT), ShellRules.decideCard(ok.copy(signedIn = false), c, showingStillDue = true))
    }

    @Test
    fun notificationCardIsASeenHanziCardDueNowMostOverdueFirst() {
        val cards = listOf(
            card("new", CardQueue.NEW, null),                                      // never: the new-card budget is for sessions
            card("later-today", CardQueue.REVIEW, now + 3_600_000),                 // due today but not yet
            card("typing", CardQueue.REVIEW, now - 9_000_000, CardTypes.MEANING_TO_HANZI), // needs a keyboard
            card("review", CardQueue.REVIEW, now - 60_000),
            card("relearn", CardQueue.RELEARNING, now - 5_000_000),
            card("learning", CardQueue.LEARNING, now - 1_000),
        )
        assertEquals(listOf("relearn", "review", "learning"), ShellRules.notificationCandidates(cards, now).map { it.id })
        assertEquals("relearn", ShellRules.pickNotificationCard(cards, now)?.id)
        assertNull(ShellRules.pickNotificationCard(cards.take(3), now))
    }

    private fun hw(id: String, due: String?, mode: String = "one_off", status: String = "active", kind: String = "deck") =
        HomeworkItem(id, "Title $id", kind, mode, due, status, "王老师", itemCount = 12)

    @Test
    fun homeworkDueNowIsOneOffActiveDueTodayOrOverdue() {
        val today = LocalDate.parse("2026-09-27")
        val items = listOf(
            hw("today", "2026-09-27"),
            hw("overdue", "2026-09-25", mode = "both"),
            hw("tomorrow", "2026-09-28"),
            hw("fsrs", "2026-09-20", mode = "fsrs"),
            hw("done", "2026-09-20", status = "done"),
            hw("cancelled", "2026-09-20", status = "cancelled"),
            hw("undated", null),
            hw("bad-date", "27/09/2026"),
        )
        val due = ShellRules.homeworkDueNow(items, today)
        assertEquals(listOf("overdue", "today"), due.map { it.item.id })
        assertEquals(listOf("overdue", "due today"), due.map { it.label })
        assertEquals("Title today — 12 words, due today · from 王老师", ShellRules.homeworkLine(due[1]))
        assertEquals("2 homework assignments (1 overdue)", ShellRules.homeworkTitle(due))
        assertEquals("Homework due today: Title today", ShellRules.homeworkTitle(due.drop(1)))
    }

    @Test
    fun homeworkIsNotifiedOncePerAssignmentPerDay() {
        val due = ShellRules.homeworkDueNow(listOf(hw("a", "2026-09-27"), hw("b", "2026-09-26")), LocalDate.parse("2026-09-27"))
        assertEquals(listOf("b", "a"), ShellRules.homeworkToNotify(ok, due, emptySet()).map { it.item.id })
        assertEquals(listOf("a"), ShellRules.homeworkToNotify(ok, due, setOf("b")).map { it.item.id })
        assertEquals(emptyList(), ShellRules.homeworkToNotify(ok.copy(hour = 23), due, emptySet()))
        assertEquals(emptyList(), ShellRules.homeworkToNotify(ok.copy(enabled = false), due, emptySet()))
    }

    @Test
    fun widgetText() {
        val signedOut = ShellRules.widgetText(ShellRules.WidgetModel(false, QueueCounts(3, 0, 0, 0)))
        assertEquals("Sign in to start studying", signedOut.detail)
        val done = ShellRules.widgetText(ShellRules.WidgetModel(true, QueueCounts(0, 0, 0, 0)))
        assertEquals(ShellRules.WidgetText("✓", "All done", "Nothing due today", null), done)
        // 24 cards × 20 s = 8 min, like Home's "24 cards due · about 8 min".
        val due = ShellRules.widgetText(ShellRules.WidgetModel(true, QueueCounts(3, 2, 4, 15)))
        assertEquals(ShellRules.WidgetText("24", "cards due", "about 8 min", null), due)
        assertEquals("card due", ShellRules.widgetText(ShellRules.WidgetModel(true, QueueCounts(0, 0, 0, 1))).caption)
        assertEquals("about 1 min", ShellRules.widgetText(ShellRules.WidgetModel(true, QueueCounts(0, 0, 0, 1))).detail)
        val hw = ShellRules.homeworkDueNow(listOf(hw("a", "2026-09-27")), LocalDate.parse("2026-09-27"))
        assertEquals("📝 Title a · due today", ShellRules.widgetText(ShellRules.WidgetModel(true, QueueCounts(0, 0, 0, 0), hw)).homework)
    }
}
