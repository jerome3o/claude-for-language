package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.LessonAudioClip
import dev.jeromeswannack.chineselearning.lab.core.LessonAudioClips
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Fetches a lesson's clips the phone doesn't have yet (the web's `createClipPrefetcher`,
 * frontend/src/services/lessonAudio.ts; docs/AUDIO.md "Lesson audio prefetch"): the exercise
 * on screen first, then the ones after it (core `LessonAudioClips.orderForPrefetch`), [concurrency]
 * at a time; [focus] moves another exercise's clips to the front of what's left. A clip already
 * being fetched is joined ([LessonMedia]'s one-request-per-clip lock), never asked for twice.
 * [run] works until every clip was looked at, offline, or its coroutine is cancelled.
 */
class LessonAudioPrefetcher(
    private val clips: List<LessonAudioClip>,
    current: Int = 0,
    private val isCached: suspend (LessonAudioClip) -> Boolean,
    /** Fetch + keep one clip; true when it is on the phone now. */
    private val fetch: suspend (LessonAudioClip) -> Boolean,
    private val online: () -> Boolean = { true },
    private val concurrency: Int = CONCURRENCY,
) {
    data class Result(val cached: Int, val fetched: Int, val failed: Int)

    private val lock = Any()
    private var queue = ArrayDeque(LessonAudioClips.orderForPrefetch(clips, current))
    private val taken = HashSet<String>()
    private var cached = 0
    private var fetched = 0
    private var failed = 0

    /** The learner is on exercise [index] now: its clips (then the ones after it) go first. */
    fun focus(index: Int) = synchronized(lock) {
        queue = ArrayDeque(LessonAudioClips.orderForPrefetch(clips, index).filter { LessonAudioClips.clipId(it) !in taken })
    }

    private fun next(): LessonAudioClip? = synchronized(lock) {
        while (queue.isNotEmpty()) {
            val c = queue.removeFirst()
            if (taken.add(LessonAudioClips.clipId(c))) return c
        }
        null
    }

    fun result(): Result = synchronized(lock) { Result(cached, fetched, failed) }

    suspend fun run(): Result {
        coroutineScope {
            repeat(maxOf(1, concurrency)) {
                launch {
                    while (online()) {
                        val clip = next() ?: break
                        try {
                            when {
                                isCached(clip) -> synchronized(lock) { cached++ }
                                !online() -> break
                                fetch(clip) -> synchronized(lock) { fetched++ }
                                else -> synchronized(lock) { failed++ }
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            synchronized(lock) { failed++ }
                        }
                    }
                }
            }
        }
        return result()
    }

    companion object {
        /** `LESSON_PREFETCH_CONCURRENCY`: clips fetched at once (the server's limiter paces TTS; most are R2 hits). */
        const val CONCURRENCY = 3
    }
}
