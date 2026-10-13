package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.cards.NoteImage
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
import kotlin.test.fail

/**
 * Pictures on cards must follow the web's rules exactly (shared/cards/note-image.ts →
 * parity/fixtures/note-image.ts → note-image.json): which side shows the picture, the deck
 * estimate and progress copy, a note's picture state.
 */
class NoteImageParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "note-image.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    @Test
    fun whereThePictureShows() {
        for (c in fixture["show"]!!.jsonArray.map { it.jsonObject }) {
            val got = NoteImage.show(c["cardType"]!!.jsonPrimitive.content, c["side"]!!.jsonPrimitive.content == "front", c["enabled"]!!.jsonPrimitive.boolean, str(c["key"]))
            assertEquals(c["show"]!!.jsonPrimitive.boolean, got, "show $c")
        }
        for (c in fixture["sides"]!!.jsonArray.map { it.jsonObject }) {
            val s = NoteImage.sides(c["cardType"]!!.jsonPrimitive.content)
            assertEquals(c["front"]!!.jsonPrimitive.boolean, s.front, "front $c")
            assertEquals(c["back"]!!.jsonPrimitive.boolean, s.back, "back $c")
        }
    }

    @Test
    fun estimatesAndLabels() {
        for (c in fixture["estimates"]!!.jsonArray.map { it.jsonObject }) {
            val e = NoteImage.estimate(c["n"]!!.jsonPrimitive.double)
            assertEquals(c["pictures"]!!.jsonPrimitive.int, e.pictures, "pictures $c")
            assertEquals(c["usd"]!!.jsonPrimitive.double, e.usd, "usd $c")
            assertEquals(c["label"]!!.jsonPrimitive.content, e.label, "label $c")
        }
        for (c in fixture["labels"]!!.jsonArray.map { it.jsonObject }) {
            val got = NoteImage.progressLabel(c["total"]!!.jsonPrimitive.int, c["withImage"]!!.jsonPrimitive.int, c["pending"]!!.jsonPrimitive.int, c["failed"]!!.jsonPrimitive.int)
            assertEquals(c["label"]!!.jsonPrimitive.content, got, "label $c")
        }
        for (c in fixture["states"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["state"]!!.jsonPrimitive.content, NoteImage.state(str(c["key"]), str(c["status"])), "state $c")
        }
    }
}
