package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.launch

/** Package B's singletons for one app: the lesson store, media and playback. */
class LessonRuntime private constructor(val app: LabApp) {
    val store = LessonStore(app.cache, app.outbox, app.repo.api)
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
