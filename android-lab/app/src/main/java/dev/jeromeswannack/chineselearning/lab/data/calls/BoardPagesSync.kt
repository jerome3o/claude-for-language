package dev.jeromeswannack.chineselearning.lab.data.calls

import dev.jeromeswannack.chineselearning.lab.data.api.BoardPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.myBoardPages
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext

/**
 * The lesson board outside a call (shared/calls/pages.ts): every relationship's board pages, kept
 * on the phone so past pages open on the train. One JSON cache entry per relationship
 * ([key]), the same list `GET /api/relationships/:relId/board-pages` returns.
 */
object BoardPagesStore {
    const val KIND = "board-pages"
    private const val STAMP = "calls/board-pages/_synced"
    /** The whole feed at most every 30 min (a lesson adds pages; the screen refreshes itself when opened). */
    const val MAX_AGE_MS = 30 * 60_000L

    fun key(relId: String) = "calls/board-pages/$relId"

    /**
     * Writes `GET /api/me/board-pages` into the per-relationship entries; a relationship whose pages
     * are all gone gets an empty list (never a stale page).
     */
    suspend fun store(cache: JsonCache, pages: List<BoardPageDto>) {
        val byRel = pages.filter { it.relationship_id != null }.groupBy { it.relationship_id!! }
        val gone = cache.all(KIND, LIST).mapNotNull { it.firstOrNull()?.relationship_id }.filter { it !in byRel }
        val values = byRel.mapValues { (_, v) -> v.sortedBy { it.number } } + gone.associateWith { emptyList() }
        if (values.isNotEmpty()) cache.putAll(KIND, values.mapKeys { (rel, _) -> key(rel) }, LIST)
        cache.put(STAMP, "calls", pages.size)
    }

    suspend fun isFresh(cache: JsonCache) = cache.isFresh(STAMP, MAX_AGE_MS)

    private val LIST = kotlinx.serialization.builtins.ListSerializer(BoardPageDto.serializer())
}

/** FeatureSync: the board pages of every relationship (throttled to every 30 min; a full resync always). */
object BoardPagesSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        if (!ctx.full && BoardPagesStore.isFresh(ctx.cache)) return
        BoardPagesStore.store(ctx.cache, ctx.api.myBoardPages())
    }
}
