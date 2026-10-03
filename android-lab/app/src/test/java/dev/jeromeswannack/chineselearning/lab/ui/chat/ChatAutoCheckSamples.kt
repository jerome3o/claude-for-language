package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckAlternativeDto
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckDto
import dev.jeromeswannack.chineselearning.lab.data.api.AutoCheckMistakeDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import java.time.Instant
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/** docs/CHAT.md "Auto-check" sample: my message the background check found something in. */
object ChatAutoCheckSamples {
    private val now = Instant.now()
    private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()

    const val TEXT = "我昨天去了商店买东西了"
    const val CORRECTED = "我昨天去商店买东西了"

    val check = AutoCheckDto(
        text = TEXT,
        status = "improvable",
        corrected = CORRECTED,
        corrected_pinyin = "Wǒ zuótiān qù shāngdiàn mǎi dōngxi le",
        corrected_english = "Yesterday I went to the shop to buy things.",
        mistakes = listOf(
            AutoCheckMistakeDto(
                "去了", "去", "One 了 at the end is enough here.",
                AutoCheckCardDto(
                    "去商店买东西", "qù shāngdiàn mǎi dōngxi", "go to the shop to buy things",
                    "去 (qù) go + 商店 (shāngdiàn) shop + 买 (mǎi) buy + 东西 (dōngxi) things.\nA verb chain: go somewhere to do something.\nOne 了 at the end of the sentence marks the whole outing as done.",
                ),
            ),
        ),
        alternative = AutoCheckAlternativeDto(
            "我昨天去商店买了点东西", "Wǒ zuótiān qù shāngdiàn mǎile diǎn dōngxi", "Yesterday I went to the shop and bought a few things.",
            "买了点 = bought a few things — how people usually say it.",
        ),
        severity = "minor",
        card = AutoCheckCardDto(
            CORRECTED, "Wǒ zuótiān qù shāngdiàn mǎi dōngxi le", "Yesterday I went to the shop to buy things.",
            "我 (wǒ) I · 昨天 (zuótiān) yesterday · 去 (qù) go · 商店 (shāngdiàn) shop · 买 (mǎi) buy · 东西 (dōngxi) things · 了 (le) done.\nTime word first, then go + place + what for; one 了 at the end.",
        ),
        checked_at = at(15),
    )

    /** Mine, checked: not the last of its group (the ✎ shows without the time). */
    val ac = ChatMessageDto("ac", conversation_id = "c1", sender_id = "me", sender = S.me, content = TEXT, created_at = at(16), auto_check = check)
    val m4 = S.m4.copy(created_at = at(15))
    val m1 = S.m1.copy(created_at = at(20))
    val m5 = S.m5.copy(created_at = at(12))

    val ui = S.student.copy(messages = listOf(m1, ac, m4, m5), aids = dev.jeromeswannack.chineselearning.lab.core.ChatLearning.Aids(), otherReadAt = at(13))
}
