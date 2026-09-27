package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Package B's port against the web app's TypeScript (parity/fixtures/lesson.ts):
 * answer checking, scramble, conversation voices, every sample lesson through the
 * Kotlin spec model, attempt helpers and pickTodaysReader.
 */
class LessonParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "lesson.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonElement.strings(): List<String> = jsonArray.map { it.jsonPrimitive.content }

    @Test fun answerChecking() {
        for ((i, el) in root["answers"]!!.jsonArray.withIndex()) {
            val c = el.jsonObject
            val answer = c["answer"]!!.str!!
            val expected = c["expected"]!!.str!!
            val alts = c["alternatives"]!!.strings()
            val where = "answer #$i ${Json.encodeToString(JsonElement.serializer(), c["answer"]!!)} vs $expected"
            assertEquals(c["normalized"]!!.str, LessonAnswers.normalizeHanzi(answer), "$where normalized")
            assertEquals(c["correct"]!!.jsonPrimitive.boolean, LessonAnswers.isHanziCorrect(answer, expected, alts), "$where correct")
            assertEquals(c["uses"]!!.jsonPrimitive.boolean, LessonAnswers.sentenceUsesWord(answer, LessonAnswers.chars(expected).take(2).joinToString("")), "$where uses")
            assertEquals(c["exact"]!!.jsonPrimitive.boolean, LessonAnswers.isExactHanziMatch(answer, expected), "$where exact")
            val d = c["diff"]!!.jsonObject
            val k = LessonAnswers.diffHanzi(answer, expected, alts)
            assertEquals(d["correct"]!!.jsonPrimitive.boolean, k.correct, "$where diff.correct")
            assertEquals(d["accuracy"]!!.jsonPrimitive.double, k.accuracy, "$where accuracy")
            assertEquals(marks(d["expected"]!!), k.expected.map { it.ch to it.hit }, "$where expected marks")
            assertEquals(marks(d["typed"]!!), k.typed.map { it.ch to it.hit }, "$where typed marks")
        }
    }

    private fun marks(el: JsonElement) = el.jsonArray.map { it.jsonObject["ch"]!!.str!! to it.jsonObject["hit"]!!.jsonPrimitive.boolean }

    @Test fun scramble() {
        for (el in root["scrambles"]!!.jsonArray) {
            val c = el.jsonObject
            val alt = c["alt"]!!.let { if (it is JsonNull) null else it.jsonArray.map { a -> a.strings() } }
            assertEquals(c["ok"]!!.jsonPrimitive.boolean, LessonAnswers.checkScrambleOrder(c["user"]!!.strings(), c["correct"]!!.strings(), alt), c.toString())
        }
    }

    @Test fun conversationVoices() {
        for (el in root["voices"]!!.jsonArray) {
            val c = el.jsonObject
            val speakers = LessonJson.decodeFromJsonElement(ListSerializer(ConversationSpeaker.serializer()), c["speakers"]!!)
            assertEquals(c["voices"]!!.strings(), Lessons.conversationVoices(speakers), c.toString())
        }
    }

    @Test fun everySampleDecodesAndMatches() {
        val samples = root["samples"]!!.jsonArray
        assertEquals(15, samples.size)
        for (el in samples) {
            val c = el.jsonObject
            val id = c["id"]!!.str!!
            val spec = LessonJson.decodeFromJsonElement(CustomLessonSpec.serializer(), c["spec"]!!)
            val exercises = spec.sections.flatMap { it.exercises }
            assertTrue(exercises.none { it is UnknownExercise }, "$id has an unknown exercise")
            assertTrue(exercises.any { it.type == id }, "$id sample has its type")
            assertEquals(c["count_scoreable"]!!.jsonPrimitive.int, Lessons.countScoreable(spec), "$id countScoreable")
            assertEquals(c["points"]!!.jsonArray.map { it.jsonPrimitive.int }, exercises.map(Lessons::exercisePoints), "$id points")
            assertEquals(c["primary"]!!.strings(), exercises.map(Lessons::primaryText), "$id primary text")
            assertEquals(c["tts_texts"]!!.strings(), Lessons.ttsTexts(spec), "$id tts texts")
            assertEquals(
                c["tts_clips"]!!.jsonArray.map { it.jsonObject["text"]!!.str to it.jsonObject["voice"]!!.str },
                Lessons.ttsClips(spec).map { it.text to it.voice },
                "$id tts clips",
            )
            // Round trip: encoding keeps every field the server sent.
            val again = LessonJson.decodeFromString(CustomLessonSpec.serializer(), LessonJson.encodeToString(CustomLessonSpec.serializer(), spec))
            assertEquals(spec, again, "$id round trip")
        }
    }

    @Test fun unknownExerciseSurvives() {
        val text = """{"title":"t","sections":[{"exercises":[{"type":"hologram","x":1},{"type":"note","title":"n"}]}]}"""
        val spec = LessonJson.decodeFromString(CustomLessonSpec.serializer(), text)
        val ex = spec.sections[0].exercises
        assertTrue(ex[0] is UnknownExercise)
        assertEquals("n", (ex[1] as NoteExercise).title)
        val back = Json.parseToJsonElement(LessonJson.encodeToString(CustomLessonSpec.serializer(), spec)).jsonObject
        assertEquals(1, back["sections"]!!.jsonArray[0].jsonObject["exercises"]!!.jsonArray[0].jsonObject["x"]!!.jsonPrimitive.int)
    }

    @Test fun attemptHelpers() {
        for (el in root["durations"]!!.jsonArray) {
            val c = el.jsonObject
            assertEquals(c["text"]!!.str, LessonAttempts.formatDuration(c["ms"]!!.jsonPrimitive.long))
        }
        for (el in root["attempts"]!!.jsonArray) {
            val c = el.jsonObject
            val data = LessonJson.decodeFromJsonElement(LessonAttemptData.serializer(), c["data"]!!)
            val expected = c["sections"]!!.jsonArray.map {
                val o = it.jsonObject
                SectionTime(o["section"]!!.jsonPrimitive.int, o["duration_ms"]!!.jsonPrimitive.long, o["exercises"]!!.jsonPrimitive.int, o["correct"]!!.jsonPrimitive.int, o["scored"]!!.jsonPrimitive.int)
            }
            assertEquals(expected, LessonAttempts.sectionTimes(data))
        }
    }

    @Test fun pickTodaysReader() {
        for ((i, el) in root["readers"]!!.jsonArray.withIndex()) {
            val c = el.jsonObject
            val readers = c["readers"]!!.jsonArray.map {
                val r = it.jsonObject
                val due = r["due_timestamp"]!!.let { d -> if (d is JsonNull) null else d.jsonPrimitive.long }
                ScheduledItem(
                    id = r["id"]!!.str!!,
                    createdAt = r["created_at"]!!.str!!,
                    state = stateOf(r["queue"]!!.jsonPrimitive.int, due, r["next_review_at"]!!.str),
                    studyable = r["status"]!!.str == "ready" && r["pages"]!!.jsonPrimitive.int > 0,
                )
            }
            val readToday = c["read_today"]!!.strings().toSet()
            val picked = ReaderSchedule.pickTodays(readers, readToday, StudyCutoff(c["cutoff"]!!.jsonPrimitive.long))
            assertEquals(c["picked"]!!.str, picked?.id, "reader case #$i")
        }
    }

    private fun stateOf(queue: Int, due: Long?, next: String?) = CardScheduler.initialCardState().copy(queue = queue, dueTimestamp = due, nextReviewAt = next)

    @Suppress("unused") private fun JsonArray.bools() = map { it.jsonPrimitive.booleanOrNull }
}
