package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
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
 * Feedback while listening: AudioLessonFeedback.kt reproduces shared/audio-lesson/feedback.ts exactly
 * (parity/fixtures/audio-lesson-feedback.ts) — the row playing, back / next a section with the 2 s grace
 * at every speed, the events' row snapshots and which row an event is about — over the sample dialogue,
 * sleep and story lessons as the web compiles and times them.
 */
class AudioLessonFeedbackParityTest {
    private val json = Json { ignoreUnknownKeys = true }

    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "audio-lesson-feedback.json").readText()).jsonObject
    }

    /** JSON has no NaN: the fixture's null speed is NaN. */
    private fun speedOf(e: JsonElement?): Double = if (e == null || e is JsonNull) Double.NaN else e.jsonPrimitive.double

    private fun jumpOf(e: JsonElement?): SectionJump? = if (e == null || e is JsonNull) null else e.jsonObject.let {
        SectionJump(it["target_ms"]!!.jsonPrimitive.long, it["row_index"]!!.jsonPrimitive.int, it["kind"]!!.jsonPrimitive.content)
    }

    private fun lines(e: JsonElement) = json.decodeFromJsonElement(ListSerializer(AudioLessonTranscriptLine.serializer()), e)

    @Test
    fun graceScalesWithSpeed() {
        assertEquals(fixture["graceMs"]!!.jsonPrimitive.long, AudioLessonFeedback.BACK_SECTION_GRACE_MS)
        for (g in fixture["graces"]!!.jsonArray.map { it.jsonObject }) {
            val speed = speedOf(g["speed"])
            assertEquals(g["ms"]!!.jsonPrimitive.long, AudioLessonFeedback.sectionGraceMs(speed), "sectionGraceMs($speed)")
        }
    }

    @Test
    fun sectionsAndEventsOverRealLessonsMatchTypeScript() {
        val lessons = fixture["lessons"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf("dialogue", "sleep", "story"), lessons.map { it["name"]!!.jsonPrimitive.content })
        for (lesson in lessons) {
            val name = lesson["name"]!!.jsonPrimitive.content
            val chapters = json.decodeFromJsonElement(ListSerializer(AudioLessonChapter.serializer()), lesson["chapters"]!!)
            val rows = AudioLessonTimeline.transcriptRows(lines(lesson["transcript"]!!))
            val kinds = mutableSetOf<String>()
            for (q in lesson["queries"]!!.jsonArray.map { it.jsonObject }) {
                val ms = q["ms"]!!.jsonPrimitive.double
                val speed = speedOf(q["speed"])
                assertEquals(q["row"]!!.jsonPrimitive.int, AudioLessonFeedback.rowIndexAt(rows, ms), "$name rowIndexAt $ms")
                val back = AudioLessonFeedback.backSectionTarget(rows, ms, speed)
                assertEquals(jumpOf(q["back"]), back, "$name backSectionTarget $ms @$speed")
                back?.let { kinds += it.kind }
                assertEquals(jumpOf(q["next"]), AudioLessonFeedback.nextSectionTarget(rows, ms), "$name nextSectionTarget $ms")
            }
            assertEquals(setOf(AudioLessonFeedback.AGAIN, AudioLessonFeedback.BACK_SECTION), kinds, "$name exercises both sides of the grace")
            for (e in lesson["events"]!!.jsonArray.map { it.jsonObject }) {
                val expected = json.decodeFromJsonElement(AudioLessonFeedbackEvent.serializer(), e["event"]!!)
                val built = AudioLessonFeedback.buildEvent(
                    id = expected.id,
                    lessonId = expected.audioLessonId,
                    kind = e["kind"]!!.jsonPrimitive.content,
                    where = "lock_screen",
                    positionMs = e["ms"]!!.jsonPrimitive.double,
                    speed = speedOf(e["speed"]),
                    audioVersion = expected.audioVersion,
                    createdAt = expected.createdAt,
                    rows = rows,
                    chapters = chapters,
                )
                assertEquals(expected, built, "$name buildFeedbackEvent ${e["ms"]}")
                assertEquals(e["flagged"]!!.jsonPrimitive.intOrNull, AudioLessonFeedback.flaggedRowIndex(built), "$name flaggedRowIndex ${built.kind} ${built.positionMs}")
            }
        }
        // The upload body round-trips through the same JSON the server reads.
        val any = lessons[0]["events"]!!.jsonArray[5].jsonObject["event"]!!
        val ev = json.decodeFromJsonElement(AudioLessonFeedbackEvent.serializer(), any)
        assertTrue(ev.row != null && ev.chapterIndex >= 0)
    }

    @Test
    fun longRowsAreCutLikeTheWeb() {
        val long = fixture["long"]!!.jsonObject
        val rows = AudioLessonTimeline.transcriptRows(lines(long["transcript"]!!))
        val expected = json.decodeFromJsonElement(AudioLessonFeedbackEvent.serializer(), long["event"]!!)
        val built = AudioLessonFeedback.buildEvent("ev-long", "al-long", AudioLessonFeedback.TOO_HARD, AudioLessonFeedback.PLAYER, 15_000.6, 1.0, null, "x", rows, emptyList())
        assertEquals(expected, built)
        assertEquals(300, built.row!!.text.length)
    }
}
