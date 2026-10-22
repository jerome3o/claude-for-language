package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Revise until right first time (shared/study/lessonRevision.ts) + the tutor's labels (shared/homework/library.ts). */
class LessonRevisionParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "lesson-revision.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.intOrNull: Int? get() = if (this is JsonNull) null else jsonPrimitive.int
    private val JsonElement.longOrNull: Long? get() = if (this is JsonNull) null else jsonPrimitive.long
    private fun strings(e: JsonElement) = e.jsonArray.map { it.str!! }
    private fun outcome(e: JsonElement): LessonRevision.Outcome? =
        if (e is JsonNull) null else LessonRevision.Outcome(strings(e.jsonObject["keys"]!!), strings(e.jsonObject["missed"]!!))

    @Test
    fun statesAndRevisionsMatchTypeScript() {
        val hs = fixture()["histories"]!!.jsonArray
        var revisions = 0
        for ((i, c) in hs.withIndex()) {
            val o = c.jsonObject
            val runs = o["runs"]!!.jsonArray.map { val r = it.jsonObject; LessonRevision.RunRecord(r["id"]!!.str!!, r["at"]!!.str!!, outcome(r["outcome"]!!), r["rating"]!!.intOrNull) }
            val marks = o["marks"]!!.jsonArray.map { val m = it.jsonObject; LessonRevision.MarkRecord(m["id"]!!.str!!, m["at"]!!.str!!, m["action"]!!.str!!) }
            val st = LessonRevision.state(runs, marks)
            val e = o["state"]!!.jsonObject
            val where = "history[$i]"
            assertEquals(e["status"]!!.str, st.status, "$where status")
            assertEquals(e["due_ms"]!!.longOrNull, st.dueMs, "$where due")
            assertEquals(e["revision"]!!.jsonPrimitive.int, st.revision, "$where revision")
            assertEquals(strings(e["missed"]!!), st.missed, "$where missed")
            assertEquals(e["full"]!!.jsonPrimitive.boolean, st.full, "$where full")
            assertEquals(e["runs"]!!.jsonPrimitive.int, st.runs, "$where runs")
            assertEquals(e["last_ms"]!!.longOrNull, st.lastMs, "$where last")
            assertEquals(e["last_run_id"]!!.str, st.lastRunId, "$where last id")
            val sections = o["sections"]!!.jsonArray.map { strings(it) }
            val steps = LessonRun.stepsOfTypes(sections)
            assertEquals(strings(o["keys"]!!), LessonRevision.revisionKeys(st, steps, o["lessonId"]!!.str!!), "$where keys")
            val cutoff = o["cutoff"]!!.jsonPrimitive.long
            assertEquals(o["due"]!!.jsonPrimitive.boolean, LessonRevision.isDue(st, cutoff), "$where isDue")
            assertEquals(o["days"]!!.jsonPrimitive.int, LessonRevision.daysAway(st, cutoff), "$where days")
            assertEquals(o["dueText"]!!.str, LessonRevision.dueText(st, cutoff), "$where dueText")
            assertEquals(o["title"]!!.str, LessonRevision.title(st), "$where title")
            assertEquals(o["toGetRight"]!!.str, LessonRevision.toGetRightLabel(st, steps.count { it.scored }), "$where toGetRight")
            if (st.status == "revision") revisions++
        }
        assertTrue(revisions > 20, "enough revision cases")
    }

    @Test
    fun outcomesAndHelpersMatchTypeScript() {
        val f = fixture()
        for ((i, c) in f["outcomes"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val rows = o["exercises"]!!.jsonArray.map {
                val a = it.jsonObject
                ExerciseAttempt(
                    a["section"]!!.jsonPrimitive.int, a["index"]!!.jsonPrimitive.int, "choice",
                    correct = a["correct"]!!.let { v -> if (v is JsonNull) null else v.jsonPrimitive.booleanOrNull },
                    points = a["points"]!!.jsonPrimitive.int, maxPoints = a["max_points"]!!.jsonPrimitive.int, retry = a["retry"]?.jsonPrimitive?.int,
                )
            }
            val got = LessonRevision.runOutcome(LessonAttemptData(exercises = rows))
            assertEquals(outcome(o["outcome"]!!), got, "outcome[$i]")
            if (got != null) assertEquals(o["endRevision"]!!.str, LessonRevision.runEndLine(got, true), "outcome[$i] end")
        }
        for ((i, c) in f["cleaned"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(outcome(o["out"]!!), LessonRevision.clean(outcome(o["input"]!!)), "cleaned[$i]")
        }
        for (h in f["hashes"]!!.jsonArray) assertEquals(h.jsonObject["h"]!!.jsonPrimitive.long, LessonRevision.fnv1a32(h.jsonObject["text"]!!.str!!), "fnv ${h.jsonObject["text"]}")
        for (x in f["extras"]!!.jsonArray) assertEquals(x.jsonObject["k"]!!.jsonPrimitive.int, LessonRevision.extraCount(x.jsonObject["n"]!!.jsonPrimitive.int), "extra ${x.jsonObject["n"]}")
        val today = f["today"]!!.str!!
        for ((i, c) in f["library"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val s = o["summary"]!!.jsonObject
            val summary = HomeworkLibrary.LessonRevisionSummary(s["status"]!!.str!!, s["revision"]!!.jsonPrimitive.int, s["due_date"]!!.str, s["to_get_right"]!!.jsonPrimitive.int, s["percent"]!!.jsonPrimitive.int)
            assertEquals(o["label"]!!.str, HomeworkLibrary.revisionProgressLabel(summary, today), "library[$i] label")
            assertEquals(
                o["status"]!!.str,
                HomeworkLibrary.libraryStatus(o["complete"]!!.jsonPrimitive.boolean, o["started"]!!.jsonPrimitive.boolean, o["due"]!!.str, today, revising = o["revising"]!!.jsonPrimitive.boolean),
                "library[$i] status",
            )
        }
    }
}
