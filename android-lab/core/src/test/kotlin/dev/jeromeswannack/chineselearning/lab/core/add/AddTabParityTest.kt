package dev.jeromeswannack.chineselearning.lab.core.add

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** The ＋ Add tab reproduces shared/add/add.ts (parity/fixtures/add-tab.ts). */
class AddTabParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "add-tab.json").readText()).jsonObject
    }

    private val JsonElement.str: String get() = jsonPrimitive.content
    private fun arr(key: String): JsonArray = data[key]!!.jsonArray

    private fun boxOf(e: JsonElement?): List<Double?>? =
        if (e == null || e is JsonNull || e !is JsonArray) null else e.map { it.jsonPrimitive.doubleOrNull }

    private fun lineOf(o: JsonObject): AddTab.Line =
        AddTab.Line(o["text"]!!.str, boxOf(o["box"])?.map { it ?: Double.NaN }, o["main"]?.jsonPrimitive?.booleanOrNull ?: false)

    private fun lineJson(l: AddTab.Line): String = "${l.text}|${l.box}|${l.main}"

    @Test
    fun tilesMatch() {
        val tiles = arr("tiles")
        assertEquals(tiles.size, AddTab.TILES.size)
        tiles.forEachIndexed { i, t ->
            val o = t.jsonObject
            val k = AddTab.TILES[i]
            assertEquals(o["kind"]!!.str, k.kind)
            assertEquals(o["icon"]!!.str, k.icon)
            assertEquals(o["title"]!!.str, k.title)
            assertEquals(o["subtitle"]!!.str, k.subtitle)
            assertEquals(o["placeholder"]!!.str, k.placeholder)
            assertEquals(o["submitLabel"]!!.str, k.submitLabel)
            assertEquals(o["noun"]!!.str, k.noun)
        }
        val formats = arr("formats")
        assertEquals(formats.map { it.jsonObject["format"]!!.str }, AddTab.AUDIO_FORMATS.map { it.format })
        assertEquals(formats.map { it.jsonObject["label"]!!.str }, AddTab.AUDIO_FORMATS.map { it.label })
    }

    @Test
    fun contentMatches() {
        val cases = arr("content")
        assertTrue(cases.size > 100)
        for (c in cases) {
            val o = c.jsonObject
            val kind = o["kind"]!!.str
            val format = o["format"]!!.str
            val text = o["text"]!!.str
            val case = "$kind/$format/'$text'"
            assertEquals(o["placeholder"]!!.str, AddTab.placeholder(kind, format), case)
            assertEquals(o["lang"]!!.str, AddTab.lang(kind, format), case)
            assertEquals(o["ready"]!!.jsonPrimitive.boolean, AddTab.ready(kind, text, format), case)
        }
        for (r in arr("results")) {
            val o = r.jsonObject
            assertEquals(o["line"]!!.str, AddTab.resultLine(o["kind"]!!.str, o["status"]!!.str))
        }
        for (r in arr("classify")) {
            val o = r.jsonObject
            assertEquals(o["kind"]!!.str, AddTab.classify(o["text"]!!.str), o["text"]!!.str)
        }
    }

    @Test
    fun ocrTextAndBoxesMatch() {
        for (r in arr("chinese")) {
            val o = r.jsonObject
            assertEquals(o["out"]!!.str, AddTab.chineseText(o["text"]!!.str), o["text"]!!.str)
        }
        for (r in arr("boxes")) {
            val o = r.jsonObject
            val out = o["out"]
            val expected = if (out == null || out is JsonNull) null else out.jsonArray.map { it.jsonPrimitive.double }
            val box = o["box"]
            val input: List<Double?>? = if (box == null || box is JsonNull || box !is JsonArray) null else box.map { it.jsonPrimitive.doubleOrNull }
            assertEquals(expected, AddTab.cleanBox(input), box.toString())
        }
    }

    @Test
    fun scoresAndOrderMatch() {
        val scores = arr("scores")
        assertTrue(scores.size > 100)
        for (s in scores) {
            val o = s.jsonObject
            val line = lineOf(o)
            assertEquals(o["score"]!!.jsonPrimitive.double, AddTab.score(line), 1e-9, o.toString())
        }
        for (s in arr("orders")) {
            val o = s.jsonObject
            val lines = o["lines"]!!.jsonArray.map { lineOf(it.jsonObject) }
            val expected = o["out"]!!.jsonArray.map { lineJson(lineOf(it.jsonObject)) }
            assertEquals(expected, AddTab.orderLines(lines).map(::lineJson))
            val expected3 = o["out3"]!!.jsonArray.map { lineJson(lineOf(it.jsonObject)) }
            assertEquals(expected3, AddTab.orderLines(lines, 3).map(::lineJson))
        }
    }

    @Test
    fun spansResizeAndWordsMatch() {
        for (s in arr("spans")) {
            val o = s.jsonObject
            assertEquals(o["out"]!!.str, AddTab.span(o["text"]!!.str, o["a"]!!.jsonPrimitive.int, o["b"]!!.jsonPrimitive.int), o.toString())
        }
        for (s in arr("resize")) {
            val o = s.jsonObject
            val out = o["out"]!!.jsonObject
            val (w, h) = AddTab.resizeDims(o["w"]!!.jsonPrimitive.double, o["h"]!!.jsonPrimitive.double)
            assertEquals(out["width"]!!.jsonPrimitive.int, w, o.toString())
            assertEquals(out["height"]!!.jsonPrimitive.int, h, o.toString())
        }
        for (s in arr("found")) {
            val o = s.jsonObject
            assertEquals(o["out"]!!.str, AddTab.foundLine(o["n"]!!.jsonPrimitive.int))
        }
    }
}
