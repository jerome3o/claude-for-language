package dev.jeromeswannack.chineselearning.lab.data.chars

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.core.explorer.WORD_BATCH_MAX
import dev.jeromeswannack.chineselearning.lab.core.explorer.WORD_DICT_VERSION
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.WordRecordDto
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.api.wordRecords
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import java.io.IOException

/**
 * The word dictionary on the device (docs/LANGUAGE_EXPLORER.md "Data and offline"; web
 * `wordDict` in services/charDict.ts): one entry per word in the [JsonCache] (`words/<hanzi>`, a
 * record or a "missing" marker with the dictionary version and when it was stored), looked up
 * cache-first and fetched in batches from `GET /api/words`. A word the dictionary lacked is
 * asked about again after a week. Offline and never looked up → [Lookup.Offline] (the Word view
 * then falls back to the character records, the learner's cards and the tapped place's hint).
 */
class WordDict(
    private val api: Api,
    private val cache: JsonCache,
    private val online: () -> Boolean,
    private val now: () -> Long = System::currentTimeMillis,
) {
    @Serializable
    data class Entry(val version: Int, val record: WordRecordDto? = null, val cachedAt: Long)

    sealed interface Lookup {
        data class Ok(val record: WordRecordDto) : Lookup
        data object Missing : Lookup
        data object Offline : Lookup
        data class Error(val message: String) : Lookup
    }

    private suspend fun cached(hanzi: String): Entry? =
        runCatching { cache.get<Entry>(key(hanzi)) }.getOrNull()?.takeIf { it.version == WORD_DICT_VERSION }

    /** The device cache only (no network): what renders at once. */
    suspend fun cachedRecord(hanzi: String): WordRecordDto? = cached(hanzi)?.record

    /** `lookupWord`: the device cache first; the network only for a word this device hasn't seen (or a stale "missing"). */
    suspend fun lookup(hanzi: String): Lookup {
        if (!isLookupWord(hanzi)) return Lookup.Missing
        val row = cached(hanzi)
        row?.record?.let { return Lookup.Ok(it) }
        if (row != null && now() - row.cachedAt < CharDict.MISSING_RETRY_MS) return Lookup.Missing
        if (!online()) return Lookup.Offline
        return try {
            fetch(listOf(hanzi))
            cached(hanzi)?.record?.let { Lookup.Ok(it) } ?: Lookup.Missing
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            Lookup.Offline
        } catch (e: Exception) {
            Lookup.Error(e.userMessage())
        }
    }

    /** `prefetchWords`: fetches the words this device doesn't have yet, WORD_BATCH_MAX per call. Returns how many records came. */
    suspend fun prefetch(words: Iterable<String>): Int {
        if (!online()) return 0
        val todo = words.filter { isLookupWord(it) }.distinct().filter { needsFetch(cached(it), now()) }
        var fetched = 0
        for (batch in todo.chunked(WORD_BATCH_MAX)) fetched += fetch(batch)
        return fetched
    }

    private suspend fun fetch(batch: List<String>): Int {
        val res = api.wordRecords(batch)
        val t = now()
        val entries = LinkedHashMap<String, Entry>()
        for (r in res.records.values) entries[key(r.hanzi)] = Entry(WORD_DICT_VERSION, r, t)
        for (m in res.missing) entries[key(m)] = Entry(WORD_DICT_VERSION, null, t)
        // A word the server neither returned nor listed as missing counts as missing too.
        for (w in batch) if (key(w) !in entries) entries[key(w)] = Entry(WORD_DICT_VERSION, null, t)
        cache.putAll(KIND, entries, Entry.serializer())
        return res.records.size
    }

    companion object {
        const val KIND = "words"

        fun key(hanzi: String) = "words/$hanzi"

        /** A dictionary word: 2–6 characters, all Han (the worker's `wordsOf` rule). */
        fun isLookupWord(hanzi: String): Boolean {
            val cps = hanzi.codePoints().toArray()
            return cps.size in 2..6 && cps.all { Known.isHan(it) }
        }

        /** Whether [prefetch] should ask for a word: never stored, an older dictionary, or "missing" for a week. */
        fun needsFetch(entry: Entry?, nowMs: Long): Boolean =
            entry == null || entry.version != WORD_DICT_VERSION || (entry.record == null && nowMs - entry.cachedAt >= CharDict.MISSING_RETRY_MS)

        fun of(app: LabApp) = WordDict(app.repo.api, app.cache, online = {
            app.online.value && !dev.jeromeswannack.chineselearning.lab.data.settings.SettingsStore.forcedOffline(app)
        })
    }
}
