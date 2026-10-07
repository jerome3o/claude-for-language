package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.core.CoachBreakdownWord
import dev.jeromeswannack.chineselearning.lab.data.api.CoachBreakdownDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable

/** docs/CHAT.md "Chat ↔ Coach": replies written in the background, and the new-words quick actions. */
object CoachBackgroundSamples {
    const val SENTENCE = "我昨天去了商店买东西了"

    val conversation = CoachConversationDto("c9", SENTENCE, "zh", action = "check", updated_at = "2026-10-07 09:00:00", message_count = 2)

    /** "Open in Coach" just pressed: the analysis is still being written. */
    val pendingAnalysis = CoachThreadDto(
        conversation,
        listOf(
            CoachMessageDto("p1", "c9", "user", "text", SENTENCE),
            CoachMessageDto("p2", "c9", "assistant", "analysis", "", status = "pending"),
        ),
    )

    /** A follow-up still being answered. */
    val pendingReply = CoachThreadDto(
        CoachSamples.conversations[0],
        CoachSamples.thread.messages.take(2) + listOf(
            CoachMessageDto("p3", "c1", "user", "text", "Why does 了 go after 买?"),
            CoachMessageDto("p4", "c1", "assistant", "text", "", status = "pending"),
        ),
    )

    /** The follow-up failed: the reason + Retry. */
    val failedReply = pendingReply.copy(
        messages = pendingReply.messages.dropLast(1) + CoachMessageDto("p4", "c1", "assistant", "text", "", status = "failed", error = "Claude is busy right now — try again in a moment."),
    )

    val conversations = listOf(
        conversation.copy(pending_reply = true),
        CoachSamples.conversations[0].copy(failed_reply = true),
    ) + CoachSamples.conversations.drop(1)

    val breakdown = CoachBreakdownDto(
        hanzi = SENTENCE,
        pinyin = "wǒ zuótiān qù le shāngdiàn mǎi dōngxi le",
        translation = "Yesterday I went to the shop to buy things.",
        words = listOf(
            ExplainedWord("我", "wǒ", "I"),
            ExplainedWord("昨天", "zuótiān", "yesterday"),
            ExplainedWord("去", "qù", "go"),
            ExplainedWord("了", "le", "completed action"),
            ExplainedWord("商店", "shāngdiàn", "shop, store"),
            ExplainedWord("买", "mǎi", "buy"),
            ExplainedWord("东西", "dōngxi", "things, stuff"),
            ExplainedWord("了", "le", "change of state"),
        ),
        construction = "Time word first, then go + place + what for.",
    )

    val newWords = listOf(CoachBreakdownWord("商店", "shāngdiàn", "shop, store"), CoachBreakdownWord("东西", "dōngxi", "things, stuff"))

    const val ANALYSIS = """{"kind":"chinese","coach":{"originalInput":"我昨天去了商店买东西了","inputLanguage":"chinese","isCorrect":false,
"corrected":{"hanzi":"我昨天去商店买东西了。","pinyin":"Wǒ zuótiān qù shāngdiàn mǎi dōngxi le.","english":"Yesterday I went to the shop to buy things."},
"critique":"One 了 at the end is enough: it marks the whole outing as done. 去了 + 了 says it twice.","issues":[],
"alternatives":[{"hanzi":"我昨天去商店买了点东西。","pinyin":"Wǒ zuótiān qù shāngdiàn mǎile diǎn dōngxi.","english":"Yesterday I went to the shop and bought a few things.","note":"买了点 = bought a few things — how people usually say it."}],"vocabSuggestions":[]}}"""

    val ready = CoachThreadDto(
        conversation,
        listOf(CoachMessageDto("r1", "c9", "user", "text", SENTENCE), CoachMessageDto("r2", "c9", "assistant", "analysis", ANALYSIS)),
    )

    val quickActions = CoachChatUi(thread = Loadable(ready), decks = CoachSamples.decks, deckId = "d1", breakdown = breakdown, newWords = newWords)

    val sheet = NewWordsSheetUi(newWords, CoachSamples.decks)
}
