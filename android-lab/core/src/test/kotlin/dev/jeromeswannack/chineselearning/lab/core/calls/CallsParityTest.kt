package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** Package J: whiteboard ops + transcript helpers reproduce shared/calls exactly (parity/fixtures/calls.ts). */
class CallsParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls.json").readText()).jsonObject
    }

    /** An op as comparable strings, numbers in JS formatting. */
    private fun canon(el: JsonElement): String = when (el) {
        is JsonNull -> "null"
        is JsonArray -> el.joinToString(",", "[", "]") { canon(it) }
        is JsonObject -> el.entries.sortedBy { it.key }.joinToString(",", "{", "}") { (k, v) -> "$k:${canon(v)}" }
        is JsonPrimitive -> if (el.isString) "\"${el.content}\"" else el.content.toDoubleOrNull()?.let { Js.numberToString(it) } ?: el.content
    }

    @Test
    fun sanitizeMatchesTypeScript() {
        val cases = root["sanitize"]!!.jsonArray
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val actual = CallBoard.sanitize(o["raw"], o["by"]!!.jsonPrimitive.content)?.toJson() ?: JsonNull
            assertEquals(canon(o["result"]!!), canon(actual), "sanitize case $i: ${o["raw"].toString().take(200)}")
        }
    }

    @Test
    fun applyAndUndoMatchTypeScript() {
        for ((s, seq) in root["sequences"]!!.jsonArray.withIndex()) {
            val o = seq.jsonObject
            val ops = o["ops"]!!.jsonArray.map { CallBoard.parse(it) ?: fail("seq $s: op unreadable $it") }
            val steps = o["steps"]!!.jsonArray.map { it.jsonObject }
            var items = emptyList<BoardItem>()
            val finalOnly = steps.size == 1 && steps[0]["final"] != null
            for ((k, op) in ops.withIndex()) {
                items = CallBoard.apply(items, op)
                if (finalOnly && k < ops.size - 1) continue
                val step = if (finalOnly) steps[0] else steps[k]
                assertEquals(step["ids"]!!.jsonArray.map { it.jsonPrimitive.content }, items.map { it.id }, "seq $s step $k ids")
                assertEquals(step["last_u1"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }, CallBoard.lastItemBy(items, "u1"), "seq $s step $k u1")
                assertEquals(step["last_u2"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }, CallBoard.lastItemBy(items, "u2"), "seq $s step $k u2")
            }
        }
    }

    @Test
    fun formatOffsetMatchesTypeScript() {
        for (c in root["formatted"]!!.jsonArray) {
            val o = c.jsonObject
            val ms = o["ms"]!!.jsonPrimitive.double
            // The app only formats integer ms; fractional inputs floor the same way.
            assertEquals(o["text"]!!.jsonPrimitive.content, CallTranscript.formatOffset(Math.floor(ms).toLong()), "formatOffset($ms)")
        }
    }

    private data class Seg(override val id: String, override val userId: String, override val startMs: Long, override val endMs: Long) : CallTranscript.Segment

    @Test
    fun mergeAndTurnsMatchTypeScript() {
        for ((i, c) in root["transcripts"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val segs = o["segments"]!!.jsonArray.map { s ->
                val so = s.jsonObject
                Seg(so["id"]!!.jsonPrimitive.content, so["user_id"]!!.jsonPrimitive.content, so["start_ms"]!!.jsonPrimitive.long, so["end_ms"]!!.jsonPrimitive.long)
            }
            val merged = CallTranscript.merge(segs)
            assertEquals(o["merged"]!!.jsonArray.map { it.jsonPrimitive.content }, merged.map { "${it.id}@${it.startMs}-${it.endMs}:${it.userId}" }, "merge $i")
            val gap = o["gap"]!!.jsonPrimitive.long
            assertEquals(o["turns"]!!.jsonArray.map { it.jsonPrimitive.int }, CallTranscript.groupTurns(merged, gap).map { it.size }, "turns $i")
        }
    }
}
