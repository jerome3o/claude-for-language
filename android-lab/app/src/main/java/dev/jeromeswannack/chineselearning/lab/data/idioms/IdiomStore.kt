package dev.jeromeswannack.chineselearning.lab.data.idioms

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomRecord
import dev.jeromeswannack.chineselearning.lab.data.api.IdiomListDto
import dev.jeromeswannack.chineselearning.lab.data.api.idiom
import dev.jeromeswannack.chineselearning.lab.data.api.idiomList
import dev.jeromeswannack.chineselearning.lab.data.api.requestIdiom
import kotlinx.serialization.Serializable

/**
 * 成语 Idioms on the phone (web services/idioms.ts, docs/IDIOMS.md): every entry opened here is
 * kept in the JsonCache (`idioms/entry/<hanzi>`), so it reads offline afterwards; the last server
 * list too (`idioms/list`). Entries are global on the server — one per idiom, for everyone.
 */
object IdiomStore {
    const val ENTRY_KIND = "idioms-entry"
    const val LIST_KIND = "idioms-list"
    const val LIST_KEY = "idioms/list"
    fun key(hanzi: String) = "idioms/entry/$hanzi"

    @Serializable
    data class Cached(val record: IdiomRecord, val openedAt: Long = 0)

    suspend fun cached(app: LabApp, hanzi: String): IdiomRecord? = runCatching { app.cache.get<Cached>(key(hanzi))?.record }.getOrNull()

    /** A ready entry on this phone (the explorer's "📜 Story & usage" link). */
    suspend fun isCached(app: LabApp, hanzi: String): Boolean = cached(app, hanzi)?.status == "ready"

    /** Ready entries opened here, most recent first. */
    suspend fun opened(app: LabApp): List<IdiomRecord> =
        runCatching { app.cache.all(ENTRY_KIND, Cached.serializer()) }.getOrDefault(emptyList())
            .filter { it.record.status == "ready" }
            .sortedByDescending { it.openedAt }
            .map { it.record }

    private suspend fun store(app: LabApp, record: IdiomRecord, opened: Boolean = false) {
        if (record.status != "ready") return
        val openedAt = if (opened) System.currentTimeMillis() else runCatching { app.cache.get<Cached>(key(record.hanzi))?.openedAt }.getOrNull() ?: System.currentTimeMillis()
        runCatching { app.cache.put(key(record.hanzi), ENTRY_KIND, Cached(record, openedAt)) }
    }

    suspend fun markOpened(app: LabApp, record: IdiomRecord) = store(app, record, opened = true)

    /** The server's row (stored when ready). Throws offline / on an error. */
    suspend fun fetch(app: LabApp, hanzi: String): IdiomRecord = app.repo.api.idiom(hanzi).also { store(app, it) }

    /** Get-or-generate on the server. */
    suspend fun start(app: LabApp, hanzi: String, retry: Boolean = false): IdiomRecord = app.repo.api.requestIdiom(hanzi, retry).also { store(app, it) }

    suspend fun cachedList(app: LabApp): IdiomListDto? = runCatching { app.cache.get<IdiomListDto>(LIST_KEY) }.getOrNull()

    suspend fun refreshList(app: LabApp): IdiomListDto = app.repo.api.idiomList().also { runCatching { app.cache.put(LIST_KEY, LIST_KIND, it) } }
}
