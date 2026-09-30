package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File

// The study card's online extras (package A) — the same endpoints frontend/src/api/client.ts
// calls from StudyPage.tsx, SentenceSet.tsx, WordDefinitionPopup.tsx, CardEditModal.tsx,
// services/recording-notes.ts and services/cardFlags.ts.

/** A note as the notes endpoints return it (`Note` in frontend/src/types.ts), only what the card uses. */
@Serializable
data class StudyNoteDto(
    val id: String,
    val deck_id: String = "",
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val audio_url: String? = null,
    val audio_provider: String? = null,
    val fun_facts: String? = null,
    val context: String? = null,
    val sentence_clue: String? = null,
    val sentence_clue_pinyin: String? = null,
    val sentence_clue_translation: String? = null,
    val sentence_clue_audio_url: String? = null,
    val alternatives: String? = null,
    val multiple_choice_options: String? = null,
    val pinyin_only: Int? = null,
    val created_at: String? = null,
) {
    /** Mirror the server's answer onto the local row (the Room note is a cache of the server's). */
    fun applyTo(local: NoteEntity): NoteEntity = local.copy(
        hanzi = hanzi.ifEmpty { local.hanzi },
        pinyin = pinyin.ifEmpty { local.pinyin },
        english = english.ifEmpty { local.english },
        audioUrl = audio_url,
        funFacts = fun_facts,
        context = context ?: local.context,
        sentenceClue = sentence_clue,
        sentenceCluePinyin = sentence_clue_pinyin,
        sentenceClueTranslation = sentence_clue_translation,
        sentenceClueAudioUrl = sentence_clue_audio_url,
        alternatives = alternatives,
        createdAt = created_at ?: local.createdAt,
    )
}

// ---------------- AI helpers on the card ----------------

suspend fun Api.generateFunFact(noteId: String): StudyNoteDto = post("/api/notes/${enc(noteId)}/generate-fun-fact")

@Serializable
data class SentenceClueOptions(val modifier: String? = null, val customPrompt: String? = null)

suspend fun Api.generateSentenceClue(noteId: String, options: SentenceClueOptions? = null): StudyNoteDto =
    if (options == null) post("/api/notes/${enc(noteId)}/generate-sentence-clue")
    else post("/api/notes/${enc(noteId)}/generate-sentence-clue", options)

suspend fun Api.generateMultipleChoice(noteId: String): StudyNoteDto = post("/api/notes/${enc(noteId)}/generate-multiple-choice")

suspend fun Api.studyNote(noteId: String): StudyNoteDto = get("/api/notes/${enc(noteId)}")

// ---------------- audio ----------------

/** `GenerateAudioOptions` — MiniMax voice / speed for a regenerated word clip. */
@Serializable
data class GenerateAudioOptions(val speed: Double? = null, val provider: String? = null, val voiceId: String? = null)

suspend fun Api.generateNoteAudio(noteId: String, options: GenerateAudioOptions? = null): StudyNoteDto =
    if (options == null) post("/api/notes/${enc(noteId)}/generate-audio")
    else post("/api/notes/${enc(noteId)}/generate-audio", options)

@Serializable
data class NoteAudioRecordingDto(
    val id: String,
    val note_id: String = "",
    val audio_url: String = "",
    val provider: String? = null,
    val speaker_name: String? = null,
    val is_primary: Boolean = false,
    val created_at: String? = null,
)

suspend fun Api.noteAudioRecordings(noteId: String): List<NoteAudioRecordingDto> = get("/api/notes/${enc(noteId)}/audio")

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class GenerateRecordingBody(
    @EncodeDefault val generate: Boolean = true,
    val provider: String,
    val speed: Double? = null,
    val voiceId: String? = null,
    val speakerName: String? = null,
)

/** "New voice": a fresh MiniMax take added to the note's recordings (web: generateNoteAudioRecording). */
suspend fun Api.generateNoteAudioRecording(noteId: String, body: GenerateRecordingBody): NoteAudioRecordingDto =
    post("/api/notes/${enc(noteId)}/audio", body)

suspend fun Api.setAudioRecordingPrimary(noteId: String, recordingId: String) {
    val res = send("PUT", "/api/notes/${enc(noteId)}/audio/${enc(recordingId)}/primary")
    if (!res.ok) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(res.code, res.body.take(200), res.body)
}

suspend fun Api.deleteAudioRecording(noteId: String, recordingId: String) {
    val res = send("DELETE", "/api/notes/${enc(noteId)}/audio/${enc(recordingId)}")
    if (!res.ok) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(res.code, res.body.take(200), res.body)
}

