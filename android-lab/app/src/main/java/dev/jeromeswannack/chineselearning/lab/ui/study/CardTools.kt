package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.room.withTransaction
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.api.AskBody
import dev.jeromeswannack.chineselearning.lab.data.api.CARD_FLAGS_PATH
import dev.jeromeswannack.chineselearning.lab.data.api.CardFlagBody
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainTextBody
import dev.jeromeswannack.chineselearning.lab.data.api.FlashcardDraft
import dev.jeromeswannack.chineselearning.lab.data.api.GenerateAudioOptions
import dev.jeromeswannack.chineselearning.lab.data.api.GenerateRecordingBody
import dev.jeromeswannack.chineselearning.lab.data.api.GenerateSentencesBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewConversationBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.NoteUpdate
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceClueOptions
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.data.api.StudyNoteDto
import dev.jeromeswannack.chineselearning.lab.data.api.VocabularyDefinition
import dev.jeromeswannack.chineselearning.lab.data.api.askAboutNote
import dev.jeromeswannack.chineselearning.lab.data.api.createConversation
import dev.jeromeswannack.chineselearning.lab.data.api.createNote
import dev.jeromeswannack.chineselearning.lab.data.api.defineVocabulary
import dev.jeromeswannack.chineselearning.lab.data.api.deleteNote
import dev.jeromeswannack.chineselearning.lab.data.api.deleteSentenceSet
import dev.jeromeswannack.chineselearning.lab.data.api.explainSentence
import dev.jeromeswannack.chineselearning.lab.data.api.explainSentenceText
import dev.jeromeswannack.chineselearning.lab.data.api.generateFunFact
import dev.jeromeswannack.chineselearning.lab.data.api.generateNoteAudio
import dev.jeromeswannack.chineselearning.lab.data.api.generateNoteAudioRecording
import dev.jeromeswannack.chineselearning.lab.data.api.generateSentenceClue
import dev.jeromeswannack.chineselearning.lab.data.api.generateSentenceSet
import dev.jeromeswannack.chineselearning.lab.data.api.initiateAIConversation
import dev.jeromeswannack.chineselearning.lab.data.api.noteAudioRecordings
import dev.jeromeswannack.chineselearning.lab.data.api.noteSentences
import dev.jeromeswannack.chineselearning.lab.data.api.textToFlashcard
import dev.jeromeswannack.chineselearning.lab.data.api.updateNote
import dev.jeromeswannack.chineselearning.lab.data.api.setAudioRecordingPrimary
import dev.jeromeswannack.chineselearning.lab.data.api.deleteAudioRecording
import dev.jeromeswannack.chineselearning.lab.data.api.studyNote
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * The network side of the study card's extras. Every call is the web's own endpoint; an
 * answer that changes a note or its sentences is mirrored into the Room cache at once
 * (like the web's `db.notes.update` after each call), so the card and the next session see
 * it before the next sync. Review events are never touched here.
 */
class CardTools(private val app: LabApp) {
    private val repo get() = app.repo
    private val api get() = app.repo.api
    private val cache get() = app.cache

    /** Notes whose sentence set generation already started this process (`generationStarted`). */
    private val setStarted = HashSet<String>()

    /** Mirror a note the server returned onto the local row; returns the new row. */
    suspend fun mirror(dto: StudyNoteDto): NoteEntity? = withContext(Dispatchers.IO) {
        val local = repo.dao.note(dto.id) ?: return@withContext null
        val updated = dto.applyTo(local)
        repo.dao.upsertNotes(listOf(updated))
        updated
    }

    suspend fun generateFunFact(noteId: String) = mirror(api.generateFunFact(noteId))

    suspend fun generateSentenceClue(noteId: String, options: SentenceClueOptions? = null) = mirror(api.generateSentenceClue(noteId, options))

    /** Word clip missing: generate it (auto, on the card, like the web's StudyCard effect). */
    suspend fun generateAudio(noteId: String) = mirror(api.generateNoteAudio(noteId))

    /** 🔊 Regenerate audio: the default MiniMax voice at the default speed. */
    suspend fun regenerateAudio(noteId: String) = mirror(
        api.generateNoteAudio(noteId, GenerateAudioOptions(speed = CardExtrasLogic.defaultTtsSpeed, provider = "minimax", voiceId = CardExtrasLogic.defaultVoice)),
    )

    /** 🗣️ New voice: a random MiniMax voice added to the note's recordings; returns its clip. */
    suspend fun newVoice(noteId: String): String {
        val (voice, speaker) = CardExtrasLogic.randomVoice()
        return api.generateNoteAudioRecording(
            noteId,
            GenerateRecordingBody(provider = "minimax", speed = CardExtrasLogic.defaultTtsSpeed, voiceId = voice.id, speakerName = speaker),
        ).audio_url
    }

    /** The note's recordings (primary first), as audio keys — what Play cycles through. */
    suspend fun voices(noteId: String): List<String> = api.noteAudioRecordings(noteId).map { it.audio_url }.filter { it.isNotBlank() }

    suspend fun recordings(noteId: String) = api.noteAudioRecordings(noteId)

    suspend fun setPrimaryRecording(noteId: String, recordingId: String) {
        api.setAudioRecordingPrimary(noteId, recordingId)
        // The primary clip is the note's audio_url: pick it up for the card and offline.
        runCatching { mirror(api.studyNote(noteId)) }
    }

    suspend fun deleteRecording(noteId: String, recordingId: String) = api.deleteAudioRecording(noteId, recordingId)

    // ---------------- sentence sets ----------------

    private fun SentenceDto.entity(noteId: String) = SentenceEntity(id, noteId, position, hanzi, pinyin, translation, audio_url, focus, focus_note)

    /** Replace the local set of one note (the server writes a set whole). */
    private suspend fun storeSet(noteId: String, rows: List<SentenceDto>): List<SentenceEntity> = withContext(Dispatchers.IO) {
        val entities = rows.map { it.entity(noteId) }
        repo.db.withTransaction {
            repo.dao.deleteSentencesOf(listOf(noteId))
            if (entities.isNotEmpty()) repo.dao.upsertSentences(entities)
        }
        rows.forEach { r -> r.explanation?.let { cache.put(explainKey(r.id), TutorNotes.KIND, it) } }
        entities.sortedBy { it.position }
    }

    /** `generateAndStoreSentenceSet`. */
    suspend fun generateSet(noteId: String, count: Int? = 6, customPrompt: String? = null, keepExisting: Boolean = false): List<SentenceEntity> =
        storeSet(noteId, api.generateSentenceSet(noteId, GenerateSentencesBody(count, customPrompt, if (keepExisting) true else null)))

    /** Nothing cached but online: the set may exist server-side and not have synced down yet. */
    suspend fun fetchSetIfMissing(noteId: String): List<SentenceEntity>? {
        if (repo.dao.sentencesFor(noteId).isNotEmpty()) return null
        val remote = api.noteSentences(noteId)
        return if (remote.isEmpty()) null else storeSet(noteId, remote)
    }

    suspend fun clearSet(noteId: String) {
        runCatching { api.deleteSentenceSet(noteId) }
            .onFailure { app.prefs.sentencesCursor = null } // offline: re-reconcile the sets on the next sync
        withContext(Dispatchers.IO) { repo.dao.deleteSentencesOf(listOf(noteId)) }
    }

    /**
     * `ensureSentenceSetForNote`: rating Again starts the word's set if it has none, so the
     * sentences are there when the card comes back a minute later. Once per note per run;
     * a failure lets a later Again try again.
     */
    suspend fun ensureSentenceSet(noteId: String) {
        if (!app.online.value || StudyPrefs.get(app).forcedOffline.value || noteId in setStarted) return
        if (repo.dao.sentencesFor(noteId).isNotEmpty()) return
        setStarted += noteId
        try {
            generateSet(noteId, count = 6)
        } catch (e: Exception) {
            setStarted -= noteId
        }
    }

    fun explainKey(sentenceId: String) = "study/explain/$sentenceId"
    private fun explainTextKey(hanzi: String) = "study/explain-text/$hanzi"

    /** A cached breakdown (set row or the card's own clue), or null. */
    suspend fun cachedExplanation(sentenceId: String?, hanzi: String): SentenceExplanation? =
        cache.get(if (sentenceId != null) explainKey(sentenceId) else explainTextKey(hanzi))

    /** `getSentenceExplanation` / `getTextExplanation`: cached first, then the API, then cached. */
    suspend fun explain(sentenceId: String?, hanzi: String, pinyin: String?, translation: String?): SentenceExplanation {
        cachedExplanation(sentenceId, hanzi)?.let { return it }
        val fresh = if (sentenceId != null) api.explainSentence(sentenceId) else api.explainSentenceText(ExplainTextBody(hanzi, pinyin, translation))
        cache.put(if (sentenceId != null) explainKey(sentenceId) else explainTextKey(hanzi), TutorNotes.KIND, fresh)
        return fresh
    }

    // ---------------- notes ----------------

    suspend fun editNote(noteId: String, update: NoteUpdate): NoteEntity? = mirror(api.updateNote(noteId, update))

    /** Delete the note on the server, then drop it (cards, sentences) here. */
    suspend fun deleteNote(noteId: String) {
        api.deleteNote(noteId)
        removeLocally(noteId)
    }

    /** Add a word / sentence as a new card; the next sync brings its cards down. */
    suspend fun addNote(deckId: String, body: NewNoteBody) {
        api.createNote(deckId, body)
        syncSoon()
    }

    /** "Already in <deck>" for the definition popup. */
    suspend fun deckHolding(hanzi: String): String? = withContext(Dispatchers.IO) {
        val note = repo.dao.allNotes().firstOrNull { it.hanzi == hanzi } ?: return@withContext null
        repo.dao.decks().firstOrNull { it.id == note.deckId }?.name ?: "a deck"
    }

    data class Definition(val value: VocabularyDefinition, val fromCache: Boolean)

    /** WordDefinitionPopup: the device cache first (works offline), else `/api/vocabulary/define`. */
    suspend fun define(hanzi: String, context: String?, refresh: Boolean = false): Definition {
        val key = "study/define/$hanzi"
        if (!refresh) cache.get<VocabularyDefinition>(key)?.let { return Definition(it, fromCache = true) }
        val fresh = api.defineVocabulary(hanzi, context, skipCache = refresh)
        cache.put(key, TutorNotes.KIND, fresh)
        return Definition(fresh, fromCache = false)
    }

    // ---------------- flag for tutor ----------------

    /**
     * `queueCardFlag`: queued in the outbox with a client id (`POST /api/card-flags` is
     * idempotent by id) and sent at once when online. Returns true when it reached the server.
     */
    suspend fun flag(tutor: FlagTutor, noteId: String, cardId: String?, message: String): Boolean {
        val id = UUID.randomUUID().toString()
        val body = CardFlagBody(id, tutor.relationshipId, noteId, cardId, message.trim(), Js.toIsoString(System.currentTimeMillis()))
        app.outbox.enqueueJson("card-flag", "POST", CARD_FLAGS_PATH, body, id = id)
        if (!app.online.value) {
            app.scheduleBackgroundUpload()
            return false
        }
        runCatching { app.outbox.drain() }
        val item = app.outbox.all().firstOrNull { it.id == id } ?: return true
        if (item.state == Outbox.FAILED) {
            // The server refused it (4xx): say why instead of keeping a flag that never goes.
            app.outbox.discardFailed("card-flag")
            throw IllegalStateException(item.lastError?.substringAfter(": ")?.let(::serverSentence) ?: "Could not send the flag")
        }
        app.scheduleBackgroundUpload()
        return false
    }

    /** `{"error":"…"}` → "…" for a refused outbox item. */
    private fun serverSentence(body: String): String =
        runCatching { (kotlinx.serialization.json.Json.parseToJsonElement(body) as kotlinx.serialization.json.JsonObject)["error"]!!.let { (it as kotlinx.serialization.json.JsonPrimitive).content } }.getOrDefault(body)

    // ---------------- roleplay ----------------

    /** "Roleplay this word": a Claude conversation about this word; returns the chat route. */
    suspend fun roleplay(relId: String, note: NoteEntity): String {
        val conv = api.createConversation(
            relId,
            NewConversationBody(
                title = "Practice: ${note.hanzi}",
                scenario = "The student is practicing the word/phrase: ${note.hanzi} (${note.pinyin}) meaning \"${note.english}\". Start a conversation that naturally uses this vocabulary. Keep it at a beginner-intermediate level.",
                user_role = "Chinese language student practicing vocabulary",
                ai_role = "Friendly Chinese conversation partner",
            ),
        )
        api.initiateAIConversation(conv.id)
        return "/connections/$relId/chat/${conv.id}"
    }

    // ---------------- Ask Claude ----------------

    suspend fun ask(noteId: String, body: AskBody): AskAnswer = api.askAboutNote(noteId, body)

    suspend fun toFlashcard(text: String): FlashcardDraft = api.textToFlashcard(text)

    /** Pull what Claude created into the local mirror (create_flashcards etc.). */
    fun syncSoon() {
        app.scope.launch { runCatching { repo.sync() } }
    }

    /** Drop a note Claude deleted (delete_current_card) from this device. */
    suspend fun removeLocally(noteId: String) = withContext(Dispatchers.IO) {
        repo.db.withTransaction {
            repo.dao.deleteCardsOfNotes(listOf(noteId))
            repo.dao.deleteSentencesOf(listOf(noteId))
            repo.dao.deleteNotes(listOf(noteId))
        }
    }

    companion object {
        fun message(e: Throwable) = e.userMessage()
    }
}
