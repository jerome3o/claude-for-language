package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** A mini lesson run (shared/study/lessonRun.ts): steps, shape, the retry round, the bar, resuming. */
class LessonRunParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "lesson-run.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.boolOrNull: Boolean? get() = if (this is JsonNull) null else jsonPrimitive.booleanOrNull
    private fun strings(e: JsonElement) = e.jsonArray.map { it.str!! }

    private fun state(o: JsonObject) = LessonRun.State(o["pos"]!!.jsonPrimitive.int, strings(o["owed"]!!), o["fixed"]!!.jsonPrimitive.int, o["retried"]?.jsonPrimitive?.int ?: 0)

    @Test
    fun runsMatchTypeScript() {
        val runs = fixture()["runs"]!!.jsonArray
        var retried = 0
        for ((i, c) in runs.withIndex()) {
            val o = c.jsonObject
            val sections = o["sections"]!!.jsonArray.map { strings(it) }
            val only = o["only"]!!.let { if (it is JsonNull) null else strings(it) }
            val steps = LessonRun.stepsOfTypes(sections, only)
            val expectedSteps = o["steps"]!!.jsonArray.map { val s = it.jsonObject; LessonRun.Step(s["key"]!!.str!!, s["section"]!!.jsonPrimitive.int, s["index"]!!.jsonPrimitive.int, s["type"]!!.str!!, s["scored"]!!.jsonPrimitive.boolean) }
            assertEquals(expectedSteps, steps, "run[$i] steps")
            assertEquals(o["shape"]!!.str, LessonRun.shapeOfTypes(sections), "run[$i] shape")
            var st = LessonRun.NEW_RUN
            for ((k, t) in o["trace"]!!.jsonArray.withIndex()) {
                val e = t.jsonObject
                val where = "run[$i] step $k"
                st = LessonRun.advance(st, steps, e["verdict"]!!.boolOrNull)
                assertEquals(state(e["state"]!!.jsonObject), st, "$where state")
                val cur = LessonRun.current(st, steps)
                val ec = e["current"]!!
                if (ec is JsonNull) assertEquals(null, cur, "$where current") else {
                    assertEquals(ec.jsonObject["phase"]!!.str, cur?.phase, "$where phase")
                    assertEquals(ec.jsonObject["step"]!!.jsonObject["key"]!!.str, cur?.step?.key, "$where key")
                }
                val bar = LessonRun.retryBar(st, steps)
                val eb = e["bar"]!!.jsonObject
                assertEquals(eb["answered"]!!.jsonPrimitive.int, bar.answered, "$where answered")
                assertEquals(eb["slots"]!!.jsonPrimitive.int, bar.slots, "$where slots")
                assertEquals(eb["retries"]!!.jsonPrimitive.int, bar.retries, "$where retries")
                assertEquals(eb["itemsDone"]!!.jsonPrimitive.int, bar.itemsDone, "$where itemsDone")
                assertEquals(eb["doneFraction"]!!.jsonPrimitive.double, bar.doneFraction, "$where doneFraction")
                assertEquals(eb["retryFraction"]!!.jsonPrimitive.double, bar.retryFraction, "$where retryFraction")
                assertEquals(eb["onRetries"]!!.jsonPrimitive.boolean, bar.onRetries, "$where onRetries")
                assertEquals(eb["complete"]!!.jsonPrimitive.boolean, bar.complete, "$where complete")
                assertEquals(e["resume"]!!.str, LessonRun.resumeLine(st, steps), "$where resume")
                retried = Math.max(retried, st.retried)
            }
        }
        assertTrue(retried > 0, "some runs have a retry round")
    }

    @Test
    fun helpersMatchTypeScript() {
        val f = fixture()
        for ((i, c) in f["resume"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val saved = o["saved"]!!
            val ok = if (saved is JsonNull) LessonRun.canResume(null, null, null, o["lessonId"]!!.str!!, o["shape"]!!.str!!)
            else {
                val s = saved.jsonObject
                LessonRun.canResume(s["lesson_id"]!!.str, s["shape"]!!.str, state(s["state"]!!.jsonObject), o["lessonId"]!!.str!!, o["shape"]!!.str!!)
            }
            assertEquals(o["ok"]!!.jsonPrimitive.boolean, ok, "resume[$i]")
        }
        for ((i, c) in f["verdicts"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(o["wrong"]!!.jsonPrimitive.boolean, LessonRun.verdictWrong(o["correct"]!!.boolOrNull, o["points"]!!.jsonPrimitive.int, o["max"]!!.jsonPrimitive.int), "verdict[$i]")
        }
        for ((i, c) in f["retries"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val attempts = o["attempts"]!!.jsonArray.map { val a = it.jsonObject; ExerciseAttempt(a["section"]!!.jsonPrimitive.int, a["index"]!!.jsonPrimitive.int, "choice", retry = a["retry"]?.jsonPrimitive?.int) }
            assertEquals(o["next"]!!.jsonPrimitive.int, LessonRun.retryNumber(attempts, o["key"]!!.str!!), "retry[$i] next")
            assertEquals(o["line"]!!.str, LessonRun.retryLine(o["n"]!!.jsonPrimitive.int), "retry[$i] line")
        }
    }
}
