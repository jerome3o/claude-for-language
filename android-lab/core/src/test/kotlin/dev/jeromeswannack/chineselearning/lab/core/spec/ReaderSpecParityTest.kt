package dev.jeromeswannack.chineselearning.lab.core.spec

import dev.jeromeswannack.chineselearning.lab.core.spec.LessonSpecParityTest.Companion.Mismatches
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonSpecParityTest.Companion.fixture
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonSpecParityTest.Companion.strings
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test

/** Reader validate / diff / export ports against the web's shared/reader (parity/fixtures/lesson-spec.ts). */
class ReaderSpecParityTest {
    private val reader by lazy { fixture("reader-spec.json").jsonObject }

    @Test fun validate() {
        val m = Mismatches("validateReaderSpec")
        for (c in reader["validate"]!!.jsonArray) {
            val spec = c.jsonObject["spec"]
            m.check(strings(c.jsonObject["errors"]), ReaderValidator.validate(spec)) { spec.toString() }
        }
        m.assertNone()
    }

    private fun summary(d: ReaderDiffResult): JsonElement = Json.parseToJsonElement(JsonObject(mapOf(
        "changed" to JsonPrimitive(d.changed),
        "meta" to JsonArray(d.meta.map { JsonArray(listOf(JsonPrimitive(it.field), it.before, it.after)) }),
        "pages" to JsonArray(d.pages.map { p ->
            when (p) {
                is ReaderPageDiffEntry.Changed -> JsonArray(listOf(JsonPrimitive(p.kind), JsonPrimitive(p.index), JsonPrimitive(p.fromIndex),
                    JsonArray(p.fields.map { f -> JsonArray(listOf(JsonPrimitive(f.field), f.before, f.after)) })))
                is ReaderPageDiffEntry.Moved -> JsonArray(listOf(JsonPrimitive(p.kind), JsonPrimitive(p.index), JsonPrimitive(p.fromIndex)))
                else -> JsonArray(listOf(JsonPrimitive(p.kind), JsonPrimitive(p.index)))
            }
        }),
    )).toString())

    @Test fun diff() {
        val lines = Mismatches("formatReaderDiff")
        val shape = Mismatches("diffReaderSpecs")
        for (c in reader["diff"]!!.jsonArray) {
            val before = c.jsonObject["before"]!!.jsonObject
            val after = c.jsonObject["after"]!!.jsonObject
            val d = ReaderDiff.diff(before, after)
            lines.check(strings(c.jsonObject["lines"]), ReaderDiff.format(d)) { "$before\n → $after" }
            shape.check(Json.parseToJsonElement(c.jsonObject["summary"].toString()), summary(d)) { "$before\n → $after" }
        }
        lines.assertNone()
        shape.assertNone()
    }

    @Test fun export() {
        val md = Mismatches("readerToMarkdown")
        val json = Mismatches("readerToJson")
        val csv = Mismatches("readerToCsv")
        val name = Mismatches("readerExportFilename")
        for (c in reader["export"]!!.jsonArray) {
            val o = c.jsonObject
            val spec = o["spec"]!!.jsonObject
            md.check(o["md"]!!.jsonPrimitive.content, ReaderExport.toMarkdown(spec)) { spec.toString() }
            json.check(o["json"]!!.jsonPrimitive.content, ReaderExport.toJson(spec)) { spec.toString() }
            csv.check(o["csv"]!!.jsonPrimitive.content, ReaderExport.toCsv(spec)) { spec.toString() }
            val expected = o["filename"]!!.jsonPrimitive.content
            name.check(expected, ReaderExport.filename(spec, expected.substringAfterLast('.'))) { spec.toString() }
        }
        md.assertNone(); json.assertNone(); csv.assertNone(); name.assertNone()
    }

    @Test fun jsTrimAndJsonMatchJavaScript() {
        kotlin.test.assertEquals("a", JsJson.trim("﻿　 a \n"))
        kotlin.test.assertEquals("\u001Ca", JsJson.trim("\u001Ca")) // not JS whitespace
        kotlin.test.assertEquals("{\"a\":[],\"b\":{}}", JsJson.stringify(Json.parseToJsonElement("{\"a\":[],\"b\":{}}")))
        kotlin.test.assertEquals("[1,1.5,100,null]", JsJson.stringify(Json.parseToJsonElement("[1.0,1.5,1e2,null]")))
    }
}
