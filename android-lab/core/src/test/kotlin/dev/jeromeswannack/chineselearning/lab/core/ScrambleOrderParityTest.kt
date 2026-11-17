package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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

/** Rearranging a word order by hand (shared/lesson/scrambleOrder.ts): rows, drop slot, zone, preview / drop, edits. */
class ScrambleOrderParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "scramble-order.json").readText()).jsonObject
    }

    private fun rect(e: JsonElement): ScrambleOrder.Rect? {
        if (e is JsonNull) return null
        val o = e.jsonObject
        return ScrambleOrder.Rect(o["left"]!!.jsonPrimitive.double, o["top"]!!.jsonPrimitive.double, o["width"]!!.jsonPrimitive.double, o["height"]!!.jsonPrimitive.double)
    }
    private fun ints(e: JsonElement) = e.jsonArray.map { it.jsonPrimitive.int }
    private fun d(e: JsonElement) = e.jsonPrimitive.double
    private fun zone(key: String) = ScrambleOrder.Zone.entries.first { it.key == key }

    @Test
    fun dropSlotOverWrappedRowsMatchesTypeScript() {
        val cases = fixture()["slots"]!!.jsonArray
        assertTrue(cases.size >= 300)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val rects = o["rects"]!!.jsonArray.map { rect(it)!! }
            val rows = o["rows"]!!.jsonArray.map { val p = ints(it); p[0] to p[1] }
            assertEquals(rows, ScrambleOrder.rows(rects), "slots[$i] rows")
            assertEquals(o["slot"]!!.jsonPrimitive.int, ScrambleOrder.dropSlot(rects, d(o["x"]!!), d(o["y"]!!)), "slots[$i] slot")
        }
    }

    @Test
    fun zoneMatchesTypeScript() {
        for ((i, c) in fixture()["zones"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val slack = o["slack"]!!
            val got = if (slack is JsonNull) ScrambleOrder.zone(rect(o["answer"]!!), rect(o["pool"]!!), d(o["x"]!!), d(o["y"]!!))
            else ScrambleOrder.zone(rect(o["answer"]!!), rect(o["pool"]!!), d(o["x"]!!), d(o["y"]!!), d(slack))
            assertEquals(o["zone"]!!.jsonPrimitive.content, got.key, "zones[$i]")
        }
    }

    @Test
    fun dragPreviewAndDropMatchTypeScript() {
        for ((i, c) in fixture()["drags"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val order = ints(o["order"]!!)
            val dj = o["drag"]!!.jsonObject
            val drag = if (dj["from"]!!.jsonPrimitive.content == "answer") ScrambleOrder.Drag.FromAnswer(dj["index"]!!.jsonPrimitive.int)
            else ScrambleOrder.Drag.FromPool(dj["tile"]!!.jsonPrimitive.int)
            val z = zone(o["zone"]!!.jsonPrimitive.content)
            val slot = o["slot"]!!.jsonPrimitive.int
            val preview = o["preview"]!!
            if (preview !is JsonNull) assertEquals(ints(preview), ScrambleOrder.preview(order, drag, z, slot), "drags[$i] preview")
            val drop = o["drop"]!!.jsonObject
            val got = ScrambleOrder.drop(order, drag, z, slot)
            assertEquals(ints(drop["order"]!!), got.order, "drags[$i] drop order")
            assertEquals(drop["change"]!!.jsonPrimitive.content, got.change, "drags[$i] change")
        }
    }

    @Test
    fun editsMatchTypeScript() {
        for ((i, c) in fixture()["edits"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val order = ints(o["order"]!!)
            val at = o["at"]!!.jsonPrimitive.int
            assertEquals(ints(o["insert"]!!), ScrambleOrder.insertAt(order, o["tile"]!!.jsonPrimitive.int, at), "edits[$i] insert")
            assertEquals(ints(o["remove"]!!), ScrambleOrder.removeAt(order, at), "edits[$i] remove")
            assertEquals(ints(o["move"]!!), ScrambleOrder.moveTo(order, at, o["to"]!!.jsonPrimitive.int), "edits[$i] move")
            assertEquals(ints(o["nudge"]!!), ScrambleOrder.nudge(order, at, o["dir"]!!.jsonPrimitive.int), "edits[$i] nudge")
        }
    }

    @Test
    fun wordsMatchTypeScript() {
        for (c in fixture()["words"]!!.jsonArray) {
            val o = c.jsonObject
            val text = o["text"]!!.jsonPrimitive.content
            val index = o["index"]!!.jsonPrimitive.int
            val count = o["count"]!!.jsonPrimitive.int
            assertEquals(o["label"]!!.jsonPrimitive.content, ScrambleOrder.tileLabel(text, index, count))
            assertEquals(o["moved"]!!.jsonPrimitive.content, ScrambleOrder.movedAnnouncement(text, index, count))
        }
    }
}
