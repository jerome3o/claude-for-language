package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.relationshipHomework
import dev.jeromeswannack.chineselearning.lab.data.api.teachingMe
import dev.jeromeswannack.chineselearning.lab.data.api.tutorDashboard
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys

/**
 * Keeps the Students tab ready for the train: after each sync (at most every 10 minutes) an
 * account with students fetches the dashboard, and every student's card from it becomes that
 * student's page (so a student page opens instantly, offline too); the homework plans follow
 * at most every 30 minutes, and the homework library every 10. Writes stay online-only, like the web.
 */
object TeachingSync : FeatureSync {
    private const val DASHBOARD_MAX_AGE = 10 * 60_000L
    private const val HOMEWORK_MAX_AGE = 30 * 60_000L

    override suspend fun sync(ctx: SyncContext) {
        val rel = ctx.cache.get<MyRelationshipsDto>(NavKeys.RELATIONSHIPS)
        if (rel?.students?.none { it.status == "active" } != false) return
        if (ctx.full || !ctx.cache.isFresh(TeachingKeys.ME, 60 * 60_000L)) {
            ctx.cache.put(TeachingKeys.ME, TeachingKeys.KIND, ctx.api.teachingMe())
        }
        // The homework library (docs/HOMEWORK.md §9): every student's, sliced per student.
        attempt { syncHomeworkLibrary(ctx) }
        if (!ctx.full && ctx.cache.isFresh(TeachingKeys.DASHBOARD, DASHBOARD_MAX_AGE)) return
        val dashboard = ctx.api.tutorDashboard()
        ctx.cache.put(TeachingKeys.DASHBOARD, TeachingKeys.KIND, dashboard)
        for (s in dashboard.students) {
            ctx.cache.put(TeachingKeys.overview(s.relationship_id), TeachingKeys.KIND, s)
            val key = TeachingKeys.homework(s.relationship_id)
            if (ctx.full || !ctx.cache.isFresh(key, HOMEWORK_MAX_AGE)) {
                attempt { ctx.cache.put(key, TeachingKeys.KIND, ctx.api.relationshipHomework(s.relationship_id)) }
            }
        }
    }
}
