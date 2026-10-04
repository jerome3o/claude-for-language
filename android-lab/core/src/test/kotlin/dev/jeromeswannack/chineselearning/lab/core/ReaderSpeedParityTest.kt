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
 * The reader's playback speed and the scrubber at 0.75× / 0.5× reproduce shared/reader/speed.ts
 * and shared/reader/blockPlayback.ts exactly (parity/fixtures/reader-speed.ts).
 */
class ReaderSpeedParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "reader-speed.json").readText()).jsonObject
    }

    @Test
    fun storedValuesParseLikeTypeScript() {
        val cases = fixture["parse"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 20)
        for (c in cases) {
            val raw = c["raw"]!!
            val input: Any? = when {
                raw is JsonNull -> null
                raw.jsonPrimitive.isString -> raw.jsonPrimitive.content
                else -> raw.jsonPrimitive.double
            }
            assertEquals(c["speed"]!!.jsonPrimitive.double, ReaderSpeed.parse(input), "parse $raw")
        }
    }

    @Test
    fun cycleLabelsAndGraceMatchTypeScript() {
        for (c in fixture["speeds"]!!.jsonArray.map { it.jsonObject }) {
            val s = c["speed"]!!.jsonPrimitive.double
            assertEquals(c["next"]!!.jsonPrimitive.double, ReaderSpeed.next(s), "next $s")
            assertEquals(c["label"]!!.jsonPrimitive.content, ReaderSpeed.label(s), "label $s")
            assertEquals(c["grace"]!!.jsonPrimitive.double, ReaderSpeed.blockGraceMsAt(s), "grace $s")
        }
        assertEquals(listOf(1.0, 0.75, 0.5), ReaderSpeed.SPEEDS)
    }

    private fun JsonElement.blocks() = jsonArray.map { b ->
        b.jsonObject.let { AudioBlocks.Block(it["startMs"]!!.jsonPrimitive.int, it["endMs"]!!.jsonPrimitive.int) }
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
    fun scrubberAtEachSpeedMatchesTypeScript() {
        val slowGraces = mutableMapOf<Double, Int>()
        for ((m, machine) in fixture["machines"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val speed = machine["speed"]!!.jsonPrimitive.double
            val grace = ReaderSpeed.blockGraceMsAt(speed)
            val blocks = machine["blocks"]!!.blocks()
            var state = BlockPlayback.State()
            for ((e, step) in machine["steps"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
                val ev = event(step["event"]!!.jsonObject)
                val result = BlockPlayback.reduce(state, ev, blocks, grace)
                assertEquals(step["state"]!!.state(), result.state, "machine $m @${speed}x step $e ($ev)")
                assertEquals(step["seekToMs"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }, result.seekToMs, "seek $m/$e")
                assertEquals(step["active"]!!.jsonPrimitive.int, BlockPlayback.activeIndex(result.state, blocks, step["pos"]!!.jsonPrimitive.double), "active $m/$e")
                if (ev is BlockPlayback.Event.Pause && state.crossedFromMs != null && result.state.anchorMs < state.anchorMs) {
                    slowGraces[speed] = (slowGraces[speed] ?: 0) + 1
                }
                state = result.state
            }
        }
        for (s in ReaderSpeed.SPEEDS) assertTrue((slowGraces[s] ?: 0) > 0, "the fixture exercises the grace at ${s}× ($slowGraces)")
    }
}
