package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Judge each sentence / Choose the word (shared/lesson/judgeGap.ts + the gap helpers): marker, checking, copy, points. */
class JudgeGapParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "lesson-judge-gap.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.boolOrNull: Boolean? get() = if (this is JsonNull) null else jsonPrimitive.booleanOrNull
    private fun bools(e: JsonElement) = e.jsonArray.map { it.boolOrNull }
    private fun strs(e: JsonElement) = e.jsonArray.map { it.str }
    private fun exercise(e: JsonElement): LessonExercise = LessonJson.decodeFromJsonElement(LessonExercise.serializer(), e)

    @Test
    fun gapMarkerMatchesTypeScript() {
        val cases = fixture()["gap"]!!.jsonArray
        assertTrue(cases.size > 100)
        for (c in cases) {
            val o = c.jsonObject
            val s = o["s"]!!.str!!
            val w = o["w"]!!.str!!
            assertEquals(o["count"]!!.jsonPrimitive.int, JudgeGap.gapCount(s), "gapCount($s)")
            val parts = o["parts"]!!.jsonObject
            assertEquals(parts["before"]!!.str!! to parts["after"]!!.str!!, JudgeGap.gapParts(s), "gapParts($s)")
            assertEquals(o["filled"]!!.str, JudgeGap.fillGap(s, w), "fillGap($s, $w)")
        }
    }

    @Test
    fun judgeCheckingMatchesTypeScript() {
        for ((i, c) in fixture()["judge"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val ex = exercise(o["exercise"]!!) as JudgeExercise
            val results = JudgeGap.judgeResults(ex, bools(o["judged"]!!))
            assertEquals(bools(o["results"]!!), results, "judge[$i] results")
            assertEquals(o["all"]!!.boolOrNull, JudgeGap.allAnswered(results), "judge[$i] all")
            assertEquals(o["line"]!!.str, JudgeGap.scoreLine(results), "judge[$i] line")
            assertEquals(strs(o["spoken"]!!), ex.sentences.map(JudgeGap::spokenText), "judge[$i] spoken")
            assertEquals(strs(o["feedback"]!!), ex.sentences.mapIndexed { k, s -> results[k]?.let { JudgeGap.judgeFeedback(s.correct, it) } }, "judge[$i] feedback")
        }
    }

    @Test
    fun gapCheckingMatchesTypeScript() {
        for ((i, c) in fixture()["gapChecks"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val ex = exercise(o["exercise"]!!) as GapChoiceExercise
            val picks = strs(o["picks"]!!)
            val results = JudgeGap.gapResults(ex, picks)
            assertEquals(bools(o["results"]!!), results, "gap[$i] results")
            assertEquals(o["all"]!!.boolOrNull, JudgeGap.allAnswered(results), "gap[$i] all")
            assertEquals(o["line"]!!.str, JudgeGap.scoreLine(results), "gap[$i] line")
            assertEquals(o["options"]!!.jsonArray.map { strs(it) }, ex.items.map { JudgeGap.optionsFor(ex, it) }, "gap[$i] options")
            assertEquals(strs(o["feedback"]!!), ex.items.mapIndexed { k, item -> JudgeGap.gapFeedback(item.answer, picks[k]) }, "gap[$i] feedback")
            assertEquals(strs(o["filled"]!!), ex.items.map { JudgeGap.fillGap(it.sentence, it.answer) }, "gap[$i] filled")
        }
    }

    @Test
    fun linesPointsAndPartsMatchTypeScript() {
        val f = fixture()
        for (c in f["lines"]!!.jsonArray) {
            val o = c.jsonObject
            val results = bools(o["results"]!!)
            assertEquals(o["line"]!!.str, JudgeGap.scoreLine(results))
            assertEquals(o["all"]!!.boolOrNull, JudgeGap.allAnswered(results))
        }
        for (c in f["points"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["points"]!!.jsonPrimitive.int, Lessons.exercisePoints(exercise(o["exercise"]!!)))
        }
        for (c in f["parts"]!!.jsonArray) {
            val o = c.jsonObject
            val answer = o["answer"]!!.let { if (it is JsonNull) null else LessonJson.decodeFromJsonElement(ExerciseAnswer.serializer(), it) }
            assertEquals(o["points"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.int }, LessonAttempts.partPoints(answer))
        }
    }
}
