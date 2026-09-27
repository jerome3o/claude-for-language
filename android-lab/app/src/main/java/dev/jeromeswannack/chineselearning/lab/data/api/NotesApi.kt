package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.NoteDto
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject

// Note endpoints behind the deck page, the card editor, the search and the card hub.

/** POST /api/decks/:id/notes body (the content service's NoteInput). */
@Serializable
data class NewNoteBody(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val fun_facts: String? = null,
    val sentence_clue: String? = null,
    val sentence_clue_pinyin: String? = null,
    val sentence_clue_translation: String? = null,
    val alternatives: String? = null,
)

@Serializable data class MoveNotesBody(val note_ids: List<String>, val deck_id: String)

@Serializable data class MoveNotesDto(val moved: Int = 0, val note_ids: List<String> = emptyList(), val deck_id: String = "")

@Serializable
data class SearchHitDto(
    val id: String,
    val deck_id: String,
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val sentence_clue: String? = null,
    val deck_name: String? = null,
)

@Serializable data class NoteSearchDto(val notes: List<SearchHitDto> = emptyList(), val total_notes: Int = 0)

// ---- card hub (GET /api/notes/:id/hub; shapes in frontend/src/types/cardFlags.ts) ----

@Serializable data class HubDeckDto(val id: String, val name: String = "")

@Serializable data class HubOwnerDto(val id: String = "", val name: String? = null)

@Serializable
data class HubCardDto(
    val id: String,
    val card_type: String,
    val queue: Int = 0,
    val stability: Double = 0.0,
    val difficulty: Double = 0.0,
    val lapses: Int = 0,
    val reps: Int = 0,
    val next_review_at: String? = null,
)

@Serializable
data class HubReviewDto(
    val id: String,
    val card_id: String = "",
    val card_type: String = "",
    val rating: Int = 0,
    val reviewed_at: String = "",
    val time_spent_ms: Long? = null,
    val user_answer: String? = null,
    val recording_url: String? = null,
)

@Serializable
data class QuestionDto(
    val id: String,
    val note_id: String = "",
    val question: String = "",
    val answer: String = "",
    val asked_at: String = "",
)

@Serializable
data class CardFlagDto(
    val id: String,
    val relationship_id: String = "",
    val note_id: String = "",
    val card_id: String? = null,
    val message: String = "",
    /** 'open' | 'resolved' */
    val status: String = "open",
    val tutor_reply: String? = null,
    val replied_at: String? = null,
    val created_at: String = "",
    val resolved_at: String? = null,
    val tutor_name: String? = null,
    val student_name: String? = null,
)

@Serializable
data class NoteHubDto(
    val note: NoteDto,
    val deck: HubDeckDto,
    val owner: HubOwnerDto = HubOwnerDto(),
    val cards: List<HubCardDto> = emptyList(),
    val recent_reviews: List<HubReviewDto> = emptyList(),
    val review_count: Int = 0,
    val questions: List<QuestionDto> = emptyList(),
    val flags: List<CardFlagDto> = emptyList(),
)

/** A student's flag, idempotent by the client id (the web's queueCardFlag). */
@Serializable
data class NewCardFlagBody(
    val id: String,
    val relationship_id: String,
    val note_id: String,
    val card_id: String? = null,
    val message: String,
    val created_at: String,
)

suspend fun Api.createNote(deckId: String, body: NewNoteBody): NoteDto = post("/api/decks/${enc(deckId)}/notes", body)

/** PUT /api/notes/:id with an explicit patch (explicit nulls clear a field). */
suspend fun Api.updateNote(id: String, patch: JsonObject): NoteDto = exchange("PUT", NotePaths.note(id), patch.toString(), NoteDto.serializer())

/** POST /api/notes/:id/generate-audio → the note with its new audio_url. */
suspend fun Api.generateNoteAudio(id: String): NoteDto = post("/api/notes/${enc(id)}/generate-audio")

suspend fun Api.searchNotes(q: String, limit: Int = 50): NoteSearchDto = get("/api/notes/search?q=${enc(q)}&limit=$limit")

suspend fun Api.noteHub(noteId: String): NoteHubDto = get("/api/notes/${enc(noteId)}/hub")

suspend fun Api.noteQuestions(noteId: String): List<QuestionDto> =
    exchange("GET", "/api/notes/${enc(noteId)}/questions", null, ListSerializer(QuestionDto.serializer()))


object NotePaths {
    fun note(id: String) = "/api/notes/${enc(id)}"
    const val MOVE = "/api/notes/move"
    const val FLAGS = "/api/card-flags"
    fun resolveFlag(id: String) = "/api/card-flags/${enc(id)}/resolve"
    fun reopenFlag(id: String) = "/api/card-flags/${enc(id)}/reopen"
    fun flag(id: String) = "/api/card-flags/${enc(id)}"
}

/** ✨ A fresh example sentence for the note (Claude, saved on the note) → the updated note. */
suspend fun Api.generateSentenceClue(id: String): NoteDto = post("/api/notes/${enc(id)}/generate-sentence-clue")

/** POST /api/notes/:id/regenerate-audio → the note with a fresh clip. */
suspend fun Api.regenerateNoteAudio(id: String): NoteDto = post("/api/notes/${enc(id)}/regenerate-audio")
