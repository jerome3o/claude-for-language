package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.core.FlashcardReview
import dev.jeromeswannack.chineselearning.lab.core.ProposedCard
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatCorrectionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachLine
import dev.jeromeswannack.chineselearning.lab.data.api.CoachResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import java.time.Instant

/** docs/CHAT.md PR 3 sample chat (real hanzi; words concatenate to each text exactly). */
object ChatLearningSamples {
    private val now = Instant.now()
    private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()
    val mh = ChatSenderDto("t1", "Minghui")
    val me = ChatSenderDto("me", "Jerome")
    private fun w(vararg parts: Pair<String, String>) = parts.map { (t, p) -> ReaderWordDto(t, p, "") }
    private fun msg(id: String, from: ChatSenderDto, content: String, minAgo: Long) =
        ChatMessageDto(id, conversation_id = "c1", sender_id = from.id, sender = from, content = content, created_at = at(minAgo))

    val m1 = msg("m1", mh, "周末你做了什么？", 30).copy(
        translation = "What did you do at the weekend?", words_source = "content",
        words = w("周末" to "zhōumò", "你" to "nǐ", "做" to "zuò", "了" to "le", "什么" to "shénme", "？" to ""),
    )
    val m2 = msg("m2", me, "我昨天去商店买东西了。", 28).copy(
        translation = "Yesterday I went to the shop to buy things.", words_source = "content",
        words = w("我" to "wǒ", "昨天" to "zuótiān", "去" to "qù", "商店" to "shāngdiàn", "买" to "mǎi", "东西" to "dōngxi", "了" to "le", "。" to ""),
        correction = ChatCorrectionDto("我昨天去商店买了东西。", "了 goes right after the verb 买 here.", "t1", at(20)),
    )
    val v1 = msg("v1", mh, "", 18).copy(
        attachment = ChatAttachmentDto("voice", duration_ms = 3_800, mime = "audio/mp4", transcript_status = "done", transcript = "买了什么好东西？", translation = "What good things did you buy?"),
        media_url = "/api/chat-media/v1", words_source = "transcript",
        words = w("买" to "mǎi", "了" to "le", "什么" to "shénme", "好" to "hǎo", "东西" to "dōngxi", "？" to ""),
    )
    val m4 = msg("m4", me, "买了一本书和一些水果。", 15).copy(
        translation = "I bought a book and some fruit.", words_source = "content",
        words = w("买" to "mǎi", "了" to "le", "一本" to "yì běn", "书" to "shū", "和" to "hé", "一些" to "yìxiē", "水果" to "shuǐguǒ", "。" to ""),
    )
    val m5 = msg("m5", mh, "太好了！下次给我看看那本书。", 12).copy(
        translation = "Great! Show me that book next time.", words_source = "content",
        words = w("太" to "tài", "好" to "hǎo", "了" to "le", "！" to "", "下次" to "xiàcì", "给" to "gěi", "我" to "wǒ", "看看" to "kànkan", "那" to "nà", "本" to "běn", "书" to "shū", "。" to ""),
    )
    val thread = listOf(m1, m2, v1, m4, m5)

    val decks = listOf(DeckChoice("d1", "From my chats", pinned = true), DeckChoice("d2", "HSK 3", false), DeckChoice("d3", "Weekend words", false))

    /** The student (Jerome) with Minghui; some words already in his decks. */
    val student = ChatUi(
        loading = false, otherName = "Minghui", myId = "me", viewerRole = "student",
        conversation = ChatConversationDto("c1", "rel1", "Weekly chat"),
        messages = thread,
        known = setOf("什么", "你", "我", "了", "好", "太"),
        aids = ChatLearning.Aids(pinyinFlipped = setOf("m1", "v1", "m5"), translationFlipped = setOf("m5")),
        decks = decks,
        otherReadAt = at(11),
    )

    /** Minghui (the tutor) looking at the same chat. */
    val tutor = student.copy(
        otherName = "Jerome", myId = "t1", viewerRole = "tutor",
        messages = thread.map { if (it.sender_id == "t1") it.copy(sender = mh) else it },
        known = emptySet(), aids = ChatLearning.Aids(),
    )

    val review = ReviewUi(
        FlashcardReview.of(
            listOf(
                ProposedCard("商店", "shāngdiàn", "shop; store", "商 (shāng) trade + 店 (diàn) shop.", "我去商店买水果。", "Wǒ qù shāngdiàn mǎi shuǐguǒ.", "I go to the shop to buy fruit.", sourceMessageId = "m2"),
                ProposedCard("买东西", "mǎi dōngxi", "to go shopping", "买 (mǎi) buy + 东西 (dōngxi) things.", alreadyHave = true, sourceMessageId = "m2"),
                ProposedCard("水果", "shuǐguǒ", "fruit", "水 (shuǐ) water + 果 (guǒ) fruit.", "我每天吃水果。", "Wǒ měitiān chī shuǐguǒ.", "I eat fruit every day.", sourceMessageId = "m4"),
                ProposedCard("下次", "xiàcì", "next time", "下 (xià) next + 次 (cì) time.", "下次见！", "Xiàcì jiàn!", "See you next time!", sourceMessageId = "m5"),
            ),
        ),
        sources = mapOf("m2" to "我昨天去商店买东西了。", "m4" to "买了一本书和一些水果。", "m5" to "太好了！下次给我看看那本书。"),
        title = "Cards from 4 messages",
        deckId = "d1",
    )

    val draft = "我明天想去公园跑步在早上。"
    val check = DraftCheckUi(
        draft, loading = false,
        result = CoachResultDto(
            isCorrect = false,
            corrected = CoachLine("我明天早上想去公园跑步。", "Wǒ míngtiān zǎoshang xiǎng qù gōngyuán pǎobù.", "Tomorrow morning I want to go running in the park."),
            critique = "Time words go **before** the verb in Chinese: put 早上 right after 明天, not at the end.",
        ),
    )
}
