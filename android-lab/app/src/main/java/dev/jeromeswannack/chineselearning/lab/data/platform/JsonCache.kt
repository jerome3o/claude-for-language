package dev.jeromeswannack.chineselearning.lab.data.platform

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer

/**
 * Offline store for synced feature data, as JSON documents in the `json_cache` table.
 * A feature caches what it fetched (readers, lessons, chats, stats…) and renders from
 * the cache first, so its screens open instantly and work on the train.
 *
 * Keys: "<feature>/<thing>[/<id>]" (e.g. "readers/list", "readers/r_123"); [kind] is the
 * feature name so a feature can list / clear its own entries. A value that no longer
 * decodes (the DTO changed) reads as missing and is simply refetched.
 *
 * Most screens use [CachedResource] (cache first, refresh from the API, errors as
 * inline notices) rather than calling this directly.
 */
class JsonCache(private val dao: PlatformDao, val json: Json, private val clock: () -> Long = System::currentTimeMillis) {

    suspend fun <T> get(key: String, serializer: KSerializer<T>): T? = dao.cacheEntry(key)?.let { decode(serializer, it.json) }

    suspend inline fun <reified T> get(key: String): T? = get(key, json.serializersModule.serializer<T>())

    suspend fun <T> put(key: String, kind: String, value: T, serializer: KSerializer<T>) {
        dao.putCache(listOf(JsonCacheEntity(key, kind, json.encodeToString(serializer, value), clock())))
    }

    suspend inline fun <reified T> put(key: String, kind: String, value: T) = put(key, kind, value, json.serializersModule.serializer<T>())

    /** Writes many documents of one [kind] in one transaction (e.g. every reader after a list sync). */
    suspend fun <T> putAll(kind: String, values: Map<String, T>, serializer: KSerializer<T>) {
        val now = clock()
        dao.putCache(values.map { (k, v) -> JsonCacheEntity(k, kind, json.encodeToString(serializer, v), now) })
    }

    /** Emits the current value (null when missing) and again whenever it is rewritten. */
    fun <T> observe(key: String, serializer: KSerializer<T>): Flow<T?> =
        dao.observeCacheEntry(key).map { it?.let { e -> decode(serializer, e.json) } }.distinctUntilChanged()

    inline fun <reified T> observe(key: String): Flow<T?> = observe(key, json.serializersModule.serializer<T>())

    /** Every document of [kind], in key order. */
    suspend fun <T> all(kind: String, serializer: KSerializer<T>): List<T> = dao.cacheEntries(kind).mapNotNull { decode(serializer, it.json) }

    fun <T> observeAll(kind: String, serializer: KSerializer<T>): Flow<List<T>> =
        dao.observeCacheEntries(kind).map { list -> list.mapNotNull { decode(serializer, it.json) } }.distinctUntilChanged()

    /** The raw row (JSON + when it was written), or null. */
    suspend fun entry(key: String): JsonCacheEntity? = dao.cacheEntry(key)

    fun observeEntry(key: String): Flow<JsonCacheEntity?> = dao.observeCacheEntry(key)

    /** Epoch ms of the last write of [key], or null. */
    suspend fun updatedAt(key: String): Long? = dao.cacheEntry(key)?.updatedAt

    /** True when [key] was written less than [maxAgeMs] ago. */
    suspend fun isFresh(key: String, maxAgeMs: Long): Boolean = updatedAt(key)?.let { clock() - it < maxAgeMs } ?: false

    suspend fun delete(key: String) = dao.deleteCache(key)

    suspend fun deleteKind(kind: String) = dao.deleteCacheKind(kind)

    fun <T> decode(serializer: KSerializer<T>, text: String): T? = runCatching { json.decodeFromString(serializer, text) }.getOrNull()
}
