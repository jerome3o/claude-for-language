package dev.jeromeswannack.chineselearning.lab.data.homework

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.data.api.PassEventsBody
import dev.jeromeswannack.chineselearning.lab.data.api.LessonSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.OnboardingDto
import dev.jeromeswannack.chineselearning.lab.data.api.SharedDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.activeLessonSummaries
import dev.jeromeswannack.chineselearning.lab.data.api.myHomework
import dev.jeromeswannack.chineselearning.lab.data.api.onboarding
import dev.jeromeswannack.chineselearning.lab.data.api.sharedDecks
import dev.jeromeswannack.chineselearning.lab.data.api.myRelationships
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

/**
 * The student's homework on this phone (docs/HOMEWORK.md §3) — the Lab's version of the web's
 * `homeworkAssignments` / `homeworkEvents` IndexedDB tables and services/homework.ts:
 *
 *  - [HomeworkSync] mirrors `GET /api/me/homework` into the JsonCache after the outbox has
 *    uploaded this phone's pass events, keeping local events the server hasn't got yet.
 *  - [recordPassEvent] writes a pass event locally at once and queues the idempotent upload
 *    (`POST /api/me/homework/events`, the event id is the outbox id); uploads straight away
 *    when online, otherwise on the next sync / by the SyncWorker.
 *  - Progress is always computed from events with the shared rules (core `Homework`), so a pass
 *    finished offline shows as done at once.
 *
 * Also caches what Home's "From <tutor>" card and the invitee first-open screen need (the
 * unread tutor messages come from ConnectionsSync's notifications).
 */
object HomeworkKeys {
    const val KIND = "homework"
    const val ASSIGNMENTS = "homework/assignments"
    const val EVENTS = "homework/events"
    const val TUTOR_CARD = "homework/tutor-card"
    const val ONBOARDING = "onboarding/state"
    const val ONBOARDING_DISMISSED = "onboarding/dismissed"
    const val ONBOARDING_KIND = "onboarding"
    const val OUTBOX_KIND = "homework"
}

/** What the "From <tutor>" card is built from (the web's useHomework queries), snapshotted for offline. */
@Serializable
data class TutorCardSources(
    val sharedDecks: List<SharedDeckDto> = emptyList(),
    val lessons: List<LessonSummaryDto> = emptyList(),
)

object HomeworkStore {
    fun assignments(cache: JsonCache): Flow<List<HomeworkAssignment>?> = cache.observe<List<HomeworkAssignment>>(HomeworkKeys.ASSIGNMENTS)
    fun events(cache: JsonCache): Flow<List<HomeworkEvent>?> = cache.observe<List<HomeworkEvent>>(HomeworkKeys.EVENTS)

    /** (assignments, events) as one flow; null until the first sync has mirrored anything. */
    fun observe(cache: JsonCache): Flow<Pair<List<HomeworkAssignment>, List<HomeworkEvent>>?> =
        combine(assignments(cache), events(cache)) { a, e -> a?.let { it to (e ?: emptyList()) } }

    /** Records one pass event (right / wrong / done) and uploads it (now when online, else later). */
    suspend fun recordPassEvent(app: LabApp, assignmentId: String, itemId: String, result: String, now: Instant = Instant.now()): HomeworkEvent {
        val event = HomeworkEvent(UUID.randomUUID().toString(), assignmentId, itemId, result, now.toString())
        val cache = app.cache
        // Queue first: a sync merging events in between keeps anything still in the outbox.
        app.outbox.enqueueJson(HomeworkKeys.OUTBOX_KIND, "POST", "/api/me/homework/events", PassEventsBody(listOf(event)), id = event.id)
        cache.put(HomeworkKeys.EVENTS, HomeworkKeys.KIND, cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS).orEmpty() + event)
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } } else app.scheduleBackgroundUpload()
        return event
    }

    /**
     * A lesson or reader was finished (in the pass or in the study session): mark every open
     * one-off assignment on it done. Never throws — study must not fail because of homework
     * bookkeeping. (Port of recordTargetDone; package B's players call this.)
     */
    suspend fun recordTargetDone(app: LabApp, kind: String, targetId: String) {
        runCatching {
            val list = app.cache.get<List<HomeworkAssignment>>(HomeworkKeys.ASSIGNMENTS).orEmpty()
            val events = app.cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS).orEmpty()
            for (a in list) {
                if (a.target_id != targetId || a.kind != kind || a.status != "active" || a.mode == "fsrs") continue
                if (events.any { it.assignment_id == a.id && it.result == "done" }) continue
                recordPassEvent(app, a.id, targetId, "done")
            }
        }
    }

    /** Lessons / readers assigned one-off only — package B leaves them out of the lesson mix and the daily reader. */
    suspend fun oneOffOnlyTargetIds(cache: JsonCache): Set<String> =
        runCatching { Homework.oneOffOnlyTargets(cache.get<List<HomeworkAssignment>>(HomeworkKeys.ASSIGNMENTS).orEmpty()) }.getOrDefault(emptySet())

    /** Server events + this phone's events still waiting in the outbox (web: syncHomework's merge). */
    fun mergeEvents(server: List<HomeworkEvent>, local: List<HomeworkEvent>, pendingIds: Set<String>): List<HomeworkEvent> {
        val serverIds = server.mapTo(HashSet()) { it.id }
        return server + local.filter { it.id !in serverIds && it.id in pendingIds }
    }
}

/** Registered in FeatureSyncs: homework, the "From <tutor>" sources and the onboarding state. */
object HomeworkSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        val cache = ctx.cache
        val data = ctx.api.myHomework()
        val pending = ctx.outbox.all().filter { it.kind == HomeworkKeys.OUTBOX_KIND && it.state == Outbox.PENDING }.mapTo(HashSet()) { it.id }
        val local = cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS).orEmpty()
        cache.put(HomeworkKeys.ASSIGNMENTS, HomeworkKeys.KIND, data.assignments)
        cache.put(HomeworkKeys.EVENTS, HomeworkKeys.KIND, HomeworkStore.mergeEvents(data.events, local, pending))

        // "From <tutor>" card: only for accounts with a tutor (the NavSync step ran just before).
        val rel = cache.get<dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto>(NavKeys.RELATIONSHIPS) ?: ctx.api.myRelationships()
        val tutors = rel.tutors
        if (tutors.isEmpty()) {
            cache.put(HomeworkKeys.TUTOR_CARD, HomeworkKeys.KIND, TutorCardSources())
        } else {
            val decks = tutors.flatMap { t -> runCatching { ctx.api.sharedDecks(t.id).map { it.copy(relationship_id = t.id) } }.getOrDefault(emptyList()) }
            val lessons = runCatching { ctx.api.activeLessonSummaries() }.getOrDefault(emptyList())
            cache.put(HomeworkKeys.TUTOR_CARD, HomeworkKeys.KIND, TutorCardSources(decks, lessons))
        }

        // Invitee first-open screen (web: useOnboarding) — only worth asking until they've reviewed.
        val onb = cache.get<OnboardingDto>(HomeworkKeys.ONBOARDING)
        if (onb == null || (onb.invited && !onb.has_reviewed)) {
            cache.put(HomeworkKeys.ONBOARDING, HomeworkKeys.ONBOARDING_KIND, ctx.api.onboarding())
        }
    }
}
