package dev.jeromeswannack.chineselearning.lab.data.platform

import android.util.Log
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.io.File

/** What a feature's sync step gets. */
class SyncContext(
    val api: Api,
    val cache: JsonCache,
    val outbox: Outbox,
    /** The core Room mirror (decks, notes, cards, events) — read it, don't write it. */
    val db: LabDatabase,
    /** True on a full resync (More → Full resync): refetch everything, ignore freshness. */
    val full: Boolean,
)

/**
 * One feature's part of a sync: fetch its data into the [JsonCache] (the Lab app's
 * equivalent of a web feature's IndexedDB table). Runs after the core sync, after the
 * outbox has drained; a failure is recorded in [LabPlatform.featureErrors] and never
 * fails the core sync. Throttle with `cache.isFresh(key, maxAge)` when a feed is expensive.
 */
fun interface FeatureSync {
    suspend fun sync(ctx: SyncContext)
}

/**
 * The feature platform: JSON cache, outbox and the per-feature sync steps. Owned by
 * the Repository (`repo.platform`, also `app.cache` / `app.outbox`); the core sync calls
 * [afterSync] once.
 */
class LabPlatform(private val db: LabDatabase, private val api: Api, filesDir: File) {
    val dao: PlatformDao = db.platform()
    /** Documents over 256 KB are kept as files in json-cache/ (a row over 2 MB can't be read back). */
    val cache = JsonCache(dao, api.json, dir = File(filesDir, "json-cache"))
    val outbox = Outbox(dao, api, File(filesDir, "outbox"))

    private val syncs = LinkedHashMap<String, FeatureSync>()
    private val _featureErrors = MutableStateFlow<Map<String, String>>(emptyMap())

    /** Last sync error per feature ("outbox" for the outbox); cleared when that step succeeds. */
    val featureErrors: StateFlow<Map<String, String>> = _featureErrors.asStateFlow()

    /** Registers a feature's sync step (LabApp does this for every LabFeature with a `sync`). */
    fun register(name: String, sync: FeatureSync) {
        syncs[name] = sync
    }

    /**
     * The one call from Repository.sync(): drain the outbox, then run every feature's
     * sync step. Only [UnauthorizedException] escapes (the core sync reports it).
     */
    suspend fun afterSync(full: Boolean) {
        step("outbox") { outbox.drain() }
        val ctx = SyncContext(api, cache, outbox, db, full)
        for ((name, sync) in syncs) step(name) { sync.sync(ctx) }
    }

    private suspend fun step(name: String, block: suspend () -> Unit) {
        try {
            block()
            _featureErrors.update { it - name }
        } catch (e: UnauthorizedException) {
            throw e
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w("LabPlatform", "sync step $name failed", e)
            _featureErrors.update { it + (name to e.userMessage()) }
        }
    }

    /** Sign-out: drop staged upload files (the tables go with db.clearAllTables()). */
    fun clearFiles() = outbox.clearFiles()
}
