package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// "Forget this card" (worker/src/routes/card-forgets.ts, shared/scheduler forget events;
// data/forgets/ForgetStore.kt). `/api/sync/changes` carries the same live list as `card_forgets`.

/** A live forget: the card is NEW again from [forgotten_at]. */
@Serializable
data class CardForgetDto(val id: String, val card_id: String, val forgotten_at: String, val source: String? = null)

@Serializable data class CardForgetsDto(val forgets: List<CardForgetDto> = emptyList())

/** One forget made on this phone: the client id makes the POST idempotent, so it can wait in the Outbox. */
@Serializable data class ForgetItemBody(val id: String, val card_id: String, val forgotten_at: String, val source: String)

@Serializable data class ForgetBody(val items: List<ForgetItemBody>)

/** Undo: these forgets stop counting (idempotent). */
@Serializable data class ForgetUndoBody(val ids: List<String>)

/** `GET /api/me/card-forgets` — the account's live forgets (a full sync; incremental ones get them in /sync/changes). */
suspend fun Api.cardForgets(): List<CardForgetDto> = get<CardForgetsDto>("/api/me/card-forgets").forgets
