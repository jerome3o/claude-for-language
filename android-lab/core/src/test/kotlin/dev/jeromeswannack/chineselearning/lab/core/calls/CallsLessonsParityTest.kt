package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Calls round 4 (+ round 5's two-hour gap): lessons (calls within two hours of each other) reproduce shared/calls/lessons.ts exactly (parity/fixtures/calls-lessons.ts). */
class CallsLessonsParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-lessons.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun lng(e: JsonElement?): Long? = if (e == null || e is JsonNull) null else e.jsonPrimitive.long

    @Test
    fun gapIsTwoHours() {
        assertEquals(root["gap"]!!.jsonPrimitive.long, CallLessons.LESSON_GAP_MS)
        assertEquals(2 * 60 * 60_000L, CallLessons.LESSON_GAP_MS)
    }

    @Test
    fun groupIntoLessonsMatches() {
        var multi = 0
        for ((i, c) in root["groupings"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val calls = o["calls"]!!.jsonArray.map {
                val x = it.jsonObject
                CallLessons.LessonCall(str(x["id"])!!, str(x["scope"])!!, lng(x["start"])!!, lng(x["end"]))
            }
            val want = o["result"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
            val got = CallLessons.groupIntoLessons(calls)
            assertEquals(want, got, "grouping case $i")
            if (got.values.toSet().size < got.size) multi++
        }
        assertTrue(multi > 50, "enough multi-call lessons ($multi)")
    }

    @Test
    fun continuesAndOpen() {
        for ((i, c) in root["continues"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonPrimitive.boolean, CallLessons.continuesLesson(lng(o["last_end"]), lng(o["start"])!!), "continues $i")
        }
        for ((i, c) in root["opens"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonPrimitive.boolean, CallLessons.lessonOpen(lng(o["last_end"]), o["any_live"]!!.jsonPrimitive.boolean, lng(o["now"])!!), "open $i")
        }
    }

    private data class Row(val id: String, val lessonId: String?, val createdAt: String)

    @Test
    fun pastCallsListGroupsByLesson() {
        for ((i, c) in root["lists"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val rows = o["rows"]!!.jsonArray.map { val x = it.jsonObject; Row(str(x["id"])!!, str(x["lesson_id"]), str(x["created_at"])!!) }
            val want = o["result"]!!.jsonArray.map { val g = it.jsonObject; str(g["lesson_id"])!! to g["ids"]!!.jsonArray.map { id -> id.jsonPrimitive.content } }
            val got = CallLessons.groupCallsByLesson(rows, { it.id }, { it.lessonId }, { it.createdAt }).map { g -> g.lessonId to g.calls.map { it.id } }
            assertEquals(want, got, "list case $i")
        }
    }
}
