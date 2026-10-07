package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.NewCardOrder
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * "Order new cards by" (shared/decks/new-card-order.ts): PUT /api/profile/new-card-order
 * `{ <switch>: true | false }` or `{ reset: true }` → NewCardOrderInfo (the four switches +
 * is_default). /api/auth/me and /api/sync/changes carry the same as `new_card_order`.
 */

/** Change one switch; returns the account's whole order as saved. */
suspend fun Api.saveNewCardOrder(key: String, on: Boolean): NewCardOrder =
    NewCardOrder.parse(put<JsonObject, JsonObject>("/api/profile/new-card-order", buildJsonObject { put(key, JsonPrimitive(on)) }).toString())

/** Every switch back to its default. */
suspend fun Api.resetNewCardOrder(): NewCardOrder =
    NewCardOrder.parse(put<JsonObject, JsonObject>("/api/profile/new-card-order", buildJsonObject { put("reset", JsonPrimitive(true)) }).toString())
