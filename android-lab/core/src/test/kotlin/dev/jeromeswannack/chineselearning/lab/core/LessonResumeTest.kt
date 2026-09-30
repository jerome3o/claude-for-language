package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Save / restore / clear rules for a mini lesson left half-way. */
class LessonResumeTest {
    private val now = 1_790_000_000_000L
    private val hour = 3_600_000L
    private val hash = LessonResume.specHash("""{"title":"把","sections":[]}""")

    private fun saved(index: Int = 3, day: String = "2026-09-27", savedAt: Long = now - hour, specHash: String = hash, lessonId: String = "L1") =
        LessonResume.Progress(lessonId, specHash, day, savedAt, savedAt - hour, index, correct = 2, total = 3,
            attempts = listOf(ExerciseAttempt(0, 0, "choice", correct = true, points = 1, maxPoints = 1, answer = ExerciseAnswer(choice = 1))),
            recordings = listOf(LessonResume.SavedRecording("s0e2", "/files/outbox/x-lesson-recording.m4a", "audio/mp4")))

    @Test fun sameDaySameSpecContinues() {
        val s = saved()
        assertEquals(s, LessonResume.restorable(s, "L1", hash, "2026-09-27", now, exerciseCount = 9))
    }

    @Test fun anotherDayStartsFresh() {
        val s = saved(day = "2026-09-26", savedAt = now - 2 * hour)
        assertNull(LessonResume.restorable(s, "L1", hash, "2026-09-27", now, 9))
        assertTrue(LessonResume.isStale(s, hash, "2026-09-27", now))
    }

    @Test fun olderThanEighteenHoursStartsFresh() {
        assertNull(LessonResume.restorable(saved(savedAt = now - 18 * hour - 1), "L1", hash, "2026-09-27", now, 9))
        assertTrue(LessonResume.restorable(saved(savedAt = now - 18 * hour), "L1", hash, "2026-09-27", now, 9) != null)
        // A save "in the future" (clock moved back) isn't trusted either.
        assertNull(LessonResume.restorable(saved(savedAt = now + hour), "L1", hash, "2026-09-27", now, 9))
    }

    @Test fun anEditedSpecStartsFresh() {
        val edited = LessonResume.specHash("""{"title":"把 (v2)","sections":[]}""")
        assertNotEquals(hash, edited)
        assertNull(LessonResume.restorable(saved(), "L1", edited, "2026-09-27", now, 9))
        assertTrue(LessonResume.isStale(saved(), edited, "2026-09-27", now))
    }

    @Test fun indexMustFitTheLesson() {
        assertNull(LessonResume.restorable(saved(index = 0), "L1", hash, "2026-09-27", now, 9)) // nothing answered yet
        assertEquals(9, LessonResume.restorable(saved(index = 9), "L1", hash, "2026-09-27", now, 9)?.index) // all answered: the rating
        assertNull(LessonResume.restorable(saved(index = 10), "L1", hash, "2026-09-27", now, 9))
        assertNull(LessonResume.restorable(saved(lessonId = "L2"), "L1", hash, "2026-09-27", now, 9))
        assertNull(LessonResume.restorable(null, "L1", hash, "2026-09-27", now, 9))
    }

    @Test fun roundTripsAsJson() {
        val s = saved()
        val json = Json { ignoreUnknownKeys = true }
        val text = json.encodeToString(LessonResume.Progress.serializer(), s)
        assertTrue("\"spec_hash\"" in text && "\"media_key\"" in text)
        assertEquals(s, json.decodeFromString(LessonResume.Progress.serializer(), text))
    }

    @Test fun hashIsStableAndSensitive() {
        assertEquals(LessonResume.specHash("abc"), LessonResume.specHash("abc"))
        assertFalse(LessonResume.specHash("abc") == LessonResume.specHash("abd"))
    }

    @Test fun continueLine() {
        assertEquals("Continuing where you left off · 4 of 9", LessonResume.continueLine(3, 9))
        assertEquals("Continuing where you left off · all done", LessonResume.continueLine(9, 9))
    }
}
