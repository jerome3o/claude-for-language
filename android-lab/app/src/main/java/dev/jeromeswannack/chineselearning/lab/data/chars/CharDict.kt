package dev.jeromeswannack.chineselearning.lab.data.chars

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CHAR_BATCH_MAX
import dev.jeromeswannack.chineselearning.lab.core.CHAR_DICT_VERSION
import dev.jeromeswannack.chineselearning.lab.core.CharStatusCard
import dev.jeromeswannack.chineselearning.lab.core.CharStatusNote
import dev.jeromeswannack.chineselearning.lab.core.CharWordRow
import dev.jeromeswannack.chineselearning.lab.core.CharWords
import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.api.CharRecordDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.charExplanation
import dev.jeromeswannack.chineselearning.lab.data.api.charRecord
import dev.jeromeswannack.chineselearning.lab.data.api.charRecords
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.IOException

/**
 * The character dictionary on the device — port of frontend/src/services/charDict.ts
 * (docs/STUDY_SESSION.md "Character sheet"). Card-independent: one record per character in
 * the [JsonCache] (`chars/<c>`, a record or a "missing" marker with the dictionary version
 * and when it was stored), filled the first time a character is looked at and, hourly during
 * sync, for the characters of the upcoming study queue — so the card back's character sheet
 * works on the train.
 */
