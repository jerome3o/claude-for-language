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
import kotlin.test.assertTrue
import kotlin.test.fail

/** "Paste a list" must parse and plan exactly like shared/import (parity/fixtures/import.ts). */
class ImportParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "import.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.s(k: String) = this[k]?.str

    @Test
    fun pinyinHelpersMatch() {
        for (c in fixture["pinyin"]!!.jsonArray.map { it.jsonObject }) {
            val s = c.s("s")!!
            assertEquals(c.s("marks"), ImportPinyin.toneNumbersToMarks(s), "toneNumbersToMarks '$s'")
            assertEquals(c.s("norm"), ImportPinyin.normalize(s), "normalizePinyin '$s'")
            assertEquals(c["count"]!!.str?.toInt(), ImportPinyin.syllableCount(s), "pinyinSyllableCount '$s'")
            val seg = c["seg"]!!.let { if (it is JsonNull) null else it.jsonArray.map { x -> x.str!! } }
            assertEquals(seg, ImportPinyin.segmentPinyin(s), "segmentPinyin '$s'")
            assertEquals(c["tone"]!!.jsonPrimitive.boolean, ImportPinyin.hasToneInfo(s), "hasToneInfo '$s'")
            assertEquals(c.s("strip"), ImportPinyin.stripTones(s), "stripTones '$s'")
        }
    }

    @Test
    fun classifyAndNormalizeMatch() {
        for (c in fixture["classify"]!!.jsonArray.map { it.jsonObject }) {
            val len = c["len"]!!.str?.toInt()
            assertEquals(c.s("out"), WordListParser.classifyCell(c.s("cell")!!, len).wire, "classifyCell '${c.s("cell")}' $len")
        }
        for (c in fixture["normalize"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c.s("out"), WordListParser.normalizeHanzi(c.s("s")!!), "normalizeHanzi '${c.s("s")}'")
        }
    }

    private fun parse(input: JsonObject): WordListParser.Result {
        val col = input.s("col")?.let { w -> WordListParser.ColumnSeparator.entries.first { it.wire == w } } ?: WordListParser.ColumnSeparator.AUTO
        val row = input.s("row")?.let { w -> WordListParser.RowSeparator.entries.first { it.wire == w } } ?: WordListParser.RowSeparator.AUTO
        return WordListParser.parse(input.s("text")!!, col, input.s("custom") ?: "", row)
    }

    private fun assertRow(want: JsonObject, got: WordListParser.Row, where: String) {
        assertEquals(want["index"]!!.jsonPrimitive.int, got.index, "$where index")
        for ((k, v) in listOf("raw" to got.raw, "hanzi" to got.hanzi, "pinyin" to got.pinyin, "english" to got.english, "sentence" to got.sentence, "notes" to got.notes)) {
            assertEquals(want.s(k), v, "$where $k")
        }
        assertEquals(want["problems"]!!.jsonArray.map { it.str }, got.problems, "$where problems")
    }

    @Test
    fun pastesParseTheSame() {
        val parses = fixture["parses"]!!.jsonArray.map { it.jsonObject }
        for (c in parses) {
            val input = c["input"]!!.jsonObject
            val want = c["out"]!!.jsonObject
            val got = parse(input)
            val where = "paste ${input.s("text")!!.replace("\n", "⏎").take(60)}"
            val d = want["detected"]!!.jsonObject
            assertEquals(d.s("columnSeparator"), got.detected.columnSeparator.wire, "$where columnSeparator")
            assertEquals(d.s("rowSeparator"), got.detected.rowSeparator.wire, "$where rowSeparator")
            assertEquals(d["columns"]!!.jsonArray.map { it.str }, got.detected.columns.map { it.wire }, "$where columns")
            assertEquals(d["headerDropped"]!!.jsonPrimitive.boolean, got.detected.headerDropped, "$where headerDropped")
            val rows = want["rows"]!!.jsonArray.map { it.jsonObject }
            assertEquals(rows.size, got.rows.size, "$where row count")
            rows.forEachIndexed { i, r -> assertRow(r, got.rows[i], "$where row $i") }
        }
        assertTrue(parses.size > 40)
    }

    @Test
    fun plansMatch() {
        val existing = fixture["existing"]!!.jsonArray.map { it.jsonObject }.map {
            ImportPlanner.Existing(it.s("id")!!, it.s("hanzi")!!, it.s("pinyin")!!, it.s("english")!!, it.s("fun_facts"), it.s("sentence_clue"))
        }
        for (c in fixture["plans"]!!.jsonArray.map { it.jsonObject }) {
            val rows = WordListParser.parse(c.s("text")!!).rows
            val policy = ImportPlanner.Policy.entries.first { it.wire == c.s("policy") }
            val excluded = c["excluded"]!!.jsonArray.map { it.jsonPrimitive.int }.toSet()
            val got = ImportPlanner.plan(rows, existing, policy, excluded)
            val want = c["plan"]!!.jsonArray.map { it.jsonObject }
            val where = "plan ${policy.wire} $excluded ${c.s("text")!!.take(30)}"
            assertEquals(want.size, got.size, "$where size")
            want.forEachIndexed { i, w ->
                val g = got[i]
                assertEquals(w.s("action"), g.action.wire, "$where row $i action")
                assertEquals(w["existing"]?.jsonObject?.s("id"), g.existing?.id, "$where row $i existing")
                assertEquals(w.s("reason"), g.reason, "$where row $i reason")
                assertEquals(w["missing"]!!.jsonArray.map { it.str }, g.missing, "$where row $i missing")
                assertEquals(
                    w["changes"]!!.jsonArray.map { ch -> ch.jsonObject.let { Triple(it.s("field"), it.s("from"), it.s("to")) } },
                    g.changes.map { Triple(it.field, it.from, it.to) },
                    "$where row $i changes",
                )
            }
            val s = c["summary"]!!.jsonObject
            val sum = ImportPlanner.summarize(got)
            assertEquals(listOf("add", "update", "unchanged", "skipped", "problems").map { s[it]!!.jsonPrimitive.int }, listOf(sum.add, sum.update, sum.unchanged, sum.skipped, sum.problems), "$where summary")
        }
    }
}
