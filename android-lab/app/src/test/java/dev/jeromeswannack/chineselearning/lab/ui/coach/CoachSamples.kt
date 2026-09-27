package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto

object CoachSamples {
    const val ANALYSIS_ZH = """{"kind":"chinese","coach":{"originalInput":"我昨天去了商店买苹果","inputLanguage":"chinese","isCorrect":false,
"corrected":{"hanzi":"我昨天去商店买了苹果。","pinyin":"Wǒ zuótiān qù shāngdiàn mǎi le píngguǒ.","english":"Yesterday I went to the shop and bought apples."},
"critique":"了 marks the completed action — here that's 买 (buying), not 去 (going). Put it after 买.","issues":[],
"alternatives":[{"hanzi":"我昨天在商店买了苹果。","pinyin":"Wǒ zuótiān zài shāngdiàn mǎi le píngguǒ.","english":"I bought apples at the shop yesterday.","note":"在 + place: where it happened, not the trip."}],"vocabSuggestions":[]}}"""

    const val ANALYSIS_EN = """{"kind":"english","translation":{"originalInput":"I went to buy tea yesterday","primary":{"hanzi":"我昨天去买茶了。","pinyin":"Wǒ zuótiān qù mǎi chá le.","english":"I went to buy tea yesterday."},
"alternatives":[{"hanzi":"我昨天买茶去了。","pinyin":"Wǒ zuótiān mǎi chá qù le.","english":"I went off to buy tea yesterday.","note":"More colloquial."}],"words":[],"grammar_points":[],"usage_note":"Sentence-final 了 tells the listener this already happened."}}"""

    const val TOOLS = """[{"tool":"search_cards","success":true,"data":{"count":0}},{"tool":"create_flashcards","success":true,"data":{"deck_name":"HSK 3 · Plans & time","notes":[{"hanzi":"商店"}]}}]"""

    val conversations = listOf(
        CoachConversationDto("c1", "我昨天去了商店买苹果", "zh", updated_at = "2026-09-27 08:10:00", message_count = 4),
        CoachConversationDto("c2", "How do I say I'm running late?", "en", updated_at = "2026-09-25 18:00:00", message_count = 2),
        CoachConversationDto("c3", "他比我高多了", "zh", updated_at = "2026-09-20 12:00:00", message_count = 6),
    )

    val thread = CoachThreadDto(
        conversations[0],
        listOf(
            CoachMessageDto("m1", "c1", "user", "text", "我昨天去了商店买苹果"),
            CoachMessageDto("m2", "c1", "assistant", "analysis", ANALYSIS_ZH),
            CoachMessageDto("m3", "c1", "user", "text", "Make a flashcard for the key word…"),
            CoachMessageDto(
                "m4", "c1", "assistant", "text",
                "Done! I added **商店** (shāngdiàn) — *shop, store*.\n- 商 (shāng) trade · 店 (diàn) shop\n- Contrast 超市 (chāoshì), a supermarket.",
                TOOLS,
            ),
        ),
    )

    val translationThread = CoachThreadDto(
        conversations[1].copy(title = "I went to buy tea yesterday"),
        listOf(CoachMessageDto("t1", "c2", "user", "text", "I went to buy tea yesterday"), CoachMessageDto("t2", "c2", "assistant", "analysis", ANALYSIS_EN)),
    )

    val decks = listOf(CoachDeck("d1", "HSK 3 · Plans & time"), CoachDeck("d2", "Food & ordering"))
}
