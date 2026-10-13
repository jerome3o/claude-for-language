package dev.jeromeswannack.chineselearning.lab.data.podcasts

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.core.podcasts.Podcasts
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastEpisodeDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastsHomeDto
import dev.jeromeswannack.chineselearning.lab.data.api.downloadPodcastAudio
import dev.jeromeswannack.chineselearning.lab.data.api.podcastEpisode
import dev.jeromeswannack.chineselearning.lab.data.api.podcastsHome
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Podcasts on the phone (docs/PODCASTS.md): the Podcasts screen (`podcasts/home`), each feed
 * (`podcasts/feed/<sha1 of url>`) and each transcribed episode with its segments
 * (`podcasts/episode/<id>`) in the [JsonCache], so an opened episode reads offline; the audio —
 * the copy the server transcribed, so the segments' times match it — under
 * `files/podcasts/<id>.<ext>`, downloaded on demand (episodes are big: the size shows first and
 * the file can be deleted from the player's ⋯ menu).
 */
class PodcastStore(private val cache: JsonCache, private val api: Api, filesDir: File) {
    val dir = File(filesDir, "podcasts")

    /** The saved audio of an episode, or null. */
    fun savedFile(id: String): File? =
        dir.listFiles { f -> f.name.startsWith("${safe(id)}.") && !f.name.endsWith(".part") }?.firstOrNull { it.length() > 0 }

    fun fileFor(id: String, mime: String?): File {
        val ext = when {
            mime == null -> "mp3"
            mime.contains("mp4") || mime.contains("m4a") || mime.contains("aac") -> "m4a"
            mime.contains("ogg") || mime.contains("opus") -> "ogg"
            else -> "mp3"
        }
        return File(dir, "${safe(id)}.$ext")
    }

    /** Bytes of every saved episode (the player's ⋯ shows it). */
    fun savedBytes(): Long = dir.listFiles()?.filter { !it.name.endsWith(".part") }?.sumOf { it.length() } ?: 0L

    suspend fun cachedEpisode(id: String): PodcastEpisodeDto? = cache.get<PodcastEpisodeDto>(episodeKey(id))

    /** Fresh from the server; kept on the phone once it has segments. */
    suspend fun fetchEpisode(id: String): PodcastEpisodeDto {
        val ep = api.podcastEpisode(id)
        remember(ep)
        return ep
    }

    suspend fun remember(ep: PodcastEpisodeDto) {
        if (Podcasts.isListenable(ep.status) && ep.segments.isNotEmpty()) cache.put(episodeKey(ep.id), KIND, ep)
    }

    /** Downloads in flight: episode id → fraction (0 while the size is unknown). */
    val downloads: StateFlow<Map<String, Double>> get() = _downloads.asStateFlow()

    /** The saved file, else downloaded once (one download per episode at a time). */
    suspend fun download(ep: PodcastEpisodeDto, onProgress: (Double, Long) -> Unit = { _, _ -> }): File {
        savedFile(ep.id)?.let { return it }
        return lock(ep.id).withLock {
            savedFile(ep.id)?.let { return@withLock it }
            val dest = fileFor(ep.id, ep.audio_mime)
            _downloads.update { it + (ep.id to 0.0) }
            try {
                api.downloadPodcastAudio(ep.id, dest) { fraction, bytes ->
                    _downloads.update { it + (ep.id to fraction) }
                    onProgress(fraction, bytes)
                }
            } finally {
                _downloads.update { it - ep.id }
            }
            Analytics.track("podcast.download", mapOf("mb" to (dest.length() / (1024 * 1024)).toInt()))
            dest
        }
    }

    /** The saved audio of one episode off the phone (the transcript stays cached). */
    suspend fun deleteAudio(id: String) = withContext(Dispatchers.IO) {
        dir.listFiles { f -> f.name.startsWith("${safe(id)}.") }?.forEach { it.delete() }
        Unit
    }

    /** The episode off "My episodes" and off the phone. */
    suspend fun forget(id: String) {
        cache.delete(episodeKey(id))
        deleteAudio(id)
    }

    companion object {
        const val KIND = "podcasts"
        const val HOME_KEY = "podcasts/home"
        fun episodeKey(id: String) = "podcasts/episode/$id"
        fun feedKey(url: String): String =
            "podcasts/feed/" + MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }

        private val _downloads = MutableStateFlow<Map<String, Double>>(emptyMap())
        private val locks = ConcurrentHashMap<String, Mutex>()
        private fun lock(id: String) = locks.getOrPut(id) { Mutex() }
        private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9_]"), "_")

        fun of(context: Context, cache: JsonCache, api: Api) = PodcastStore(cache, api, context.filesDir)
        fun of(ctx: SyncContext) = PodcastStore(ctx.cache, ctx.api, ctx.outbox.dir.parentFile ?: ctx.outbox.dir)
    }
}

/**
 * The sync step: the Podcasts screen hourly, and the transcript of every listenable episode in
 * "My episodes" that isn't on the phone yet (small JSON; the audio is only fetched when opened).
 */
object PodcastsSync : FeatureSync {
    private const val REFRESH_EVERY_MS = 60 * 60 * 1000L

    override suspend fun sync(ctx: SyncContext) {
        if (!ctx.full && ctx.cache.isFresh(PodcastStore.HOME_KEY, REFRESH_EVERY_MS)) return
        val home = ctx.api.podcastsHome()
        ctx.cache.put(PodcastStore.HOME_KEY, PodcastStore.KIND, home)
        val store = PodcastStore.of(ctx)
        for (e in home.episodes.take(20)) {
            if (!Podcasts.isListenable(e.status)) continue
            val have = store.cachedEpisode(e.id)
            if (have != null && have.status == e.status && have.progress_done == e.progress_done) continue
            try {
                store.fetchEpisode(e.id)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                android.util.Log.w("Podcasts", "couldn't cache ${e.id}", err)
            }
        }
    }
}

/** The home screen data with the episodes made shorter for the list (no segments are ever in it). */
fun PodcastsHomeDto.withoutSegments() = copy(episodes = episodes.map { it.copy(segments = emptyList()) })

/** Per-device player memory: the segment each episode was at and the reveal mode. */
class PodcastPrefs(context: Context) {
    private val sp = context.getSharedPreferences("lab-podcasts", Context.MODE_PRIVATE)

    fun segment(id: String): Int = sp.getInt("seg:$id", 0)
    fun saveSegment(id: String, i: Int) = sp.edit().putInt("seg:$id", i.coerceAtLeast(0)).apply()

    var reveal: Podcasts.Reveal
        get() = runCatching { Podcasts.Reveal.valueOf(sp.getString("reveal", null) ?: "LISTEN") }.getOrDefault(Podcasts.Reveal.LISTEN)
        set(v) { sp.edit().putString("reveal", v.name).apply() }

    var slow: Boolean
        get() = sp.getBoolean("slow", false)
        set(v) { sp.edit().putBoolean("slow", v).apply() }

    var auto: Boolean
        get() = sp.getBoolean("auto", false)
        set(v) { sp.edit().putBoolean("auto", v).apply() }
}
