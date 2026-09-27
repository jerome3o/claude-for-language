package dev.jeromeswannack.chineselearning.lab.ui.homework

import dev.jeromeswannack.chineselearning.lab.core.DeckProgressSummary
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.HwItem
import dev.jeromeswannack.chineselearning.lab.core.HwMessage
import dev.jeromeswannack.chineselearning.lab.core.HwPick
import dev.jeromeswannack.chineselearning.lab.data.api.OnboardingDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.OnboardingDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.FirstOpenActions
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.FirstOpenScreen
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.FirstOpenUi
import org.junit.Test
import org.robolectric.annotation.Config

/** Package E screenshots: homework list, the one-off pass, Home's homework cards, first open. */
class HomeworkScreenshots : LabScreenshotTest() {
    companion object {
        const val TODAY = "2026-09-27"

        private fun a(id: String, title: String, kind: String = "deck", mode: String = "one_off", due: String? = TODAY, items: Int = 12, part: Int = 0, parts: Int = 1, status: String = "active") =
            HomeworkAssignment(
                id = id, kind = kind, target_id = "t-$id", title = title, mode = mode, due_date = due,
                item_ids = if (kind == "deck") (1..items).map { "$id-n$it" } else null, item_count = items,
                part_index = part, part_count = parts, status = status, created_at = "2026-09-2${part}T10:00:00Z",
                updated_at = "2026-09-26T10:00:00Z", completed_at = if (status == "done") "2026-09-26T10:00:00Z" else null, tutor_name = "王老师",
            )

        val assignments = listOf(
            a("a1", "餐厅点菜 · day 1 of 2", due = "2026-09-25", parts = 2),
            a("a2", "餐厅点菜 · day 2 of 2", due = "2026-09-28", part = 1, parts = 2),
            a("a3", "天气和季节", mode = "both", due = TODAY, items = 8),
            a("a4", "把字句", kind = "lesson", due = "2026-10-01"),
            a("a5", "小明在巴黎", kind = "reader", due = "2026-09-30"),
            a("a6", "Week 2 · 家人", status = "done", due = "2026-09-20"),
        )
        val events = (1..5).map { HomeworkEvent("e$it", "a1", "a1-n$it", "right", "2026-09-26T10:0$it:00Z") } +
            listOf(HomeworkEvent("e9", "a1", "a1-n6", "wrong", "2026-09-26T10:09:00Z"))
        val sorted = Homework.sortHomeworkItems(Homework.toHomeworkItems(assignments, events, TODAY))
        val listUi = HomeworkListUi(true, sorted.todo, sorted.done)

        val note = PassNote("n1", "服务员", "fúwùyuán", "waiter; waitress", null, "服务员，我们要点菜。", "Waiter, we'd like to order.")
        val deckAssignment = assignments[0]
        val progress = Homework.passProgress(Homework.passItemIds(deckAssignment), events)
        fun deckPass(revealed: Boolean) = PassUi.Deck("餐厅点菜", "day 1 of 2", Homework.dueLabel("2026-09-25", TODAY), progress, note, revealed, "d1", oneOffOnly = true)

        val tutorCard = TutorCardUi(
            HwPick("王老师", "rel1", HwItem.Deck("d1", "第三周作业：天气", "2026-09-26T10:00:00Z"), HwMessage("c1", "rel1", "明天上课前把这些词复习一下，好吗？", "2026-09-27T08:00:00Z")),
            DeckProgressSummary(18, 7, listOf("刮风", "晴天")),
            18,
        )

        val onboarding = OnboardingDto(
            invited = true, redeemed_at = "2026-09-27 08:00:00", inviter = UserSummaryDto("t1", name = "王老师"), inviter_role = "tutor",
            relationship_id = "rel1", welcome_message = "欢迎！Welcome — start with the starter deck and message me any questions.", welcome_conversation_id = "c1",
            decks = listOf(OnboardingDeckDto("d1", "Starter Chinese (from tutor)", 15)),
        )
    }

    @Test fun list() = shootInShell("homework-01-list", active = TabId.STUDY) { HomeworkListScreen(listUi, onBack = {}, onOpen = {}) }

    @Test fun listEmpty() = shoot("homework-02-list-empty") { HomeworkListScreen(HomeworkListUi(true), onBack = {}, onOpen = {}) }

    @Test fun passFront() = shoot("homework-03-pass-front") { HomeworkPassScreen(deckPass(false), PassActions()) }

    @Test fun passRevealed() = shoot("homework-04-pass-revealed") { HomeworkPassScreen(deckPass(true), PassActions()) }

    @Test fun passDone() = shoot("homework-05-pass-done") {
        HomeworkPassScreen(deckPass(false).copy(progress = progress.copy(done = 12, total = 12, remaining = emptyList(), retrying = 0, complete = true)), PassActions())
    }

    @Test fun passDoneAdded() = shoot("homework-06-pass-done-added", dark = true) {
        HomeworkPassScreen(deckPass(false).copy(progress = progress.copy(done = 12, total = 12, remaining = emptyList(), retrying = 0, complete = true), addState = AddState.Done), PassActions())
    }

    @Test fun passLesson() = shoot("homework-07-pass-lesson") { HomeworkPassScreen(PassUi.Player("lesson", "把字句", complete = false, available = true), PassActions()) }

    @Test fun passMissing() = shoot("homework-08-pass-missing") { HomeworkPassScreen(PassUi.Missing, PassActions()) }

    @Test fun homeCards() = shootInShell("homework-09-home-cards", active = TabId.STUDY) {
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen("Home") {
            item { HomeHomeworkSection(HomeHomeworkUi(sorted.todo, tutorCard), onOpen = {}, onAll = {}, cardActions = TutorCardActions()) }
        }
    }

    @Test fun firstOpen() = shoot("homework-10-first-open") {
        FirstOpenScreen(FirstOpenUi(onboarding, "Jerome Swannack", totalDue = 15, hasSyncedOnce = true, online = true), FirstOpenActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun passUnfolded() = shoot("homework-11-pass-unfolded") { HomeworkPassScreen(deckPass(true), PassActions()) }
}
