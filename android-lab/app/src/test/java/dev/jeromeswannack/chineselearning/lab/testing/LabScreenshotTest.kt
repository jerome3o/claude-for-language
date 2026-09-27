package dev.jeromeswannack.chineselearning.lab.testing

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.ShellFrame
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabSpec
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Base class for Roborazzi screenshots. A feature's shots live in its own test file:
 *
 *   class ReadersScreenshots : LabScreenshotTest() {
 *       @Test fun list() = shoot("readers-01-list") { ReadersScreen(sampleUi, ReadersActions()) }
 *       @Test fun listInShell() = shootInShell("readers-02-tab", active = TabId.MORE) { ReadersScreen(sampleUi, ReadersActions()) }
 *       @Config(qualifiers = UNFOLDED) @Test fun wide() = shoot("readers-03-unfolded") { … }
 *   }
 *
 * `./gradlew :app:recordRoborazziDebug` writes app/screenshots/<name>.png — look at every one.
 * Name shots `<feature>-NN-<state>` so packages never collide. Phone = Pixel Fold folded
 * (412×915dp); [UNFOLDED] = the inner screen. Realistic data (real hanzi) lives in [Samples].
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = LabScreenshotTest.PHONE, application = android.app.Application::class)
abstract class LabScreenshotTest {
    @get:Rule val compose = createComposeRule()

    /** Renders [content] in the Lab theme, lets animations settle, saves `screenshots/<name>.png`. */
    fun shoot(name: String, dark: Boolean = false, settleMs: Long = 2_000, content: @Composable () -> Unit) {
        compose.setContent { LabTheme(dark = dark) { content() } }
        compose.mainClock.advanceTimeBy(settleMs)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    /** Same, with the tab bar under the screen (the student tab set unless [tabs] says otherwise). */
    fun shootInShell(
        name: String,
        active: dev.jeromeswannack.chineselearning.lab.ui.nav.TabId?,
        tabs: List<TabSpec> = NavRules.tabsFor(dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole()),
        dark: Boolean = false,
        content: @Composable () -> Unit,
    ) = shoot(name, dark) { ShellFrame(tabs, active, showBar = true, onSelect = {}) { content() } }

    companion object {
        const val PHONE = "w412dp-h915dp-xxhdpi"
        const val UNFOLDED = "w841dp-h701dp-xxhdpi"
    }
}
