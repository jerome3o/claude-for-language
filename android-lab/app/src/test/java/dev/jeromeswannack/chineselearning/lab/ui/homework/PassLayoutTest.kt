package dev.jeromeswannack.chineselearning.lab.ui.homework

import android.view.View
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.ShellFrame
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The pass's action button sits above the system navigation (gesture) bar, with room for a
 * thumb — the Lab draws edge to edge, so an immersive screen (no tab bar) must keep its
 * bottom controls out of the navigation-bar inset itself (LabScreenFrame does it for every
 * such screen). Folded and unfolded, front (Show answer) and back (Not yet / Got it).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = LabScreenshotTest.PHONE, application = android.app.Application::class)
class PassLayoutTest {
    @get:Rule val compose = createComposeRule()

    /** A 3-button navigation bar is 48dp; the gesture bar is shorter. */
    private val navBar: Dp = 48.dp

    private fun bottomOf(tag: String, revealed: Boolean): Pair<Float, Float> {
        var view: View? = null
        compose.setContent {
            view = LocalView.current
            LabTheme {
                // The pass is an immersive route: the shell shows no tab bar.
                ShellFrame(NavRules.tabsFor(NavRole()), active = null, showBar = false, onSelect = {}) {
                    HomeworkPassScreen(HomeworkScreenshots.deckPass(revealed), PassActions())
                }
            }
        }
        compose.waitForIdle()
        val px = (navBar.value * view!!.resources.displayMetrics.density).toInt()
        compose.runOnIdle {
            val insets = WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, px))
                .setVisible(WindowInsetsCompat.Type.navigationBars(), true)
                .build()
            ViewCompat.dispatchApplyWindowInsets(view!!, insets)
        }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        val root = compose.onRoot().getBoundsInRoot()
        val button = compose.onNodeWithTag(tag).getBoundsInRoot()
        return (root.bottom - button.bottom).value to root.bottom.value
    }

    /**
     * The shared fix must not pad twice where the tab bar shows: it pads the navigation bar
     * itself, so a LabScreenFrame screen above it ends right on the tab bar's top edge.
     */
    @Test fun frameAboveTheTabBarIsNotPaddedTwice() {
        var view: View? = null
        compose.setContent {
            view = LocalView.current
            LabTheme {
                ShellFrame(NavRules.tabsFor(NavRole()), active = null, showBar = true, onSelect = {}) {
                    LabScreenFrame { Box(Modifier.fillMaxSize().testTag("body")) }
                }
            }
        }
        compose.waitForIdle()
        val px = (navBar.value * view!!.resources.displayMetrics.density).toInt()
        compose.runOnIdle {
            ViewCompat.dispatchApplyWindowInsets(
                view!!,
                WindowInsetsCompat.Builder()
                    .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, px))
                    .setVisible(WindowInsetsCompat.Type.navigationBars(), true)
                    .build(),
            )
        }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        val root = compose.onRoot().getBoundsInRoot()
        val body = compose.onNodeWithTag("body").getBoundsInRoot()
        // Tab bar = 68dp + the navigation bar under it; nothing between the body and the bar.
        val gap = (root.bottom - body.bottom).value
        assertTrue("body ends ${gap}dp above the bottom; expected the tab bar (68dp) + nav bar ($navBar) only", kotlin.math.abs(gap - (68f + navBar.value)) < 1f)
    }

    @Test fun showAnswerSitsAboveTheNavigationBar() {
        val (gap, _) = bottomOf("hw-show", revealed = false)
        assertTrue("Show answer is ${gap}dp above the screen's bottom edge; needs ≥ nav bar ($navBar) + 16dp", gap >= navBar.value + 16f)
    }

    @Test fun gotItSitsAboveTheNavigationBar() {
        val (gap, _) = bottomOf("hw-gotit", revealed = true)
        assertTrue("Got it is ${gap}dp above the screen's bottom edge; needs ≥ nav bar ($navBar) + 16dp", gap >= navBar.value + 16f)
    }

    @Test fun notYetSitsAboveTheNavigationBar() {
        val (gap, _) = bottomOf("hw-notyet", revealed = true)
        assertTrue("Not yet is ${gap}dp above the screen's bottom edge", gap >= navBar.value + 16f)
    }

    /** …but not floating halfway up the screen: within thumb reach of the bottom (≤ 40dp above the bar). */
    @Test fun showAnswerStaysInThumbReach() {
        val (gap, _) = bottomOf("hw-show", revealed = false)
        assertTrue("Show answer is ${gap}dp above the bottom edge — too high", gap <= navBar.value + 40f)
    }

    @Config(qualifiers = LabScreenshotTest.UNFOLDED)
    @Test fun unfoldedShowAnswerSitsAboveTheNavigationBar() {
        val (gap, _) = bottomOf("hw-show", revealed = false)
        assertTrue("Show answer is ${gap}dp above the bottom edge (unfolded)", gap >= navBar.value + 16f && gap <= navBar.value + 40f)
    }
}
