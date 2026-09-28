package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/** Multiple-choice option rules reproduce shared/cards/multipleChoice.ts exactly (parity/fixtures/multiple-choice.ts). */
class McOptionsParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "multiple-choice.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonElement.row() = jsonObject.let { o -> McOptions.Row(o["correct"]!!.str!!, o["options"]!!.jsonArray.map { it.str!! }) }

    @Test
    fun hanziOptionMatchesTypeScript() {
        val cases = fixture["hanzi"]!!.jsonArray
        assertTrue(cases.size > 100)
        for (c in cases.map { it.jsonObject }) {
            val option = c["option"]!!.str!!
            val correct = c["correct"]!!.str!!
            assertEquals(c["result"]!!.jsonPrimitive.boolean, McOptions.isHanziOption(option, correct), "isHanziOption(\"$option\", \"$correct\")")
        }
    }

    @Test
    fun sanitizeMatchesTypeScript() {
        for ((i, c) in fixture["sanitized"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            assertEquals(c["result"]!!.row(), McOptions.sanitize(c["row"]!!.row()), "case $i")
        }
    }

    @Test
    fun gridRulesMatchTypeScript() {
        for ((i, c) in fixture["grids"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val rows = c["rows"]!!.jsonArray.map { it.row() }
            val selections = c["selections"]!!.jsonArray.map { it.str }
            val picked = c["picked"]!!.jsonPrimitive.int
            assertEquals(c["choiceRows"]!!.jsonPrimitive.int, McOptions.choiceRowCount(rows), "choiceRows $i")
            assertEquals(c["compact"]!!.jsonPrimitive.boolean, McOptions.isCompact(rows), "compact $i")
            assertEquals(c["next"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.int }, McOptions.nextUnansweredRow(rows, selections, picked), "next $i")
        }
    }

    @Test
    fun pinyinSyllableIsNeverAnOption() {
        val row = McOptions.sanitize(McOptions.Row("习", listOf("学", "刁", "习", "xi", "羽")))
        assertEquals(listOf("学", "刁", "习", "羽"), row.options)
        assertFalse(McOptions.isHanziOption("xi", "习"))
        assertFalse(McOptions.isHanziOption("xí", "习"))
    }
}
