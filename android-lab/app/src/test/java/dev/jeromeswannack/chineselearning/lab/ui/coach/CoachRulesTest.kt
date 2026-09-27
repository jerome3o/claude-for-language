package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.CoachAnalysisDto
import kotlinx.coroutines.runBlocking
import org.junit.Test
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CoachRulesTest {
    @Test
    fun detectsChineseLikeTheWeb() {
        assertTrue(CoachRules.containsChinese("我昨天去了商店"))
        assertTrue(CoachRules.containsChinese("what does 把 mean"), "mixed input counts as Chinese")
        assertTrue(CoachRules.containsChinese("㐀"))
        assertFalse(CoachRules.containsChinese("How do I say I'm running late?"))
        assertFalse(CoachRules.containsChinese("nǐ hǎo"))
    }

    @Test
    fun retriesOnceOnlyForRetryableFailures() = runBlocking<Unit> {
        var calls = 0
        assertEquals("ok", CoachRules.retryOnce(0) { if (++calls == 1) throw IOException("drop") else "ok" })
        assertEquals(2, calls)

        calls = 0
        assertFailsWith<HttpException> { CoachRules.retryOnce(0) { calls++; throw HttpException(502, "declined", """{"error":"Claude declined"}""") } }
        assertEquals(1, calls, "502 = Claude declined: not retried")

        calls = 0
        assertFailsWith<HttpException> { CoachRules.retryOnce(0) { calls++; throw HttpException(503, "busy") } }
        assertEquals(2, calls, "a busy server gets exactly one more try")

        calls = 0
        assertFailsWith<HttpException> { CoachRules.retryOnce(0) { calls++; throw HttpException(400, "bad") } }
        assertEquals(1, calls)
    }

    @Test
    fun errorTextSaysWhatWentWrong() {
        assertEquals(
            "You're offline — the coach needs a connection. Your text is kept; try again when you're back online.",
            CoachRules.errorText(IOException(), "Couldn't reach the coach", online = false),
        )
        assertEquals("Couldn't reach the coach — the connection dropped. Try again.", CoachRules.errorText(IOException(), "Couldn't reach the coach", online = true))
        assertEquals("Claude declined that one", CoachRules.errorText(HttpException(502, "x", """{"error":"Claude declined that one"}"""), "Couldn't send that", true))
        assertEquals("Couldn't send that — something went wrong on our side. Try again.", CoachRules.errorText(HttpException(500, "x", ""), "Couldn't send that", true))
    }

    @Test
    fun quickActionsPutTheCardInTheChosenDeck() {
        val deck = CoachDeck("d1", "HSK 3")
        val msg = COACH_QUICK_ACTIONS.first { it.key == "card-word" }.message("我打算学中文。", deck)
        assertTrue(msg.startsWith("Make a flashcard for the key word or phrase in \"我打算学中文。\""))
        assertTrue(msg.contains("Put it in my deck \"HSK 3\" (deck_id d1)."))
        assertEquals(listOf("card-word", "card-sentence", "examples", "alternatives", "grammar"), COACH_QUICK_ACTIONS.map { it.key })
    }

    @Test
    fun parsesAnalysesAndToolResults() {
        val zh = CoachAnalysisDto.parse(CoachSamples.ANALYSIS_ZH)!!
        assertEquals("我昨天去商店买了苹果。", zh.sentence)
        assertEquals("I went to buy tea yesterday.", CoachAnalysisDto.parse(CoachSamples.ANALYSIS_EN)!!.translation!!.primary.english)
        assertEquals("我昨天去买茶了。", CoachAnalysisDto.parse(CoachSamples.ANALYSIS_EN)!!.sentence)
        assertNull(CoachAnalysisDto.parse("not json"))
        assertNull(CoachAnalysisDto.parse("""{"kind":"other"}"""))
        assertEquals(2, CoachAnalysisDto.toolResults(CoachSamples.TOOLS).size)
        assertEquals(emptyList(), CoachAnalysisDto.toolResults("oops"))
    }
}
