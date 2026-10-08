package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckDto
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckMistakeDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.chat.MessageMenuContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.menuTag
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Ask Claude, immersion (docs/STUDY_SESSION.md "Ask Claude"; web components/askClaude): Claude's
 * Chinese reply as word chips, my flagged question with ✎ + "Open in Coach", the 中文 / EN toggle,
 * a long press → the chat's menu with the parts that fit. Screenshots: `ask-zh-*`.
 */
class AskClaudeImmersionTest : LabScreenshotTest() {
    // Word chips made on the phone (data/text/DeviceWords), as in the app.
    @org.junit.Before fun deviceWords() = dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords.setForTests(dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter.shipped)
    @org.junit.After fun resetDeviceWords() = dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords.setForTests(null)
    private val note = Samples.note.copy(hanzi = "银行", pinyin = "yínháng", english = "bank", sentenceClue = "我去银行取钱。")
    private val view = CardView(
        QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, CardScheduler.initialCardState()), note, emptyList(),
        CardScheduler.intervalPreviews(CardScheduler.initialCardState(), Js.parseDate("2026-10-08T09:30:00.000Z")), emptyList(), 1, "HSK 2", true,
    )

    private val question = "银行是什么意？"
    private val answer = "银行就是放钱的地方。\n我们常说：我去银行取钱。"
    private fun w(t: String, p: String = "", g: String = "") = ReaderWordDto(t, p, g)
    private val answerWords = listOf(
        w("银行", "yínháng", "bank"), w("就是", "jiùshì", "is exactly"), w("放", "fàng", "to put"), w("钱", "qián", "money"), w("的", "de"), w("地方", "dìfang", "place"),
        w("。"), w("\n"), w("我们", "wǒmen", "we"), w("常", "cháng", "often"), w("说", "shuō", "say"), w("："), w("我", "wǒ", "I"), w("去", "qù", "go"),
        w("银行", "yínháng", "bank"), w("取钱", "qǔ qián", "withdraw money"), w("。"),
    )
    private val check = AutoCheckDto(
        text = question, status = "improvable", corrected = "银行是什么意思？", corrected_pinyin = "yínháng shì shénme yìsi", corrected_english = "What does 银行 mean?",
        mistakes = listOf(AutoCheckMistakeDto("什么意", "什么意思", "The word is 意思.")), severity = "moderate", checked_at = "2026-10-08T10:00:00Z",
    )
    private val entry = AskAnswer(
        id = "q1", question = question, answer = answer, answer_lang = "zh", answer_words = answerWords,
        answer_translation = "A bank is a place where money is kept. We often say: I go to the bank to withdraw money.", question_check = check,
    )
    private val conversation = AskUi(conversation = listOf(entry))

    @Composable
    private fun sheet(ask: AskUi, language: String = "zh", actions: AskActions = AskActions()) {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(top = 16.dp)) {
            AskClaudeBody(view, ask, language, null, true, actions)
        }
    }

    @Test fun conversationLight() = shoot("ask-zh-01-conversation") { sheet(conversation) }

    @Test fun conversationDark() = shoot("ask-zh-02-conversation-dark", dark = true) { sheet(conversation) }

    @Test fun startInChinese() = shoot("ask-zh-03-start") { sheet(AskUi()) }

    @Test fun menuOnTheReply() = shoot("ask-zh-04-menu") {
        val menu = AskClaude.menu(AskClaude.MenuMessage(mine = false, text = answer, translation = entry.answer_translation))
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(top = 16.dp)) {
            MessageMenuContent(dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto(id = "q1:answer", sender_id = "claude", content = answer), menu, true, emptyList(), mine = false, onReact = {}, onAction = {})
        }
    }

    @Test fun replyIsWordChipsAndMyQuestionHasTheCheck() {
        var opened: String? = null
        compose.setContent { LabTheme { sheet(conversation, actions = AskActions(openPath = { opened = it })) } }
        compose.onNodeWithTag(AskTags.REPLY).assertIsDisplayed()
        assertTrue(compose.onAllNodesWithTag("chat-word-chip", useUnmergedTree = true).fetchSemanticsNodes().size >= 10)
        compose.onNodeWithTag(AskTags.MARK, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.chat.CHAT_COACH_CHIP_TAG).performClick()
        assertEquals(dev.jeromeswannack.chineselearning.lab.ui.coach.coachOpenPath(question, "check", null), opened)
    }

    @Test fun languageToggleAndQuickChips() {
        var language: String? = null
        val asked = mutableListOf<Pair<String, Boolean>>()
        compose.setContent { LabTheme { sheet(AskUi(), actions = AskActions(setLanguage = { language = it }, ask = { q, h, _ -> asked += q to h })) } }
        compose.onNodeWithTag(AskTags.HINT).assertIsDisplayed()
        compose.onNodeWithText("造句 Use in sentence").performClick()
        assertEquals(listOf("请用这个词造几个简单的句子。" to false), asked)
        compose.onNodeWithTag(AskTags.LANG_EN).performClick()
        assertEquals("en", language)
    }

    @Test fun longPressOpensTheChatMenuThenTranslate() {
        val translated = mutableListOf<Pair<String, String>>()
        compose.setContent { LabTheme { sheet(conversation, actions = AskActions(translate = { id, part -> translated += id to part; true })) } }
        compose.onNodeWithTag(AskTags.REPLY).performTouchInput { longClick() }
        compose.onNodeWithTag(menuTag("translate")).assertIsDisplayed()
        compose.onNodeWithTag(menuTag("play")).assertExists()
        compose.onNodeWithTag("chat-reaction-bar").assertDoesNotExist()
        compose.onNodeWithTag(menuTag("translate")).performClick()
        compose.waitForIdle()
        assertEquals(listOf("q1" to "answer"), translated)
        compose.onNodeWithTag("chat-translation", useUnmergedTree = true).assertExists()
    }
}
