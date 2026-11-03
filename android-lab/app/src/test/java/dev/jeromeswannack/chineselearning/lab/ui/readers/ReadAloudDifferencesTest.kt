package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
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
 * word, a tap on the marked word lights its row instead of opening the explorer; "You said" marked.
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
            ReaderPageView(page, e, readAloudPreview = ReadAloudHandle(ReadAloudUi(result = result, said = said), ReadAloudActions()))
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
        // A tap on the marked word lights its row — it doesn't open the explorer; an unmarked word still does.
        compose.onNodeWithContentDescription("成 — sounded right (heard 程), 都 — tone off (heard 度)").performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(emptyList(), opened)
        compose.onNodeWithContentDescription("小吃").performClick()
        assertEquals(listOf("小吃"), opened)
    }

    private fun shootJerome(name: String, dark: Boolean, openSaid: Boolean) {
        compose.mainClock.autoAdvance = false
        compose.setContent { LabTheme(dark = dark) { Page(env) } }
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
