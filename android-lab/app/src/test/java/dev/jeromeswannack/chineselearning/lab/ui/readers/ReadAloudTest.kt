package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
import androidx.compose.ui.unit.dp
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
 * 🎤 Read it aloud on a reader page: 🎤 beside the speed chip → listening (the Chinese shows, the live
 * transcript under the audio) → stop → the page's OWN Chinese marked in place (no second copy), one
 * line "✕ 42% — 4 to check", the transcript behind "You said ▸", 🎤 = Say it again; a long press on a
 * marked word says it; failed / empty / offline states. Plus the screenshots.
 */
class ReadAloudTest : LabScreenshotTest() {
    private val text = "早上好。我叫小徐。"
    private val words = listOf(
        ReaderWordDto("早上", "zǎoshang", "morning"), ReaderWordDto("好", "hǎo", "good"), ReaderWordDto("。", "", ""),
        ReaderWordDto("我", "wǒ", "I"), ReaderWordDto("叫", "jiào", "am called"), ReaderWordDto("小徐", "Xiǎo Xú", "Xiao Xu"), ReaderWordDto("。", "", ""),
    )
    private val page = ReaderPageDto("p1", 1, text, "Zǎoshang hǎo. Wǒ jiào Xiǎo Xú.", "Good morning. My name is Xiao Xu.", words = words)

    private val story = ReaderPageDto(
        "p2", 2, "小明今天第一次去巴黎。他很兴奋。", "Xiǎomíng jīntiān dì yī cì qù Bālí. Tā hěn xīngfèn.",
        "Today Xiaoming is going to Paris for the first time. He is very excited.",
        words = listOf(
            ReaderWordDto("小明", "Xiǎomíng", "Xiaoming"), ReaderWordDto("今天", "jīntiān", "today"), ReaderWordDto("第一次", "dì yī cì", "the first time"),
            ReaderWordDto("去", "qù", "go"), ReaderWordDto("巴黎", "Bālí", "Paris"), ReaderWordDto("。", "", ""),
            ReaderWordDto("他", "tā", "he"), ReaderWordDto("很", "hěn", "very"), ReaderWordDto("兴奋", "xīngfèn", "excited"), ReaderWordDto("。", "", ""),
        ),
    )
    private val clip: File by lazy { File.createTempFile("clip", ".mp3") }
    private val env = ReaderEnv(
        pageAudio = { _, _ -> clip },
        analyze = { _, _ -> sampleClipAnalysis(5200, listOf(AudioBlocks.Block(0, 2600), AudioBlocks.Block(2600, 5200)), List(96) { i -> if (i % 48 in 4..40) (0.35 + 0.6 * Math.abs(Math.sin(i * 1.3))).toFloat() else 0.03f }) },
    )

