package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.NoteAudio.Clip
import dev.jeromeswannack.chineselearning.lab.core.NoteAudio.Clips
import dev.jeromeswannack.chineselearning.lab.core.NoteAudio.Status
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NoteAudioTest {
    private val full = Clips("n1", "generated/n1.mp3", "今天刮风了。", "generated/n1-s.mp3")

    @Test fun missingDetection() {
        assertEquals(emptySet(), NoteAudio.missing(full))
        assertEquals(setOf(Clip.WORD), NoteAudio.missing(full.copy(audioUrl = null)))
        assertEquals(setOf(Clip.WORD), NoteAudio.missing(full.copy(audioUrl = "  ")))
        assertEquals(setOf(Clip.SENTENCE), NoteAudio.missing(full.copy(sentenceClueAudioUrl = null)))
        // No sentence: nothing to voice.
        assertEquals(setOf(Clip.WORD), NoteAudio.missing(Clips("n", null, null, null)))
        assertEquals(emptySet(), NoteAudio.missing(Clips("n", "a.mp3", " ", null)))
        // A clip that 404'd counts as missing, whichever way its url is spelled.
        assertEquals(setOf(Clip.WORD), NoteAudio.missing(full.copy(audioUrl = "/api/audio/generated/n1.mp3"), setOf("generated/n1.mp3")))
        assertEquals(setOf(Clip.WORD, Clip.SENTENCE), NoteAudio.missing(full, setOf("generated/n1.mp3", "generated/n1-s.mp3")))
        assertEquals(listOf("generated/n1-s.mp3"), NoteAudio.brokenKeys(full, setOf("generated/n1-s.mp3", "other.mp3")))
    }

    @Test fun keyMatchesTheWorker() {
        assertEquals("generated/a.mp3", NoteAudio.key("/api/audio/generated/a.mp3"))
        assertEquals("generated/a.mp3", NoteAudio.key("api/audio/generated/a.mp3"))
        assertEquals("generated/a.mp3", NoteAudio.key("generated/a.mp3"))
    }

    @Test fun inFlightRequestsAreDeduped() {
        val t = NoteAudio.Tracker()
        assertTrue(t.start("n1", 0))
        assertFalse(t.start("n1", 1))
        assertFalse(t.start("n1", 2, manual = true)) // not even a retry tap while one is running
        assertEquals(Status.Generating, t.status("n1"))
        t.succeeded("n1")
        assertEquals(null, t.status("n1"))
        assertTrue(t.start("n1", 3))
    }

    @Test fun failuresBackOffLongerEachTimeAndRetryTapSkipsTheWait() {
        val t = NoteAudio.Tracker()
        assertTrue(t.start("n1", 0))
        assertEquals(30_000, t.failed("n1", 0))
        assertEquals(Status.Failed(1, 30_000), t.status("n1"))
        assertFalse(t.start("n1", 29_999))
        assertTrue(t.start("n1", 30_000))
        assertEquals(30_000 + 120_000, t.failed("n1", 30_000))
        assertFalse(t.mayStart("n1", 60_000))
        // The "Couldn't make audio — retry" button doesn't wait for the backoff.
        assertTrue(t.start("n1", 60_000, manual = true))
        assertEquals(60_000 + 600_000, t.failed("n1", 60_000))
        // Capped at the last step.
        var now = 60_000L
        repeat(5) { now += 7 * 3_600_000; assertTrue(t.start("n1", now)); t.failed("n1", now) }
        assertEquals(Status.Failed(8, now + NoteAudio.BACKOFF_MS.last()), t.status("n1"))
        // Success resets the count.
        assertTrue(t.start("n1", now, manual = true)); t.succeeded("n1")
        assertTrue(t.start("n1", now)); assertEquals(now + 30_000, t.failed("n1", now))
    }

    @Test fun offlineRequestsWaitInTheQueue() {
        val t = NoteAudio.Tracker()
        t.queueOffline("n1")
        t.queueOffline("n2")
        assertEquals(Status.WaitingForConnection, t.status("n1"))
        assertEquals(setOf("n1", "n2"), t.queued)
        assertTrue(t.start("n1", 0))
        assertEquals(setOf("n2"), t.queued)
        // Queued while a request runs: nothing to queue.
        t.queueOffline("n1")
        assertEquals(Status.Generating, t.status("n1"))
        assertEquals(setOf("n2"), t.queued)
        t.abandoned("n1")
        assertEquals(null, t.status("n1"))
        val restored = NoteAudio.Tracker().apply { restoreQueued(listOf("a", "b")) }
        assertEquals(setOf("a", "b"), restored.queued)
    }

    @Test fun backfillTakesTheQueuedFirstThenTheUpcomingQueueInOrder() {
        val notes = listOf(
            Clips("done", "a.mp3", null, null),
            Clips("noWord", null, null, null),
            Clips("noClue", "b.mp3", "句子。", null),
            Clips("broken", "c.mp3", null, null),
            Clips("offline", null, null, null),
            Clips("failing", null, null, null),
            Clips("running", null, null, null),
        ).associateBy { it.noteId }
        val t = NoteAudio.Tracker()
        t.queueOffline("offline")
        t.start("failing", 0); t.failed("failing", 0)
        t.start("running", 0)
        val upcoming = listOf("done", "noWord", "noWord", "failing", "running", "noClue", "broken", "gone")
        assertEquals(
            listOf("offline", "noWord", "noClue", "broken"),
            NoteAudio.backfillBatch(t.queued, upcoming, notes, setOf("c.mp3"), t, nowMs = 1_000),
        )
        // Past the backoff the failing note is tried again; the limit caps the pass.
        assertEquals(listOf("offline", "noWord"), NoteAudio.backfillBatch(t.queued, upcoming, notes, setOf("c.mp3"), t, nowMs = 60_000, limit = 2))
        assertEquals(
            listOf("offline", "noWord", "failing", "noClue"),
            NoteAudio.backfillBatch(t.queued, upcoming, notes, emptySet(), t, nowMs = 60_000),
        )
    }

    @Test fun queuedIsPendingNotAFailure() {
        assertTrue(NoteAudio.isPending("queued"))
        for (o in listOf("ok", "copied", "generated", "failed", "none", null)) assertFalse(NoteAudio.isPending(o))

        val t = NoteAudio.Tracker()
        assertTrue(t.start("n", 0))
        val s = t.coming("n", 1_000)
        assertEquals(Status.Coming(asks = 1, nextAskAtMs = 1_000 + NoteAudio.COMING_RETRY_MS), s)
        // No failure backoff: asked again after ~20 s, not 30 s / 2 min.
        assertFalse(t.mayStart("n", 1_000 + NoteAudio.COMING_RETRY_MS - 1))
        assertTrue(t.mayStart("n", 1_000 + NoteAudio.COMING_RETRY_MS))
        // The background pass respects the same wait.
        val notes = mapOf("n" to Clips("n", null, null, null))
        assertEquals(emptyList(), NoteAudio.backfillBatch(emptyList(), listOf("n"), notes, emptySet(), t, nowMs = 5_000))
        assertEquals(listOf("n"), NoteAudio.backfillBatch(emptyList(), listOf("n"), notes, emptySet(), t, nowMs = 21_000))
    }

    @Test fun reAskKeepsComingAndDedupes() {
        val t = NoteAudio.Tracker()
        t.start("n", 0)
        t.coming("n", 0)
        assertTrue(t.start("n", NoteAudio.COMING_RETRY_MS))
        // Still "coming" (no "Generating audio…" flash), and no second request while it is out.
        assertEquals(Status.Coming(1, NoteAudio.COMING_RETRY_MS, asking = true), t.status("n"))
        assertFalse(t.mayStart("n", 10 * NoteAudio.COMING_RETRY_MS))
        assertFalse(t.start("n", 10 * NoteAudio.COMING_RETRY_MS, manual = true))
        // Offline while asking: left alone.
        t.queueOffline("n")
        assertTrue("n" !in t.queued)
        // A cancelled re-ask leaves it coming, askable again.
        t.abandoned("n")
        assertEquals(Status.Coming(1, NoteAudio.COMING_RETRY_MS), t.status("n"))
        // The clip arrives.
        t.start("n", NoteAudio.COMING_RETRY_MS)
        t.succeeded("n")
        assertEquals(null, t.status("n"))
    }

    @Test fun comingIsThrottledToSixAsksThenFails() {
        val t = NoteAudio.Tracker()
        var now = 0L
        repeat(NoteAudio.COMING_MAX_ASKS - 1) { i ->
            assertTrue(t.start("n", now))
            val s = t.coming("n", now)
            assertEquals(i + 1, (s as Status.Coming).asks)
            now += NoteAudio.COMING_RETRY_MS
        }
        assertTrue(t.start("n", now))
        val last = t.coming("n", now)
        assertTrue(last is Status.Failed, "the ${NoteAudio.COMING_MAX_ASKS}th queued answer counts as a failure: $last")
        assertEquals(now + NoteAudio.BACKOFF_MS[0], (last as Status.Failed).retryAtMs)
        // The retry button starts a fresh count.
        assertTrue(t.start("n", now, manual = true))
        assertTrue(t.coming("n", now) is Status.Coming)
    }
}
