package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package J: the shared text board CRDT reproduces shared/calls/textDoc.ts exactly (parity/fixtures/calls-text.ts). */
class CallsTextParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-text.json").readText()).jsonObject
    }

    /** Numbers compared as JS prints them (1 not 1.0). */
    private fun canon(el: JsonElement?): String = when (el) {
        null, is JsonNull -> "null"
        is JsonArray -> el.joinToString(",", "[", "]") { canon(it) }
        is JsonObject -> el.entries.sortedBy { it.key }.joinToString(",", "{", "}") { (k, v) -> "$k:${canon(v)}" }
        is JsonPrimitive -> if (el.isString) "\"${el.content}\"" else el.content.toDoubleOrNull()?.let { d -> if (d == Math.floor(d) && Math.abs(d) < 1e15) d.toLong().toString() else d.toString() } ?: el.content
    }

    private fun op(el: JsonElement): TextOp = CallTextDoc.sanitizeOp(el) ?: fail("unreadable op $el")

    private fun snap(runs: List<TextRun>): String = canon(CallTextDoc.snapshotToJson(runs)["runs"])

    @Test
    fun scriptsReplayIdentically() {
        val scripts = root["scripts"]!!.jsonArray
        assertTrue(scripts.size >= 5)
        for (sEl in scripts) {
            val s = sEl.jsonObject
            val seed = s["seed"]!!.jsonPrimitive.content
            val sites = s["sites"]!!.jsonArray.map { it.jsonPrimitive.content }
            val docs = sites.map { CallTextDoc(it) }
            val room = CallTextDoc("room")
            for ((i, stEl) in s["steps"]!!.jsonArray.withIndex()) {
                val st = stEl.jsonObject
                val label = "seed $seed step $i ${st["kind"]}"
                when (st["kind"]!!.jsonPrimitive.content) {
                    "ins" -> {
                        val d = docs[st["who"]!!.jsonPrimitive.int]
                        val got = d.localInsert(st["index"]!!.jsonPrimitive.int, st["text"]!!.jsonPrimitive.content)
                        assertEquals(canon(st["op"]), canon(got?.toJson()), "$label op")
                        assertEquals(st["after"]!!.jsonPrimitive.content, d.text(), label)
                    }
                    "del" -> {
                        val d = docs[st["who"]!!.jsonPrimitive.int]
                        val got = d.localDelete(st["index"]!!.jsonPrimitive.int, st["count"]!!.jsonPrimitive.int)
                        assertEquals(canon(st["op"]), canon(got?.toJson()), "$label op")
                        assertEquals(st["after"]!!.jsonPrimitive.content, d.text(), label)
                    }
                    "replace" -> {
                        val d = docs[st["who"]!!.jsonPrimitive.int]
                        val caret = st["caret"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.int }
                        val got = d.replaceText(st["next"]!!.jsonPrimitive.content, caret)
                        assertEquals(canon(st["ops"]), canon(JsonArray(got.map { it.toJson() })), "$label ops")
                        assertEquals(st["after"]!!.jsonPrimitive.content, d.text(), label)
                    }
                    "to_room" -> {
                        room.apply(op(st["op"]!!))
                        assertEquals(st["after"]!!.jsonPrimitive.content, room.text(), label)
                    }
                    "to_client" -> {
                        val d = docs[st["to"]!!.jsonPrimitive.int]
                        d.apply(op(st["op"]!!))
                        assertEquals(st["after"]!!.jsonPrimitive.content, d.text(), label)
                    }
                    "anchor" -> {
                        val d = docs[st["who"]!!.jsonPrimitive.int]
                        val a = d.anchorAt(st["index"]!!.jsonPrimitive.int)
                        assertEquals(canon(st["anchor"]), canon(a?.toJson()), "$label anchor")
                        assertEquals(st["back"]!!.jsonPrimitive.int, d.indexOfAnchor(a), "$label back")
                    }
                    else -> fail("unknown step $label")
                }
            }
            val snaps = s["snapshots"]!!.jsonArray
            docs.forEachIndexed { k, d ->
                assertEquals(canon(snaps[k].jsonObject["runs"]), snap(d.snapshot()), "seed $seed replica $k snapshot")
                assertEquals(s["clocks"]!!.jsonArray[k].jsonPrimitive.long, d.clock, "seed $seed replica $k clock")
            }
            assertEquals(canon(s["room"]!!.jsonObject["runs"]), snap(room.snapshot()), "seed $seed room")
            // Everyone converged, and a late joiner reads the same from the room's snapshot.
            val late = CallTextDoc("late", CallTextDoc.parseSnapshot(s["room"]))
            assertEquals(docs[0].text(), late.text(), "seed $seed late joiner")
            assertTrue(docs.all { it.text() == docs[0].text() }, "seed $seed converged")
        }
    }

    @Test
    fun diffCharsMatchesTypeScript() {
        for ((i, c) in root["diffs"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val caret = o["caret"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.int }
            val got = CallTextDoc.diffChars(o["prev"]!!.jsonArray.map { it.jsonPrimitive.content }, o["next"]!!.jsonArray.map { it.jsonPrimitive.content }, caret)
            val want = o["result"]!!.jsonObject
            assertEquals(want["index"]!!.jsonPrimitive.int, got.index, "diff $i index")
            assertEquals(want["remove"]!!.jsonPrimitive.int, got.remove, "diff $i remove")
            assertEquals(want["insert"]!!.jsonPrimitive.content, got.insert, "diff $i insert")
        }
    }

    @Test
    fun sanitizeOffsetsAndColours() {
        for ((i, c) in root["sanitize"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val site = o["site"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(canon(o["result"]), canon(CallTextDoc.sanitizeOp(o["raw"], site)?.toJson()), "sanitize $i ${o["raw"].toString().take(80)}")
        }
        for (c in root["offsets"]!!.jsonArray) {
            val o = c.jsonObject
            val t = o["text"]!!.jsonPrimitive.content
            val off = o["offset"]!!.jsonPrimitive.int
            assertEquals(o["char"]!!.jsonPrimitive.int, CallTextDoc.codeUnitToCharIndex(t, off), "char of $t@$off")
            assertEquals(o["back"]!!.jsonPrimitive.int, CallTextDoc.charToCodeUnitIndex(t, off), "back of $t@$off")
        }
        for (c in root["colors"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["color"]!!.jsonPrimitive.content, CallTextDoc.presenceColor(o["user"]!!.jsonPrimitive.content))
        }
    }
}
