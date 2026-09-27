package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkEventUpload
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkEventsBody
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLiteDto
import dev.jeromeswannack.chineselearning.lab.data.api.homeworkLite
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox

/**
 * The two touch points lessons and readers have with homework (docs/HOMEWORK.md), the
 * web's `oneOffOnlyTargetIds` and `recordTargetDone` in services/homework.ts:
 *  - a lesson / reader assigned one-off only is done in the homework pass, never in the
 *    FSRS rotation;
 *  - finishing a lesson / reading a reader anywhere records the assignment's `done`.
 *
 * It keeps its own small copy of `GET /api/me/homework` (the homework pass itself is
 * package E's); the done event goes through the Outbox with a deterministic id, so it is
 * sent once even if E's pass records the same completion (the server dedupes by id and
 * recomputes progress).
 */
class HomeworkLink(private val cache: JsonCache, private val outbox: Outbox) {

    suspend fun refresh(api: Api) {
        cache.put(KEY, KIND, api.homeworkLite(), HomeworkLiteDto.serializer())
    }

    private suspend fun data(): HomeworkLiteDto = cache.get(KEY, HomeworkLiteDto.serializer()) ?: HomeworkLiteDto()

    /** `oneOffOnlyTargetIds`: one-off assignments whose target has no long-term (fsrs / both) assignment. */
    suspend fun oneOffOnly(): Set<String> {
        val list = data().assignments
        val fsrs = list.filter { it.mode != "one_off" }.mapTo(HashSet()) { it.targetId }
        return list.filter { it.mode == "one_off" && it.targetId !in fsrs }.mapTo(HashSet()) { it.targetId }
    }

    /** `recordTargetDone`: a `done` pass event for each active one-off / both assignment of [targetId]. */
    suspend fun recordDone(kind: String, targetId: String): Boolean {
        val d = data()
        var queued = false
        for (a in d.assignments) {
            if (a.targetId != targetId || a.kind != kind || a.status != "active" || a.mode == "fsrs") continue
            if (d.events.any { it.assignmentId == a.id && it.result == "done" }) continue
            val id = "lab-done-${a.id}"
            val event = HomeworkEventUpload(id, a.id, targetId, "done", Js.toIsoString(System.currentTimeMillis()))
            outbox.enqueueJson("homework-done", "POST", "/api/me/homework/events", HomeworkEventsBody(listOf(event)), id = id)
            queued = true
        }
        if (queued) {
            // Locally the assignment is done now, so a second finish doesn't queue again.
            cache.put(KEY, KIND, d.copy(events = d.events + d.assignments.filter { it.targetId == targetId }.map {
                dev.jeromeswannack.chineselearning.lab.data.api.HomeworkEventLite("lab-done-${it.id}", it.id, "done")
            }), HomeworkLiteDto.serializer())
        }
        return queued
    }

    private companion object {
        const val KEY = "lessons/homework"
        const val KIND = "lessons"
    }
}
