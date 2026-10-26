package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.jeromeswannack.chineselearning.lab.core.phone.PersonaReply
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneJs
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneScenarios
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 📱 Phone practice in the real shell (web e2e/tests/phone-practice.spec.ts): the easiest rail task
 * (stations by 简拼, the date, G7311, 二等座, a refused submit with nobody ticked, 选座 F, pay with a
 * wrong password first) and the easiest food task (选规格 with a required-option error, 备注 不要香菜,
 * the 餐具 refusal, pay) end to end — the engine must say each task is complete.
 */
@RunWith(RobolectricTestRunner::class)
// Native graphics: the sheets' top-only rounded clip is hit-tested through Path ops, which the legacy mode can't do.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class PhoneFlowTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var p: PhoneRuntime

    private fun start(id: String) {
        val spec = PhoneScenarios.byId(id)!!
        compose.setContent {
            LabTheme {
                val scope = rememberCoroutineScope()
                p = remember { PhoneRuntime(spec, System.currentTimeMillis(), emptyList(), scope, PersonaClient { _, _, _, _ -> PersonaReply("好的", "OK") }) }
                PhoneStage(p, onWord = null)
            }
        }
        compose.waitForIdle()
    }

    private fun node(tag: String): SemanticsNodeInteraction {
        val n = compose.onNodeWithTag(tag, useUnmergedTree = true)
        runCatching { n.performScrollTo() }
        return n
    }

    private fun tap(tag: String) {
        node(tag).performClick()
        compose.waitForIdle()
    }

    private fun tapFirst(tag: String) {
        compose.onAllNodesWithTag(tag, useUnmergedTree = true).onFirst().performClick()
        compose.waitForIdle()
    }

    private fun type(tag: String, text: String) {
        compose.onNodeWithTag(tag, useUnmergedTree = true).performTextInput(text)
        compose.waitForIdle()
    }

    /** Some text under the node tagged [tag] contains [text]. */
    private fun assertHas(tag: String, text: String) {
        compose.onAllNodes((hasTestTag(tag) or hasAnyAncestor(hasTestTag(tag))) and hasText(text, substring = true), useUnmergedTree = true).onFirst().assertExists()
    }

    private fun advance(ms: Long) {
        compose.mainClock.advanceTimeBy(ms)
        compose.waitForIdle()
    }

    private fun payWith(password: String) {
        tap("pay-confirm")
        for (d in password) tap("key-$d")
        advance(2_500)
    }

    /** Taps [tag] and checks the toast it shows (the clock held so the 2.2 s toast is still up). */
    private fun tapToToast(tag: String, text: String) {
        compose.mainClock.autoAdvance = false
        node(tag).performClick()
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeByFrame()
        compose.onNodeWithText(text, substring = true, useUnmergedTree = true).assertExists()
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
    }

    @Test fun railSaturdayTicketToHangzhou() {
        start("rail-hangzhou-saturday")
        tap("home-app-rail")
        tap("rail-from")
        type("rail-station-search", "shhq")
        tapFirst("rail-station-option")
        tap("rail-to")
        type("rail-station-search", "杭州东")
        tapFirst("rail-station-option")
        tap("rail-date")
        tap("rail-day-2026-10-31")
        tap("rail-search")
        tap("rail-train-row-G7311")
        tap("rail-book-二等座")

        // Submitting with nobody ticked is refused like the real app.
        tapToToast("rail-submit", "请选择乘车人")
        tap("rail-passenger-p_self")
        tap("rail-seat-1F")
        tap("rail-submit")
        tap("rail-confirm-ok")
        tap("rail-pay")

        // A wrong pay password first: a slip, then the right one.
        payWith("111111")
        assertHas("pay-error", "支付密码错误")
        for (d in p.spec.wallet.payPassword) tap("key-$d")
        advance(2_500)
        tap("pay-done")
        advance(500)

        assertHas("rail-order-status", "支付成功")
        val order = p.recordsOf("rail_order").single().data
        assertEquals("G7311", PhoneJs.s(order, "train_no"))
        assertEquals("paid", PhoneJs.s(order, "status"))
        assertTrue(PhoneEngine.isComplete(p.spec, p.events))
        val result = PhoneEngine.scenarioResult(p.spec, p.events, 0, 1)
        assertTrue("window" in result.bonus_done, "the 1F seat is a window seat")
    }

    @Test fun foodBeefNoodlesToTheOffice() {
        start("food-beef-noodles")
        tap("home-app-food")
        tap("food-shop-shop_lanzhou")
        tap("food-spec-open-lamian")

        tapToToast("food-spec-add", "请选择辣度")
        tap("food-spec-choice-中辣")
        tap("food-spec-choice-细面")
        tap("food-spec-choice-加蛋")
        tap("food-spec-add")
        tap("food-checkout")

        tapToToast("food-submit", "请选择餐具数量")
        tap("food-note")
        tap("food-note-tag-不要香菜")
        tap("food-note-done")
        tap("food-cutlery")
        tap("food-cutlery-option-无需餐具")
        assertHas("food-note", "不要香菜")
        tap("food-submit")
        payWith(p.spec.wallet.payPassword)
        tap("pay-done")
        advance(500)

        compose.onNodeWithTag("food-order-status", useUnmergedTree = true).assertExists()
        assertTrue(PhoneEngine.isComplete(p.spec, p.events))
        val result = PhoneEngine.scenarioResult(p.spec, p.events, 0, 1)
        // Two slips: the missing 辣度 and the missing 餐具数量.
        assertEquals(2, result.slips + result.mistakes.size)
        assertTrue("cutlery" in result.bonus_done)
    }
}
