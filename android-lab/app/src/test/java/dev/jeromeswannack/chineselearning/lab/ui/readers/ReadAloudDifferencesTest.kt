package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorerController
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AudioBlocks
import dev.jeromeswannack.chineselearning.lab.core.ReadAloud
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals

/**
 * What it heard vs the page (Jerome's take: 成都 heard as 程度): one row per word with both in pinyin,
 * the reason per character in words ("都 dū → you said dù (4th tone instead of 1st)"), ▶ the page's
 * word; a tap on the marked word opens the explorer like any word, and so do the row's page word and
 * what was heard; "You said" marked. A take stopped early lists nothing for the part never reached.
 */
class ReadAloudDifferencesTest : LabScreenshotTest() {
    private val text = "胆子大的话，可以试试麻辣兔头，这是很多成都人最爱的小吃。"
    private val said = "胆子大的话，可以试试麻辣兔头，这是很多程度人最爱的小吃。"
    private fun w(t: String, py: String = "", gloss: String = "") = ReaderWordDto(t, py, gloss)
    private val page = ReaderPageDto(
        "p1", 1, text,
        "Dǎnzi dà dehuà, kěyǐ shìshi málà tùtóu, zhè shì hěn duō Chéngdū rén zuì ài de xiǎochī.",
        "If you're brave, try the spicy rabbit head — many Chengdu people's favourite snack.",
        words = listOf(
            w("胆子", "dǎnzi", "courage"), w("大", "dà", "big"), w("的话", "dehuà", "if"), w("，"), w("可以", "kěyǐ", "can"), w("试试", "shìshi", "try"),
            w("麻辣", "málà", "numbing-spicy"), w("兔头", "tùtóu", "rabbit head"), w("，"), w("这", "zhè", "this"), w("是", "shì", "is"),
            w("很多", "hěn duō", "many"), w("成都", "Chéngdū", "Chengdu"), w("人", "rén", "people"), w("最", "zuì", "most"), w("爱", "ài", "love"),
            w("的", "de", ""), w("小吃", "xiǎochī", "snack"), w("。"),
        ),
    )
    private val result = ReadAloud.judge(text, said)
    private val clip: File by lazy { File.createTempFile("clip", ".mp3") }

