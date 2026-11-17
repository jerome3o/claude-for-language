package dev.jeromeswannack.chineselearning.lab.data.revisit

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.RevisitMark
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.RevisitEventDto
import dev.jeromeswannack.chineselearning.lab.data.api.RevisitEventsUpload
import dev.jeromeswannack.chineselearning.lab.data.api.revisit
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.util.UUID

/** A Done-for-good / Bring-back event on this phone; [pending] until the server's list carries it. */
@Serializable
data class LocalRevisitEvent(
    val id: String,
    val itemKind: String,
    val itemId: String,
    val action: String,
    val createdAt: String,
    val pending: Boolean = false,
) {
    fun mark() = RevisitMark(id, itemKind, itemId, action, createdAt)
    fun dto() = RevisitEventDto(id, itemKind, itemId, action, createdAt)
}

/**
 * The legacy "Done for good" / "Bring back" marks on mini lessons (the web's services/lessonLearn.ts):
 * written here at once and sent through the Outbox (`POST /api/me/revisit-events`, idempotent by
 * id); every sync replaces the server's events whole (`GET /api/me/revisit`), keeping this phone's
 * pending ones. LessonStore hands them to the revision rule (core LessonRevision: a retire = done
 * forever). The old "revisit later" gaps and "New lessons a day" settings are gone (Oct 2026).
 * Readers are read once — their old marks are ignored.
 */
class RevisitStore(private val cache: JsonCache, private val outbox: Outbox, private val api: Api) {
    private val eventsSerializer = ListSerializer(LocalRevisitEvent.serializer())

    fun observeMarks(): Flow<List<RevisitMark>> = cache.observe(EVENTS, eventsSerializer).map { list -> list.orEmpty().map { it.mark() } }

    suspend fun marks(): List<RevisitMark> = events().map { it.mark() }

    private suspend fun events(): List<LocalRevisitEvent> = cache.get(EVENTS, eventsSerializer).orEmpty()

    /**
     * `markRevisit`: write a retire / restore event (local at once, uploaded through the
     * outbox) — the lists and the session see it on their next read.
     */
    suspend fun mark(itemKind: String, itemId: String, action: String, source: String = "session", nowMs: Long = System.currentTimeMillis(), track: Boolean = true): LocalRevisitEvent = lock.withLock {
        val event = LocalRevisitEvent(UUID.randomUUID().toString(), itemKind, itemId, action, Js.toIsoString(nowMs), pending = true)
        cache.put(EVENTS, KIND, events() + event, eventsSerializer)
        outbox.enqueueJson(KIND, "POST", "/api/me/revisit-events", RevisitEventsUpload(listOf(event.dto())), id = event.id)
        // The row menu's "Stop revising — done for good" tracks `lesson.row_action` instead (track = false).
        if (track && action == RETIRE) Analytics.track("study.done_for_good", mapOf("kind" to itemKind, "source" to source))
        else if (track) Analytics.track("study.bring_back", mapOf("kind" to itemKind))
        event
    }

    /** `syncRevisit` (after the outbox drained): the server's events, this phone's pending ones on top. */
    suspend fun sync() {
        val res = api.revisit()
        lock.withLock {
            val stillQueued = outbox.all().filter { it.kind == KIND }.mapTo(HashSet()) { it.id }
            val server = res.events.map { LocalRevisitEvent(it.id, it.item_kind, it.item_id, it.action, it.created_at) }
            val serverIds = server.mapTo(HashSet()) { it.id }
            val pending = events().filter { it.pending && it.id in stillQueued && it.id !in serverIds }
            cache.put(EVENTS, KIND, server + pending, eventsSerializer)
        }
    }

    companion object {
        const val KIND = "revisit"
        const val EVENTS = "revisit/events"
        const val RETIRE = "retire"
        const val RESTORE = "restore"
        private val lock = Mutex()
    }
}

/** The Done-for-good marks in the sync (web: `replaceLocalRevisitEvents`), after the outbox drained. */
object RevisitSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        RevisitStore(ctx.cache, ctx.outbox, ctx.api).sync()
    }
}