class CharDict(
    private val api: Api,
    private val cache: JsonCache,
    private val online: () -> Boolean,
    private val now: () -> Long = System::currentTimeMillis,
) {
    @Serializable
    data class Entry(val version: Int, val record: CharRecordDto? = null, val cachedAt: Long)

    @Serializable
    data class Explanation(val explanation: String, val cachedAt: Long)

    sealed interface Lookup {
        data class Ok(val record: CharRecordDto) : Lookup
        data object Missing : Lookup
        data object Offline : Lookup
        data class Error(val message: String) : Lookup
    }

    sealed interface Explain {
        data class Ok(val text: String) : Explain
        data object Offline : Explain
        data class Error(val message: String) : Explain
    }

    private suspend fun cached(char: String): Entry? =
        runCatching { cache.get<Entry>(key(char)) }.getOrNull()?.takeIf { it.version == CHAR_DICT_VERSION }

    private suspend fun store(char: String, record: CharRecordDto?) {
        runCatching { cache.put(key(char), KIND, Entry(CHAR_DICT_VERSION, record, now())) }
    }

    /** `lookupChar`: the device cache first; the network only for a character this device hasn't seen. */
    suspend fun lookup(char: String): Lookup {
        val row = cached(char)
        row?.record?.let { return Lookup.Ok(it) }
        if (row != null && now() - row.cachedAt < MISSING_RETRY_MS) return Lookup.Missing
        if (!online()) return Lookup.Offline
        return try {
            val record = api.charRecord(char).record
            store(char, record)
            Lookup.Ok(record)
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            if (e.code == 404) {
                store(char, null)
                Lookup.Missing
            } else Lookup.Error(e.userMessage())
        } catch (e: IOException) {
            Lookup.Offline
        } catch (e: Exception) {
            Lookup.Error(e.userMessage())
        }
    }

    /** `prefetchChars`: fetches the records of [chars] this device doesn't have yet, CHAR_BATCH_MAX per call. */
    suspend fun prefetch(chars: Iterable<String>): Int {
        val wanted = chars.filter { isLookupChar(it) }.distinct()
        val todo = wanted.filter { needsFetch(cached(it), now()) }
        var fetched = 0
        for (batch in todo.chunked(CHAR_BATCH_MAX)) {
            val res = api.charRecords(batch.joinToString(""))
            val t = now()
            val entries = LinkedHashMap<String, Entry>()
            for (r in res.records.values) entries[key(r.char)] = Entry(CHAR_DICT_VERSION, r, t)
            for (m in res.missing) entries[key(m)] = Entry(CHAR_DICT_VERSION, null, t)
            cache.putAll(KIND, entries, Entry.serializer())
            fetched += res.records.size
        }
        return fetched
    }

    /** `explainChar`: "More about 字" — the device cache, else the server (one answer per character). */
    suspend fun explain(char: String): Explain {
        runCatching { cache.get<Explanation>(explainKey(char)) }.getOrNull()?.let { return Explain.Ok(it.explanation) }
        if (!online()) return Explain.Offline
        return try {
            val out = api.charExplanation(char)
            runCatching { cache.put(explainKey(char), KIND, Explanation(out.explanation, now())) }
            Explain.Ok(out.explanation)
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            Explain.Error(e.userMessage())
        } catch (e: IOException) {
            Explain.Offline
        } catch (e: Exception) {
            Explain.Error(e.userMessage())
        }
    }

    companion object {
        const val KIND = "chars"

        /** A character the dictionary lacked is asked about again after a week (a new build may have it). */
        const val MISSING_RETRY_MS = 7L * 24 * 60 * 60 * 1000
        const val PREFETCH_EVERY_MS = 60L * 60 * 1000
        const val PREFETCH_KEY = "chars/prefetch-at"
        const val PREFETCH_NOTES = 150
        private const val DAY_MS = 24L * 60 * 60 * 1000

        fun key(char: String) = "chars/$char"
        fun explainKey(char: String) = "chars-explain/$char"

        /** `isLookupChar`: exactly one Han character. */
        fun isLookupChar(ch: String): Boolean {
            val cps = ch.codePoints().toArray()
            return cps.size == 1 && Known.isHan(cps[0])
        }

        /** Whether [prefetch] should ask for a character: never stored, an older dictionary, or "missing" for a week. */
        fun needsFetch(entry: Entry?, nowMs: Long): Boolean =
            entry == null || entry.version != CHAR_DICT_VERSION || (entry.record == null && nowMs - entry.cachedAt >= MISSING_RETRY_MS)

        /**
         * `prefetchQueueCharsIfDue`'s notes: the cards coming up soonest — due within 24 h (soonest
         * first), then the next new ones — up to [limit] distinct notes.
         */
        fun upcomingNoteIds(cards: List<CardEntity>, nowMs: Long, limit: Int = PREFETCH_NOTES): List<String> {
            val soon = nowMs + DAY_MS
            val due = cards.filter { it.queue != 0 && (it.dueTimestamp ?: Long.MAX_VALUE) <= soon }.sortedBy { it.dueTimestamp }.take(limit * 3)
            val fresh = cards.filter { it.queue == 0 }.take(limit * 2)
            val ids = LinkedHashSet<String>()
            for (c in due + fresh) {
                ids += c.noteId
                if (ids.size >= limit) break
            }
            return ids.toList()
        }

        /** The distinct lookup characters of [hanzi], in order. */
        fun lookupChars(hanzi: Iterable<String>): List<String> {
            val out = LinkedHashSet<String>()
            for (h in hanzi) for (cp in h.codePoints().toArray()) if (Known.isHan(cp)) out += String(Character.toChars(cp))
            return out.toList()
        }

        /**
         * `charWordStatuses`: each word's status from this device's notes (in decks that exist)
         * and their cards' replayed state in Room (shared/chars/status.ts via core CharWords).
         */
        suspend fun statuses(dao: LabDao, words: List<CharWordDto>, cardHanzi: String?): List<CharWordRow<CharWordDto>> = withContext(Dispatchers.IO) {
            val wanted = words.map { Known.noteKey(it.hanzi) }.toSet()
            val decks = dao.decks().map { it.id }.toSet()
            val notes = dao.allNotes().filter { it.deckId in decks && Known.noteKey(it.hanzi) in wanted }
            val ids = notes.map { it.id }.toSet()
            val cards = if (ids.isEmpty()) emptyList() else dao.cards().filter { it.noteId in ids }
            CharWords.rows(
                words,
                notes.map { CharStatusNote(it.id, it.hanzi) },
                cards.map { CharStatusCard(it.noteId, it.queue, it.stability) },
                cardHanzi,
            ) { it.hanzi }
        }

        fun of(app: LabApp) = CharDict(app.repo.api, app.cache, online = {
            app.online.value && !dev.jeromeswannack.chineselearning.lab.data.settings.SettingsStore.forcedOffline(app)
        })

        /**
         * Sync step (hourly, like the web's `prefetchQueueCharsIfDue`): the characters of the
         * upcoming study queue's notes, so tapping a character on the card back never needs the network.
         */
        val Sync = FeatureSync { ctx ->
            if (!ctx.full && ctx.cache.isFresh(PREFETCH_KEY, PREFETCH_EVERY_MS)) return@FeatureSync
            val dao = ctx.db.dao()
            val noteIds = upcomingNoteIds(dao.cards(), System.currentTimeMillis())
            val chars = if (noteIds.isEmpty()) emptyList() else lookupChars(dao.notes(noteIds).map { it.hanzi })
            CharDict(ctx.api, ctx.cache, online = { true }).prefetch(chars)
            ctx.cache.put(PREFETCH_KEY, KIND, System.currentTimeMillis())
        }
    }
}
