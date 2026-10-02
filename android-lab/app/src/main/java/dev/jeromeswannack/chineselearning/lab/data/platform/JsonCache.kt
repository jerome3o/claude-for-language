package dev.jeromeswannack.chineselearning.lab.data.platform

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import java.io.File

/**
 * Offline store for synced feature data, as JSON documents in the `json_cache` table.
 * A feature caches what it fetched (readers, lessons, chats, stats…) and renders from
 * the cache first, so its screens open instantly and work on the train.
 *
 * Keys: "<feature>/<thing>[/<id>]" (e.g. "readers/list", "readers/r_123"); [kind] is the
 * feature name so a feature can list / clear its own entries. A value that no longer
 * decodes (the DTO changed) reads as missing and is simply refetched.
 *
 * Big documents live in files: Android reads a row through a 2 MB CursorWindow and throws
 * SQLiteBlobTooBigException for anything larger — a 2.2 MB "readers/list" (38 readers with
 * vocabulary and word chips) crashed the app on every open. A document over [FILE_BYTES]
 * is written to [dir] and its row holds a pointer ([FILE_MARKER]); every read sizes the row
 * first ([PlatformDao.cacheMeta]) and never selects one that can't fit — an oversized row
 * left by an older build is read back in slices and moved to a file, nothing is lost.
 * Reads never throw: a document that can't be read reads as missing.
 *
 * Most screens use [CachedResource] (cache first, refresh from the API, errors as
 * inline notices) rather than calling this directly.
 */
