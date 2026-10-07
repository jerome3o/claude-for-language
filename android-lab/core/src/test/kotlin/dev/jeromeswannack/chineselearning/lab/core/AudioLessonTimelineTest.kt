package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The list's status line, the speed chip and formatMb (AudioLessonsPage.tsx / services/audioLessons.ts). */
class AudioLessonTimelineTest {
    private fun line(status: String, progress: String? = null, done: Int? = null, total: Int? = null, error: String? = null, duration: Long? = null, words: Int = 0, size: Long? = null) =
        AudioLessonTimeline.statusLine(status, progress, done, total, error, duration, words, size)

    @Test fun statusLines() {
        assertEquals("Waiting to start…", line("queued"))
        assertEquals("Claude is writing the lesson…", line("writing"))
        assertEquals("Checking the words you know…", line("writing", progress = "Checking the words you know…"))
        assertEquals("Recording…", line("speaking"))
        assertEquals("Recording 0 of 64 clips…", line("speaking", total = 64))
        assertEquals("Recording 12 of 64 clips…", line("speaking", done = 12, total = 64))
        assertEquals("Putting it together…", line("rendering"))
        assertEquals("Something went wrong", line("failed"))
        assertEquals("The voices are busy", line("failed", error = "The voices are busy"))
        assertEquals("13 min · 3 words · 6.1 MB", line("ready", duration = 780_000, words = 3, size = 6_400_000))
        assertEquals("1 min", line("ready", duration = 10_000))
        assertEquals("", line("ready"))
    }

    @Test fun speedChip() {
        assertEquals(0.9, AudioLessonTimeline.nextSpeed(0.75))
        assertEquals(1.0, AudioLessonTimeline.nextSpeed(0.9))
        assertEquals(1.25, AudioLessonTimeline.nextSpeed(1.0))
        assertEquals(0.75, AudioLessonTimeline.nextSpeed(1.25))
        assertEquals(0.75, AudioLessonTimeline.nextSpeed(2.0)) // indexOf -1 → the first speed, like the web
        assertEquals("0.75×", AudioLessonTimeline.speedLabel(0.75))
        assertEquals("1×", AudioLessonTimeline.speedLabel(1.0))
        assertEquals(1.0, AudioLessonTimeline.parseSpeed(null))
        assertEquals(1.0, AudioLessonTimeline.parseSpeed(0.5))
        assertEquals(1.25, AudioLessonTimeline.parseSpeed(1.25))
    }

    @Test fun mbAndChapters() {
        assertEquals("", AudioLessonTimeline.formatMb(null))
        assertEquals("", AudioLessonTimeline.formatMb(0))
        assertEquals("1.0 MB", AudioLessonTimeline.formatMb(1024L * 1024))
        val chapters = listOf(AudioLessonChapter("A", 0), AudioLessonChapter("B", 10_000), AudioLessonChapter("C", 20_000))
        assertEquals(10_000L, AudioLessonTimeline.nextChapterTarget(chapters, 500.0))
        assertNull(AudioLessonTimeline.nextChapterTarget(chapters, 25_000.0))
        assertTrue(AudioLessonTimeline.isBuilding("speaking"))
        assertFalse(AudioLessonTimeline.isBuilding("failed"))
        assertEquals(12, AudioLessonTimeline.Limits.defaultMinutes("dialogue"))
        assertEquals(20, AudioLessonTimeline.Limits.defaultMinutes("sleep"))
    }
}
