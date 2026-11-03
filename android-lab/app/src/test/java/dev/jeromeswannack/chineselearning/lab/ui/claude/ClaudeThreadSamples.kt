package dev.jeromeswannack.chineselearning.lab.ui.claude

import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachSamples

/** Claude threads as the screen draws them (docs/CHAT.md "Claude thread view"). */
object ClaudeThreadSamples {
    private fun mine(id: String, text: String, intent: String = "ask", queued: Boolean = false) =
        ClaudeMessageDto(id, "t1", id, "user", "text", text, intent = intent, created_at = "2026-11-03T10:00:0${id.last()}.000Z", queued = queued)

    private fun claude(id: String, text: String, status: String? = null, lang: String = "zh", type: String = "text", tools: String? = null) =
        ClaudeMessageDto(id, "t1", null, "assistant", type, text, status = status, streaming = status == "pending" && text.isNotEmpty(), answer_lang = lang, tool_results = tools, created_at = "2026-11-03T10:00:0${id.last()}.000Z")

    /** A plain chat, Claude's second reply streaming in. */
    val generalStreaming = ClaudeThreadUi(
        threadId = "t1",
        title = "成都有什么好吃的？",
        hasThread = true,
        messages = listOf(
            mine("u1", "成都有什么好吃的？"),
            claude("a2", "成都的菜很有名，特别是火锅。\n火锅又麻又辣，可是很好吃。"),
            mine("u3", "串串是什么？"),
            claude("a4", "串串就是把菜和肉穿在竹签上，\n放在锅里煮", status = "pending"),
        ),
    )

    /** The same, Claude looking through the cards before it writes. */
    val generalTool = generalStreaming.copy(
        messages = generalStreaming.messages.dropLast(1) + claude("a4", "", status = "pending"),
        liveTool = LiveTool("a4", "tool", "search_cards"),
    )

    val cardContext = ClaudeContextDto(ClaudeChats.CARD, note_id = "n1", label = "银行")

    /** Ask Claude on a card: the context chip, an answer, the suggestion chips. */
    val cardThread = ClaudeThreadUi(
        threadId = "t2",
        title = "银行和很行有什么不一样？",
        context = cardContext,
        hasThread = true,
        hasSentence = true,
        messages = listOf(
            mine("u1", "银行和很行有什么不一样？"),
            claude(
                "a2",
                "「银行」的「行」读 háng，意思是做生意的地方。\n「很行」的「行」读 xíng，意思是很厉害、可以。\n所以：我去银行 (háng)，你真行 (xíng)！",
                tools = """[{"tool":"search_cards","success":true,"data":{"count":2}}]""",
            ),
        ),
    )

    /** A card thread nobody has asked in yet. */
    val cardEmpty = ClaudeThreadUi(isNew = true, context = cardContext, hasSentence = true)

    /** A plain chat started with ✏️ Check: the Coach's result card, then a follow-up. */
    val checkResult = ClaudeThreadUi(
        threadId = "t3",
        title = "我昨天去了商店买苹果",
        hasThread = true,
        messages = listOf(
            mine("u1", "我昨天去了商店买苹果", intent = "check"),
            claude("a2", CoachSamples.ANALYSIS_ZH, type = "analysis"),
        ),
    )

    /** Offline: my question waits in the outbox; one the server refused says why. */
    val queuedOffline = ClaudeThreadUi(
        threadId = "t4",
        title = "怎么点菜？",
        hasThread = true,
        online = false,
        messages = listOf(
            mine("u1", "怎么点菜？"),
            claude("a2", "你可以说：「服务员，点菜！」\n然后指着菜单说：「我要这个。」"),
            mine("u3", "「买单」和「结账」一样吗？", queued = true),
        ),
    )

    val queueRefused = queuedOffline.copy(
        online = true,
        messages = queuedOffline.messages.dropLast(1) + mine("u3", "「买单」和「结账」一样吗？"),
        queueFailed = mapOf("u3" to "Keep a message under 2000 characters"),
    )

    /** A fresh plain chat with a Chinese sentence in the box (Ask + ✏️ Check / 🔍 Explain). */
    val newChinese = ClaudeThreadUi(isNew = true, draft = "我昨天去了商店买东西了")

    /** A practice chat copied in from the old Claude role-plays: read-only. */
    val practice = ClaudeThreadUi(
        threadId = "t5",
        title = "点菜",
        context = ClaudeContextDto(ClaudeChats.PRACTICE, conversation_id = "c9", scenario = "点菜"),
        hasThread = true,
        threadReadOnly = true,
        messages = listOf(claude("a1", "欢迎光临！请问几位？"), mine("u2", "两位。")),
    )
}
