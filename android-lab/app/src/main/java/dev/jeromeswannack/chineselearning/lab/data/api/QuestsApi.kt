package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/* Quests (package H) — the same endpoints as the web's api/client.ts "Quests" block. */

/** A list row (`GET /api/quests`) — the world JSON is left out. */
@Serializable
data class QuestSummaryDto(
    val id: String,
    val title: String = "",
    val topic: String? = null,
    val status: String = "ready",
    val error: String? = null,
    val completed_at: String? = null,
    val best_moves: Int? = null,
    val play_count: Int = 0,
    val progress: String? = null,
    val created_at: String = "",
    val goal_count: Int = 0,
    val object_count: Int = 0,
)

/** One quest with its world (`GET /api/quests/:id`); `world` is parsed by core's QuestWorld.parse. */
@Serializable
data class QuestDto(
    val id: String,
    val title: String = "",
    val topic: String? = null,
    val status: String = "ready",
    val world: JsonElement? = null,
    val error: String? = null,
    val completed_at: String? = null,
    val best_moves: Int? = null,
    val progress: String? = null,
    val created_at: String = "",
)

@Serializable data class QuestListDto(val quests: List<QuestSummaryDto> = emptyList())
@Serializable data class QuestEnvelopeDto(val quest: QuestDto)
@Serializable data class NewQuestBody(val topic: String? = null, val difficulty: String? = null, val goal_count: Int? = null)
@Serializable data class QuestCreatedDto(val id: String, val status: String = "generating")
@Serializable data class QuestCompleteBody(val moves: Int)

suspend fun Api.quests(): List<QuestSummaryDto> = get<QuestListDto>("/api/quests").quests
suspend fun Api.quest(id: String): QuestDto = get<QuestEnvelopeDto>("/api/quests/${enc(id)}").quest
suspend fun Api.createQuest(body: NewQuestBody): QuestCreatedDto = post("/api/quests", body)
suspend fun Api.retryQuest(id: String): QuestCreatedDto = post("/api/quests/${enc(id)}/retry")
suspend fun Api.deleteQuest(id: String) { send("DELETE", "/api/quests/${enc(id)}").let { if (!it.ok && it.code != 404) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(it.code, it.body.take(200), it.body) } }

