package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** "Example sentence style" — SentenceStyle.kt must match shared/study/sentenceStyle.ts (parity/fixtures/sentence-style.ts). */
class SentenceStyleParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "sentence-style.json").readText()).jsonObject
    }

    @Test fun constants() {
        assertEquals(fixture["styles"]!!.jsonArray.map { it.jsonPrimitive.content }, SentenceStyle.STYLES)
        assertEquals(fixture["default"]!!.jsonPrimitive.content, SentenceStyle.DEFAULT)
        assertEquals(fixture["note"]!!.jsonPrimitive.content, SentenceStyle.NOTE)
        for (c in fixture["copy"]!!.jsonArray.map { it.jsonObject }) {
            val style = c["style"]!!.jsonPrimitive.content
            assertEquals(c["label"]!!.jsonPrimitive.content, SentenceStyle.label(style), "label $style")
            assertEquals(c["description"]!!.jsonPrimitive.content, SentenceStyle.description(style), "description $style")
        }
    }

    @Test fun readsAStoredValue() {
        for (r in fixture["read"]!!.jsonArray.map { it.jsonObject }) {
            val v = r["v"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(r["is"]!!.jsonPrimitive.boolean, SentenceStyle.isStyle(v), "is $v")
            assertEquals(r["style"]!!.jsonPrimitive.content, SentenceStyle.of(v), "of $v")
        }
    }
}
