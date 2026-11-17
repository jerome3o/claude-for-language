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

/** "Which sentence is wrong?" choices (shared/lesson/choiceMistake.ts): detection, what is spoken, the correction call. */
class ChoiceMistakeParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "choice-mistake.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    private fun sentence(e: JsonElement?): LessonSentence? =
        if (e == null || e is JsonNull) null else LessonJson.decodeFromJsonElement(LessonSentence.serializer(), e)

    private fun state(e: JsonElement): ChoiceMistake.State? {
        if (e is JsonNull) return null
        val o = e.jsonObject
        return when (o["status"]!!.str) {
            "ready" -> ChoiceMistake.State.Ready(sentence(o["correction"])!!, o["source"]!!.str!!)
            "unchanged" -> ChoiceMistake.State.Unchanged
            "loading" -> ChoiceMistake.State.Loading
            "unavailable" -> ChoiceMistake.State.Unavailable(o["offline"]!!.jsonPrimitive.boolean)
            "none" -> ChoiceMistake.State.None
            else -> fail("unknown state $o")
        }
    }

    @Test
    fun questionDetectionMatchesTypeScript() {
        val cases = fixture()["questions"]!!.jsonArray
        assertTrue(cases.size > 40)
        var asks = 0
        for (c in cases) {
            val o = c.jsonObject
            val q = o["q"]!!.str!!
            val expected = o["asks"]!!.jsonPrimitive.boolean
            if (expected) asks++
            assertEquals(expected, ChoiceMistake.questionAsksForWrong(q), "questionAsksForWrong(\"$q\")")
        }
        assertTrue(asks in 10 until cases.size - 10, "a mix of both")
    }

    @Test
    fun spokenTextsMatchTypeScript() {
        for ((i, c) in fixture()["exercises"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val ex = LessonJson.decodeFromJsonElement(LessonExercise.serializer(), o["exercise"]!!) as ChoiceExercise
            assertEquals(o["asks"]!!.jsonPrimitive.boolean, ChoiceMistake.asksForWrong(ex), "[$i] asks")
            assertEquals(o["needs"]!!.jsonPrimitive.boolean, ChoiceMistake.needsCorrection(ex), "[$i] needs")
            assertEquals(state(o["initial"]!!), ChoiceMistake.initial(ex), "[$i] initial")
            assertEquals(o["tts"]!!.jsonArray.map { it.str }, ChoiceMistake.ttsTexts(ex), "[$i] tts")
            assertEquals(o["exerciseTts"]!!.jsonArray.map { it.str }, Lessons.exerciseTtsTexts(ex), "[$i] exerciseTts")
            val say = o["sayAgain"]!!
            val target = LessonFeedback.sayAgainTarget(ex)
            if (say is JsonNull) assertEquals(null, target, "[$i] sayAgain")
            else {
                val so = say.jsonObject
                assertEquals(LessonFeedback.Target(so["hanzi"]!!.str!!, so["pinyin"]?.str, so["kind"]!!.str!!), target, "[$i] sayAgain")
            }
            val input = o["input"]!!
            val actual = ChoiceMistake.input(ex)
            if (input is JsonNull) assertEquals(null, actual, "[$i] input")
            else assertEquals(LessonJson.decodeFromJsonElement(ChoiceMistake.Input.serializer(), input), actual, "[$i] input")
            for ((k, sc) in o["states"]!!.jsonArray.withIndex()) {
                val so = sc.jsonObject
                val st = state(so["state"]!!)
                assertEquals(so["wrong"]!!.jsonArray.map { it.jsonPrimitive.boolean }, ex.options.indices.map { ChoiceMistake.isWrongOption(ex, it, st) }, "[$i/$k] wrong")
                assertEquals(so["picks"]!!.jsonArray.map { it.str }, ex.options.indices.map { ChoiceMistake.pickSpeech(ex, it, st) }, "[$i/$k] picks")
                assertEquals(sentence(so["sayAgain"]), ChoiceMistake.sayAgainSentence(ex, st), "[$i/$k] sayAgain")
            }
        }
    }

    @Test
    fun correctionCallMatchesTypeScript() {
        val f = fixture()
        for (c in f["cacheTexts"]!!.jsonArray) {
            val input = c.jsonObject["input"]!!.jsonObject
            assertEquals(c.jsonObject["text"]!!.str, ChoiceMistake.cacheText(input["question"]!!.str!!, input["sentence"]!!.str!!))
        }
        for ((i, c) in f["replies"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val sentence = o["sentence"]!!.str!!
            val expected = o["result"]!!
            val actual = runCatching { ChoiceMistake.normalize(o["raw"], sentence) }.getOrNull()
            if (expected is JsonNull) assertEquals(null, actual, "reply[$i]")
            else {
                val e = expected.jsonObject
                assertEquals(ChoiceMistake.Result(sentence(e["correction"])!!, e["unchanged"]!!.jsonPrimitive.boolean), actual, "reply[$i]")
            }
        }
        val spec = CustomLessonSpec(
            title = "t",
            sections = listOf(
                LessonSection(exercises = f["exercises"]!!.jsonArray.map { LessonJson.decodeFromJsonElement(LessonExercise.serializer(), it.jsonObject["exercise"]!!) }),
                LessonSection(exercises = listOf(LessonJson.decodeFromJsonElement(LessonExercise.serializer(), f["exercises"]!!.jsonArray[0].jsonObject["exercise"]!!))),
            ),
        )
        assertEquals(f["warnings"]!!.jsonArray.map { it.str }, ChoiceMistake.warnings(spec))
    }
}