class JsonCache(
    private val dao: PlatformDao,
    val json: Json,
    /** Where documents over [FILE_BYTES] are kept (null: in the row — tests only). */
    private val dir: File? = null,
    private val clock: () -> Long = System::currentTimeMillis,
) {

    suspend fun <T> get(key: String, serializer: KSerializer<T>): T? = load(key)?.let { decode(serializer, it.json) }

    suspend inline fun <reified T> get(key: String): T? = get(key, json.serializersModule.serializer<T>())

    suspend fun <T> put(key: String, kind: String, value: T, serializer: KSerializer<T>) {
        dao.putCache(listOf(row(key, kind, json.encodeToString(serializer, value), clock())))
    }

    suspend inline fun <reified T> put(key: String, kind: String, value: T) = put(key, kind, value, json.serializersModule.serializer<T>())

    /** Writes many documents of one [kind] in one transaction (e.g. every reader after a list sync). */
    suspend fun <T> putAll(kind: String, values: Map<String, T>, serializer: KSerializer<T>) {
        val now = clock()
        dao.putCache(values.map { (k, v) -> row(k, kind, json.encodeToString(serializer, v), now) })
    }

    /** Emits the current value (null when missing) and again whenever it is rewritten. */
    fun <T> observe(key: String, serializer: KSerializer<T>): Flow<T?> =
        observeEntry(key).map { it?.let { e -> decode(serializer, e.json) } }.distinctUntilChanged()

    inline fun <reified T> observe(key: String): Flow<T?> = observe(key, json.serializersModule.serializer<T>())

    /** Every document of [kind], in key order. */
    suspend fun <T> all(kind: String, serializer: KSerializer<T>): List<T> =
        safeMetas(kind).mapNotNull { m -> load(m.key)?.let { decode(serializer, it.json) } }

    fun <T> observeAll(kind: String, serializer: KSerializer<T>): Flow<List<T>> =
        dao.observeCacheMetas(kind)
            .map { metas -> metas.mapNotNull { m -> load(m.key)?.let { decode(serializer, it.json) } } }
            .flowOn(Dispatchers.IO)
            .distinctUntilChanged()

    /** The row (JSON + when it was written), or null. */
    suspend fun entry(key: String): JsonCacheEntity? = load(key)

    /** [entry], again whenever the row is rewritten. The query only sizes the row; the read runs on IO. */
    fun observeEntry(key: String): Flow<JsonCacheEntity?> =
        dao.observeCacheMeta(key).map { meta -> meta?.let { load(it.key) } }.flowOn(Dispatchers.IO)

    /** Epoch ms of the last write of [key], or null. */
    suspend fun updatedAt(key: String): Long? = runCatching { dao.cacheMeta(key)?.updatedAt }.getOrNull()

    /** True when [key] was written less than [maxAgeMs] ago. */
    suspend fun isFresh(key: String, maxAgeMs: Long): Boolean = updatedAt(key)?.let { clock() - it < maxAgeMs } ?: false

    suspend fun delete(key: String) {
        dao.deleteCache(key)
        fileFor(key)?.let { f -> withContext(Dispatchers.IO) { f.delete() } }
    }

    suspend fun deleteKind(kind: String) {
        val keys = safeMetas(kind).map { it.key }
        dao.deleteCacheKind(kind)
        withContext(Dispatchers.IO) { keys.forEach { k -> fileFor(k)?.delete() } }
    }

    fun <T> decode(serializer: KSerializer<T>, text: String): T? = runCatching { json.decodeFromString(serializer, text) }.getOrNull()

    // ---- storage ----

    private fun fileFor(key: String): File? = dir?.let { File(it, sha1(key) + ".json") }

    /** The row to upsert: the JSON itself, or (over [FILE_BYTES]) a pointer to the file it was written to. */
    private suspend fun row(key: String, kind: String, text: String, now: Long): JsonCacheEntity {
        val file = fileFor(key)
        if (file == null || utf8Bytes(text) <= FILE_BYTES) {
            if (file != null) withContext(Dispatchers.IO) { if (file.exists()) file.delete() }
            return JsonCacheEntity(key, kind, text, now)
        }
        withContext(Dispatchers.IO) {
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(file)) {
                file.delete()
                tmp.renameTo(file)
            }
        }
        // The pointer changes with every write, so observers of the row see the update.
        return JsonCacheEntity(key, kind, "$FILE_MARKER${file.name}#$now", now)
    }

    private suspend fun safeMetas(kind: String): List<JsonCacheMeta> = runCatching { dao.cacheMetas(kind) }.getOrDefault(emptyList())

    /**
     * Reads [key] whatever its size: sized first, a small row selected whole, a file pointer
     * followed, an oversized row read in slices (and moved to a file). Never throws: a row
     * that can't be read reads as missing (its feature's sync fetches it again).
     */
    private suspend fun load(key: String): JsonCacheEntity? = withContext(Dispatchers.IO) {
        try {
            val meta = dao.cacheMeta(key) ?: return@withContext null
            val text = if (meta.bytes > ROW_READ_BYTES) readSlices(meta) else dao.cacheEntry(key)?.json ?: return@withContext null
            val resolved = if (text.startsWith(FILE_MARKER)) {
                val name = text.removePrefix(FILE_MARKER).substringBefore('#')
                val f = dir?.let { File(it, name) }?.takeIf { it.exists() } ?: return@withContext null
                f.readText()
            } else {
                text
            }
            JsonCacheEntity(meta.key, meta.kind, resolved, meta.updatedAt)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Throwable) {
            android.util.Log.w("JsonCache", "couldn't read $key", e)
            null
        }
    }

    /** A row too big for one CursorWindow (written before documents went to files): read it in pieces, then keep it as a file. */
    private suspend fun readSlices(meta: JsonCacheMeta): String {
        val chars = dao.cacheChars(meta.key) ?: 0
        val sb = StringBuilder(chars)
        var start = 1 // SQLite substr() is 1-based, in characters
        while (start <= chars) {
            sb.append(dao.cacheSlice(meta.key, start, SLICE_CHARS) ?: break)
            start += SLICE_CHARS
        }
        val text = sb.toString()
        if (dir != null) runCatching { dao.putCache(listOf(row(meta.key, meta.kind, text, meta.updatedAt))) }
        return text
    }

    companion object {
        /** Documents bigger than this (UTF-8 bytes) go to a file — far under the 2 MB CursorWindow. */
        const val FILE_BYTES = 256 * 1024

        /** A row bigger than this is never selected whole. */
        const val ROW_READ_BYTES = 1024 * 1024L

        /** Characters per slice of an oversized row (≤ 3 bytes each in UTF-8, so ≤ 750 KB). */
        const val SLICE_CHARS = 250_000

        /** A row's json when the document is in a file: marker + file name + "#" + write time. */
        const val FILE_MARKER = "\u0000file:"

        internal fun utf8Bytes(s: String): Int {
            var n = 0
            var i = 0
            while (i < s.length) {
                val c = s[i]
                n += when {
                    c.code < 0x80 -> 1
                    c.code < 0x800 -> 2
                    Character.isHighSurrogate(c) -> { i++; 4 }
                    else -> 3
                }
                i++
            }
            return n
        }

        private fun sha1(s: String): String =
            java.security.MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
