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

/** The mini-lesson answer screen's feedback (shared/lesson/feedback.ts): feel, verdict moments, Say it again targets, fixes. */
class LessonFeedbackParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "lesson-feedback.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun copyMatchesTypeScript() {
        val c = fixture()["copy"]!!.jsonObject
        assertEquals(c["checking"]!!.str, LessonFeedback.CLAUDE_CHECKING_LINE)
        assertEquals(c["label"]!!.str, LessonFeedback.SAY_AGAIN_LABEL)
        assertEquals(c["note"]!!.str, LessonFeedback.SAY_AGAIN_NOTE)
        assertEquals(c["fixLabel"]!!.str, LessonFeedback.SAY_AGAIN_FIX_LABEL)
        assertEquals(c["example"]!!.str, LessonFeedback.EXAMPLE_LABEL)
    }

    @Test
    fun feelMatchesTypeScript() {
        val cases = fixture()["feel"]!!.jsonArray
        assertEquals(LessonFeedback.MOMENTS.size * 2, cases.size)
        for (c in cases) {
            val o = c.jsonObject
            val moment = o["moment"]!!.str!!
            assertTrue(moment in LessonFeedback.MOMENTS, moment)
            val f = LessonFeedback.feel(moment, o["celebrated"]!!.jsonPrimitive.boolean)
            assertEquals(o["feel"]!!.str, f.feel, moment)
            assertEquals(o["confetti"]!!.jsonPrimitive.boolean, f.confetti, moment)
        }
        for (c in fixture()["verdicts"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["moment"]!!.str, LessonFeedback.claudeVerdictMoment(o["verdict"]!!.str))
        }
    }

    @Test
    fun sayAgainTargetsMatchTypeScript() {
        val cases = fixture()["targets"]!!.jsonArray
        assertTrue(cases.size > 20)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val ex = LessonJson.decodeFromJsonElement(LessonExercise.serializer(), o["exercise"]!!)
            val t = LessonFeedback.sayAgainTarget(ex)
            val want = o["target"]!!
            if (want is JsonNull) {
                assertEquals(null, t, "#$i ${ex.type}")
            } else {
                val w = want.jsonObject
                assertEquals(w["hanzi"]!!.str, t?.hanzi, "#$i ${ex.type}")
                assertEquals(w["pinyin"]?.str, t?.pinyin, "#$i ${ex.type} pinyin")
                assertEquals(w["kind"]!!.str, t?.kind, "#$i ${ex.type} kind")
            }
        }
    }

    @Test
    fun fixesMatchTypeScript() {
        for (c in fixture()["fixes"]!!.jsonArray) {
            val o = c.jsonObject
            val corrected = o["corrected"]!!.str
            val said = o["said"]!!.str
            val offered = o["offered"]!!.str
            assertEquals(o["fix"]!!.str, LessonFeedback.sayAgainFix(corrected, said, offered), "$corrected / $said / $offered")
        }
    }
}