// ---------------- notes (edit card, add a word) ----------------

/**
 * PUT /api/notes/:id from the edit sheet — the web's CardEditModal.handleSave: fun facts only
 * when non-empty, the sentence fields explicitly null when the sentence was cleared. Built
 * by hand because the API's Json drops nulls (explicitNulls = false).
 */
data class NoteUpdate(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val funFacts: String?,
    val sentenceClue: String?,
    val sentenceCluePinyin: String?,
    val sentenceClueTranslation: String?,
    val sentenceClueAudioUrl: String?,
    val alternatives: String?,
) {
    fun toJson(): String = kotlinx.serialization.json.buildJsonObject {
        put("hanzi", JsonPrimitive(hanzi))
        put("pinyin", JsonPrimitive(pinyin))
        put("english", JsonPrimitive(english))
        if (!funFacts.isNullOrEmpty()) put("fun_facts", JsonPrimitive(funFacts))
        put("sentence_clue", JsonPrimitive(sentenceClue))
        put("sentence_clue_pinyin", JsonPrimitive(if (sentenceClue != null) sentenceCluePinyin else null))
        put("sentence_clue_translation", JsonPrimitive(if (sentenceClue != null) sentenceClueTranslation else null))
        put("sentence_clue_audio_url", JsonPrimitive(if (sentenceClue != null) sentenceClueAudioUrl else null))
        put("alternatives", JsonPrimitive(alternatives))
    }.toString()
}

suspend fun Api.updateNote(noteId: String, update: NoteUpdate): StudyNoteDto =
    exchange("PUT", "/api/notes/${enc(noteId)}", update.toJson(), StudyNoteDto.serializer())

suspend fun Api.deleteNote(noteId: String) {
    val res = send("DELETE", "/api/notes/${enc(noteId)}")
    if (!res.ok) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(res.code, res.body.take(200), res.body)
}

@Serializable
data class NewNoteBody(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val fun_facts: String? = null,
    val sentence_clue: String? = null,
    val sentence_clue_pinyin: String? = null,
    val sentence_clue_translation: String? = null,
)

suspend fun Api.createNote(deckId: String, body: NewNoteBody): StudyNoteDto = post("/api/decks/${enc(deckId)}/notes", body)

// ---------------- tap a character → definition ----------------

@Serializable
data class DefineBody(val hanzi: String, val context: String? = null, val skipCache: Boolean? = null)

@Serializable
data class VocabularyDefinition(
    val hanzi: String,
    val pinyin: String = "",
    val english: String = "",
    val fun_facts: String? = null,
    val example: String? = null,
)

suspend fun Api.defineVocabulary(hanzi: String, context: String?, skipCache: Boolean = false): VocabularyDefinition =
    post("/api/vocabulary/define", DefineBody(hanzi, context, if (skipCache) true else null))

// ---------------- sentence sets ----------------

@Serializable
data class SentenceDto(
    val id: String,
    val note_id: String = "",
    val position: Int = 0,
    val hanzi: String = "",
    val pinyin: String? = null,
    val translation: String? = null,
    val audio_url: String? = null,
    val focus: String? = null,
    val focus_note: String? = null,
    val explanation: String? = null,
)

@Serializable
data class SentencesAnswer(val sentences: List<SentenceDto> = emptyList())

@Serializable
data class GenerateSentencesBody(val count: Int? = null, val customPrompt: String? = null, val keepExisting: Boolean? = null)

suspend fun Api.noteSentences(noteId: String): List<SentenceDto> = get<SentencesAnswer>("/api/notes/${enc(noteId)}/sentences").sentences

suspend fun Api.generateSentenceSet(noteId: String, body: GenerateSentencesBody): List<SentenceDto> =
    post<GenerateSentencesBody, SentencesAnswer>("/api/notes/${enc(noteId)}/sentences/generate", body).sentences

suspend fun Api.deleteSentenceSet(noteId: String) {
    val res = send("DELETE", "/api/notes/${enc(noteId)}/sentences")
    if (!res.ok) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(res.code, res.body.take(200), res.body)
}

/** `SentenceBriefExplanation`: word glosses + one line on the construction (+ a one-line translation; older ones have none). */
@Serializable
data class SentenceExplanation(val words: List<ExplainedWord> = emptyList(), val construction: String? = null, val translation: String? = null)

@Serializable
data class ExplainedWord(val hanzi: String, val pinyin: String = "", val gloss: String = "")

@Serializable
private data class ExplanationAnswer(val explanation: SentenceExplanation)

@Serializable
data class ExplainTextBody(val hanzi: String, val pinyin: String? = null, val translation: String? = null)

