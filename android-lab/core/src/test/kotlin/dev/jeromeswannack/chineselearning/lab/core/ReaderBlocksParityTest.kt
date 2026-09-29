package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Phrase blocks and the restart-point state machine reproduce shared/reader/audioBlocks.ts and
 * shared/reader/blockPlayback.ts exactly (parity/fixtures/reader-blocks.ts).
 */
class ReaderBlocksParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "reader-blocks.json").readText()).jsonObject
    }

    private fun JsonElement.blocks() = jsonArray.map { b ->
        b.jsonObject.let { AudioBlocks.Block(it["startMs"]!!.jsonPrimitive.int, it["endMs"]!!.jsonPrimitive.int) }
    }
    private fun JsonElement.doubles() = jsonArray.map { it.jsonPrimitive.double }.toDoubleArray()

    @Test
    fun rmsEnvelopeMatchesTypeScript() {
        for ((i, c) in fixture["pcm"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val samples = c["samples"]!!.jsonArray.map { it.jsonPrimitive.double.toFloat() }.toFloatArray()
            val rate = c["sampleRate"]!!.jsonPrimitive.int
            val env = AudioBlocks.rmsEnvelope(samples, samples.size, rate, c["frameMs"]!!.jsonPrimitive.int)
            assertEquals(c["envelope"]!!.doubles().toList(), env.toList(), "pcm case $i")
            assertEquals(c["durationMs"]!!.jsonPrimitive.int, AudioBlocks.clipDurationMs(samples.size.toLong(), rate), "duration $i")
        }
    }

    @Test
    fun segmentationMatchesTypeScript() {
        val cases = fixture["segments"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 100)
        var multi = 0
        for ((i, c) in cases.withIndex()) {
            val env = c["envelope"]!!.doubles()
            val duration = c["durationMs"]!!.jsonPrimitive.double
            val label = (c["name"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content) ?: "case $i"
            assertEquals(c["threshold"]!!.jsonPrimitive.double, AudioBlocks.silenceThreshold(env), "threshold $label")
            val expected = c["blocks"]!!.blocks()
            assertEquals(expected, AudioBlocks.segment(env, duration), "blocks $label")
            if (expected.size > 1) multi++
        }
        assertTrue(multi > 30, "the fixture exercises real splits ($multi)")
    }

    @Test
    fun realClipsSplitIntoPhrases() {
        val real = fixture["segments"]!!.jsonArray.map { it.jsonObject }.filter { it["name"] !is JsonNull && it["name"] != null }
        val byName = real.associate { it["name"]!!.jsonPrimitive.content to AudioBlocks.segment(it["envelope"]!!.doubles(), it["durationMs"]!!.jsonPrimitive.double).map { b -> b.startMs } }
        assertEquals(listOf(0, 3020, 5940), byName["我喜欢一边跑步，一边听音乐。"])
        assertEquals(listOf(0), byName["咱们一边吃一边聊吧"])
    }

    private fun event(o: JsonObject): BlockPlayback.Event = when (o["type"]!!.jsonPrimitive.content) {
        "play" -> BlockPlayback.Event.Play
        "tick" -> BlockPlayback.Event.Tick(o["posMs"]!!.jsonPrimitive.double)
        "pause" -> BlockPlayback.Event.Pause(o["posMs"]!!.jsonPrimitive.double)
        "ended" -> BlockPlayback.Event.Ended
        "place" -> BlockPlayback.Event.Place(o["ms"]!!.jsonPrimitive.double)
        "jump" -> BlockPlayback.Event.Jump(o["index"]!!.jsonPrimitive.int)
        "step" -> BlockPlayback.Event.Step(o["dir"]!!.jsonPrimitive.int, o["posMs"]!!.jsonPrimitive.double)
        else -> fail("unknown event $o")
    }

    private fun JsonElement.state() = jsonObject.let {
        BlockPlayback.State(
            anchorMs = it["anchorMs"]!!.jsonPrimitive.double,
            manual = it["manual"]!!.jsonPrimitive.boolean,
            playing = it["playing"]!!.jsonPrimitive.boolean,
            crossedFromMs = it["crossedFromMs"]!!.let { v -> if (v is JsonNull) null else v.jsonPrimitive.double },
        )
    }

    @Test
    fun stateMachineMatchesTypeScript() {
        var graces = 0
        for ((m, machine) in fixture["machines"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val blocks = machine["blocks"]!!.blocks()
            var state = BlockPlayback.State()
            for ((e, step) in machine["steps"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
                val ev = event(step["event"]!!.jsonObject)
                val result = BlockPlayback.reduce(state, ev, blocks)
                val expected = step["state"]!!.state()
                assertEquals(expected, result.state, "machine $m step $e ($ev)")
                assertEquals(step["seekToMs"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }, result.seekToMs, "seek $m/$e")
                assertEquals(step["active"]!!.jsonPrimitive.int, BlockPlayback.activeIndex(result.state, blocks, step["pos"]!!.jsonPrimitive.double), "active $m/$e")
                if (ev is BlockPlayback.Event.Pause && state.crossedFromMs != null && result.state.anchorMs < state.anchorMs) graces++
                state = result.state
            }
        }
        assertTrue(graces > 0, "the fixture exercises the pause grace")
    }
}
