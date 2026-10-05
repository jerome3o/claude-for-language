package dev.jeromeswannack.chineselearning.lab.ui.kit

import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetActions
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetSamples
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharacterSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertTrue
import org.junit.Test
import org.robolectric.shadows.ShadowDialog

/**
 * Every Lab bottom sheet stays BELOW the status bar / display cutout, however tall its content
 * (Jerome, Pixel Fold folded: the character sheet's 轨 tile and × slid up under the clock and the
 * battery). Material3's ModalBottomSheet only pads the bottom inset and lets a tall sheet grow to
 * the window's top edge, so the shared sheet frame (LabModalSheet: LabBottomSheet, LabFormSheet,
 * LabSheetFrame) caps the sheet at the window minus the top inset.
 *
 * The sheet's dialog window gets a real status-bar inset dispatched (Robolectric reports none);
 * the stand-in phone behind draws a status bar of that height so the shot shows where it is.
 */
class SheetInsetsTest : LabScreenshotTest() {
    private val activity get() = (compose as androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>).activity

    /** Pixel 10 Pro Fold, cover screen: the status bar with the camera cutout. */
    private val statusBarDp = 52
    private val navBarDp = 24

    /** The card back behind the sheet, with a stand-in status bar (clock, icons, battery). */
    @Composable
    private fun Phone(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Row(
                Modifier.fillMaxWidth().height(statusBarDp.dp).background(Lab.colors.card).padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("12:34", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                Text("●", fontSize = 18.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                Text("▾ ◢  87% ▮", fontSize = 15.sp, color = Lab.colors.ink)
            }
            Column(Modifier.fillMaxWidth().padding(top = (statusBarDp + 40).dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("轨道", fontSize = 56.sp, color = Lab.colors.ink)
                Text("guǐdào", color = Lab.colors.accent, fontSize = 22.sp)
                Text("track; orbit", color = Lab.colors.ink, fontSize = 18.sp)
            }
            content()
        }
    }

    /** Gives every window's Compose root (the sheet's dialog too) the status-bar + navigation-bar insets. */
    private fun dispatchInsets() {
        val density = activity.resources.displayMetrics.density
        val insets = WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, (statusBarDp * density).toInt(), 0, 0))
            .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, (navBarDp * density).toInt()))
            .setVisible(WindowInsetsCompat.Type.statusBars(), true)
            .setVisible(WindowInsetsCompat.Type.navigationBars(), true)
            .build()
        compose.runOnIdle {
            val roots = buildList {
                add(activity.window.decorView)
                ShadowDialog.getShownDialogs().forEach { d -> d.window?.decorView?.let(::add) }
            }
            for (root in roots) composeViews(root).forEach { ViewCompat.dispatchApplyWindowInsets(it, insets) }
        }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
    }

    private fun composeViews(v: View): List<View> = when {
        v is ComposeView || v.javaClass.name.endsWith("AndroidComposeView") -> listOf(v)
        v is ViewGroup -> (0 until v.childCount).flatMap { composeViews(v.getChildAt(it)) }
        else -> emptyList()
    }

    @OptIn(ExperimentalRoborazziApi::class)
    private fun open(name: String, dark: Boolean = false, sheet: @Composable () -> Unit) {
        compose.setContent { LabTheme(dark = dark) { Phone(sheet) } }
        compose.mainClock.advanceTimeBy(2_000)
        dispatchInsets()
        captureScreenRoboImage("screenshots/$name.png")
    }

    /** [tag] = the sheet's first line, right under its 48dp drag handle: the sheet's top must be below the status bar. */
    private fun assertBelowStatusBar(tag: String) {
        val top = compose.onNodeWithTag(tag, useUnmergedTree = true).getBoundsInRoot().top.value
        val min = statusBarDp + DRAG_HANDLE_DP
        assertTrue("$tag starts ${top}dp from the window top: the sheet's top is under the ${statusBarDp}dp status bar (needs ≥ ${min}dp)", top >= min)
    }

    @Composable
    private fun charSheet() = CharacterSheet(
        char = "行",
        cardHanzi = "银行",
        actions = CharSheetActions(
            lookup = { CharDict.Lookup.Ok(CharSheetSamples.xing) },
            statuses = { _, _ -> CharSheetSamples.loaded().rows.orEmpty() },
        ),
        addActions = SentenceActions(),
        onClose = {},
        onWrite = {},
        bump = null,
    )

    /** The bug: a tall character sheet (two readings, ten words) — its glyph tile and × stay below the status bar. */
    @Test fun characterSheetStaysBelowTheStatusBar() {
        open("sheet-insets-01-char-sheet") { charSheet() }
        assertBelowStatusBar("char-sheet-close")
    }

    @Test fun characterSheetDark() {
        open("sheet-insets-02-char-sheet-dark", dark = true) { charSheet() }
        assertBelowStatusBar("char-sheet-close")
    }

    /** Any LabBottomSheet with more content than the screen: the title stays below the status bar, the rest scrolls. */
    @Test fun tallMenuSheetStaysBelowTheStatusBar() {
        open("sheet-insets-03-tall-menu") {
            LabBottomSheet(onDismiss = {}) {
                SheetTitle("Move to deck", Modifier.testTag("tall-top"))
                repeat(40) { i -> NavRow("📚", "HSK ${i / 6 + 1} · Lesson ${i + 1}", onClick = {}) }
            }
        }
        assertBelowStatusBar("tall-top")
    }

    /** A form sheet (LabFormSheet): the title below the status bar, the footer pinned above the navigation bar. */
    @Test fun tallFormSheetStaysBelowTheStatusBar() {
        open("sheet-insets-04-tall-form") {
            LabFormSheet(
                onDismiss = {},
                header = { SheetTitle("Add to a deck", Modifier.testTag("form-top")) },
                footer = {
                    SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp), onClick = {})
                    PrimaryPill("Add card", Modifier.weight(1f).height(52.dp), onClick = {})
                },
            ) {
                repeat(30) { i -> Text("Deck ${i + 1} · 第${i + 1}课", color = Lab.colors.ink, modifier = Modifier.padding(vertical = 10.dp)) }
            }
        }
        assertBelowStatusBar("form-top")
        val footer = compose.onNodeWithTag(STICKY_FOOTER_TAG, useUnmergedTree = true).getBoundsInRoot()
        val window = activity.resources.displayMetrics.let { it.heightPixels / it.density }
        assertTrue("footer ends at ${footer.bottom.value}dp, window is ${window}dp", footer.bottom.value <= window + 1f)
    }
}

/** Material3's BottomSheetDefaults.DragHandle: 22 + 4 + 22dp. */
private const val DRAG_HANDLE_DP = 48

