package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
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
 * The audio-lesson player's helpers reproduce shared/audio-lesson/timeline.ts exactly
 * (parity/fixtures/audio-lesson.ts): chapter / line lookup, "previous chapter", clock text,
 * the sleep fade, transcript rows — over the sample dialogue and sleep lessons as the web
 * compiles and times them.
 */
class AudioLessonParityTest {
    private val json = Json { ignoreUnknownKeys = true }

    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "audio-lesson.json").readText()).jsonObject
    }

    private fun rowsOf(o: kotlinx.serialization.json.JsonElement) = o.jsonArray.map { r ->
        val x = r.jsonObject
        AudioLessonTranscriptRow(
            first = x["first"]!!.jsonPrimitive.int,
            last = x["last"]!!.jsonPrimitive.int,
            startMs = x["start_ms"]!!.jsonPrimitive.long,
            lang = x["lang"]!!.jsonPrimitive.content,
            text = x["text"]!!.jsonPrimitive.content,
            pinyin = x["pinyin"]?.jsonPrimitive?.content,
            english = x["english"]?.jsonPrimitive?.content,
            repeat = x["repeat"]?.jsonPrimitive?.int,
            again = x["again"]?.jsonPrimitive?.int,
        )
    }

    @Test
    fun lookupsOverRealLessonsMatchTypeScript() {
        val lessons = fixture["lessons"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf("dialogue", "sleep", "story"), lessons.map { it["name"]!!.jsonPrimitive.content })
        for (lesson in lessons) {
            val name = lesson["name"]!!.jsonPrimitive.content
            val chapters = json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(AudioLessonChapter.serializer()), lesson["chapters"]!!)
            val lines = json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(AudioLessonTranscriptLine.serializer()), lesson["transcript"]!!)
            assertTrue(chapters.size > 3 && lines.size > 30, "$name is a real lesson")
            val queries = lesson["queries"]!!.jsonArray.map { it.jsonObject }
            var backs = 0
            for (q in queries) {
                val ms = q["ms"]!!.jsonPrimitive.double
                assertEquals(q["chapter"]!!.jsonPrimitive.int, AudioLessonTimeline.chapterIndexAt(chapters, ms), "$name chapterIndexAt $ms")
                assertEquals(q["line"]!!.jsonPrimitive.int, AudioLessonTimeline.transcriptIndexAt(lines, ms), "$name transcriptIndexAt $ms")
                val prev = AudioLessonTimeline.previousChapterTarget(chapters, ms)
                assertEquals(q["previous"]!!.jsonPrimitive.long, prev, "$name previousChapterTarget $ms")
                if (prev < chapters[AudioLessonTimeline.chapterIndexAt(chapters, ms)].startMs) backs++
            }
            assertTrue(backs > 0, "$name exercises the 3 s grace")
            val rows = AudioLessonTimeline.transcriptRows(lines)
            assertEquals(rowsOf(lesson["rows"]!!), rows, "$name transcriptRows")
            // The repeat chip's words ("×3", "×3 +1") and what a screen reader says.
            val labels = lesson["labels"]!!.jsonArray.map { it.jsonArray.let { a -> a[0].jsonPrimitive.content to a[1].jsonPrimitive.content } }
            assertEquals(labels, rows.map { AudioLessonTimeline.repeatLabel(it.repeat, it.again) }, "$name repeatLabel")
        }
        // The dialogue's intro is narration around Chinese: one row of several lines.
        val dialogueRows = AudioLessonTimeline.transcriptRows(
            json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(AudioLessonTranscriptLine.serializer()), lessons[0]["transcript"]!!),
        )
        assertTrue(dialogueRows.any { it.last > it.first && it.text.contains("兰州拉面") })
        // A story: one row per line, said three times, its English joined to it.
        val storyRows = AudioLessonTimeline.transcriptRows(
            json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(AudioLessonTranscriptLine.serializer()), lessons[2]["transcript"]!!),
        )
        assertEquals(25, storyRows.size)
        assertTrue(storyRows.all { it.repeat == 3 && !it.english.isNullOrEmpty() })
        assertEquals("明慧：你好！你今天想喝什么？", storyRows[0].text)
    }

    @Test
    fun formatsAndTheStoryEstimateMatchTypeScript() {
        val f = fixture["formats"]!!.jsonObject
        assertEquals(f["all"]!!.jsonArray.map { it.jsonPrimitive.content }, AudioLessonFormats.ALL)
        for (i in f["info"]!!.jsonArray.map { it.jsonObject }) {
            val format = i["format"]?.jsonPrimitive?.contentOrNull
            val want = i["info"]!!.jsonObject
            assertEquals(
                AudioLessonFormatInfo(want["icon"]!!.jsonPrimitive.content, want["label"]!!.jsonPrimitive.content, want["short"]!!.jsonPrimitive.content, want["kind"]!!.jsonPrimitive.content),
                AudioLessonFormats.info(format),
                "info $format",
            )
        }
        for (d in f["defaultMinutes"]!!.jsonArray.map { it.jsonObject }) {
            val format = d["format"]!!.jsonPrimitive.content
            assertEquals(d["minutes"]!!.jsonPrimitive.int, AudioLessonTimeline.Limits.defaultMinutes(format), "defaultMinutes $format")
        }
        assertEquals(f["storyText"]!!.jsonPrimitive.int, AudioLessonTimeline.Limits.STORY_TEXT)
        assertEquals(f["msPerHan"]!!.jsonPrimitive.int, AudioLessonFormats.STORY_MS_PER_HAN)
        assertEquals(f["maxMinutes"]!!.jsonPrimitive.int, AudioLessonFormats.STORY_MAX_MINUTES)
        for (e in f["estimates"]!!.jsonArray.map { it.jsonObject }) {
            val text = e["text"]!!.jsonPrimitive.content
            val got = AudioLessonFormats.storyMinutesForText(text)
            val label = text.take(12)
            assertEquals(e["minutes"]!!.jsonPrimitive.int, got.minutes, "minutes $label (${text.length})")
            assertEquals(e["han"]!!.jsonPrimitive.int, got.han, "han $label")
            assertEquals(e["capped"]!!.jsonPrimitive.boolean, got.capped, "capped $label")
            assertEquals(e["line"]!!.jsonPrimitive.content, AudioLessonFormats.storyEstimateLine(text), "line $label")
        }
    }

    @Test
    fun transcriptRowEdgesMatchTypeScript() {
        for ((i, c) in fixture["rowCases"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val lines = json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(AudioLessonTranscriptLine.serializer()), c["lines"]!!)
            assertEquals(rowsOf(c["rows"]!!), AudioLessonTimeline.transcriptRows(lines), "row case $i")
        }
    }

    @Test
    fun clockDurationAndFadeMatchTypeScript() {
        for (c in fixture["clocks"]!!.jsonArray.map { it.jsonObject }) {
            val ms = c["ms"]!!.jsonPrimitive.double
            assertEquals(c["clock"]!!.jsonPrimitive.content, AudioLessonTimeline.formatClock(ms), "formatClock $ms")
            assertEquals(c["duration"]!!.jsonPrimitive.content, AudioLessonTimeline.durationLabel(ms), "durationLabel $ms")
        }
        for (f in fixture["fades"]!!.jsonArray.map { it.jsonObject }) {
            val ms = f["ms"]!!.jsonPrimitive.double
            assertEquals(f["volume"]!!.jsonPrimitive.double, AudioLessonTimeline.sleepFadeVolume(ms), "sleepFadeVolume $ms")
        }
        assertEquals(fixture["fadeMs"]!!.jsonPrimitive.long, AudioLessonTimeline.SLEEP_FADE_MS)
    }

    @Test
    fun musicBedMatchesTypeScript() {
        val m = fixture["music"]!!.jsonObject
        assertEquals(m["defaultVolume"]!!.jsonPrimitive.double, AudioLessonMusic.DEFAULT_VOLUME)
        assertEquals(m["minVolume"]!!.jsonPrimitive.double, AudioLessonMusic.MIN_VOLUME)
        assertEquals(m["maxVolume"]!!.jsonPrimitive.double, AudioLessonMusic.MAX_VOLUME)
        for (d in m["defaults"]!!.jsonArray.map { it.jsonObject }) {
            val format = d["format"]?.jsonPrimitive?.contentOrNull
            assertEquals(d["on"]!!.jsonPrimitive.boolean, AudioLessonMusic.defaultOn(format), "defaultOn $format")
        }
        for (o in m["on"]!!.jsonArray.map { it.jsonObject }) {
            val raw = o["raw"]?.jsonPrimitive?.contentOrNull
            val format = o["format"]?.jsonPrimitive?.contentOrNull
            assertEquals(o["on"]!!.jsonPrimitive.boolean, AudioLessonMusic.parseOn(raw, format), "parseOn $raw $format")
        }
        for (v in m["volumes"]!!.jsonArray.map { it.jsonObject }) {
            val raw = v["raw"]?.jsonPrimitive?.doubleOrNull
            assertEquals(v["volume"]!!.jsonPrimitive.double, AudioLessonMusic.parseVolume(raw), "parseVolume $raw")
            assertEquals(v["label"]!!.jsonPrimitive.content, AudioLessonMusic.volumeLabel(raw ?: Double.NaN), "volumeLabel $raw")
        }
        for (o in m["outputs"]!!.jsonArray.map { it.jsonObject }) {
            val volume = o["volume"]!!.jsonPrimitive.double
            val fade = o["fade"]!!.jsonPrimitive.double
            assertEquals(o["out"]!!.jsonPrimitive.double, AudioLessonMusic.outputVolume(volume, fade), "outputVolume $volume × $fade")
        }
        for (p in m["plays"]!!.jsonArray.map { it.jsonObject }) {
            val on = p["on"]!!.jsonPrimitive.boolean
            val playing = p["lessonPlaying"]!!.jsonPrimitive.boolean
            assertEquals(p["play"]!!.jsonPrimitive.boolean, AudioLessonMusic.shouldPlay(on, playing))
        }
    }

    @Test
    fun speedsAndTimerChoicesMatchTypeScript() {
        assertEquals(fixture["speeds"]!!.jsonArray.map { it.jsonPrimitive.double }, AudioLessonTimeline.SPEEDS)
        val timer = fixture["timer"]!!.jsonArray.map { it.jsonObject }
        assertEquals(timer.map { it["minutes"]!!.jsonPrimitive.int }, AudioLessonTimeline.SLEEP_TIMER_CHOICES)
        for (t in timer) assertEquals(t["label"]!!.jsonPrimitive.content, AudioLessonTimeline.sleepTimerLabel(t["minutes"]!!.jsonPrimitive.int))
    }
}
