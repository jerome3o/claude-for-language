package dev.jeromeswannack.chineselearning.lab.data.phone

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine.ScenarioResult
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * 📱 Phone practice on the phone (web services/phonePractice.ts, docs/PHONE_PRACTICE.md). Plays are
 * LOCAL-ONLY: kept in the JsonCache (its own kinds, so the study sync never sees them) — finished
 * plays (the result: success, time, hints, mistakes) for the list's "done / best time", and the play
 * in progress (its event log) so leaving and coming back carries on where you were.
 */
object PhoneStore {
    const val PLAY_KIND = "phone_play"
    const val CURRENT_KIND = "phone_current"
    private fun playKey(id: String) = "phone/plays/$id"
    private fun currentKey(scenarioId: String) = "phone/current/$scenarioId"

    /** A play left for more than this starts afresh (yesterday's half-booked ticket is gone). */
    const val RESUME_WITHIN_MS = 12L * 60 * 60 * 1000

    @Serializable
    data class StoredPlay(val id: String, val scenario_id: String, val started_at: Long, val ended_at: Long, val result: ScenarioResult, val gave_up: Boolean)

    @Serializable
    data class CurrentPlay(val scenario_id: String, val started_at: Long, val touched_at: Long, val events: List<JsonObject>, val hints_shown: Int)

    data class ScenarioStatus(val done: Boolean = false, val plays: Int = 0, val bestMs: Long? = null, val lastAt: Long? = null, val inProgress: Boolean = false)

    suspend fun savePlay(app: LabApp, play: StoredPlay) {
        runCatching { app.cache.put(playKey(play.id), PLAY_KIND, play, StoredPlay.serializer()) }
    }

    suspend fun plays(app: LabApp): List<StoredPlay> =
        runCatching { app.cache.all(PLAY_KIND, StoredPlay.serializer()) }.getOrDefault(emptyList()).sortedByDescending { it.ended_at }

    suspend fun currentPlays(app: LabApp): List<CurrentPlay> = runCatching { app.cache.all(CURRENT_KIND, CurrentPlay.serializer()) }.getOrDefault(emptyList())

    /** Per scenario: finished?, best (fastest successful) time, plays, a play under way. */
    suspend fun statuses(app: LabApp): Map<String, ScenarioStatus> = statusesOf(plays(app), currentPlays(app))

    fun statusesOf(plays: List<StoredPlay>, current: List<CurrentPlay>): Map<String, ScenarioStatus> {
        val out = LinkedHashMap<String, ScenarioStatus>()
        for (p in plays) {
            val s = out[p.scenario_id] ?: ScenarioStatus()
            out[p.scenario_id] = s.copy(
                plays = s.plays + 1,
                lastAt = maxOf(s.lastAt ?: 0L, p.ended_at),
                done = s.done || p.result.success,
                bestMs = if (p.result.success) minOf(s.bestMs ?: p.result.duration_ms, p.result.duration_ms) else s.bestMs,
            )
        }
        for (c in current) if (c.events.isNotEmpty()) out[c.scenario_id] = (out[c.scenario_id] ?: ScenarioStatus()).copy(inProgress = true)
        return out
    }

    suspend fun loadCurrent(app: LabApp, scenarioId: String): CurrentPlay? = runCatching { app.cache.get(currentKey(scenarioId), CurrentPlay.serializer()) }.getOrNull()

    suspend fun saveCurrent(app: LabApp, play: CurrentPlay) {
        runCatching { app.cache.put(currentKey(play.scenario_id), CURRENT_KIND, play, CurrentPlay.serializer()) }
    }

    suspend fun clearCurrent(app: LabApp, scenarioId: String) {
        runCatching { app.cache.delete(currentKey(scenarioId)) }
    }
}
