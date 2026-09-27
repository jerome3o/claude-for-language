package dev.jeromeswannack.chineselearning.lab.ui.study

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** Port of frontend/src/services/multipleChoice.ts, against the same cases as multipleChoice.test.ts. */
class MultipleChoiceTest {
    private val raw = """[{"correct":"打","options":["打","找","扛","灯"]},{"correct":"算","options":["算","笔","篮","蒜"]},{"correct":"。","options":["。"]}]"""

    @Test fun parse() {
        val rows = MultipleChoice.parse(raw)!!
        assertEquals(3, rows.size)
        assertEquals("打", rows[0].correct)
        assertNull(MultipleChoice.parse(null))
        assertNull(MultipleChoice.parse(""))
        assertNull(MultipleChoice.parse("not json"))
        assertNull(MultipleChoice.parse("[]"))
        assertNull(MultipleChoice.parse("""{"correct":"打"}"""))
        // Malformed rows are dropped, good ones kept.
        assertEquals(1, MultipleChoice.parse("""[{"correct":1,"options":[]},{"correct":"打","options":["打"]}]""")!!.size)
    }

    @Test fun shuffleKeepsEveryOption() {
        val rows = MultipleChoice.parse(raw)!!
        val shuffled = MultipleChoice.shuffle(rows, Random(7))
        rows.zip(shuffled).forEach { (a, b) ->
            assertEquals(a.correct, b.correct)
            assertEquals(a.options.sorted(), b.options.sorted())
        }
    }

    @Test fun englishAndPunctuationArePreselected() {
        assertTrue(MultipleChoice.isEnglishEntry("OK"))
        assertFalse(MultipleChoice.isEnglishEntry("OK吗"))
        assertFalse(MultipleChoice.isEnglishEntry("打"))
        val rows = MultipleChoice.parse(raw)!! + MultipleChoice.Row("KTV", listOf("KTV", "卡"))
        assertEquals(listOf(null, null, "。", "KTV"), MultipleChoice.initialSelections(rows))
    }

    @Test fun loadRules() = runBlocking {
        var calls = 0
        val cached = MultipleChoice.load(raw, online = false) { calls++; null }
        assertTrue(cached is MultipleChoice.Load.Ready && !cached.generated)
        assertEquals(MultipleChoice.Load.Fallen(MultipleChoice.Fallback.OFFLINE), MultipleChoice.load(null, online = false) { calls++; raw })
        assertEquals(0, calls)
        val fresh = MultipleChoice.load(null, online = true) { raw }
        assertTrue(fresh is MultipleChoice.Load.Ready && fresh.generated)
        assertEquals(MultipleChoice.Load.Fallen(MultipleChoice.Fallback.EMPTY), MultipleChoice.load(null, true) { "[]" })
        assertEquals(MultipleChoice.Load.Fallen(MultipleChoice.Fallback.ERROR), MultipleChoice.load(null, true) { error("boom") })
        assertEquals(MultipleChoice.Load.Fallen(MultipleChoice.Fallback.TIMEOUT), MultipleChoice.load(null, true, timeoutMs = 50) { delay(1_000); raw })
        assertEquals("Options took too long — type your answer instead.", MultipleChoice.Fallback.TIMEOUT.message)
    }
}