    @Composable
    private fun Page(p: ReaderPageDto, handle: ReadAloudHandle, e: ReaderEnv = env) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp)) {
            ReaderPageView(p, e, readAloudPreview = handle)
        }
    }

    @Test
    fun recordThenThePageIsMarkedInPlace() {
        val spoken = mutableListOf<String>()
        compose.mainClock.autoAdvance = false
        compose.setContent {
            LabTheme {
                var ui by remember { mutableStateOf(ReadAloudUi()) }
                val handle = ReadAloudHandle(ui, ReadAloudActions(onMic = {
                    ui = if (ui.phase == "listening") {
                        // He skipped 早上好 and said 许 (xǔ) for 徐 (xú).
                        ReadAloudUi(result = ReadAloud.judge(text, "我叫小许。"), said = "我叫小许。")
                    } else ReadAloudUi(phase = "listening", finalText = "我叫")
                }))
                Page(page, handle, ReaderEnv(speak = { spoken += it }))
            }
        }
        compose.mainClock.advanceTimeBy(1_500)
        compose.onNodeWithText("Tap to reveal Chinese").assertIsDisplayed()
        compose.onNodeWithTag(ReadAloudTags.MIC).assertContentDescriptionEquals(ReadAloud.LABEL).performClick()
        compose.mainClock.advanceTimeBy(1_500)
        // Listening: the Chinese shows (he reads it) and the live words under the audio.
        compose.onNodeWithTag("reader-words").assertIsDisplayed()
        compose.onNodeWithTag(ReadAloudTags.LIVE).assertIsDisplayed()
        compose.onNodeWithText("我叫").assertIsDisplayed()
        compose.onNodeWithTag(ReadAloudTags.MIC).assertContentDescriptionEquals(ReadAloud.STOP).performClick()
        compose.mainClock.advanceTimeBy(1_500)
        // The page's own chips carry the marks.
        compose.onNodeWithContentDescription("小, 徐 — tone off (heard 许)").assertIsDisplayed()
        compose.onNodeWithContentDescription("早 — missed, 上 — missed").assertIsDisplayed()
        compose.onNodeWithTag(ReadAloudTags.LINE).assertTextEquals("✕ 42% — 4 to check")
        // A long press on a word that needs a look says it.
        compose.onNodeWithContentDescription("小, 徐 — tone off (heard 许)").performTouchInput { longClick() }
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf("小徐"), spoken)
        compose.onNodeWithTag(ReadAloudTags.MIC).assertContentDescriptionEquals(ReadAloud.AGAIN)
        // The transcript, small, only when asked.
        assertEquals(0, compose.onAllNodesWithTagCount(ReadAloudTags.SAID))
        compose.onNodeWithTag(ReadAloudTags.SAID_TOGGLE).performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithTag(ReadAloudTags.SAID).assertTextEquals("我叫小许。")
        // The answer stays hidden: pinyin / translation reveals are untouched.
        compose.onNodeWithText("Tap to reveal pinyin").assertIsDisplayed()
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTagCount(tag: String) =
        onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size

    @Test
    fun failedEmptyAndOffline() {
        var ui by mutableStateOf(ReadAloudUi(phase = "failed", failure = "failed"))
        compose.setContent { LabTheme { ReadAloudPanel(ui, ReadAloudActions()) } }
        compose.onNodeWithTag(ReadAloudTags.RETRY).assertIsDisplayed()
        ui = ReadAloudUi(phase = "failed", failure = "empty")
        compose.onNodeWithTag(ReadAloudTags.EMPTY).assertTextEquals(ReadAloud.EMPTY)
        ui = ReadAloudUi(blocked = "offline", offlineNote = true)
        compose.onNodeWithTag(ReadAloudTags.OFFLINE).assertTextEquals(ReadAloud.OFFLINE)
    }

    private fun handle(ui: ReadAloudUi) = ReadAloudHandle(ui, ReadAloudActions())

    /** A two-sentence page read with a homophone (他 → 她), a tone slip (兴 xìng), a missed 很 and an extra 了. */
    private val storyResult = ReadAloud.judge(story.contentChinese, "小明今天第一次去巴黎了她行奋")

    @Test fun marked() = shoot("readers-40-read-aloud-marked", settleMs = 2_500) { Page(story, handle(ReadAloudUi(result = storyResult, said = "小明今天第一次去巴黎了她行奋"))) }

    @Test fun listening() = shoot("readers-41-read-aloud-listening", settleMs = 2_500) {
        Page(story, handle(ReadAloudUi(phase = "listening", finalText = "小明今天第一次", partialText = "去巴黎")))
    }

    @Test fun allRight() = shoot("readers-42-read-aloud-all-right", settleMs = 2_500) {
        Page(page, handle(ReadAloudUi(result = ReadAloud.judge(text, "早上好，我叫小徐。"), said = "早上好，我叫小徐。")))
    }

    @Test fun failed() = shoot("readers-43-read-aloud-failed", settleMs = 2_500) { Page(page, handle(ReadAloudUi(phase = "failed", failure = "failed"))) }
}