    @Composable
    private fun Page(e: ReaderEnv) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp)) {
            ReaderPageView(page, e, readAloudPreview = ReadAloudHandle(ReadAloudUi(result = result, said = said), ReadAloudActions()), initialShowChinese = true)
        }
    }

    private val env = ReaderEnv(
        pageAudio = { _, _ -> clip },
        analyze = { _, _ -> sampleClipAnalysis(5200, listOf(AudioBlocks.Block(0, 2600), AudioBlocks.Block(2600, 5200)), List(96) { i -> if (i % 48 in 4..40) (0.35 + 0.6 * Math.abs(Math.sin(i * 1.3))).toFloat() else 0.03f }) },
    )

    @Test
    fun jeromesTake() {
        val spoken = mutableListOf<String>()
        val opened = mutableListOf<String>()
        compose.setContent { LabTheme { Page(ReaderEnv(speak = { spoken += it }, onWord = { word, _ -> opened += word.text })) } }
        compose.onNodeWithTag(ReadAloudTags.LINE).assertIsDisplayed()
        assertEquals(1, compose.onAllNodes(hasTestTag(ReadAloudTags.DIFF)).fetchSemanticsNodes().size)
        compose.onNodeWithText("都 dū → you said dù (4th tone instead of 1st)").assertIsDisplayed()
        compose.onNodeWithText("成 chéng — sounded right (written 程)").assertIsDisplayed()
        compose.onNodeWithText("chéngdū").assertIsDisplayed()
        compose.onNodeWithText("chéngdù").assertIsDisplayed()
        compose.onNodeWithText("Tone").assertIsDisplayed()
        // ▶ plays the page's word.
        compose.onNodeWithTag(ReadAloudTags.DIFF_PLAY).performClick()
        assertEquals(listOf("成都"), spoken)
        // A tap on the marked word opens it in the explorer, like any word.
        compose.onNodeWithContentDescription("成 — sounded right (heard 程), 都 — tone off (heard 度)").performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(listOf("成都"), opened)
        compose.onNodeWithContentDescription("小吃").performClick()
        assertEquals(listOf("成都", "小吃"), opened)
    }

    @Test
    fun rowWordsOpenTheExplorer() {
        val events = mutableListOf<Pair<String, Map<String, Any?>>>()
        val explorer = ExplorerController(track = { e, p -> events += e to p })
        compose.setContent {
            LabTheme { CompositionLocalProvider(LocalExplorer provides explorer) { Page(env) } }
        }
        // The page's word (what he meant to say), with its sentence.
        compose.onNodeWithTag(ReadAloudTags.DIFF_PAGE).performClick()
        assertEquals(ExplorerItem.Word("成都", "chéngdū", null, text), explorer.current)
        assertEquals("explorer.open" to mapOf("source" to "read_aloud", "kind" to "word"), events.last())
        // What was heard.
        compose.onNodeWithTag(ReadAloudTags.DIFF_HEARD).performClick()
        assertEquals("程度", (explorer.current as ExplorerItem.Word).hanzi)
    }

    @Test
    fun stoppedEarly() {
        val stopText = "最有名的是李子坝站：轻轨直接从一栋住宅楼的中间穿过去！"
        val r = ReadAloud.judge(stopText, "最有名的是李子吧站轻轨直接从一栋")
        compose.setContent {
            LabTheme { ReadAloudPanel(ReadAloudUi(result = r, said = "最有名的是李子吧站轻轨直接从一栋"), ReadAloudActions()) }
        }
        compose.onNodeWithText("✓ 93% — 1 to check · stopped early").assertIsDisplayed()
        // Only the slip he made is listed — nothing for the part he never reached.
        assertEquals(1, compose.onAllNodes(hasTestTag(ReadAloudTags.DIFF)).fetchSemanticsNodes().size)
        compose.onNodeWithText("Tone").assertIsDisplayed()
        compose.onNodeWithText("Missed").assertDoesNotExist()
        compose.onNodeWithText("missed", substring = true).assertDoesNotExist()
    }

    @Test
    fun stoppedEarlyDark() {
        val stopText = "最有名的是李子坝站：轻轨直接从一栋住宅楼的中间穿过去！"
        val heard = "最有名的是李子吧站轻轨直接从一栋"
        val stopPage = ReaderPageDto(
            "p2", 1, stopText,
            "Zuì yǒumíng de shì Lǐzǐbà zhàn: qīngguǐ zhíjiē cóng yí dòng zhùzháilóu de zhōngjiān chuān guòqù!",
            "The most famous is Liziba station: the light rail goes straight through the middle of a block of flats!",
            words = listOf(
                w("最", "zuì"), w("有名", "yǒumíng"), w("的", "de"), w("是", "shì"), w("李子坝站", "Lǐzǐbà zhàn"), w("："),
                w("轻轨", "qīngguǐ"), w("直接", "zhíjiē"), w("从", "cóng"), w("一", "yí"), w("栋", "dòng"), w("住宅楼", "zhùzháilóu"),
                w("的", "de"), w("中间", "zhōngjiān"), w("穿", "chuān"), w("过去", "guòqù"), w("！"),
            ),
        )
        val r = ReadAloud.judge(stopText, heard)
        compose.mainClock.autoAdvance = false
        compose.setContent {
            LabTheme(dark = true) {
                CompositionLocalProvider(LocalExplorer provides ExplorerController()) {
                    Box(Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp)) {
                        ReaderPageView(stopPage, env, readAloudPreview = ReadAloudHandle(ReadAloudUi(result = r, said = heard), ReadAloudActions()), initialShowChinese = true)
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(2_500)
        compose.onRoot().captureRoboImage("screenshots/readers-49-read-aloud-stopped-early-dark.png")
    }

    private fun shootJerome(name: String, dark: Boolean, openSaid: Boolean) {
        compose.mainClock.autoAdvance = false
        compose.setContent { LabTheme(dark = dark) { CompositionLocalProvider(LocalExplorer provides ExplorerController()) { Page(env) } } }
        compose.mainClock.advanceTimeBy(2_500)
        if (openSaid) {
            compose.onNodeWithTag(ReadAloudTags.SAID_TOGGLE).performClick()
            compose.mainClock.advanceTimeBy(800)
        }
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun differencesDark() = shootJerome("readers-48-read-aloud-differences-dark", dark = true, openSaid = true)

    @Test fun differencesLight() = shootJerome("readers-48-read-aloud-differences", dark = false, openSaid = true)
}
