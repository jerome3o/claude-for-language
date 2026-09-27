package dev.jeromeswannack.chineselearning.lab.core.spec

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The spec ports (validate / diff / export for lessons and readers, the catalogue resource)
 * against golden vectors from the web's own TypeScript (parity/fixtures/lesson-spec.ts).
 */
class LessonSpecParityTest {
    companion object {
        fun fixture(name: String): JsonElement {
            val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
            return Json.parseToJsonElement(File(dir, name).readText())
        }

        fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }

        /** Collects mismatches and fails once with the first few, so a drift is readable. */
        class Mismatches(private val what: String) {
            private val list = mutableListOf<String>()
            var total = 0
            fun check(expected: Any?, actual: Any?, input: () -> String) {
                total++
                if (expected != actual && list.size < 400) list += "--- input: ${input().take(600)}\n    expected: $expected\n    actual:   $actual"
                else if (expected != actual) list += "…"
            }
            fun assertNone() {
                if (list.isNotEmpty()) fail("$what: ${list.size} of $total differ\n" + list.take(8).joinToString("\n"))
                assertTrue(total > 0, "$what: no vectors")
            }
        }
    }

    private val lesson by lazy { fixture("lesson-spec.json").jsonObject }

    @Test fun catalogueResourceMatchesTheTypeScript() {
        val dir = System.getProperty("parity.dir")!!
        val expected = Json.parseToJsonElement(File(dir, "lesson-catalogue.json").readText())
        val bundled = Json.parseToJsonElement(LessonCatalogue::class.java.getResourceAsStream("/lesson/catalogue.json")!!.bufferedReader().readText())
        assertEquals(
            expected, bundled,
            "core/src/main/resources/lesson/catalogue.json is stale — cp $dir/lesson-catalogue.json android-lab/core/src/main/resources/lesson/catalogue.json",
        )
        assertEquals(15, LessonCatalogue.types.size)
        assertEquals(LessonValidator.EXERCISE_TYPE_IDS, LessonCatalogue.types.map { it.type })
        for (sample in LessonCatalogue.samples) assertEquals(emptyList(), LessonValidator.validate(sample.spec), "sample ${sample.id}")
    }

    @Test fun validate() {
        val m = Mismatches("validateLessonSpec")
        for (c in lesson["validate"]!!.jsonArray) {
            val spec = c.jsonObject["spec"]
            m.check(strings(c.jsonObject["errors"]), LessonValidator.validate(spec)) { spec.toString() }
        }
        m.assertNone()
    }

    @Test fun primaryText() {
        val m = Mismatches("exercisePrimaryText")
        for (c in lesson["primary"]!!.jsonArray) {
            val ex = c.jsonObject["exercise"]!!.jsonObject
            m.check(c.jsonObject["text"]!!.jsonPrimitive.content, LessonDiff.primaryText(ex)) { ex.toString() }
        }
        m.assertNone()
    }

    private fun canon(e: JsonElement?): JsonElement = JsJson.canonical(e)?.let { JsonPrimitive(it) } ?: JsonNull

    private fun summary(d: LessonDiffResult): JsonElement = JsonObject(mapOf(
        "changed" to JsonPrimitive(d.changed),
        "meta" to JsonArray(d.meta.map { JsonArray(listOf(JsonPrimitive(it.field), it.before ?: JsonNull, it.after ?: JsonNull)) }),
        "sections" to JsonArray(d.sections.map {
            when (it) {
                is SectionDiffEntry.Renamed -> JsonArray(listOf(JsonPrimitive("renamed"), JsonPrimitive(it.index), JsonPrimitive(it.before), JsonPrimitive(it.after)))
                is SectionDiffEntry.Added -> JsonArray(listOf(JsonPrimitive("added"), JsonPrimitive(it.index), JsonPrimitive(it.title), JsonPrimitive(it.exerciseCount)))
                is SectionDiffEntry.Removed -> JsonArray(listOf(JsonPrimitive("removed"), JsonPrimitive(it.index), JsonPrimitive(it.title), JsonPrimitive(it.exerciseCount)))
            }
        }),
        "exercises" to JsonArray(d.exercises.map {
            when (it) {
                is ExerciseDiffEntry.Moved -> JsonArray(listOf(JsonPrimitive("moved"), JsonPrimitive(it.section), JsonPrimitive(it.index), JsonPrimitive(it.fromSection), JsonPrimitive(it.fromIndex)))
                is ExerciseDiffEntry.Changed -> JsonArray(listOf(JsonPrimitive("changed"), JsonPrimitive(it.section), JsonPrimitive(it.index),
                    JsonArray(it.fields.map { f -> JsonArray(listOf(JsonPrimitive(f.field), canon(f.before), canon(f.after))) })))
                is ExerciseDiffEntry.Added -> JsonArray(listOf(JsonPrimitive("added"), JsonPrimitive(it.section), JsonPrimitive(it.index)))
                is ExerciseDiffEntry.Removed -> JsonArray(listOf(JsonPrimitive("removed"), JsonPrimitive(it.section), JsonPrimitive(it.index)))
            }
        }),
    ))

    /** Re-parses so number / null literals compare like the fixture's. */
    private fun normalise(e: JsonElement): JsonElement = Json.parseToJsonElement(e.toString())

    @Test fun diff() {
        val lines = Mismatches("formatLessonDiff")
        val shape = Mismatches("diffLessonSpecs")
        for (c in lesson["diff"]!!.jsonArray) {
            val before = c.jsonObject["before"]!!.jsonObject
            val after = c.jsonObject["after"]!!.jsonObject
            val d = LessonDiff.diff(before, after)
            lines.check(strings(c.jsonObject["lines"]), LessonDiff.format(d)) { "$before\n → $after" }
            shape.check(normalise(c.jsonObject["summary"]!!), normalise(summary(d))) { "$before\n → $after" }
        }
        lines.assertNone()
        shape.assertNone()
    }

    @Test fun export() {
        val md = Mismatches("lessonToMarkdown")
        val json = Mismatches("lessonToJson")
        val csv = Mismatches("lessonToCsv")
        val name = Mismatches("lessonExportFilename")
        for (c in lesson["export"]!!.jsonArray) {
            val o = c.jsonObject
            val spec = o["spec"]!!.jsonObject
            md.check(o["md"]!!.jsonPrimitive.content, LessonExport.toMarkdown(spec)) { spec.toString() }
            json.check(o["json"]!!.jsonPrimitive.content, LessonExport.toJson(spec)) { spec.toString() }
            csv.check(o["csv"]!!.jsonPrimitive.content, LessonExport.toCsv(spec)) { spec.toString() }
            val expected = o["filename"]!!.jsonPrimitive.content
            name.check(expected, LessonExport.filename(spec, expected.substringAfterLast('.'))) { spec.toString() }
        }
        md.assertNone(); json.assertNone(); csv.assertNone(); name.assertNone()
    }
}
