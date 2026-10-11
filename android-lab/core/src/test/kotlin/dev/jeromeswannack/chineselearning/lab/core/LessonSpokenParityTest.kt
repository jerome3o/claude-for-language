package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Spoken lesson answers reproduce shared/lesson/spoken-check.ts exactly (parity/fixtures/lesson-spoken.ts). */
class LessonSpokenParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "lesson-spoken.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content

    @Test
    fun checksMatch() {
        val cases = data["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 80)
        assertTrue(cases.any { it["accepted"]!!.jsonPrimitive.boolean && !it["strict"]!!.jsonPrimitive.boolean }, "no case where speaking helps")
        for (c in cases) {
            val alts = c["alternatives"]!!.jsonArray.map { it.jsonPrimitive.content }
            val r = LessonSpokenCheck.check(c["answer"].str!!, c["expected"].str!!, alts, c["source"].str)
            val what = c.toString()
            assertEquals(c["verdict"].str, r.verdict?.let(AnswerKey::verdictName), what)
            assertEquals(c["accepted"]!!.jsonPrimitive.boolean, r.accepted, what)
            assertEquals(c["note"].str, r.note, what)
            val strict = LessonAnswers.diffHanzi(c["answer"].str!!, c["expected"].str!!, alts).correct
            assertEquals(c["strict"]!!.jsonPrimitive.boolean, strict, what)
            assertEquals(c["correct"]!!.jsonPrimitive.boolean, LessonSpokenCheck.correct(strict, r), what)
        }
    }

    @Test
    fun labelsMatch() {
        for (l in data["labels"]!!.jsonArray.map { it.jsonObject }) {
            val typed = l["typed_label"].str
            val got = if (typed == null) LessonSpokenCheck.inputLabel(l["input"].str) else LessonSpokenCheck.inputLabel(l["input"].str, typed)
            assertEquals(l["label"].str, got, l.toString())
        }
    }
}
