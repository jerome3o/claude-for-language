package dev.jeromeswannack.chineselearning.lab.data.clips

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.data.api.ClipEventDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClipEventsBody
import dev.jeromeswannack.chineselearning.lab.data.api.clipFeed
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonMedia
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * 🎬 Clips on the phone (experimental; web services/clips.ts, docs/CLIPS.md). The feed is kept in
 * the JsonCache (`clips/feed`), events go through the Outbox (`POST /api/clips/events`, one
 * client id each — idempotent) and are laid over the cached state at once; a clip's voice lines
 * are practice-TTS clips and its pictures R2 files, both through LessonMedia (the same keys as
 * the web), so a clip played or prefetched once plays on the train.
 */
object ClipStore {
    const val FEED_KEY = "clips/feed"
    const val FEED_KIND = "clips-feed"
    private const val PREFS = "lab-clips"

    @Serializable
    data class Feed(val clips: List<ClipRecord> = emptyList(), val cachedAt: Long = 0)

    data class CaptionPrefs(val pinyin: Boolean = true, val english: Boolean = true, val muted: Boolean = false)

    private fun media(app: LabApp) = LessonMedia(app.filesDir, app.repo.api)

    suspend fun cached(app: LabApp): List<ClipRecord>? = runCatching { app.cache.get<Feed>(FEED_KEY) }.getOrNull()?.clips

    suspend fun store(app: LabApp, clips: List<ClipRecord>) {
        runCatching { app.cache.put(FEED_KEY, FEED_KIND, Feed(clips, System.currentTimeMillis())) }
    }

    /** Uploads waiting events first, then the server's feed (stored). Throws offline / on an error. */
    suspend fun refresh(app: LabApp): List<ClipRecord> {
        runCatching { app.outbox.drain() }
        return app.repo.api.clipFeed().also { store(app, it) }
    }

    /** Record an event: queued in the Outbox (uploaded now when online, else on the next sync). */
    fun record(app: LabApp, clipId: String, kind: String, value: Int? = null) {
        val id = UUID.randomUUID().toString()
        val event = ClipEventDto(id, clipId, kind, value, Instant.now().toString())
        app.scope.launch {
            runCatching {
                app.outbox.enqueueJson("clip-event", "POST", "/api/clips/events", ClipEventsBody(listOf(event)), id = id)
                if (app.online.value) app.outbox.drain() else app.scheduleBackgroundUpload()
            }
        }
    }

    /** A clip line's audio file (cached; fetched when online). */
    suspend fun lineAudio(app: LabApp, text: String, voiceId: String?): File? =
        media(app).tts(text, voiceId, Clips.TTS_SPEED, online = app.online.value)

    /** A picture by its R2 key (cached; fetched when online). */
    suspend fun picture(app: LabApp, key: String?): File? = media(app).image(key, app.online.value)

    /** The next clip's voice lines and pictures, fetched ahead. */
    suspend fun prefetch(app: LabApp, clip: ClipRecord) {
        val spec = clip.spec ?: return
        if (!app.online.value) return
        val m = media(app)
        for (key in clip.images.values) runCatching { m.image(key, online = true) }
        for (line in Clips.audioClips(spec)) runCatching { m.tts(line.text, line.voiceId, Clips.TTS_SPEED, online = true) }
    }

    fun prefs(context: Context): CaptionPrefs {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return CaptionPrefs(p.getBoolean("pinyin", true), p.getBoolean("english", true), p.getBoolean("muted", false))
    }

    fun savePrefs(context: Context, prefs: CaptionPrefs) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("pinyin", prefs.pinyin).putBoolean("english", prefs.english).putBoolean("muted", prefs.muted).apply()
    }
}
