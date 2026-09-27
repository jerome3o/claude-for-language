package dev.jeromeswannack.chineselearning.lab.shell

import dev.jeromeswannack.chineselearning.lab.data.api.get
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.serialization.Serializable

/** `HomeworkAssignment` (shared/homework/types.ts) — only what the widget and notifications show. */
@Serializable
data class ShellAssignmentDto(
    val id: String,
    val kind: String = "deck",
    val title: String = "",
    val mode: String = "fsrs",
    val due_date: String? = null,
    val status: String = "active",
    val item_count: Int = 0,
    val done_count: Int = 0,
    val tutor_name: String? = null,
) {
    fun toItem() = ShellRules.HomeworkItem(id, title, kind, mode, due_date, status, tutor_name, item_count, done_count)
}

@Serializable
data class ShellHomeworkDto(val assignments: List<ShellAssignmentDto> = emptyList())

/**
 * The student's assignments for the widget's homework line and the due-homework
 * notification, cached for offline (`GET /api/me/homework`, the web's homework sync).
 * Registered in FeatureSyncs; refreshed at most every 15 minutes.
 */
object HomeworkFeed : FeatureSync {
    const val KEY = "shell/homework"
    const val KIND = "shell"
    private const val MAX_AGE_MS = 15 * 60 * 1000L

    override suspend fun sync(ctx: SyncContext) {
        if (!ctx.full && ctx.cache.isFresh(KEY, MAX_AGE_MS)) return
        ctx.cache.put(KEY, KIND, ctx.api.get<ShellHomeworkDto>("/api/me/homework"))
    }

    suspend fun cached(cache: JsonCache): List<ShellRules.HomeworkItem> =
        cache.get<ShellHomeworkDto>(KEY)?.assignments?.map { it.toItem() }.orEmpty()
}
