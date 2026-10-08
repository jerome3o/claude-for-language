package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.PassEventsBody
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox

/**
 * The two touch points lessons and readers have with homework (docs/HOMEWORK.md), the
 * web's `oneOffOnlyTargetIds` and `recordTargetDone` in services/homework.ts:
 *  - a lesson / reader assigned one-off only is done in the homework pass, never in the
 *    FSRS rotation;
 *  - finishing a lesson / reading a reader anywhere (the session or the homework pass)
 *    records the assignment's `done`.
 *
 * It reads and writes the ONE homework mirror (package E's `HomeworkKeys.ASSIGNMENTS` /
 * `EVENTS`, filled by HomeworkSync), so the pass and Home show the item done at once. The
 * done event goes through the Outbox under the homework kind (so a sync merging events
 * keeps it until it is uploaded), with a deterministic id so it is only ever sent once.
 */
class HomeworkLink(private val cache: JsonCache, private val outbox: Outbox) {

    private suspend fun assignments(): List<HomeworkAssignment> = cache.get<List<HomeworkAssignment>>(HomeworkKeys.ASSIGNMENTS).orEmpty()

    /** `oneOffOnlyTargetIds`: one-off assignments whose target has no long-term (fsrs / both) assignment. */
    suspend fun oneOffOnly(): Set<String> = runCatching { Homework.oneOffOnlyTargets(assignments()) }.getOrDefault(emptySet())

    /** `homeworkPassTargetIds`: lessons / readers with a pass (one_off / both, not cancelled) — on top of the daily new-lesson place. */
    suspend fun homeworkPass(): Set<String> = runCatching { Homework.homeworkPassTargets(assignments()) }.getOrDefault(emptySet())

    /**
     * `recordTargetDone`: a `done` pass event for each active one-off / both assignment of
     * [targetId] that has none yet. Never throws — study must not fail because of homework
     * bookkeeping. Returns whether anything was queued (the caller drains the outbox).
     */
    suspend fun recordDone(kind: String, targetId: String, nowMs: Long = System.currentTimeMillis()): Boolean = runCatching {
        val events = cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS).orEmpty()
        val fresh = assignments().filter { a ->
            a.target_id == targetId && a.kind == kind && a.status == "active" && a.mode != "fsrs" &&
                events.none { it.assignment_id == a.id && it.result == "done" }
        }.map { a -> HomeworkEvent(doneEventId(a.id), a.id, targetId, "done", Js.toIsoString(nowMs)) }
        // Queue first: a sync merging events in between keeps anything still in the outbox.
        for (e in fresh) outbox.enqueueJson(HomeworkKeys.OUTBOX_KIND, "POST", "/api/me/homework/events", PassEventsBody(listOf(e)), id = e.id)
        if (fresh.isNotEmpty()) cache.put(HomeworkKeys.EVENTS, HomeworkKeys.KIND, events + fresh)
        fresh.isNotEmpty()
    }.getOrDefault(false)

    companion object {
        /** One done event per assignment from this phone (the server dedupes by id). */
        fun doneEventId(assignmentId: String) = "lab-done-$assignmentId"
    }
}
