package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardField
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The board's tab-complete must survive what goes on around it (23 Oct 2026: it worked now and then
 * for Jerome and not at all for Minghui) — web: TextBoard.glossReliability.test.tsx.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class TextBoardGlossReliabilityTest {
    @get:Rule val compose = createComposeRule()

    private var board by mutableStateOf(TextBoardUi())

    private fun mount(gloss: suspend (String) -> BoardGlossFetcher.Result, local: (suspend (String) -> BoardGloss?)? = null, reports: MutableList<GlossLookupReport> = mutableListOf()) {
        board = TextBoardUi()
        compose.setContent {
            LabTheme {
                Column(Modifier.fillMaxSize()) {
                    TextBoardPanel(
                        board,
                        { t, s, e, _ -> board = board.copy(text = t, version = board.version + 1, lastChange = "local", mySelection = s to e) },
                        { _, _ -> }, {}, Modifier.fillMaxWidth().weight(1f),
                        gloss = gloss, localGloss = local, onGlossLookup = { reports += it },
                    )
                }
            }
        }
        val field = compose.onNode(hasSetTextAction())
        field.performClick()
    }

    private fun type(text: String) = compose.onNode(hasSetTextAction()).performTextInput(text)

    /** The other person's edit arriving: the field is rewritten with my caret at the end of [text]. */
    private fun remote(text: String) = compose.runOnIdle {
        board = board.copy(text = text, version = board.version + 1, rewrite = board.rewrite + 1, field = BoardField(text, text.length, text.length), lastChange = "remote")
    }

    private fun advance(ms: Long) {
        compose.mainClock.advanceTimeBy(ms)
        compose.waitForIdle()
    }

    private fun shown(s: String) = compose.onAllNodesWithText(s, substring = true).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun theOtherPersonTypingAboveMyLineNeverDropsMyAnswer() {
        val answer = CompletableDeferred<BoardGlossFetcher.Result>()
        var calls = 0
        val reports = mutableListOf<GlossLookupReport>()
        mount({ calls++; answer.await() }, reports = reports)
        type("你好")
        advance(700)
        assertEquals(1, calls)
        for (t in listOf("老", "老师", "老师好")) {
            remote("$t\n你好")
            advance(200)
        }
        answer.complete(BoardGlossFetcher.Result(BoardGloss("nǐ hǎo", "hello"), "server"))
        advance(50)
        assertTrue("the offer shows after Minghui's edits", shown("nǐ hǎo - hello"))
        assertEquals(1, calls)
        assertEquals("server", reports.single().outcome)
        assertEquals("server", reports.single().shown)
    }

    @Test
    fun theDeviceGlossShowsAtOnceThenTheServersReplacesIt() {
        val answer = CompletableDeferred<BoardGlossFetcher.Result>()
        mount({ answer.await() }, local = { BoardGloss("yínháng", "bank", local = true) })
        type("银行")
        advance(700)
        assertTrue(shown("yínháng - bank"))
        answer.complete(BoardGlossFetcher.Result(BoardGloss("yínháng", "a bank"), "server"))
        advance(50)
        assertTrue(shown("yínháng - a bank"))
    }

    @Test
    fun aFailedLookupStillGivesTheDevicePinyin() {
        val reports = mutableListOf<GlossLookupReport>()
        mount({ BoardGlossFetcher.Result(null, "unavailable", 503) }, local = { BoardGloss("wǒ xiǎng qù", "", local = true) }, reports)
        type("我想去")
        advance(700)
        assertTrue(shown("wǒ xiǎng qù"))
        assertEquals("local", reports.single().shown)
        assertEquals(503, reports.single().status)
    }
}
