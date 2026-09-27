package dev.jeromeswannack.chineselearning.lab.data.decks

import dev.jeromeswannack.chineselearning.lab.core.CardStandard
import dev.jeromeswannack.chineselearning.lab.core.DeckQueue
import dev.jeromeswannack.chineselearning.lab.core.DeckSettings
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckDto
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.NoteDto
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.DeckPaths
import dev.jeromeswannack.chineselearning.lab.data.api.MoveDeckBody
import dev.jeromeswannack.chineselearning.lab.data.api.MoveNotesBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewCardFlagBody
import dev.jeromeswannack.chineselearning.lab.data.api.DeckNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.NotePaths
import dev.jeromeswannack.chineselearning.lab.data.api.ReorderBody
import dev.jeromeswannack.chineselearning.lab.data.api.createDeck
import dev.jeromeswannack.chineselearning.lab.data.api.addNoteToDeck
import dev.jeromeswannack.chineselearning.lab.data.api.encode
import dev.jeromeswannack.chineselearning.lab.data.api.makeNoteAudio
import dev.jeromeswannack.chineselearning.lab.data.api.writeSentenceClue
import dev.jeromeswannack.chineselearning.lab.data.api.remakeNoteAudio
import dev.jeromeswannack.chineselearning.lab.data.api.send
import dev.jeromeswannack.chineselearning.lab.data.api.starterDeck
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.io.IOException
import java.util.UUID

/** How a write went. */
sealed interface WriteOutcome {
    /** The server has it (and Room mirrors its answer). */
    data object Saved : WriteOutcome

    /** Offline: changed on this phone, sent by the Outbox on the next sync. */
    data object Queued : WriteOutcome

    /** The server (or the same rule checked on the phone) said no — show [message]. */
    data class Refused(val message: String) : WriteOutcome
}

/** The fields of the card editor / add-word form (the web's CardEditModal / NoteForm). */
data class NoteFields(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val funFacts: String = "",
    val sentenceClue: String = "",
    val sentenceCluePinyin: String = "",
    val sentenceClueTranslation: String = "",
    /** One accepted typed answer per line (stored as a JSON array). */
    val alternatives: String = "",
) {
    fun alternativesJson(): String? {
        val list = alternatives.split('\n').map(NoteSearch::jsTrim).filter { it.isNotEmpty() }
        return if (list.isEmpty()) null else kotlinx.serialization.json.JsonArray(list.map(::JsonPrimitive)).toString()
    }

    companion object {
        fun of(n: NoteEntity) = NoteFields(
            hanzi = n.hanzi, pinyin = n.pinyin, english = n.english, funFacts = n.funFacts.orEmpty(),
            sentenceClue = n.sentenceClue.orEmpty(), sentenceCluePinyin = n.sentenceCluePinyin.orEmpty(),
            sentenceClueTranslation = n.sentenceClueTranslation.orEmpty(), alternatives = alternativesText(n.alternatives),
        )

        /** JSON array → one per line (the web's editor); unreadable → empty. */
        fun alternativesText(json: String?): String = runCatching {
            if (json.isNullOrBlank()) "" else kotlinx.serialization.json.Json.parseToJsonElement(json).let { el ->
                (el as kotlinx.serialization.json.JsonArray).joinToString("\n") { (it as JsonPrimitive).content }
            }
        }.getOrDefault("")
    }
}

/**
 * Every deck / note write the Decks tab, the deck page, the card editor and the card hub
 * make — the web's api/client calls + `removeNotesLocally` / `removeDecksLocally` / the
 * IndexedDB priority updates in services/deckOrder.ts.
 *
 * The content service stays the one write path: each write is the same API call the web
 * makes. Rules the server enforces (card standard, deck settings) are checked here first
 * with the parity-tested ports in core, so the same sentence shows offline. Then:
 *  - online (and nothing older waiting in the Outbox): call the API; on success mirror the
 *    answer into Room, on a 4xx return [WriteOutcome.Refused] with the server's reason;
 *  - offline / server trouble: idempotent writes (edit, delete, move, reorder, settings)
 *    are mirrored into Room at once and queued in the Outbox, in order;
 *  - creating things (a deck, a note, audio) needs the server and says so offline.
 * The next sync brings the canonical rows either way.
 */
