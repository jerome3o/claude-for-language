package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSpec
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** "▶ Watch the intro" (shared/lesson/patternIntro.ts): the voice-over, the intro clip, what it says, the lit part. */
class LessonPatternIntroParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "lesson-pattern-intro.json").readText()).jsonObject
    }

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Serializable private data class Ex(val hanzi: String, val pinyin: String? = null, val english: String? = null, val parts: List<PatternExamplePart>)
    @Serializable private data class C(val pattern: LessonPattern, val examples: List<Ex> = emptyList())

    private fun card(c: C) = LessonPatterns.Card(c.pattern, c.examples.map { LessonPatterns.Example(it.hanzi, it.pinyin, it.english, it.parts) }, emptyList())

    @Test
    fun introsMatchTypeScript() {
        val cases = fixture()["intros"]!!.jsonArray
        assertTrue(cases.size > 80)
        for (c in cases) {
            val o = c.jsonObject
            val card = card(json.decodeFromJsonElement(C.serializer(), o["card"]!!))
            assertEquals(json.decodeFromJsonElement(ListSerializer(PatternIntroLine.serializer()), o["lines"]!!), LessonPatternIntro.lines(card))
            val clip = LessonPatternIntro.clip(card)
            assertEquals(json.decodeFromJsonElement(ClipSpec.serializer(), o["clip"]!!), clip, "clip of ${card.pattern.name}")
            assertEquals(o["texts"]!!.jsonArray.map { it.jsonPrimitive.content }, Clips.utterances(clip).map { it.text })
        }
    }

    @Test
    fun notesPrefetchTheIntro() {
        for (c in fixture()["notes"]!!.jsonArray) {
            val o = c.jsonObject
            val note = LessonJson.decodeFromJsonElement(LessonExercise.serializer(), o["note"]!!) as NoteExercise
            assertEquals(o["texts"]!!.jsonArray.map { it.jsonPrimitive.content }, Lessons.exerciseTtsTexts(note))
            val view = LessonPatterns.noteView(note.body, note.sentences, note.patterns)!!
            assertEquals(o["intro"]!!.jsonArray.map { it.jsonPrimitive.content }, LessonPatternIntro.texts(view))
        }
    }

    @Test
    fun litPartMatchesTypeScript() {
        for (c in fixture()["lit"]!!.jsonArray) {
            val o = c.jsonObject
            val parts = json.decodeFromJsonElement(ListSerializer(PatternExamplePart.serializer()), o["parts"]!!)
            val duration = o["duration"]!!.jsonPrimitive.int.toDouble()
            for (a in o["at"]!!.jsonArray) {
                val at = a.jsonObject
                assertEquals(at["part"]!!.jsonPrimitive.int, LessonPatternIntro.litPart(parts, at["ms"]!!.jsonPrimitive.int.toDouble(), duration))
            }
        }
    }
}
