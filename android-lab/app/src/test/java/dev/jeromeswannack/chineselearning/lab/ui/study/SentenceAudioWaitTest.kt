package dev.jeromeswannack.chineselearning.lab.ui.study

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/** ▶ on a new set row waits for the real clip ("Audio coming…") instead of the phone's voice. */
class SentenceAudioWaitTest {
    private fun run(answers: List<String?>, throwAt: Int = -1): Pair<SentenceAudioWait.Result, Int> = runBlocking {
        var asked = 0
        var comingShown = 0
        val r = SentenceAudioWait.await(
            ask = {
                val i = asked++
                if (i == throwAt) error("offline")
                answers.getOrElse(i) { SentenceAudioWait.COMING }
            },
            onComing = { comingShown++ },
            sleep = {},
        )
        r to comingShown
    }

    @Test
    fun readyAtOnce() {
        assertEquals(SentenceAudioWait.Result.Ready("generated/s1.mp3") to 0, run(listOf("generated/s1.mp3")))
    }

    @Test
    fun comingThenReady() {
        assertEquals(SentenceAudioWait.Result.Ready("generated/s1.mp3") to 2, run(listOf(SentenceAudioWait.COMING, SentenceAudioWait.COMING, "generated/s1.mp3")))
    }

    @Test
    fun cannotBeMadeOrFails() {
        assertEquals(SentenceAudioWait.Result.Unavailable to 0, run(listOf(null)))
        assertEquals(SentenceAudioWait.Result.Unavailable to 1, run(listOf(SentenceAudioWait.COMING), throwAt = 1))
    }

    @Test
    fun givesUpQuietly() {
        assertEquals(SentenceAudioWait.Result.StillComing to SentenceAudioWait.POLLS, run(emptyList()))
    }
}
