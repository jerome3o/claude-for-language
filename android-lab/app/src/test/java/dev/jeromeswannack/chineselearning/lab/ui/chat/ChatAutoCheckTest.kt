package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.core.SayBetter
import dev.jeromeswannack.chineselearning.lab.data.api.ChatCorrectionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.MessagesDto
import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatAutoCheckSamples as A

/** "How to say it better" (docs/CHAT.md "Auto-check"): the DTO, the sheet's content, the menu and the ✎ state. */
class ChatAutoCheckTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun decodesAutoCheckFromTheMessagesPage() {
        val body = """
            {"messages":[{"id":"ac","conversation_id":"c1","sender_id":"me","content":"我昨天去了商店买东西了","created_at":"2026-10-03T09:00:00.000Z",
              "sender":{"id":"me","name":"Jerome"},
              "auto_check":{"text":"我昨天去了商店买东西了","status":"improvable","corrected":"我昨天去商店买东西了",
                "corrected_pinyin":"Wǒ zuótiān qù shāngdiàn mǎi dōngxi le","corrected_english":"Yesterday I went to the shop to buy things.",
                "mistakes":[{"quote":"去了","fix":"去","why":"One 了 at the end is enough here.","card":null},
                            {"quote":"","fix":"的","why":"Missing.","card":{"hanzi":"的","pinyin":"de","english":"(possessive)","fun_facts":"x"}}],
                "alternative":{"hanzi":"我昨天去商店买了点东西","pinyin":"p","english":"e","note":null},
                "severity":"minor","card":null,"checked_at":"2026-10-03T09:00:05.000Z"}},
             {"id":"m2","sender_id":"t1","content":"好","created_at":"2026-10-03T09:01:00.000Z","auto_check":null}]}
        """.trimIndent()
        val page = json.decodeFromString(MessagesDto.serializer(), body)
        val ac = page.messages[0].auto_check
        assertNotNull(ac)
        assertEquals("improvable", ac.status)
        assertEquals("去了", ac.mistakes[0].quote)
        assertNull(ac.mistakes[0].card)
        assertEquals("的", ac.mistakes[1].card?.hanzi)
        assertEquals("我昨天去商店买了点东西", ac.alternative?.hanzi)
        assertNull(page.messages[1].auto_check)
        // The cached copy keeps it (the chat history is cached as JSON).
        val again = json.decodeFromString(ChatMessageDto.serializer(), json.encodeToString(ChatMessageDto.serializer(), page.messages[0]))
        assertEquals(ac, again.auto_check)
    }

    @Test fun sheetFromTheAutoCheck() {
        val v = assertNotNull(SayBetterView.of(A.ac, "me", "Minghui"))
        assertEquals(SayBetter.IMPROVABLE, v.state)
        assertNull(v.header)
        assertEquals(A.CORRECTED, v.corrected)
        assertEquals("Wǒ zuótiān qù shāngdiàn mǎi dōngxi le", v.pinyin)
        assertEquals(listOf("你说 去了 → 去"), v.mistakes.map { it.line })
        assertEquals("One 了 at the end is enough here.", v.mistakes[0].why)
        assertEquals("去商店买东西", v.mistakes[0].card?.hanzi)
        assertEquals("我昨天去商店买了点东西", v.alternative?.hanzi)
        assertEquals(A.CORRECTED, v.card.hanzi)
        assertEquals(A.check.card!!.fun_facts, v.card.funFacts)
        // The red pen: what was taken out of the original.
        assertEquals("了", v.diff.original.filter { !it.same }.joinToString("") { it.text })
        assertEquals("Missing: 的", SayBetterView.mistakeLine("", "的"))
    }

    @Test fun theTutorsCorrectionWins() {
        val m = A.ac.copy(correction = ChatCorrectionDto("我昨天去商店买了东西。", "了 goes after 买.", "t1", "x"), translation = "Yesterday I went shopping.")
        val v = assertNotNull(SayBetterView.of(m, "me", "Minghui Li", pinyinOf = { "PINYIN($it)" }))
        assertEquals(SayBetter.CORRECTED, v.state)
        assertEquals("✏️ Minghui corrected this", v.header)
        assertEquals("了 goes after 买.", v.note)
        assertEquals("我昨天去商店买了东西。", v.corrected)
        assertEquals("PINYIN(我昨天去商店买了东西。)", v.pinyin, "made on the phone")
        assertEquals("Yesterday I went shopping.", v.english, "the message translation")
        assertEquals(emptyList(), v.mistakes, "the check reached another sentence: its rows stay out")
        assertNull(v.alternative)
        assertEquals(Triple("我昨天去商店买了东西。", "Yesterday I went shopping.", "了 goes after 买."), Triple(v.card.hanzi, v.card.english, v.card.funFacts))
        // Same sentence as the check: its pinyin, English and rows are used.
        val same = assertNotNull(SayBetterView.of(A.ac.copy(correction = ChatCorrectionDto(A.CORRECTED, null, "t1", "x")), "me", null))
        assertEquals("✏️ Your tutor corrected this", same.header)
        assertEquals(A.check.corrected_english, same.english)
        assertEquals(A.check.corrected_pinyin, same.pinyin)
        assertEquals(1, same.mistakes.size)
    }

    @Test fun nothingForOthersOrStaleChecks() {
        assertNull(SayBetterView.of(A.ac, "t1", "Minghui"), "never for the other person")
        assertNull(SayBetterView.of(A.ac.copy(content = "我昨天去商店买东西了"), "me", null), "edited since: the check is stale")
        assertNull(SayBetterView.of(A.ac.copy(auto_check = A.check.copy(status = "ok")), "me", null))
        assertNull(SayBetterView.of(A.ac.copy(deleted_at = "x"), "me", null))
    }

    @Test fun menuStartsWithSayBetter() {
        val menu = A.ui.menu(A.ac)
        assertEquals(MessageMenu.SAY_BETTER, menu.items.first().id)
        assertEquals("How to say it better", menu.items.first().label)
        assertEquals(SayBetter.IMPROVABLE, A.ui.sayBetter(A.ac))
        assertNull(A.ui.sayBetter(A.m1))
        // A current check answers "Check my Chinese" already.
        assertNull(menu.items.firstOrNull { it.id == MessageMenu.CHECK })
        // The tutor's view of the same message: nothing.
        val tutorView = ChatLearningSamples.tutor.copy(messages = listOf(A.ac.copy(auto_check = null)))
        assertNull(tutorView.sayBetter(A.ac.copy(auto_check = null)))
        assertEquals(MessageMenu.REPLY, tutorView.menu(A.ac.copy(auto_check = null)).items.first().id)
    }
}
