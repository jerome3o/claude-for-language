package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.chat.ListeningUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals

/**
 * Ask Claude 🎧 Listen first (docs/STUDY_SESSION.md "Ask Claude"; web AskClaudeSheet + e2e
 * ask-claude-listening.spec.ts): the header's 🎧, Claude's Chinese answer as the chat's hidden
 * bubble (tap → listen, long press / 👁 → reveal), a new answer playing once by itself, English
 * answers and my own question never hidden, the offline line. Screenshots: `ask-listen-*`.
 */
class AskClaudeListeningTest : LabScreenshotTest() {
    private val note = Samples.note.copy(hanzi = "银行", pinyin = "yínháng", english = "bank", sentenceClue = "我去银行取钱。")
    private val view = CardView(
        QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, CardScheduler.initialCardState()), note, emptyList(),
        CardScheduler.intervalPreviews(CardScheduler.initialCardState(), Js.parseDate("2026-10-08T09:30:00.000Z")), emptyList(), 1, "HSK 2", true,
    )
    private val question = "银行是什么意思？"
    private val answer = "银行就是放钱的地方。我们常说：我去银行取钱。"
    private val zh = AskAnswer(id = "q1", question = question, answer = answer, answer_lang = "zh")
    private val en = AskAnswer(id = "q2", question = "In English please?", answer = "A **bank** (银行) is where money is kept.", answer_lang = "en")

    @Composable
    private fun sheet(ask: AskUi, listening: Boolean = true, listen: ListeningUi = ListeningUi(), notice: AskListenNotice? = null, actions: AskActions = AskActions()) {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(top = 16.dp)) {
            AskClaudeBody(view, ask, "zh", null, true, actions, listening = listening, listen = listen, listenNotice = notice)
        }
    }

    @Test fun hiddenLight() = shoot("ask-listen-01-hidden") { sheet(AskUi(conversation = listOf(zh)), listen = ListeningUi(durations = mapOf("q1" to 7.4))) }

    @Test fun hiddenPlayingDark() = shoot("ask-listen-02-playing-dark", dark = true) {
        sheet(AskUi(conversation = listOf(zh)), listen = ListeningUi(playing = "q1", playNonce = 1, slow = true, durations = mapOf("q1" to 7.4)))
    }

    @Test fun offlineNotice() = shoot("ask-listen-03-offline") {
        sheet(AskUi(conversation = listOf(zh)), notice = AskListenNotice("q1", "🎧 Listening needs a connection the first time — hold to read it instead."))
    }

    @Test fun startWithListenFirst() = shoot("ask-listen-04-start") { sheet(AskUi()) }

    @Test fun settingsSection() = shoot("ask-listen-05-settings") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) { AskClaudeLanguageSection("zh", null, onChange = {}, listening = true) }
    }

    @Test fun toggleInTheHeader() {
        val set = mutableListOf<Boolean>()
        compose.setContent { LabTheme { sheet(AskUi(), listening = false, actions = AskActions(setListening = { set += it })) } }
        compose.onNodeWithTag(AskTags.LISTEN).performClick()
        assertEquals(listOf(true), set)
    }

    @Test fun hiddenAnswerTapListensLongPressReveals() {
        val listened = mutableListOf<Pair<String, Boolean>>()
        val revealed = mutableListOf<String>()
        compose.setContent {
            LabTheme { sheet(AskUi(conversation = listOf(zh)), actions = AskActions(listen = { id, auto -> listened += id to auto }, reveal = { revealed += it })) }
        }
        // My question shows; the answer is hidden.
        compose.onNodeWithTag(AskTags.MINE).assertIsDisplayed()
        compose.onNodeWithTag(AskTags.HIDDEN).assertIsDisplayed()
        compose.onNodeWithTag(AskTags.REPLY).assertDoesNotExist()
        compose.onNodeWithText("Tap to listen · hold to reveal", useUnmergedTree = true).assertExists()
        // On screen when the sheet opened: no auto-play.
        assertEquals(emptyList(), listened)
        compose.onNodeWithTag(AskTags.HIDDEN).performClick()
        assertEquals(listOf("q1" to false), listened)
        compose.onNodeWithTag(AskTags.HIDDEN).performTouchInput { longClick() }
        assertEquals(listOf("q1"), revealed)
        compose.onNodeWithTag("chat-listening-reveal").performClick()
        assertEquals(listOf("q1", "q1"), revealed)
    }

    @Test fun revealedAndEnglishAnswersShowAsText() {
        compose.setContent { LabTheme { sheet(AskUi(conversation = listOf(zh, en)), listen = ListeningUi(revealed = setOf("q1"))) } }
        compose.onNodeWithTag(AskTags.HIDDEN).assertDoesNotExist()
    }

    @Test fun aNewAnswerPlaysOnceByItself() {
        val listened = mutableListOf<Pair<String, Boolean>>()
        val ask = mutableStateOf(AskUi())
        compose.setContent { LabTheme { sheet(ask.value, actions = AskActions(listen = { id, auto -> listened += id to auto })) } }
        compose.waitForIdle()
        ask.value = AskUi(conversation = listOf(zh))
        compose.waitForIdle()
        assertEquals(listOf("q1" to true), listened)
        // An English answer arriving next: nothing plays.
        ask.value = AskUi(conversation = listOf(zh, en))
        compose.waitForIdle()
        assertEquals(listOf("q1" to true), listened)
    }

    @Test fun noAutoPlayWhileAudioIsGoing() {
        val listened = mutableListOf<Pair<String, Boolean>>()
        val ask = mutableStateOf(AskUi())
        compose.setContent { LabTheme { sheet(ask.value, actions = AskActions(listen = { id, auto -> listened += id to auto }, audioBusy = { true })) } }
        compose.waitForIdle()
        ask.value = AskUi(conversation = listOf(zh))
        compose.waitForIdle()
        assertEquals(emptyList(), listened)
    }

    @Test fun offlineLineUnderTheBubble() {
        compose.setContent { LabTheme { sheet(AskUi(conversation = listOf(zh)), notice = AskListenNotice("q1", "🎧 Listening needs a connection the first time — hold to read it instead.")) } }
        compose.onNodeWithTag(AskTags.HIDDEN_NOTICE).assertIsDisplayed()
    }
}
