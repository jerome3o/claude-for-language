package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.DeckDto
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// Deck endpoints the web's Decks tab and deck page call (frontend/src/api/client.ts).
// Every write goes through the worker's content service; the Lab app mirrors the answer
// into Room and the next sync brings the canonical rows (data/decks/DeckWrites.kt).

@Serializable data class NewDeckBody(val name: String, val description: String? = null)

@Serializable data class DeckPatchBody(val name: String? = null, val description: String? = null)

@Serializable data class MoveDeckBody(val to: String)

@Serializable data class ReorderBody(val deck_ids: List<String>)

@Serializable data class StarterDeckDto(val deck: DeckDto, val created: Boolean = false, val word_count: Int = 0)

/** POST /api/decks → the new deck (shared defaults: 3 new + 6 secondary a day). */
suspend fun Api.createDeck(name: String, description: String?): DeckDto = post("/api/decks", NewDeckBody(name, description))

suspend fun Api.updateDeck(id: String, name: String?, description: String?): DeckDto = put("/api/decks/${enc(id)}", DeckPatchBody(name, description))

/** PUT /api/decks/:id/settings — any subset; 400 with `problems` on bad values. */
suspend fun Api.updateDeckSettings(id: String, settings: JsonObject): DeckDto =
    exchange("PUT", "/api/decks/${enc(id)}/settings", settings.toString(), DeckDto.serializer())

suspend fun Api.starterDeck(): StarterDeckDto = post("/api/decks/starter")

object DeckPaths {
    fun deck(id: String) = "/api/decks/${enc(id)}"
    fun move(id: String) = "/api/decks/${enc(id)}/move"
    fun settings(id: String) = "/api/decks/${enc(id)}/settings"
    const val REORDER = "/api/decks/reorder"
}
