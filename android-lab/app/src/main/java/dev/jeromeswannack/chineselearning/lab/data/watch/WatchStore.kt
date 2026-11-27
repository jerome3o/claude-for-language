package dev.jeromeswannack.chineselearning.lab.data.watch

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.core.watch.Watch
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.WatchListDto
import dev.jeromeswannack.chineselearning.lab.data.api.WatchPositionBody
import dev.jeromeswannack.chineselearning.lab.data.api.WatchVideoDto
import dev.jeromeswannack.chineselearning.lab.data.api.saveWatchPosition
import dev.jeromeswannack.chineselearning.lab.data.api.watchList
import dev.jeromeswannack.chineselearning.lab.data.api.watchVideo
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.CancellationException

/**
 * 📺 Watch on the phone (docs/WATCH.md): "My videos" (`watch/list`) and every opened video with its
 * transcript (`watch/video/<id>`) in the [JsonCache], so the list and each transcript read offline
 * (the video itself is YouTube's player and needs a connection — never downloaded). The resume
 * point is saved on the phone at once ([WatchPrefs]) and sent with a best-effort PUT (queued in
 * the outbox when it fails; the endpoint just stores a number, so a late copy is harmless).
 */
class WatchStore(private val cache: JsonCache, private val api: Api, private val outbox: Outbox) {
    suspend fun cachedVideo(id: String): WatchVideoDto? = runCatching { cache.get<WatchVideoDto>(videoKey(id)) }.getOrNull()

    suspend fun cachedList(): WatchListDto? = runCatching { cache.get<WatchListDto>(LIST_KEY) }.getOrNull()

    /** Fresh from the server, kept on the phone. */
    suspend fun fetchVideo(id: String): WatchVideoDto = api.watchVideo(id).also { remember(it) }

    suspend fun remember(v: WatchVideoDto) {
        runCatching { cache.put(videoKey(v.id), KIND, v) }
        // Keep the list's row in step (status, progress) without its lines.
        val list = cachedList() ?: return
        if (list.videos.none { it.id == v.id }) {
            runCatching { cache.put(LIST_KEY, KIND, list.copy(videos = listOf(v.copy(lines = emptyList(), gaps = emptyList())) + list.videos)) }
        } else {
            runCatching {
                cache.put(LIST_KEY, KIND, list.copy(videos = list.videos.map { if (it.id == v.id) v.copy(lines = emptyList(), gaps = emptyList(), position_ms = it.position_ms) else it }))
            }
        }
    }

    /** The list's progress bar follows the position at once (offline too). */
    suspend fun rememberPosition(id: String, positionMs: Long) {
        val list = cachedList() ?: return
        if (list.videos.none { it.id == id }) return
        runCatching { cache.put(LIST_KEY, KIND, list.copy(videos = list.videos.map { if (it.id == id) it.copy(position_ms = positionMs) else it })) }
    }

    /** PUT the resume point; offline / failing → the outbox carries it later. */
    suspend fun sendPosition(id: String, positionMs: Long, online: Boolean) {
        rememberPosition(id, positionMs)
        if (online) {
            try {
                api.saveWatchPosition(id, positionMs)
                return
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // falls through to the outbox
            }
        }
        runCatching { outbox.enqueueJson(OUTBOX_KIND, "PUT", "/api/watch/videos/$id/position", WatchPositionBody(positionMs)) }
    }

    suspend fun forget(id: String) {
        runCatching { cache.delete(videoKey(id)) }
        val list = cachedList() ?: return
        runCatching { cache.put(LIST_KEY, KIND, list.copy(videos = list.videos.filterNot { it.id == id })) }
    }

    companion object {
        const val KIND = "watch"
        const val OUTBOX_KIND = "watch-position"
        const val LIST_KEY = "watch/list"
        fun videoKey(id: String) = "watch/video/$id"
        fun of(ctx: SyncContext) = WatchStore(ctx.cache, ctx.api, ctx.outbox)
    }
}

/**
 * The sync step: "My videos" (every 10 min, or at once while a transcript is being made), then the
 * transcript of each video already opened on this phone whose state moved on — so a transcript
 * finished on the server while away is readable on the train.
 */
object WatchSync : FeatureSync {
    private const val REFRESH_EVERY_MS = 10 * 60 * 1000L

    override suspend fun sync(ctx: SyncContext) {
        val store = WatchStore.of(ctx)
        val before = store.cachedList()
        val working = before?.videos?.any { Watch.isWorking(it.status) } == true
        if (!ctx.full && !working && ctx.cache.isFresh(WatchStore.LIST_KEY, REFRESH_EVERY_MS)) return
        val list = ctx.api.watchList()
        ctx.cache.put(WatchStore.LIST_KEY, WatchStore.KIND, list)
        for (v in list.videos.take(30)) {
            val have = store.cachedVideo(v.id) ?: continue // only the ones opened here
            if (have.status == v.status && have.chunks_done == v.chunks_done && have.progress_done == v.progress_done) continue
            try {
                store.fetchVideo(v.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                android.util.Log.w("Watch", "couldn't cache ${v.id}", e)
            }
        }
    }
}

/** Per-device player memory (web: localStorage): the switches, the speed, and each video's resume point. */
class WatchPrefs(context: Context) {
    private val sp = context.getSharedPreferences("lab-watch", Context.MODE_PRIVATE)

    fun position(id: String): Long? = if (sp.contains("pos:$id")) sp.getLong("pos:$id", 0) else null
    fun savePosition(id: String, ms: Long) = sp.edit().putLong("pos:$id", ms.coerceAtLeast(0)).apply()

    var pinyin: Boolean
        get() = sp.getBoolean("pinyin", true)
        set(v) { sp.edit().putBoolean("pinyin", v).apply() }

    var english: Boolean
        get() = sp.getBoolean("english", true)
        set(v) { sp.edit().putBoolean("english", v).apply() }

    var pauseEachLine: Boolean
        get() = sp.getBoolean("pause", false)
        set(v) { sp.edit().putBoolean("pause", v).apply() }

    var listenFirst: Boolean
        get() = sp.getBoolean("listen", false)
        set(v) { sp.edit().putBoolean("listen", v).apply() }

    var speed: Double
        get() = Watch.parseSpeed(sp.getString("speed", null))
        set(v) { sp.edit().putString("speed", Watch.speedLabel(v).removeSuffix("×")).apply() }
}
