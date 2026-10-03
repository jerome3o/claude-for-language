package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatReplyToDto
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionUserDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatWaveforms
import dev.jeromeswannack.chineselearning.lab.data.chat.LinkPreviewDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config
import java.time.Instant
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/**
 * Chat round 2 (docs/CHAT.md "Round 2"): the Signal-like thread (groups, day pills, ticks inside
 * the last bubble, reactions, reply quote, inline pinyin + translation, link preview, voice with a
 * real waveform + speed chip), the long-press menu, Explain, the one-row composer, recording, selection.
 */
class ChatRound2Screenshots : LabScreenshotTest() {
    companion object {
        private val now = Instant.now()
        private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()
        private fun msg(id: String, from: dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto, content: String, minAgo: Long) =
            ChatMessageDto(id, conversation_id = "c1", sender_id = from.id, sender = from, content = content, created_at = at(minAgo))

        const val LINK = "https://www.zhihu.com/question/2024/how-to-learn-chinese"

        val y1 = msg("y1", S.mh, "明天的课你准备好了吗？", 60 * 24 + 30)
        val y2 = msg("y2", S.me, "准备好了！", 60 * 24 + 20)
        val y3 = msg("y3", S.me, "我写了一篇短文，明天给你看 📝", 60 * 24 + 19)
        val voice = msg("v9", S.mh, "", 40).copy(
            attachment = ChatAttachmentDto("voice", duration_ms = 6_400, mime = "audio/mp4", transcript_status = "done", transcript = "这篇文章很有用，你看看吧。", translation = "This article is really useful, have a look."),
            media_url = "/api/chat-media/v9",
        )
        val link = msg("l1", S.mh, "看看这个：$LINK", 39)
        val reply = msg("r1", S.me, "好的，我晚上看 👍", 30).copy(
            reply_to = ChatReplyToDto("l1", link.content, S.mh),
            reactions = listOf(ReactionDto("❤️", listOf(ReactionUserDto("t1", "Minghui")), 1)),
        )
        val m1 = S.m1.copy(created_at = at(14))
        val m2 = S.m2.copy(created_at = at(12), reactions = listOf(ReactionDto("👍", listOf(ReactionUserDto("t1", "Minghui")), 1), ReactionDto("😂", listOf(ReactionUserDto("me", "Jerome")), 1)))
        val m4 = S.m4.copy(created_at = at(11), edited_at = at(10))
        val thread = listOf(y1, y2, y3, voice, link, reply, m1, m2, m4)

        val preview = LinkPreviewDto(LINK, "怎样才能学好中文？", "从听说读写四个方面，分享十个每天都能用的小方法。", "https://pic.example/zhihu.jpg", "知乎")
        val wave = ChatWaveforms.pool(List(96) { i -> (0.25f + 0.75f * kotlin.math.abs(kotlin.math.sin(i / 5.0)).toFloat()) * (if (i % 7 == 0) 0.5f else 1f) })

        val ui = S.student.copy(
            messages = thread,
            otherReadAt = at(11),
            aids = ChatLearning.Aids(pinyinFlipped = setOf("m1"), translationFlipped = setOf("m1")),
            linkPreviews = mapOf(LINK to preview),
            waveforms = mapOf("v9" to wave),
            timeShown = setOf("y2"),
            voiceSpeed = 1.5f,
        )

        val actions = ChatActions(
            loadImage = { _, _ -> ChatRichScreenshots.picture(640, 480) },
            loadLocalImage = { _, _ -> ChatRichScreenshots.picture(640, 480) },
            loadLinkImage = { _, _ -> ChatRichScreenshots.picture(764, 400) },
        )

        val explanation = SentenceExplanation(
            listOf(
                ExplainedWord("周末", "zhōumò", "weekend"), ExplainedWord("你", "nǐ", "you"), ExplainedWord("做", "zuò", "do"),
                ExplainedWord("了", "le", "(completed action)"), ExplainedWord("什么", "shénme", "what"),
            ),
            construction = "**了** right after the verb 做 marks a finished action; 什么 sits where the answer goes — Chinese questions keep statement order.",
            translation = "What did you do at the weekend?",
        )
    }

