package dev.jeromeswannack.chineselearning.lab.ui.quests

import dev.jeromeswannack.chineselearning.lab.core.QuestDirection
import dev.jeromeswannack.chineselearning.lab.core.QuestPlayerAction
import dev.jeromeswannack.chineselearning.lab.data.api.QuestSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import kotlinx.coroutines.test.TestScope
import org.junit.Test
import org.robolectric.annotation.Config

/** Quests (package H): list, building, failed, the game in play, hint, refusal, menu, finish. */
class QuestsScreenshots : LabScreenshotTest() {
    private val rows = listOf(
        QuestSummaryDto("q1", "在超市买东西", "在超市买东西", "generating", progress = "Writing the goals…", created_at = "2026-09-27 08:10:00"),
        QuestSummaryDto("q2", "厨房做早饭", "厨房做早饭", "ready", completed_at = "2026-09-26 09:00:00", best_moves = 23, play_count = 2, created_at = "2026-09-26 08:00:00", goal_count = 4, object_count = 6),
        QuestSummaryDto("q3", "在公园遛狗", "在公园遛狗", "ready", created_at = "2026-09-25 18:30:00", goal_count = 5, object_count = 9),
        QuestSummaryDto("q4", "开一家小咖啡店", "开一家小咖啡店", "error", error = "World failed validation after 2 repairs", created_at = "2026-09-24 12:00:00"),
    )

    private fun game(scope: TestScope = TestScope()) = QuestGameController(SampleQuest.world, scope)

    @Test fun list() = shootInShell("quests-01-list", active = TabId.MORE) {
        QuestsScreen(QuestsUi(quests = Loadable(rows)), QuestsActions(onBack = {}))
    }

    @Test fun building() = shoot("quests-02-building") {
        QuestWaitScreen("在超市买东西", "generating", "Writing the goals…", null, null, false, {}, {})
    }

    @Test fun failed() = shoot("quests-03-failed") {
        QuestWaitScreen("开一家小咖啡店", "error", null, "World failed validation after 2 repairs", null, false, {}, {})
    }

    @Test fun start() {
        val c = game()
        shoot("quests-04-play-start") { QuestGameView(c, QuestReveal(), {}, {}) }
    }

    @Test fun midGameWithHintAndPinyin() {
        val c = game()
        c.act(QuestPlayerAction.Interact("cat", "pet"))
        listOf(QuestDirection.UP, QuestDirection.LEFT, QuestDirection.LEFT, QuestDirection.UP).forEach(c::move)
        c.act(QuestPlayerAction.Interact("fridge", "open"))
        c.dismissToast()
        c.showHint = true
        shoot("quests-05-sequence-hint-pinyin") { QuestGameView(c, QuestReveal(pinyin = true, english = true, buttonPinyin = true), {}, {}) }
    }

    @Test fun refused() {
        val c = game()
        c.move(QuestDirection.RIGHT)
        c.move(QuestDirection.RIGHT)
        shoot("quests-06-refused") { QuestGameView(c, QuestReveal(), {}, {}) }
    }

    @Test fun menu() {
        val c = game()
        shoot("quests-07-menu") { QuestGameView(c, QuestReveal(english = true), {}, {}, menuOpenInitially = true) }
    }

    @Test fun finished() {
        val c = game()
        c.act(QuestPlayerAction.Interact("cat", "pet"))
        listOf(QuestDirection.UP, QuestDirection.LEFT, QuestDirection.LEFT, QuestDirection.UP).forEach(c::move)
        c.act(QuestPlayerAction.Interact("fridge", "open"))
        c.act(QuestPlayerAction.PickUp("egg"))
        c.move(QuestDirection.RIGHT)
        c.act(QuestPlayerAction.Interact("pan", "cook"))
        c.pickUpOrPutDown()
        c.move(QuestDirection.DOWN); c.move(QuestDirection.DOWN)
        c.act(QuestPlayerAction.PickUp("bread"))
        c.move(QuestDirection.RIGHT); c.move(QuestDirection.RIGHT); c.move(QuestDirection.DOWN)
        c.pickUpOrPutDown()
        shoot("quests-08-finished", settleMs = 1_200) { QuestGameView(c, QuestReveal(), {}, {}) }
    }

    @Test fun dark() {
        val c = game()
        shoot("quests-09-dark", dark = true) { QuestGameView(c, QuestReveal(pinyin = true), {}, {}) }
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() {
        val c = game()
        shoot("quests-10-unfolded") { QuestGameView(c, QuestReveal(pinyin = true), {}, {}) }
    }
}