suspend fun Api.explainSentence(sentenceId: String): SentenceExplanation =
    post<ExplanationAnswer>("/api/sentences/${enc(sentenceId)}/explain").explanation

suspend fun Api.explainSentenceText(body: ExplainTextBody): SentenceExplanation =
    post<ExplainTextBody, ExplanationAnswer>("/api/sentences/explain-text", body).explanation

// ---------------- Ask Claude ----------------

@Serializable
data class AskContext(val userAnswer: String? = null, val correctAnswer: String? = null, val cardType: String? = null)

@Serializable
data class AskHistoryItem(val question: String, val answer: String)

@Serializable
data class AskBody(val question: String, val context: AskContext? = null, val conversationHistory: List<AskHistoryItem>? = null)

@Serializable
data class AskToolResult(val tool: String, val success: Boolean = false, val data: JsonObject? = null, val error: String? = null)

@Serializable
data class ReadOnlyToolCall(val tool: String, val input: JsonObject? = null)

@Serializable
data class AskAnswer(
    val id: String,
    val question: String = "",
    val answer: String = "",
    val toolResults: List<AskToolResult>? = null,
    val readOnlyToolCalls: List<ReadOnlyToolCall>? = null,
)

suspend fun Api.askAboutNote(noteId: String, body: AskBody): AskAnswer = post("/api/notes/${enc(noteId)}/ask", body)

@Serializable
data class TextToFlashcardBody(val text: String)

@Serializable
data class FlashcardDraft(val hanzi: String, val pinyin: String = "", val english: String = "", val fun_facts: String? = null)

suspend fun Api.textToFlashcard(text: String): FlashcardDraft = post("/api/text-to-flashcard", TextToFlashcardBody(text))

// ---------------- roleplay (a Claude conversation about this word) ----------------

@Serializable
data class NewConversationBody(val title: String, val scenario: String, val user_role: String, val ai_role: String)

@Serializable
data class ConversationIdDto(val id: String)

suspend fun Api.createConversation(relationshipId: String, body: NewConversationBody): ConversationIdDto =
    post("/api/relationships/${enc(relationshipId)}/conversations", body)

suspend fun Api.initiateAIConversation(conversationId: String): JsonElement =
    post("/api/conversations/${enc(conversationId)}/ai-initiate")

// ---------------- voice recordings ----------------

@Serializable
data class TranscriptionDto(val text: String = "", val language: String? = null, val provider: String? = null)

/**
 * POST /api/transcribe — the upload path (Whisper, then Soniox async / Gemini on the server).
 * [liveError] says why the live stream gave nothing; the server logs it.
 */
suspend fun Api.transcribe(file: File, mime: String, liveError: String? = null): TranscriptionDto {
    val fields = buildMap {
        put("client", "lab")
        liveError?.takeIf { it.isNotBlank() }?.let { put("live_error", it.take(200)) }
    }
    val res = upload("/api/transcribe", file, fileName = file.name, mime = mime, fields = fields)
    if (!res.ok) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(res.code, res.body.take(200), res.body)
    return json.decodeFromString(TranscriptionDto.serializer(), res.body)
}

// ---------------- tutor notes on the card back ----------------

/** GET /api/me/recording-notes — a tutor's needs-work comment on a recording, or a reply to my flag. */
@Serializable
data class RecordingNoteDto(
    val event_id: String,
    val kind: String? = null,
    val card_id: String? = null,
    val note_id: String = "",
    val hanzi: String = "",
    val comment: String = "",
    val tutor_name: String? = null,
    val updated_at: String = "",
)

@Serializable
data class RecordingNotesAnswer(val notes: List<RecordingNoteDto> = emptyList())

suspend fun Api.recordingNotes(): List<RecordingNoteDto> = get<RecordingNotesAnswer>("/api/me/recording-notes").notes

fun recordingNoteSeenPath(eventId: String) = "/api/me/recording-notes/${enc(eventId)}/seen"

/** GET /api/me/tutor-notes?include_seen=1 — every note (seen ones too) for the Tutor notes page. */
suspend fun Api.tutorNotes(limit: Int = 200): dev.jeromeswannack.chineselearning.lab.core.TutorNotesPageDto =
    get("/api/me/tutor-notes?include_seen=1&limit=$limit")

// ---------------- flag for tutor ----------------

@Serializable
data class CardFlagBody(
    val id: String,
    val relationship_id: String,
    val note_id: String,
    val card_id: String? = null,
    val message: String,
    val created_at: String,
)

const val CARD_FLAGS_PATH = "/api/card-flags"
