package dev.jeromeswannack.chineselearning.lab.data.strokes

import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.core.CharStrokeData
import dev.jeromeswannack.chineselearning.lab.core.StrokeData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Port of `StrokeDataResult` (frontend/src/services/strokeData.ts). */
sealed interface StrokeLoad {
    data class Ok(val data: CharStrokeData) : StrokeLoad
    /** The dataset has no entry for this character (rare / not a CJK ideograph). */
    data object Missing : StrokeLoad
    /** Not on the device and the network failed — try again when online. */
    data object Offline : StrokeLoad
}

/**
 * Stroke-order data for handwriting practice, offline-first — the native twin of the web's
 * `services/strokeData.ts`. Source: hanzi-writer-data (Make Me a Hanzi, Arphic Public
 * License) served by the web deploy at `<WEB_URL>/strokes/<hex>.json`. Each character
 * (~2 KB) is fetched the first time it's written and kept as a plain file under
 * `files/strokes/` — no Room table, nothing in the sync. Memory → file → network; a
 * character the dataset doesn't have is remembered for a week (the SPA fallback page that
 * Pages serves for unknown paths counts as missing).
 */
class StrokeStore(
    private val dir: File,
    private val baseUrl: String = Config.WEB_URL,
    private val http: OkHttpClient = defaultClient,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val memory = ConcurrentHashMap<String, CharStrokeData>()
    private val json = Json { ignoreUnknownKeys = true }
    private val writeLock = Mutex()
    private val missingDir get() = File(dir, "missing")

    private fun fileFor(char: String) = File(dir, StrokeData.file(char))

    /** One character's data: memory → file → network (and keep it). */
    suspend fun get(char: String): StrokeLoad = withContext(Dispatchers.IO) {
        memory[char]?.let { return@withContext StrokeLoad.Ok(it) }
        readFile(char)?.let {
            memory[char] = it
            return@withContext StrokeLoad.Ok(it)
        }
        val miss = File(missingDir, StrokeData.file(char))
        if (miss.exists() && now() - miss.lastModified() < MISSING_TTL_MS) return@withContext StrokeLoad.Missing
        val result = fetch(char)
        if (result == StrokeLoad.Missing) {
            runCatching {
                writeLock.withLock {
                    missingDir.mkdirs()
                    miss.writeText("")
                    miss.setLastModified(now())
                }
            }
        }
        result
    }

    private fun readFile(char: String): CharStrokeData? {
        val f = fileFor(char)
        if (!f.exists()) return null
        return runCatching { StrokeData.parse(json.parseToJsonElement(f.readText())) }.getOrNull()
    }

    private suspend fun fetch(char: String): StrokeLoad {
        val body: String
        try {
            val req = Request.Builder().url("$baseUrl/strokes/${StrokeData.file(char)}").build()
            http.newCall(req).execute().use { res ->
                if (res.code == 404) return StrokeLoad.Missing
                if (!res.isSuccessful) return StrokeLoad.Offline
                // Pages answers unknown paths with the SPA's index.html (200, text/html).
                if (res.header("Content-Type").orEmpty().contains("text/html")) return StrokeLoad.Missing
                body = res.body?.string() ?: return StrokeLoad.Offline
            }
        } catch (_: IOException) {
            return StrokeLoad.Offline
        }
        val data = runCatching { StrokeData.parse(json.parseToJsonElement(body)) }.getOrNull() ?: return StrokeLoad.Missing
        runCatching {
            writeLock.withLock {
                dir.mkdirs()
                val tmp = File(dir, StrokeData.file(char) + ".part")
                tmp.writeText(body)
                tmp.renameTo(fileFor(char))
                File(missingDir, StrokeData.file(char)).delete()
            }
        }
        memory[char] = data
        return StrokeLoad.Ok(data)
    }

    /** The characters of [chars] already on this device. */
    suspend fun cached(chars: Collection<String>): Set<String> = withContext(Dispatchers.IO) {
        chars.filterTo(HashSet()) { memory.containsKey(it) || fileFor(it).exists() }
    }

    data class PrefetchResult(val saved: Int, val missing: Int, val failed: Int)

    /**
     * Port of `prefetchStrokeData`: download every character of [chars] not on the device yet,
     * 6 at a time; stops early after 5 failures in a row (offline). "Save all" for the train.
     */
    suspend fun prefetch(chars: Collection<String>, onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): PrefetchResult = coroutineScope {
        val unique = chars.distinct()
        val have = cached(unique)
        val todo = unique.filter { it !in have }
        val next = AtomicInteger(0)
        val done = AtomicInteger(0)
        val saved = AtomicInteger(0)
        val missing = AtomicInteger(0)
        val failed = AtomicInteger(0)
        val offlineStreak = AtomicInteger(0)
        onProgress(0, todo.size)
        (0 until CONCURRENCY).map {
            async(Dispatchers.IO) {
                while (offlineStreak.get() < 5) {
                    val i = next.getAndIncrement()
                    if (i >= todo.size) break
                    when (get(todo[i])) {
                        is StrokeLoad.Ok -> { saved.incrementAndGet(); offlineStreak.set(0) }
                        StrokeLoad.Missing -> missing.incrementAndGet()
                        StrokeLoad.Offline -> { failed.incrementAndGet(); offlineStreak.incrementAndGet() }
                    }
                    onProgress(done.incrementAndGet(), todo.size)
                }
            }
        }.forEach { it.await() }
        PrefetchResult(saved.get(), missing.get(), failed.get())
    }

    companion object {
        /** Don't re-ask the network for a character the dataset lacks for a week. */
        const val MISSING_TTL_MS = 7L * 24 * 3600 * 1000
        private const val CONCURRENCY = 6

        private val defaultClient: OkHttpClient by lazy {
            OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
        }

        @Volatile private var instance: StrokeStore? = null

        /** The app-wide store (`files/strokes/`). */
        fun of(context: android.content.Context): StrokeStore =
            instance ?: synchronized(this) { instance ?: StrokeStore(File(context.filesDir, "strokes")).also { instance = it } }

        /** ~2 KB of stroke data per character (the web's `sizeLabel`). */
        fun sizeLabel(chars: Int): String {
            val kb = chars * 2
            return if (kb < 1024) "~$kb KB" else "~${dev.jeromeswannack.chineselearning.lab.core.Js.toFixed(kb / 1024.0, 1)} MB"
        }
    }
}
