package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.LessonAudioClip
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** The open lesson's prefetch (web lessonAudio.test.ts): order, focus, concurrency, offline, cancel. */
class LessonAudioPrefetcherTest {
    private fun clip(text: String, exercise: Int) = LessonAudioClip(LessonAudioClip.TTS, text, exercise = exercise)

    @Test fun missingClipsCurrentExerciseFirstEachOnceAtMostNAtATime() = runTest {
        val clips = listOf(clip("一", 0), clip("二", 1), clip("三", 2), clip("一", 3), clip("四", 3))
        val order = ArrayList<String>()
        val inFlight = AtomicInteger()
        var maxInFlight = 0
        val p = LessonAudioPrefetcher(
            clips, current = 2, concurrency = 2,
            isCached = { it.text == "二" },
            fetch = {
                order += it.text
                maxInFlight = maxOf(maxInFlight, inFlight.incrementAndGet())
                yield()
                inFlight.decrementAndGet()
                it.text != "四"
            },
        )
        assertEquals(LessonAudioPrefetcher.Result(cached = 1, fetched = 2, failed = 1), p.run())
        assertEquals(listOf("三", "一", "四"), order)
        assertEquals(2, maxInFlight)
    }

    @Test fun focusMovesTheNewExerciseToTheFront() = runTest {
        val clips = listOf("a", "b", "c", "d", "e").mapIndexed { i, t -> clip(t, i) }
        val gates = HashMap<String, CompletableDeferred<Boolean>>()
        val order = ArrayList<String>()
        val p = LessonAudioPrefetcher(clips, concurrency = 1, isCached = { false }, fetch = {
            order += it.text
            CompletableDeferred<Boolean>().also { d -> gates[it.text] = d }.await()
        })
        val job = async { p.run() }
        runCurrent()
        assertEquals(listOf("a"), order)
        p.focus(3)
        for (t in listOf("a", "d", "e", "b", "c")) {
            runCurrent()
            gates.getValue(t).complete(true)
        }
        job.await()
        assertEquals(listOf("a", "d", "e", "b", "c"), order)
    }

    @Test fun stopsOfflineAndWhenCancelled() = runTest {
        var online = true
        val fetched = ArrayList<String>()
        val p = LessonAudioPrefetcher(listOf(clip("a", 0), clip("b", 1)), concurrency = 1, online = { online }, isCached = { false }, fetch = {
            fetched += it.text
            online = false
            true
        })
        p.run()
        assertEquals(listOf("a"), fetched)

        val never = CompletableDeferred<Boolean>()
        val q = LessonAudioPrefetcher(listOf(clip("a", 0), clip("b", 1)), concurrency = 1, isCached = { false }, fetch = { never.await() })
        val job = launch { q.run() }
        runCurrent()
        job.cancel()
        runCurrent()
        assertEquals(LessonAudioPrefetcher.Result(0, 0, 0), q.result())
    }
}
