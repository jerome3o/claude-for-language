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

/** The tutor's private student profile reproduces shared/students/profile.ts exactly (parity/fixtures/student-profile.ts). */
class StudentProfileParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "student-profile.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    private fun fields(e: JsonElement): StudentProfileFields {
        val o = e.jsonObject
        return StudentProfileFields(
            body = o["body"]!!.str!!,
            level = o["level"]?.str,
            handwriting = o["handwriting"]?.let { if (it is JsonNull) null else it.jsonPrimitive.boolean },
            wordsPerLesson = o["words_per_lesson"]?.let { if (it is JsonNull) null else it.jsonPrimitive.int },
        )
    }

    @Test
    fun constantsExamplesAndHintsMatch() {
        assertEquals(data["max_chars"]!!.jsonPrimitive.int, StudentProfile.MAX_CHARS)
        assertEquals(data["max_words"]!!.jsonPrimitive.int, StudentProfile.MAX_WORDS_PER_LESSON)
        assertEquals(data["levels"]!!.jsonArray.map { it.str }, StudentProfile.LEVELS)
        assertEquals(data["level_labels"]!!.jsonObject.mapValues { it.value.str }, StudentProfile.LEVEL_LABELS)
        assertEquals(data["hints"]!!.jsonArray.map { it.str }, StudentProfile.HINTS)
        val examples = data["examples"]!!.jsonArray
        assertEquals(examples.size, StudentProfile.EXAMPLES.size)
        examples.forEachIndexed { i, e ->
            val o = e.jsonObject
            val k = StudentProfile.EXAMPLES[i]
            assertEquals(o["id"]!!.str, k.id)
            assertEquals(o["title"]!!.str, k.title)
            assertEquals(o["summary"]!!.str, k.summary)
            assertEquals(fields(o["profile"]!!), k.profile, "example ${k.id}")
        }
    }

    @Test
    fun validationChipsEmptyAndExamplesMatch() {
        val cases = data["cases"]!!.jsonArray
        assertTrue(cases.size > 1000)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val p = fields(o["profile"]!!)
            assertEquals(o["empty"]!!.jsonPrimitive.boolean, StudentProfile.isEmpty(p), "cases[$i] empty")
            val (value, problems) = StudentProfile.validate(p)
            assertEquals(o["problems"]!!.jsonArray.map { it.str }, problems, "cases[$i] problems")
            val expected = o["value"]!!.let { if (it is JsonNull) null else fields(it) }
            assertEquals(expected, value, "cases[$i] value")
            val chips = o["chips"]!!.let { if (it is JsonNull) null else it.jsonArray.map { x -> x.str } }
            assertEquals(chips, value?.let { StudentProfile.chips(it) }, "cases[$i] chips")
            o["apply"]!!.jsonArray.forEachIndexed { j, a ->
                assertEquals(fields(a), StudentProfile.applyExample(p, StudentProfile.EXAMPLES[j].profile), "cases[$i] apply ${StudentProfile.EXAMPLES[j].id}")
            }
        }
    }

    @Test
    fun unsavedChangesMatch() {
        for ((i, pr) in data["pairs"]!!.jsonArray.withIndex()) {
            val o = pr.jsonObject
            assertEquals(o["same"]!!.jsonPrimitive.boolean, StudentProfile.same(fields(o["a"]!!), fields(o["b"]!!)), "pairs[$i]")
        }
    }
}
