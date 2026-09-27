package dev.jeromeswannack.chineselearning.lab.ui.strokes

import dev.jeromeswannack.chineselearning.lab.core.HintLevel
import dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz
import dev.jeromeswannack.chineselearning.lab.core.WritingExerciseResult
import dev.jeromeswannack.chineselearning.lab.core.WritingGrade
import dev.jeromeswannack.chineselearning.lab.core.WritingMode
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The writing run's orchestration (quiz rules themselves are parity-tested in core). */
@OptIn(ExperimentalCoroutinesApi::class)
class WritingControllerTest {
    private val data = listOf("你", "好", "十").associateWith { TestStrokes.data(it) }
    private var t = 1_790_000_000_000L
    private val clock = { t }

    private class RecordingFx : WritingFx {
        val events = mutableListOf<String>()
        override fun strokeCorrect(index: Int) { events += "stroke$index" }
        override fun miss() { events += "miss" }
        override fun characterDone(perfect: Boolean) { events += if (perfect) "perfect" else "done" }
    }

    private fun controller(scope: TestScope, text: String, mode: WritingMode, fx: WritingFx = WritingFx.None, onComplete: (WritingExerciseResult) -> Unit = {}) =
        WritingController(text, StrokeQuiz.writableCharacters(text), data, emptyList(), mode, autoDemo = true, scope = scope, fx = fx, onComplete = onComplete, clock = clock)

    private fun writeAll(c: WritingController) {
        c.charData.medians.forEach { m ->
            t += 700
            assertEquals(InkOutcome.Accept, c.onStroke(TestStrokes.draw(m)))
        }
    }

    @Test
    fun traceRunPlaysDemoThenWritesTheWordToASummary() = with(TestScope()) {
        var result: WritingExerciseResult? = null
        val fx = RecordingFx()
        val c = controller(this, "你好", WritingMode.TRACE, fx) { result = it }
        assertNotNull(c.demoKey, "trace mode starts with the stroke-order demo")
        assertEquals("Watch the stroke order — or just start writing", c.progressText)
        c.onPenDown()
        assertNull(c.demoKey, "writing cancels the demo")
        assertEquals("Stroke 1 of 7 · character 1 of 2", c.progressText)

        writeAll(c)
        assertEquals(WritingGrade.PERFECT, c.celebrate)
        assertEquals("完美！Perfect", c.status.text)
        assertFalse(c.summary)
        advanceUntilIdle() // the 1.1 s pause, then the next character
        assertEquals(1, c.charIdx)
        assertNotNull(c.demoKey, "each character in trace mode gets its demo")
        writeAll(c)
        advanceUntilIdle()

        assertTrue(c.summary)
        val r = assertNotNull(result)
        assertEquals("你好", r.text)
        assertEquals(WritingMode.TRACE, r.mode)
        assertEquals(WritingGrade.PERFECT, r.grade)
        assertEquals(listOf("你", "好"), r.characters.map { it.character })
        assertFalse(StrokeQuiz.writtenFromMemory(r), "a traced word never counts as written from memory")
        assertEquals(listOf("stroke0", "stroke1", "stroke2", "stroke3", "stroke4", "stroke5", "stroke6", "perfect"), fx.events.take(8))
    }

    @Test
    fun recallRunCountsAsWrittenFromMemory() = with(TestScope()) {
        var result: WritingExerciseResult? = null
        val c = controller(this, "十", WritingMode.RECALL) { result = it }
        assertNull(c.demoKey, "no demo from memory")
        writeAll(c)
        advanceUntilIdle()
        assertTrue(StrokeQuiz.writtenFromMemory(assertNotNull(result)))
    }

    @Test
    fun mistakesExplainThemselvesAndHelpEscalates() = with(TestScope()) {
        val fx = RecordingFx()
        val c = controller(this, "十", WritingMode.RECALL, fx)
        val (horizontal, vertical) = c.charData.medians
        // Vertical first: that's stroke 2.
        assertEquals(InkOutcome.Reject, c.onStroke(TestStrokes.draw(vertical)))
        assertEquals("That's stroke 2 — stroke 1 comes first.", c.status.text)
        assertEquals(StatusTone.Bad, c.status.tone)
        // Backwards horizontal: second miss → the start dot.
        assertEquals(InkOutcome.Reject, c.onStroke(TestStrokes.draw(horizontal, reverse = true)))
        assertEquals("Right stroke, other direction — start from the dot.", c.status.text)
        assertEquals(HintLevel.START, c.hint)
        assertEquals(StatusTone.Hint, c.status.tone)
        // A tap is not a mistake.
        assertEquals(InkOutcome.Ignore, c.onStroke(listOf(dev.jeromeswannack.chineselearning.lab.core.StrokePoint(500.0, 400.0), dev.jeromeswannack.chineselearning.lab.core.StrokePoint(503.0, 401.0))))
        assertEquals(2, c.quiz.pending.misses)
        // Third miss paints the stroke.
        c.onStroke(TestStrokes.draw(vertical))
        assertEquals(HintLevel.STROKE, c.hint)
        assertEquals(listOf("miss", "miss", "miss"), fx.events)
        // Right now → accepted, but counted as hinted.
        assertEquals(InkOutcome.Accept, c.onStroke(TestStrokes.draw(horizontal)))
        assertTrue(c.quiz.done[0].hinted)
    }

    @Test
    fun fiveMissesRevealTheStrokeAndMoveOn() = with(TestScope()) {
        val c = controller(this, "十", WritingMode.RECALL)
        val vertical = c.charData.medians[1]
        repeat(4) { c.onStroke(TestStrokes.draw(vertical)) }
        assertEquals(0, c.quiz.current)
        assertEquals(InkOutcome.Reject, c.onStroke(TestStrokes.draw(vertical)))
        assertEquals(1, c.quiz.current)
        assertEquals(0, c.justCompleted)
        assertTrue(c.quiz.done[0].revealed)
        assertEquals("That's how stroke 1 goes — on to the next.", c.status.text)
    }

    @Test
    fun hintRestartAndModeSwitch() = with(TestScope()) {
        val c = controller(this, "你好", WritingMode.RECALL)
        c.requestHint()
        assertEquals(HintLevel.STROKE, c.hint)
        assertEquals("Follow the blue stroke — start at the dot.", c.status.text)
        c.onStroke(TestStrokes.draw(c.charData.medians[0]))
        c.restartChar()
        assertEquals(0, c.quiz.current)
        assertEquals(HintLevel.NONE, c.hint)
        c.switchMode(WritingMode.TRACE)
        assertEquals(WritingMode.TRACE, c.mode)
        assertNotNull(c.demoKey)
        val runKey = c.runKey
        c.watch()
        assertNotNull(c.demoKey)
        c.onDemoEnd()
        assertNull(c.demoKey)
        assertEquals(runKey, c.runKey)
    }
}
