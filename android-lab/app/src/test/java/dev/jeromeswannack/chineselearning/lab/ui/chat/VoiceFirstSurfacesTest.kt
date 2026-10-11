package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachHomeActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachHomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachHomeUi
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachSamples
import dev.jeromeswannack.chineselearning.lab.ui.coach.coachActionTag
import dev.jeromeswannack.chineselearning.lab.core.CoachAction
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.study.AskActions
import dev.jeromeswannack.chineselearning.lab.ui.study.AskClaudeBody
import dev.jeromeswannack.chineselearning.lab.ui.study.AskUi
import dev.jeromeswannack.chineselearning.lab.ui.study.CardView
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test

/**
 * Voice first where Jerome writes (docs/CHAT.md "Voice-first composer"; the web's DictationComposer, the
 * coach's sentence box, Ask Claude): the chat composer's four voice states, the coach's review running
 * the action buttons on what was said, Ask Claude's question box. Screenshots: `voice-first-*`.
 * (Tests have no microphone and no app, so the live boxes are typing; `voicePreview` draws each state.)
 */
class VoiceFirstSurfacesTest : LabScreenshotTest() {
    private val chat = ChatScreenshots.base.copy(draft = "")
    private val listening = VoiceDictationUi(phase = "listening", finalText = "我明天下午", partialText = "有空")
    private val review = VoiceDictationUi(phase = "review", finalText = "我明天下午有空，三点可以吗？")

    @Test fun chatIdle() {
        shoot("voice-first-01-chat-idle") { ChatScreen(chat.copy(voicePreview = VoiceDictationUi()), ChatActions()) }
        // 🎤 Say it dictates text; the waveform button beside it still records a voice message.
        compose.onNodeWithTag("chat-say").assertExists()
        compose.onNodeWithTag("chat-type").assertExists()
        compose.onNodeWithTag("chat-mic").assertExists()
    }

    @Test fun chatListening() {
        shoot("voice-first-02-chat-listening", settleMs = 600) { ChatScreen(chat.copy(voicePreview = listening), ChatActions()) }
        compose.onNodeWithTag("chat-dictate-live").assertExists()
        compose.onNodeWithTag("chat-dictate-stop").assertExists()
        compose.onAllNodesWithTag("chat-mic").assertCountEquals(0)
    }

    @Test fun chatReview() {
        shoot("voice-first-03-chat-review") { ChatScreen(chat.copy(voicePreview = review), ChatActions()) }
        compose.onNodeWithTag("chat-dictate-send").assertExists()
        compose.onNodeWithTag("chat-dictate-edit").assertExists()
        // The learner's Chinese: ✓ Check my Chinese works on what was said.
        compose.onNodeWithTag("chat-check-draft").assertExists()
    }

    @Test fun chatTyping() = shoot("voice-first-04-chat-typing") { ChatScreen(ChatScreenshots.base.copy(voicePreview = VoiceDictationUi(mode = "type")), ChatActions()) }

    @Test fun chatClaudeIdle() {
        shoot("voice-first-05-claude-chat-idle") { ChatScreen(ChatScreenshots.aiUi.copy(waitingForAi = false, playingId = null, draft = "", voicePreview = VoiceDictationUi()), ChatActions()) }
        // A Claude role-play has no voice messages: only dictation.
        compose.onNodeWithTag("chat-say").assertExists()
        compose.onAllNodesWithTag("chat-mic").assertCountEquals(0)
    }

    @Test fun coachIdle() = shoot("voice-first-06-coach-idle") {
        CoachHomeScreen(CoachHomeUi(conversations = Loadable(CoachSamples.conversations)), CoachHomeActions(onBack = {}), voicePreview = VoiceDictationUi())
    }

    @Test fun coachListening() = shoot("voice-first-07-coach-listening", settleMs = 600) {
        CoachHomeScreen(CoachHomeUi(conversations = Loadable(CoachSamples.conversations)), CoachHomeActions(onBack = {}), voicePreview = VoiceDictationUi(phase = "listening", finalText = "我昨天去了", partialText = "商店"))
    }

    @Test fun coachReview() {
        shoot("voice-first-08-coach-review") {
            CoachHomeScreen(CoachHomeUi(conversations = Loadable(CoachSamples.conversations)), CoachHomeActions(onBack = {}), voicePreview = VoiceDictationUi(phase = "review", finalText = "我昨天去了商店买苹果"))
        }
        // Chinese said → Check my sentence + Explain act on it.
        compose.onNodeWithTag(coachActionTag(CoachAction.CHECK)).assertExists()
        compose.onNodeWithTag(coachActionTag(CoachAction.EXPLAIN)).assertExists()
    }

    @Test fun coachReviewEnglish() {
        shoot("voice-first-09-coach-review-english") {
            CoachHomeScreen(CoachHomeUi(conversations = Loadable(CoachSamples.conversations)), CoachHomeActions(onBack = {}), voicePreview = VoiceDictationUi(phase = "review", finalText = "How do I say I'm running late?"))
        }
        // English said → Translate.
        compose.onNodeWithTag(coachActionTag(CoachAction.TRANSLATE)).assertExists()
        compose.onAllNodesWithTag(coachActionTag(CoachAction.CHECK)).assertCountEquals(0)
    }

    private val note = Samples.note.copy(hanzi = "银行", pinyin = "yínháng", english = "bank", sentenceClue = "我去银行取钱。")
    private val view = CardView(
        QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, CardScheduler.initialCardState()), note, emptyList(),
        CardScheduler.intervalPreviews(CardScheduler.initialCardState(), Js.parseDate("2026-10-08T09:30:00.000Z")), emptyList(), 1, "HSK 2", true,
    )
    private val ask = AskUi(conversation = listOf(AskAnswer(id = "q1", question = "银行和很行有什么不一样？", answer = "银行是放钱的地方；很行是说一个人很厉害。", answer_lang = "zh")))

    @Test fun askClaudeIdle() = shoot("voice-first-10-ask-claude-idle") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(top = 16.dp)) {
            AskClaudeBody(view, ask, "zh", null, true, AskActions(), voicePreview = VoiceDictationUi())
        }
    }

    @Test fun askClaudeReview() = shoot("voice-first-11-ask-claude-review") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(top = 16.dp)) {
            AskClaudeBody(view, ask, "zh", null, true, AskActions(), voicePreview = VoiceDictationUi(phase = "review", finalText = "银行的行为什么读háng？"))
        }
    }

    @Test fun chatReviewDark() = shoot("voice-first-12-chat-review-dark", dark = true) { LabTheme(dark = true) { ChatScreen(chat.copy(voicePreview = review), ChatActions()) } }
}
