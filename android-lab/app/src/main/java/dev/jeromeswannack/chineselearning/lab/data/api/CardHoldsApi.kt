package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// Suspend & snooze (worker/src/routes/card-holds.ts, shared/decks/holds.ts; data/holds/HoldStore.kt).
// `/api/sync/changes` carries the same active list as `card_holds`.

/** An active hold (not cleared). `until` = the local date a snooze ends ("YYYY-MM-DD"). */
@Serializable
data class CardHoldDto(
    val id: String,
    val card_id: String,
    val kind: String,
    val until: String? = null,
    val created_at: String,
    val note_id: String? = null,
    val card_type: String? = null,
    val hanzi: String? = null,
    val deck_name: String? = null,
)

@Serializable data class CardHoldsDto(val holds: List<CardHoldDto> = emptyList())

/** One hold made on this phone: the client id makes the POST idempotent, so it can wait in the Outbox. */
@Serializable data class HoldItemBody(val id: String, val card_id: String, val kind: String, val until: String?, val created_at: String, val source: String)

@Serializable data class HoldBody(val items: List<HoldItemBody>)

/** Unsuspend / Wake now: clears the holds of [card_ids] made at or before [cleared_at] (idempotent). */
@Serializable data class HoldClearBody(val card_ids: List<String>, val cleared_at: String)

@Serializable data class BurySiblingsBody(val bury_siblings: Boolean)

@Serializable data class BurySiblingsDto(val bury_siblings: Boolean = false)

/** `GET /api/me/card-holds` — the account's active holds (a full sync; incremental ones get them in /sync/changes). */
suspend fun Api.cardHolds(): List<CardHoldDto> = get<CardHoldsDto>("/api/me/card-holds").holds

/** `PUT /api/profile/bury-siblings`. */
suspend fun Api.setBurySiblings(on: Boolean): Boolean = put<BurySiblingsBody, BurySiblingsDto>("/api/profile/bury-siblings", BurySiblingsBody(on)).bury_siblings
