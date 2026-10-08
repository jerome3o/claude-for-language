package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChineseWords
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertTrue

/**
 * Word chips made on the phone (data/text/DeviceWords → core chinese/Segmenter): Ask Claude's
 * Chinese reply arrives with no `answer_words` and is still WORD chips at once (工资, 卡片, 要不要
 * — never one chip per character); with pinyin on, each word carries its own pinyin.
 * Screenshots: `device-words-*`.
 */
class DeviceWordsScreenshots : LabScreenshotTest() {
    private val note = Samples.note.copy(hanzi = "工资", pinyin = "gōngzī", english = "salary")
    private val view = CardView(
        QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, CardScheduler.initialCardState()), note, emptyList(),
        CardScheduler.intervalPreviews(CardScheduler.initialCardState(), Js.parseDate("2026-10-08T09:30:00.000Z")), emptyList(), 1, "HSK 3", true,
    )
    private val answer = "好问题！\n「工资高」的相反是「工资低」。\n低 就是「不高」的意思，跟「高」相反。\n比如：这份工作的工资低，我不想做。\n你要不要我帮你加一张「工资低」的卡片？"
    private val entry = AskAnswer(id = "q1", question = "这个词的相反是什么", answer = answer, answer_lang = "zh")

    @Before fun deviceWords() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun reset() = DeviceWords.setForTests(null)

    @Test fun askClaudeReplyIsWordChipsAtOnce() {
        compose.setContent { LabTheme { AskClaudeBody(view, AskUi(conversation = listOf(entry)), "zh", null, true, AskActions()) } }
        compose.waitForIdle()
        assertTrue(compose.onAllNodesWithTag("chat-word-chip", useUnmergedTree = true).fetchSemanticsNodes().size >= 20)
        compose.onNodeWithText("要不要", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("卡片", useUnmergedTree = true).assertExists()
    }

    @Test fun conversation() = shoot("device-words-01-ask-claude") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(top = 16.dp)) {
            AskClaudeBody(view, AskUi(conversation = listOf(entry)), "zh", null, true, AskActions())
        }
    }

    @Test fun withPinyin() = shoot("device-words-02-pinyin") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(16.dp)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.faint).padding(horizontal = 14.dp, vertical = 9.dp)) {
                ChineseWords(answer, DeviceWords.of(answer), isMe = false, color = Lab.colors.ink, showPinyin = true, known = setOf("工资"), onChip = {})
            }
        }
    }
}
