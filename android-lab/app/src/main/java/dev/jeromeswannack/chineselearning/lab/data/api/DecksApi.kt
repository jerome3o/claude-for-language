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

// ---- Paste a list (routes/word-import.ts) and Generate (POST /api/ai/generate-deck) ----

@Serializable data class GlossWordIn(val hanzi: String, val pinyin: String? = null, val english: String? = null)

@Serializable data class GlossWordOut(val hanzi: String, val pinyin: String = "", val english: String = "")

@Serializable data class GlossBody(val words: List<GlossWordIn>)

@Serializable data class GlossAnswer(val words: List<GlossWordOut> = emptyList())

@Serializable
data class EnrichWordIn(val hanzi: String, val pinyin: String? = null, val english: String? = null, val fun_facts: String? = null, val sentence_clue: String? = null)

@Serializable
data class EnrichWordOut(
    val hanzi: String,
    val fun_facts: String? = null,
    val sentence_clue: String? = null,
    val sentence_clue_pinyin: String? = null,
    val sentence_clue_translation: String? = null,
)

@Serializable data class EnrichBody(val words: List<EnrichWordIn>)

@Serializable data class EnrichAnswer(val words: List<EnrichWordOut> = emptyList())

@Serializable
data class StudentShareDto(
    val shared_deck_id: String,
    val relationship_id: String,
    val target_deck_id: String = "",
    val student_name: String = "",
    val target_deleted: Boolean = false,
    val notes_missing: Int = 0,
    val notes_behind: Int = 0,
)

@Serializable data class StudentSharesAnswer(val shares: List<StudentShareDto> = emptyList())

@Serializable data class SharedCopyUpdateDto(val added: Int = 0, val kept: Int = 0, val audio_filled: Int = 0, val updated: Int = 0)

@Serializable data class GenerateDeckBody(val prompt: String, val deck_name: String? = null)

@Serializable data class GeneratedDeckDto(val deck: DeckDto, val notes: List<dev.jeromeswannack.chineselearning.lab.data.NoteDto> = emptyList())

/** Missing pinyin / English for pasted words (Haiku, ≤100 words; 503 without an API key). */
suspend fun Api.glossWords(words: List<GlossWordIn>): List<GlossWordOut> = post<GlossBody, GlossAnswer>("/api/ai/gloss-words", GlossBody(words)).words

/** Explanation + example sentence to the card standard (Sonnet, ≤30 words). */
suspend fun Api.enrichWords(words: List<EnrichWordIn>): List<EnrichWordOut> = post<EnrichBody, EnrichAnswer>("/api/ai/enrich-words", EnrichBody(words)).words

/** A tutor's copies of this deck in students' accounts (empty for everyone else). */
suspend fun Api.deckStudentShares(deckId: String): List<StudentShareDto> = get<StudentSharesAnswer>("/api/decks/${enc(deckId)}/student-shares").shares

/** "Update their copy": new words added, edited text copied, progress kept. */
suspend fun Api.updateStudentCopy(relationshipId: String, sharedDeckId: String): SharedCopyUpdateDto =
    post("/api/relationships/${enc(relationshipId)}/shared-decks/${enc(sharedDeckId)}/update")

/** Generate a deck with Claude (8–12 words, audio awaited server side). */
suspend fun Api.generateDeck(prompt: String, deckName: String?): GeneratedDeckDto = post("/api/ai/generate-deck", GenerateDeckBody(prompt, deckName))
