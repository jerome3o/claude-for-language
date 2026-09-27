package dev.jeromeswannack.chineselearning.lab.ui.library

import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.libraryItems
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import kotlinx.serialization.builtins.ListSerializer

/**
 * Keeps the Lesson Library list on the phone (so `/library` opens instantly, and offline) for
 * accounts that teach: an account with an active student, or one that has opened its library
 * before (a tutor account's Library tab). Every 10 minutes at most; a full resync always.
 * Runs after NavSync, so the relationships it reads are this sync's.
 */
object LibrarySync : FeatureSync {
    const val MAX_AGE_MS = 10 * 60_000L

    override suspend fun sync(ctx: SyncContext) {
        val rels = ctx.cache.get(NavKeys.RELATIONSHIPS, MyRelationshipsDto.serializer())
        val teaches = rels?.students?.any { it.status == "active" } == true
        val seen = ctx.cache.entry(LibraryKeys.LIST) != null
        if (!teaches && !seen) return
        if (!ctx.full && ctx.cache.isFresh(LibraryKeys.LIST, MAX_AGE_MS)) return
        ctx.cache.put(LibraryKeys.LIST, LibraryKeys.KIND, ctx.api.libraryItems(), ListSerializer(LibraryItemSummaryDto.serializer()))
    }
}