class DeckWrites(
    private val dao: LabDao,
    private val api: Api,
    private val outbox: Outbox,
    private val online: () -> Boolean,
    /** Room changed: screens reload (Repository.notifyLocalChange). */
    private val onLocalChange: () -> Unit = {},
    /** After any write: sync (drains the Outbox, fetches canonical rows) / schedule the upload. */
    private val afterWrite: (queued: Boolean) -> Unit = {},
) {
    // ---------------- deck queue ----------------

    /** The whole queue order (first = studied first): the web's `reorderQueue`. */
    suspend fun reorder(orderedIds: List<String>): WriteOutcome {
        val priorities = DeckQueue.prioritiesFor(orderedIds)
        return idempotent("deck-order", "PUT", DeckPaths.REORDER, api.encode(ReorderBody(orderedIds))) {
            val decks = dao.decks().filter { it.id in priorities }
            dao.upsertDecks(decks.map { it.copy(studyPriority = priorities.getValue(it.id)) })
        }
    }

    /**
     * One deck to the top / bottom (the web's `moveDeckInQueue`, `POST /api/decks/:id/move`)
     * or a step up / down (`nudgeDeckInQueue` → the whole order).
     */
    suspend fun moveDeck(deckId: String, to: DeckQueue.Move, currentOrder: List<String>): WriteOutcome = when (to) {
        DeckQueue.Move.UP, DeckQueue.Move.DOWN -> {
            val next = DeckQueue.moveInOrder(currentOrder, deckId, to)
            if (next === currentOrder) WriteOutcome.Saved else reorder(next)
        }
        DeckQueue.Move.TOP, DeckQueue.Move.BOTTOM -> idempotent("deck-order", "POST", DeckPaths.move(deckId), api.encode(MoveDeckBody(to.wire))) {
            val all = dao.decks()
            val p = DeckQueue.edgePriority(all.map { it.studyPriority }, top = to == DeckQueue.Move.TOP)
            all.firstOrNull { it.id == deckId }?.let { dao.upsertDecks(listOf(it.copy(studyPriority = p))) }
        }
    }

    // ---------------- decks ----------------

    /** "New deck" — needs the server (the content service fills in the settings). */
    suspend fun createDeck(name: String, description: String?): Result<DeckDto> = online("create a deck") {
        val deck = api.createDeck(NoteSearch.jsTrim(name), description?.let(NoteSearch::jsTrim)?.ifEmpty { null })
        dao.upsertDecks(listOf(deckEntity(deck)))
        deck
    }

    /** The built-in "Starter Chinese" deck (idempotent server side). Its words arrive with the sync. */
    suspend fun starterDeck(): Result<DeckDto> = online("add the starter deck") {
        val r = api.starterDeck()
        dao.upsertDecks(listOf(deckEntity(r.deck)))
        r.deck
    }

    suspend fun renameDeck(deckId: String, name: String, description: String): WriteOutcome {
        val n = NoteSearch.jsTrim(name)
        if (n.isEmpty()) return WriteOutcome.Refused("A deck needs a name.")
        val d = NoteSearch.jsTrim(description)
        val body = buildJsonObject { put("name", JsonPrimitive(n)); put("description", if (d.isEmpty()) JsonNull else JsonPrimitive(d)) }
        return idempotent("deck-edit", "PUT", DeckPaths.deck(deckId), body.toString()) {
            dao.decks().firstOrNull { it.id == deckId }?.let { dao.upsertDecks(listOf(it.copy(name = n, description = d.ifEmpty { null }))) }
        }
    }

    /**
     * Deck settings (`PUT /api/decks/:id/settings`), validated with `pickDeckSettings`'s port
     * first — a bad value never leaves the phone. [form] holds the raw field texts.
     */
    suspend fun updateSettings(deckId: String, form: Map<String, String>): WriteOutcome {
        val picked = DeckSettings.pick(form)
        if (picked.problems.isNotEmpty()) return WriteOutcome.Refused(picked.problems.joinToString("; ") { it.message })
        val body = buildJsonObject {
            for ((k, v) in picked.settings) put(k, if (v is Double) JsonPrimitive(if (k == "request_retention") v else v.toLong()) else JsonPrimitive(v as String))
        }
        return idempotent("deck-settings", "PUT", DeckPaths.settings(deckId), body.toString()) {
            val deck = dao.decks().firstOrNull { it.id == deckId } ?: return@idempotent
            dao.upsertDecks(
                listOf(
                    deck.copy(
                        newCardsPerDay = (picked.settings["new_cards_per_day"] as Double?)?.toInt() ?: deck.newCardsPerDay,
                        secondaryCardsPerDay = (picked.settings["secondary_cards_per_day"] as Double?)?.toInt() ?: deck.secondaryCardsPerDay,
                    ),
                ),
            )
        }
    }

    /** Delete a deck: gone from this phone at once (the web's removeDecksLocally), tombstoned on the server. */
    suspend fun deleteDeck(deckId: String): WriteOutcome = idempotent("deck-delete", "DELETE", DeckPaths.deck(deckId), null, goneIsDone = true) {
        val ids = listOf(deckId)
        val noteIds = dao.allNotes().filter { it.deckId == deckId }.map { it.id }
        noteIds.chunked(500).forEach { dao.deleteSentencesOf(it) }
        dao.deleteCardsOfDecks(ids)
        dao.deleteNotesOfDecks(ids)
        dao.deleteDecks(ids)
    }

    // ---------------- notes ----------------

    /** "+ Add word" — the server makes the three cards and the audio, so it needs a connection. */
    suspend fun createNote(deckId: String, f: NoteFields): Result<NoteDto> {
        CardStandard.newNoteProblem(f.hanzi, f.pinyin, f.english, f.sentenceClue)?.let { return Result.failure(RefusedException(it)) }
        return online("add a word") {
            val clue = NoteSearch.jsTrim(f.sentenceClue).ifEmpty { null }
            val note = api.addNoteToDeck(
                deckId,
                DeckNoteBody(
                    hanzi = NoteSearch.jsTrim(f.hanzi), pinyin = NoteSearch.jsTrim(f.pinyin), english = NoteSearch.jsTrim(f.english),
                    fun_facts = NoteSearch.jsTrim(f.funFacts).ifEmpty { null }, sentence_clue = clue,
                    sentence_clue_pinyin = clue?.let { NoteSearch.jsTrim(f.sentenceCluePinyin).ifEmpty { null } },
                    sentence_clue_translation = clue?.let { NoteSearch.jsTrim(f.sentenceClueTranslation).ifEmpty { null } },
                    alternatives = f.alternativesJson(),
                ),
            )
            mirrorNote(note)
            note
        }
    }

    /** Save the card editor (the web's CardEditModal.handleSave → PUT /api/notes/:id). */
    suspend fun updateNote(noteId: String, f: NoteFields): WriteOutcome {
        CardStandard.editProblem(f.hanzi, f.pinyin, f.english, f.sentenceClue)?.let { return WriteOutcome.Refused(it) }
        val clue = NoteSearch.jsTrim(f.sentenceClue).ifEmpty { null }
        val funFacts = f.funFacts.ifBlank { null }
        val cluePinyin = clue?.let { NoteSearch.jsTrim(f.sentenceCluePinyin).ifEmpty { null } }
        val clueTranslation = clue?.let { NoteSearch.jsTrim(f.sentenceClueTranslation).ifEmpty { null } }
        val alternatives = f.alternativesJson()
        val patch = buildJsonObject {
            put("hanzi", JsonPrimitive(f.hanzi))
            put("pinyin", JsonPrimitive(f.pinyin))
            put("english", JsonPrimitive(f.english))
            put("fun_facts", funFacts?.let(::JsonPrimitive) ?: JsonNull)
            put("sentence_clue", clue?.let(::JsonPrimitive) ?: JsonNull)
            put("sentence_clue_pinyin", cluePinyin?.let(::JsonPrimitive) ?: JsonNull)
            put("sentence_clue_translation", clueTranslation?.let(::JsonPrimitive) ?: JsonNull)
            put("alternatives", alternatives?.let(::JsonPrimitive) ?: JsonNull)
        }
        return idempotent("note-edit", "PUT", NotePaths.note(noteId), patch.toString(), answer = { body ->
            runCatching { api.json.decodeFromString(NoteDto.serializer(), body) }.getOrNull()?.let { mirrorNote(it, withCards = false) }
        }) {
            val before = dao.note(noteId) ?: return@idempotent
            dao.upsertNotes(
                listOf(
                    before.copy(
                        hanzi = NoteSearch.jsTrim(f.hanzi), pinyin = NoteSearch.jsTrim(f.pinyin), english = NoteSearch.jsTrim(f.english),
                        funFacts = funFacts, sentenceClue = clue, sentenceCluePinyin = cluePinyin, sentenceClueTranslation = clueTranslation,
                        // A changed clue gets a new clip on the server; don't play the old one meanwhile.
                        sentenceClueAudioUrl = if (clue == before.sentenceClue) before.sentenceClueAudioUrl else null,
                        alternatives = alternatives,
                    ),
                ),
            )
        }
    }

    /** Delete a note and its three cards (the web's deleteNote + removeNotesLocally). */
    suspend fun deleteNote(noteId: String): WriteOutcome = idempotent("note-delete", "DELETE", NotePaths.note(noteId), null, goneIsDone = true) {
        val ids = listOf(noteId)
        dao.deleteCardsOfNotes(ids)
        dao.deleteSentencesOf(ids)
        dao.deleteNotes(ids)
    }

    /** Move notes to another of my decks, cards and history kept (`POST /api/notes/move`). */
    suspend fun moveNotes(noteIds: List<String>, toDeckId: String): WriteOutcome {
        if (noteIds.isEmpty()) return WriteOutcome.Saved
        return idempotent("note-move", "POST", NotePaths.MOVE, api.encode(MoveNotesBody(noteIds, toDeckId))) {
            val notes = dao.notes(noteIds)
            dao.upsertNotes(notes.map { it.copy(deckId = toDeckId) })
            notes.forEach { dao.moveCardsOfNote(it.id, toDeckId) }
        }
    }

    /** 🔊+ Generate the word's TTS clip (needs the server). */
    suspend fun generateAudio(noteId: String): Result<NoteDto> = online("make audio") {
        val note = api.makeNoteAudio(noteId)
        dao.note(noteId)?.let { dao.upsertNotes(listOf(it.copy(audioUrl = note.audio_url))) }
        note
    }

    /** 🎙 Regenerate a word's clip (a new voice; needs the server). */
    suspend fun regenerateAudio(noteId: String): Result<NoteDto> = online("make audio") {
        val note = api.remakeNoteAudio(noteId)
        dao.note(noteId)?.let { dao.upsertNotes(listOf(it.copy(audioUrl = note.audio_url))) }
        note
    }

    /** ✨ Claude writes a new example sentence (saved on the note server side) — needs the server. */
    suspend fun generateSentence(noteId: String): Result<NoteDto> = online("write a sentence") {
        val note = api.writeSentenceClue(noteId)
        mirrorNote(note, withCards = false)
        note
    }

    // ---------------- card flags (the card hub's flag form; same queue as the study sheet) ----------------

    /** Flag a card for a tutor — idempotent by its client id, so it can wait in the Outbox. */
    suspend fun flagCard(relationshipId: String, noteId: String, message: String, nowMs: Long = System.currentTimeMillis()): WriteOutcome {
        val text = NoteSearch.jsTrim(message)
        if (text.isEmpty()) return WriteOutcome.Refused("Write what's confusing first.")
        val id = UUID.randomUUID().toString()
        val body = api.encode(NewCardFlagBody(id, relationshipId, noteId, null, text, Js.toIsoString(nowMs)))
        return idempotent("card-flags", "POST", NotePaths.FLAGS, body, outboxId = id) {}
    }

    // ---------------- helpers ----------------

    class RefusedException(message: String) : Exception(message)

    private suspend fun <T> online(what: String, block: suspend () -> T): Result<T> = withContext(Dispatchers.IO) {
        if (!online()) return@withContext Result.failure(RefusedException("You're offline — connect to $what."))
        try {
            val r = block()
            onLocalChange()
            afterWrite(false)
            Result.success(r)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(RefusedException(e.userMessage()))
        }
    }

    /**
     * An idempotent write: straight to the server when online and nothing older is queued
     * (so writes keep their order), else [mirror] + Outbox. [answer] gets the server's body.
     */
    private suspend fun idempotent(
        kind: String,
        method: String,
        path: String,
        body: String?,
        goneIsDone: Boolean = false,
        outboxId: String = UUID.randomUUID().toString(),
        answer: suspend (String) -> Unit = {},
        mirror: suspend () -> Unit,
    ): WriteOutcome = withContext(Dispatchers.IO) {
        if (online() && !hasQueuedWrites()) {
            try {
                val res = api.send(method, path, body)
                if (res.ok || (goneIsDone && res.code == 404)) {
                    mirror()
                    if (res.ok) answer(res.body)
                    onLocalChange()
                    afterWrite(false)
                    return@withContext WriteOutcome.Saved
                }
                if (res.code in 400..499 && res.code != 408 && res.code != 429) {
                    return@withContext WriteOutcome.Refused(HttpException(res.code, res.body.take(200), res.body).userMessage())
                }
                // 5xx / 408 / 429: the Outbox retries it.
            } catch (e: UnauthorizedException) {
                return@withContext WriteOutcome.Refused(e.userMessage())
            } catch (_: IOException) {
                // Offline after all: queue it.
            }
        }
        outbox.enqueue(kind, method, path, body, id = outboxId)
        mirror()
        onLocalChange()
        afterWrite(true)
        WriteOutcome.Queued
    }

    /** A deck / note write of ours still waiting in the Outbox: new ones queue behind it. */
    private suspend fun hasQueuedWrites(): Boolean = outbox.all().any { it.state == Outbox.PENDING && it.kind in KINDS }

    private suspend fun mirrorNote(n: NoteDto, withCards: Boolean = true) {
        dao.upsertNotes(listOf(noteEntity(n)))
        if (withCards && n.cards.isNotEmpty()) dao.insertCardsIfMissing(n.cards.map { CardEntity(it.id, n.id, n.deck_id, it.card_type) })
    }

    companion object {
        /** The Outbox kinds this class writes. */
        val KINDS = setOf("deck-order", "deck-edit", "deck-settings", "deck-delete", "note-edit", "note-delete", "note-move", "card-flags")

        fun deckEntity(d: DeckDto) = DeckEntity(d.id, d.name, d.description, d.new_cards_per_day, d.secondary_cards_per_day, d.study_priority, d.created_at)

        fun noteEntity(n: NoteDto) = NoteEntity(
            id = n.id, deckId = n.deck_id, hanzi = n.hanzi, pinyin = n.pinyin, english = n.english, audioUrl = n.audio_url,
            funFacts = n.fun_facts, context = n.context, sentenceClue = n.sentence_clue, sentenceCluePinyin = n.sentence_clue_pinyin,
            sentenceClueTranslation = n.sentence_clue_translation, sentenceClueAudioUrl = n.sentence_clue_audio_url,
            alternatives = n.alternatives, createdAt = n.created_at,
        )
    }
}
