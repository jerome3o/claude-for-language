package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.phone.Bilingual
import dev.jeromeswannack.chineselearning.lab.core.phone.PersonaReply
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneScenarios
import dev.jeromeswannack.chineselearning.lab.data.phone.PhoneStore
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config

/** 📱 Phone practice (ui/phone): `phone-*.png` → docs/pr-screenshots/phone-practice-lab/. */
class PhoneScreenshots : LabScreenshotTest() {
    private lateinit var p: PhoneRuntime

    private fun play(id: String, content: @Composable (PhoneRuntime) -> Unit = { PhoneStage(it, onWord = null) }) {
        val spec = PhoneScenarios.byId(id)!!
        compose.setContent {
            LabTheme {
                val scope = rememberCoroutineScope()
                p = remember { PhoneRuntime(spec, System.currentTimeMillis(), emptyList(), scope, PersonaClient { _, _, _, _ -> PersonaReply("好的，我马上到。", "OK, I'll be right there.") }) }
                Box(Modifier.fillMaxSize()) { content(p) }
            }
        }
        compose.waitForIdle()
    }

    private fun tap(tag: String) {
        val n = compose.onNodeWithTag(tag, useUnmergedTree = true)
        runCatching { n.performScrollTo() }
        n.performClick()
        compose.waitForIdle()
    }

    private fun tapFirst(tag: String) {
        compose.onAllNodesWithTag(tag, useUnmergedTree = true).onFirst().performClick()
        compose.waitForIdle()
    }

    private fun capture(name: String) {
        compose.mainClock.advanceTimeBy(600)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun list() = shoot("phone-01-list") {
        PhonePracticeScreen(
            mapOf(
                "rail-hangzhou-saturday" to PhoneStore.ScenarioStatus(done = true, plays = 2, bestMs = 222_000),
                "food-beef-noodles" to PhoneStore.ScenarioStatus(inProgress = true),
            ),
            onBack = {}, onOpen = {},
        )
    }

    @Test fun taskCardOverHome() {
        play("rail-hangzhou-saturday") { r ->
            PhonePlayLayout(r, r.spec, resumed = false, hintsShown = 0, onHintsShown = {}, onWord = null, onGiveUp = {}, onRestart = {}, onExit = {})
        }
        capture("phone-02-task-card")
    }

    @Test fun homeScreen() {
        play("rail-hangzhou-saturday")
        capture("phone-03-home")
    }

    @Test fun railTrains() {
        play("rail-hangzhou-saturday")
        tap("home-app-rail")
        tap("rail-from")
        compose.onNodeWithTag("rail-station-search", useUnmergedTree = true).performTextInput("shhq")
        tapFirst("rail-station-option")
        tap("rail-to")
        compose.onNodeWithTag("rail-station-search", useUnmergedTree = true).performTextInput("杭州东")
        tapFirst("rail-station-option")
        tap("rail-date")
        tap("rail-day-2026-10-31")
        tap("rail-search")
        capture("phone-04-rail-trains")
    }

    @Test fun railConfirmAndPay() {
        play("rail-hangzhou-saturday")
        tap("home-app-rail")
        tap("rail-from")
        compose.onNodeWithTag("rail-station-search", useUnmergedTree = true).performTextInput("shhq")
        tapFirst("rail-station-option")
        tap("rail-to")
        compose.onNodeWithTag("rail-station-search", useUnmergedTree = true).performTextInput("杭州东")
        tapFirst("rail-station-option")
        tap("rail-date")
        tap("rail-day-2026-10-31")
        tap("rail-search")
        tap("rail-train-row-G7311")
        tap("rail-book-二等座")
        tap("rail-passenger-p_self")
        tap("rail-seat-1F")
        capture("phone-05-rail-confirm")
        tap("rail-submit")
        tap("rail-confirm-ok")
        tap("rail-pay")
        tap("pay-confirm")
        tap("key-1")
        tap("key-3")
        capture("phone-06-pay-password")
    }

    @Test fun foodSpecSheet() {
        play("food-beef-noodles")
        tap("home-app-food")
        tap("food-shop-shop_lanzhou")
        tap("food-spec-open-lamian")
        tap("food-spec-choice-中辣")
        tap("food-spec-choice-加蛋")
        capture("phone-07-food-spec")
    }

    @Test fun foodCheckout() {
        play("food-beef-noodles")
        tap("home-app-food")
        tap("food-shop-shop_lanzhou")
        tap("food-spec-open-lamian")
        tap("food-spec-choice-中辣")
        tap("food-spec-choice-细面")
        tap("food-spec-add")
        tap("food-checkout")
        capture("phone-08-food-checkout")
    }

    @Test fun chatTransfer() {
        play("chat-pay-back")
        tap("home-app-chat")
        tap("chat-row-xiaolin")
        capture("phone-09-chat")
        tap("chat-panel-toggle")
        tap("chat-panel-转账")
        tap("amount-8")
        tap("amount-6")
        capture("phone-10-transfer")
    }

    @Test fun rideConfirm() {
        play("ride-north-gate")
        tap("home-app-ride")
        tap("ride-where")
        compose.onNodeWithTag("ride-search", useUnmergedTree = true).performTextInput("外滩")
        compose.waitForIdle()
        tapFirst("ride-poi-bund")
        capture("phone-11-ride-cars")
    }

    @Test fun summary() {
        val spec = PhoneScenarios.byId("food-beef-noodles")!!
        val result = PhoneEngine.ScenarioResult(
            spec.id, success = true, duration_ms = 214_000, hints_used = 1, goals_done = spec.goals.filter { !it.optional }.map { it.id },
            bonus_done = emptyList(), bonus_total = spec.goals.count { it.optional },
            mistakes = listOf(PhoneEngine.MistakeIdLabel("x", Bilingual("Forgot the spice level at first", "忘了选辣度"))), slips = 1, persona_messages = 0,
        )
        shoot("phone-12-summary") { PhoneSummary(spec, result, onAgain = {}, onList = {}, onKeepGoing = {}, onAdd = {}) }
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() {
        play("food-beef-noodles") { r ->
            PhonePlayLayout(r, r.spec, resumed = false, hintsShown = 0, onHintsShown = {}, onWord = null, onGiveUp = {}, onRestart = {}, onExit = {})
        }
        tap("phone-task-close")
        tap("home-app-food")
        tap("food-shop-shop_lanzhou")
        tap("phone-hint-button")
        capture("phone-13-unfolded")
    }
}
