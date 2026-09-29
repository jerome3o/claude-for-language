package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.builtins.ListSerializer
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
 * Picture hunt answers, hints, feedback and hit-testing reproduce shared/picture-hunt exactly
 * (parity/fixtures/picture-hunt.ts): the same verdict for every typed answer, the same
 * normalised forms, the same object under every tap. Doubles are compared exactly.
 */
class PictureHuntParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "picture-hunt.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun strs(e: JsonElement) = e.jsonArray.map { it.jsonPrimitive.content }
    private fun objects(e: JsonElement): List<HuntObject> = json.decodeFromJsonElement(ListSerializer(HuntObject.serializer()), e)

    private fun matchJson(m: HuntMatch): Map<String, String> = when (m) {
        is HuntMatch.Found -> mapOf("kind" to "found", "objectId" to m.objectId, "via" to m.via, "typed" to m.typed)
        is HuntMatch.Already -> mapOf("kind" to "already", "objectId" to m.objectId)
        is HuntMatch.Close -> mapOf("kind" to "close", "objectId" to m.objectId, "reason" to m.reason, "shared" to m.shared)
        HuntMatch.Empty -> mapOf("kind" to "empty")
        HuntMatch.None -> mapOf("kind" to "none")
    }

    @Test
    fun constants() {
        assertEquals(data["default_seconds"]!!.jsonPrimitive.int, PICTURE_HUNT_DEFAULT_SECONDS)
    }

    @Test
    fun everyAnswerGetsTheSameVerdictAndFeedback() {
        val sets = data["sets"]!!.jsonArray.map(::objects)
        val cases = data["matches"]!!.jsonArray
        assertTrue(cases.size > 1000, "expected many match cases, got ${cases.size}")
        for (c in cases) {
            val o = c.jsonObject
            val objects = sets[o["set"]!!.jsonPrimitive.int]
            val input = o["input"]!!.str!!
            val found = strs(o["found"]!!)
            val m = PictureHuntMatch.match(input, objects, found)
            val expected = o["match"]!!.jsonObject.mapValues { it.value.str!! }
            assertEquals(expected, matchJson(m), "match(${input.codePoints().toArray().joinToString { "U+%04X".format(it) }} \"$input\", found=$found)")
            val fb = o["feedback"]!!
            val actual = PictureHuntFeedback.of(m, objects)
            if (fb is JsonNull) assertEquals(null, actual, "feedback for \"$input\"")
            else assertEquals(HuntFeedback(fb.jsonObject["tone"]!!.str!!, fb.jsonObject["text"]!!.str!!), actual, "feedback for \"$input\"")
        }
    }

    @Test
    fun normalisationMatches() {
        for (e in data["strings"]!!.jsonArray) {
            val o = e.jsonObject
            val s = o["s"]!!.str!!
            assertEquals(o["strip"]!!.str, PictureHuntMatch.stripAnswer(s), "stripAnswer(\"$s\")")
            assertEquals(o["norm"]!!.str, PictureHuntMatch.normalizeHanziAnswer(s), "normalizeHanziAnswer(\"$s\")")
            assertEquals(o["simp"]!!.str, PictureHuntMatch.toSimplified(s), "toSimplified(\"$s\")")
            assertEquals(o["hanzi"]!!.jsonPrimitive.boolean, PictureHuntMatch.hasHanzi(s), "hasHanzi(\"$s\")")
            val k = o["key"]!!.jsonObject
            assertEquals(
                PinyinKey(k["letters"]!!.str!!, k["tones"]!!.str!!, k["hasTones"]!!.jsonPrimitive.boolean),
                PictureHuntMatch.pinyinKey(s),
                "pinyinKey(\"$s\")",
            )
        }
    }

    /**
     * Every BMP code point through stripAnswer / toSimplified / hasHanzi. V8 (Node) ships a
     * newer Unicode than the JVM: a code point the JVM doesn't know yet (unassigned there) is
     * excused — they are all recent, exotic additions. Anything else must match.
     */
    @Test
    fun wholeBmpNormalisesLikeV8() {
        val changed = HashMap<Int, List<JsonElement>>()
        for (e in data["bmp"]!!.jsonArray) {
            val row = e.jsonArray
            changed[row[0].jsonPrimitive.int] = row
        }
        val excused = ArrayList<String>()
        for (cp in 0 until 0x10000) {
            if (cp in 0xD800..0xDFFF) continue
            val ch = String(Character.toChars(cp))
            val row = changed[cp]
            val strip = row?.get(1)?.str ?: ch
            val simp = row?.get(2)?.str ?: ch
            val han = row?.get(3)?.jsonPrimitive?.boolean ?: false
            assertEquals(simp, PictureHuntMatch.toSimplified(ch), "toSimplified U+%04X".format(cp))
            assertEquals(han, PictureHuntMatch.hasHanzi(ch), "hasHanzi U+%04X".format(cp))
            val actual = PictureHuntMatch.stripAnswer(ch)
            if (actual != strip) {
                if (unknownToJvm(ch) || unknownToJvm(strip)) excused += "U+%04X".format(cp)
                else fail("stripAnswer(U+%04X \"%s\"): V8 \"%s\", JVM \"%s\"".format(cp, ch, strip, actual))
            }
        }
        if (excused.isNotEmpty()) println("PictureHuntParityTest: newer-Unicode code points excused: $excused")
        assertTrue(excused.size < 100, "too many Unicode-version differences: $excused")
    }

    private fun unknownToJvm(s: String): Boolean = s.codePoints().anyMatch { Character.getType(it) == Character.UNASSIGNED.toInt() }

    @Test
    fun hintsMatch() {
        for (e in data["hints"]!!.jsonArray) {
            val o = e.jsonObject
            val objects = objects(o["objects"]!!)
            val given = o["given"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
            assertEquals(o["target"]!!.str, PictureHuntMatch.pickHintTarget(objects, strs(o["found"]!!), given)?.id)
            assertEquals(o["areas"]!!.jsonArray.map { it.jsonPrimitive.double }, objects.map(PictureHuntMatch::objectArea))
        }
        val kitchen = objects(data["sets"]!!.jsonArray[0])
        for (e in data["hint_texts"]!!.jsonArray) {
            val o = e.jsonObject
            val obj = kitchen.first { it.id == o["id"]!!.str }
            assertEquals(o["text"]!!.str, PictureHuntMatch.hintText(obj, o["level"]!!.jsonPrimitive.int))
        }
    }

    @Test
    fun geometryMatches() {
        for (scene in data["scenes"]!!.jsonArray) {
            val s = scene.jsonObject
            val objects = objects(s["objects"]!!)
            for (p in s["probes"]!!.jsonArray) {
                val o = p.jsonObject
                val x = o["x"]!!.jsonPrimitive.double
                val y = o["y"]!!.jsonPrimitive.double
                val slop = o["slop"]!!.jsonPrimitive.double
                assertEquals(o["at"]!!.str, PictureHuntGeometry.objectAt(objects, x, y, slop)?.id, "objectAt($x, $y, $slop)")
                val contains = o["contains"]!!.jsonArray.map { r -> r.jsonArray.map { it.jsonPrimitive.boolean } }
                assertEquals(contains, objects.map { ob -> ob.regions.map { PictureHuntGeometry.regionContains(it, x, y) } })
                val inPoly = o["inPoly"]!!.jsonArray.map { r -> r.jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.boolean } }
                assertEquals(inPoly, objects.map { ob -> ob.regions.map { r -> r.polygon?.let { PictureHuntGeometry.pointInPolygon(x, y, it) } } })
            }
            val anchors = s["anchors"]!!.jsonArray.map { r ->
                r.jsonArray.map { a -> a.jsonObject.let { LabelAnchor(it["x"]!!.jsonPrimitive.double, it["y"]!!.jsonPrimitive.double, it["above"]!!.jsonPrimitive.boolean) } }
            }
            assertEquals(anchors, objects.map { ob -> ob.regions.map(PictureHuntGeometry::labelAnchor) })
        }
        for (h in data["hypots"]!!.jsonArray) {
            val (dx, dy, d) = h.jsonArray.map { it.jsonPrimitive.double }
            assertEquals(d, StrokeGeometry.hypot(dx, dy), "hypot($dx, $dy)")
        }
    }

}
