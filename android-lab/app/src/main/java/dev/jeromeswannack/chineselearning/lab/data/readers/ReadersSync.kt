package dev.jeromeswannack.chineselearning.lab.data.readers

import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext

/** Readers in the sync (web: syncReadersFromServer + downloadReaderReviewEvents + prefetchReaderMedia). */
object ReadersSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        ReaderStore(ctx.cache, ctx.outbox, ctx.api).sync()
    }
}