    /** The chat dimmed with a bottom sheet over it (the dialog window itself isn't captured). */
    @Composable
    private fun SheetOver(under: @Composable () -> Unit, content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize()) {
            under()
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 760.dp).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)
                    .verticalScroll(rememberScrollState()).padding(top = 20.dp, bottom = 16.dp),
            ) { content() }
        }
    }

    @Test fun light() = shoot("chat-r2-01-folded-light") { ChatScreen(ui, actions) }

    @Test fun dark() = shoot("chat-r2-02-folded-dark", dark = true) { ChatScreen(ui, actions) }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("chat-r2-03-unfolded") { ChatScreen(ui.copy(typing = true), actions) }

    @Test fun menu() = shoot("chat-r2-04-long-press-menu") {
        SheetOver({ ChatScreen(ui, actions) }) {
            MessageMenuContent(m1, ui.menu(m1), online = true, recent = emptyList(), mine = false, onReact = {}, onAction = {})
        }
    }

    @Test fun menuMineOffline() = shoot("chat-r2-05-menu-mine-offline", dark = true) {
        SheetOver({ ChatScreen(ui.copy(online = false), actions) }) {
            MessageMenuContent(m2, ui.menu(m2), online = false, recent = listOf("😂", "👏"), mine = true, onReact = {}, onAction = {})
        }
    }

    @Test fun explain() = shoot("chat-r2-06-explain") {
        SheetOver({ ChatScreen(ui, actions) }) {
            ExplainContent(ExplainUi("m1", m1.content, m1.translation, loading = false, result = explanation), saveCard = false, online = true, cards = SentenceActions(), onRetry = {}, onClose = {})
        }
    }

    @Test fun saveAsFlashcard() = shoot("chat-r2-07-save-as-flashcard") {
        SheetOver({ ChatScreen(ui, actions) }) {
            ExplainContent(
                ExplainUi("m1", m1.content, m1.translation, loading = false, result = explanation), saveCard = true, online = true,
                cards = SentenceActions(decks = { S.decks.map { it.id to it.name } }), onRetry = {}, onClose = {},
            )
        }
    }

    @Test fun composerWithText() = shoot("chat-r2-08-composer-text") {
        ChatScreen(ui.copy(draft = "我们下次一起去书店吧！", replyingTo = m1), actions)
    }

    @Test fun composerEmpty() = shoot("chat-r2-09-composer-empty") {
        ChatScreen(ui.copy(messages = thread.takeLast(4)), actions)
    }

    @Test fun recordingHeld() = shoot("chat-r2-10-recording-held") {
        ChatScreen(ui.copy(recorder = RecorderUi.Recording(4_300, locked = false, level = 0.55f)), actions)
    }

    @Test fun recordingLocked() = shoot("chat-r2-11-recording-locked") {
        ChatScreen(ui.copy(recorder = RecorderUi.Recording(12_800, locked = true, level = 0.35f)), actions)
    }

    @Test fun voiceBubble() = shoot("chat-r2-12-voice-speed") {
        ChatScreen(
            ui.copy(
                messages = listOf(y3, voice, link),
                voice = VoicePlayback("v9", 2_600, 6_400, playing = true),
                aids = ChatLearning.Aids(translationFlipped = setOf("v9")),
            ),
            actions,
        )
    }

    @Test fun linkPreview() = shoot("chat-r2-13-link-preview") {
        ChatScreen(ui.copy(messages = listOf(y1, link, reply)), actions)
    }

    @Test fun selection() = shoot("chat-r2-14-selection") {
        ChatScreen(ui.copy(selection = SelectionUi(setOf("m1", "m2"))), actions)
    }
}
