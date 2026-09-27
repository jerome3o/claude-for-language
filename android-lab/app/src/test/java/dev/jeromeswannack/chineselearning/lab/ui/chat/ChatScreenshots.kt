package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatReplyToDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.CheckResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.DiscussionTurn
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionUserDto
import dev.jeromeswannack.chineselearning.lab.data.api.SegmentChunk
import dev.jeromeswannack.chineselearning.lab.data.api.SegmentedDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceBreakdownDto
import dev.jeromeswannack.chineselearning.lab.data.api.SuggestedCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config
import java.time.Instant

/** Package E screenshots: the chat. Sheets are rendered as full screens here (bottom sheets need a window). */
class ChatScreenshots : LabScreenshotTest() {
    companion object {
        private val now = Instant.now()
        private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()
        val wang = ChatSenderDto("t1", "王老师")
        val me = ChatSenderDto("me", "Jerome")
        val messages = listOf(
            ChatMessageDto("m1", sender_id = "t1", sender = wang, content = "明天上课前把这些词复习一下，好吗？", created_at = at(60 * 26)),
            ChatMessageDto("m2", sender_id = "me", sender = me, content = "好的！我今天学了二十个新词。", created_at = at(60 * 25), check_status = "correct",
                reactions = listOf(ReactionDto("👍", listOf(ReactionUserDto("t1", "王老师")), 1))),
            ChatMessageDto("m3", sender_id = "t1", sender = wang, content = "太好了！你觉得哪个词最难？", created_at = at(40)),
            ChatMessageDto("m4", sender_id = "me", sender = me, content = "我觉得刮风最难，我老是忘记。", created_at = at(35), check_status = "needs_improvement",
                reply_to = ChatReplyToDto("m3", "太好了！你觉得哪个词最难？", wang)),
            ChatMessageDto("m5", sender_id = "t1", sender = wang, content = "Video call starting — join here: https://chinese.example.dev/calls/abcDEF1234", created_at = at(2)),
        )
        val base = ChatUi(
            loading = false, otherName = "王老师", myId = "me", viewerRole = "student",
            conversation = ConversationDto("c1", "rel1", "Lesson questions"),
            messages = messages, draft = "明天见！",
            wordByWord = setOf("m3"),
            segmentations = mapOf("m3" to SegmentedDto("Great! Which word do you find hardest?", SentenceBreakdownDto(chunks = listOf("太好了", "！", "你", "觉得", "哪个", "词", "最", "难", "？").map { SegmentChunk(it) }))),
        )
        val aiUi = ChatUi(
            loading = false, otherName = "Claude", otherIsClaude = true, myId = "me",
            conversation = ConversationDto("c2", "rel2", "Restaurant Practice", scenario = "Ordering food at a Chinese restaurant", user_role = "A tourist", ai_role = "A friendly waiter", is_ai_conversation = true),
            messages = listOf(
                ChatMessageDto("a1", sender_id = "claude-ai", sender = ChatSenderDto("claude-ai", "Claude"), content = "欢迎光临！请问几位？", created_at = at(5)),
                ChatMessageDto("a2", sender_id = "me", sender = me, content = "两位，谢谢。", created_at = at(4)),
            ),
            waitingForAi = true, playingId = "a1",
        )
        val card = SuggestedCard("刮风", "guā fēng", "to be windy", "刮 (guā) to blow + 风 (fēng) wind. 今天刮风 = it's windy today.")
    }

    @Test fun chat() = shoot("chat-01-conversation") { ChatScreen(base, ChatActions()) }

    @Test fun claude() = shoot("chat-02-claude-practice") { ChatScreen(aiUi, ChatActions()) }

    @Test fun offline() = shoot("chat-03-offline", dark = true) {
        ChatScreen(base.copy(online = false, offlineHistory = true, draft = ""), ChatActions())
    }

    @Test fun empty() = shoot("chat-04-empty") { ChatScreen(ChatUi(loading = false, otherName = "王老师", myId = "me"), ChatActions()) }

    @Test fun notice() = shoot("chat-05-notice") {
        ChatScreen(base.copy(notice = Notice("Saved 刮风 to 天气.", false), replyingTo = messages[2], checkingId = "m4"), ChatActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("chat-06-unfolded") { ChatScreen(base, ChatActions()) }

    @Test fun deckPicker() = shoot("chat-07-card-deck-picker") {
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen("Generated Flashcard") {
            item { CardPreview(card) }
            item { DeckPicker(base.copy(decks = listOf(DeckChoice("d1", "天气", true), DeckChoice("d2", "Starter Chinese", false))), 1, ChatSheetActions()) { _, _ -> } }
        }
    }

    @Test fun check() = shoot("chat-08-check-result") {
        val r = CheckResultDto("needs_improvement", "Nice! 老是 is natural here. Say 我觉得「刮风」最难 — quote the word you mean.", listOf(card))
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen("Check Result") {
            item { androidx.compose.material3.Text(r.feedback) }
            item { CardPreview(card) }
        }
    }
}
