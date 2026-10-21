package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

/** System messages (docs/CHAT.md "System messages") in Jerome's chat with Minghui, real hanzi. */
object ChatSystemSamples {
    private val now = Instant.now()
    private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()
    val mh = ChatSenderDto("t1", "Minghui Wang")
    val me = ChatSenderDto("me", "Jerome")

    private fun msg(id: String, from: ChatSenderDto, content: String, minAgo: Long) =
        ChatMessageDto(id, conversation_id = "c1", sender_id = from.id, sender = from, content = content, created_at = at(minAgo))

    private fun sys(id: String, from: ChatSenderDto, kind: String, data: JsonObject, fallback: String, minAgo: Long) =
        msg(id, from, fallback, minAgo).copy(system_kind = kind, system_data = data)

    val hi = msg("h1", mh, "今天的作业做完了吗？", 50)
    val budget = sys("s1", mh, "study_budget", buildJsonObject { put("new_cards_per_day", 2); put("secondary_cards_per_day", 5); put("is_default", false) },
        "📚 Minghui set your new cards to 2 a day (+5 extra)", 48)
    val reply = msg("h2", me, "做完了！新词有点多。", 40)
    val flag = sys("s2", me, "card_flag", buildJsonObject { put("flag_id", "f1"); put("note_id", "n1"); put("hanzi", "银行"); put("pinyin", "yínháng"); put("english", "bank"); put("message", "我总是和很行搞混") },
        "🚩 Jerome flagged 银行 for you: “我总是和很行搞混”", 35)
    val flagReply = sys("s3", mh, "flag_reply", buildJsonObject { put("flag_id", "f1"); put("note_id", "n1"); put("hanzi", "银行"); put("reply", "银行的“行”读 háng，不是 xíng。") },
        "🚩 Minghui replied about 银行: “银行的“行”读 háng，不是 xíng。”", 30)
    val missed = sys("s4", mh, "call_started", buildJsonObject { put("call_id", "call-1"); put("ended", true); put("missed", true) },
        "📹 Minghui started a video call — join here: https://app.test/calls/call-1", 20)
    val live = sys("s5", mh, "call_started", buildJsonObject { put("call_id", "call-2") },
        "📹 Minghui started a video call — join here: https://app.test/calls/call-2", 2)
    val thread = listOf(hi, budget, reply, flag, flagReply, missed, live)

    val student = ChatUi(
        loading = false, otherName = "Minghui", myId = "me", viewerRole = "student",
        conversation = ChatConversationDto("c1", "rel1", "Weekly chat"),
        messages = thread, aids = ChatLearning.Aids(), otherReadAt = at(1),
    )

    /** The same chat from Minghui's side. */
    val tutor = student.copy(otherName = "Jerome", myId = "t1", viewerRole = "tutor")
}
