package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.launch

/** Package B's singletons for one app: the lesson store, media and playback. */
class LessonRuntime private constructor(val app: LabApp) {
    val store = LessonStore(app.cache, app.outbox, app.repo.api, LessonProgressStore.get(app))
    val media: LessonMedia get() = store.media
    val audio = LessonAudio(app, store.media, app.scope) { app.online.value }
    /** Graded readers (package B, same runtime: they share the media cache and the player). */
    val readers = dev.jeromeswannack.chineselearning.lab.data.readers.ReaderStore(app.cache, app.outbox, app.repo.api)

    /**
     * After a lesson (web: `syncCustomLessons()` right after completing): send the completion
     * and its recordings now when online; the background worker covers offline.
     */
    fun uploadSoon() {
        app.scheduleBackgroundUpload()
        if (!app.online.value) return
        app.scope.launch {
            runCatching { app.outbox.drain() }
            runCatching { store.uploadMedia() }
        }
    }

    /**
     * The open lesson's prefetch (docs/AUDIO.md "Lesson audio prefetch"): every clip the phone
     * doesn't have yet, the exercise in [current] first and refocused as it changes; runs until the
     * lesson closes (its coroutine is cancelled) or every clip was looked at.
     */
    suspend fun prefetchOpenLesson(spec: dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec, current: kotlinx.coroutines.flow.StateFlow<Int>) {
        val voices = ConversationVoiceCache.get(app.cache)
        val state = ConversationAudioCache.get(app.cache)
        val clips = dev.jeromeswannack.chineselearning.lab.core.LessonAudioClips.lessonClips(spec) { ConversationAudioCache.resolve(state, voices, it) }
        audio.noteClips(clips.size)
        if (clips.isEmpty()) return
        val prefetcher = LessonAudioPrefetcher(
            clips,
            current.value,
            isCached = { media.cachedClip(it) != null },
            fetch = { media.clip(it, app.online.value) != null },
            online = { app.online.value },
        )
        kotlinx.coroutines.coroutineScope {
            val follow = launch { current.collect { prefetcher.focus(it) } }
            try {
                prefetcher.run()
            } finally {
                audio.notePrefetched(prefetcher.result().fetched)
                follow.cancel()
            }
        }
    }

    /** `lesson.audio` (counts only) when the lesson closes — nothing when nothing was spoken. */
    fun reportLessonAudio(source: String) {
        val s = audio.stats()
        audio.resetStats()
        if (s.hits + s.misses == 0) return
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track(
            "lesson.audio",
            mapOf("source" to source, "hits" to s.hits, "misses" to s.misses, "stale" to s.stale, "max_wait_ms" to s.maxWaitMs, "clips" to s.clips, "prefetched" to s.prefetched),
        )
    }

    companion object {
        @Volatile private var instance: LessonRuntime? = null

        fun of(app: LabApp): LessonRuntime = instance?.takeIf { it.app === app } ?: synchronized(this) {
            instance?.takeIf { it.app === app } ?: LessonRuntime(app).also { instance = it }
        }
    }
}

/** Lessons in the sync (web: syncCustomLessons + prefetchCustomLessonMedia), after the outbox has drained. */
object LessonsSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        LessonStore(ctx.cache, ctx.outbox, ctx.api).sync(prefetch = true, online = true)
    }
}
