package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.SourceDecks
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/**
 * Source decks (core SourceDecks.kt; web services/sourceDecks.ts; docs/STUDY_SESSION.md "Source
 * decks"): "+ Add as card" saves straight into the deck of its source, and "Change" moves it.
 */

/** What a source-deck add made: the note(s) and the deck they are in now. */
data class AddedNote(
    val noteIds: List<String>,
    val deckId: String,
    val deckName: String,
    /** The source deck's key (null when it went to a deck he picked). */
    val key: String? = null,
)

@Serializable
data class EnsureSourceDeckBody(val key: String)

@Serializable
data class EnsureSourceDeckDto(val deck: DeckRowDto, val created: Boolean = false)

@Serializable
data class DeckRowDto(val id: String, val name: String = "", val source_key: String? = null)

/** `POST /api/decks/source { key }` → the deck, made on first use. */
suspend fun Api.ensureSourceDeck(key: String): EnsureSourceDeckDto = post("/api/decks/source", EnsureSourceDeckBody(key))

/** Many notes into a source deck in one request (`POST /api/decks/source:<key>/notes/batch`). */
suspend fun Api.addNotesToSourceDeck(key: String, notes: List<NewNoteBody>, skipExisting: Boolean = false): BatchNotesDto =
    addNotesBatch(SourceDecks.ref(key), notes, skipExisting)

/** `POST /api/notes/move` (online): the notes and their cards to another of my decks. */
suspend fun Api.moveNotesTo(noteIds: List<String>, deckId: String): MoveNotesDto = post(NotePaths.MOVE, MoveNotesBody(noteIds, deckId))
