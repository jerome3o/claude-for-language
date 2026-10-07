package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/* Sentence Coach conversations (package H) — web: api/client.ts "Sentence Coach Conversations", types.ts. */

@Serializable
data class CoachConversationDto(
    val id: String,
    val title: String = "",
    val input_language: String = "zh",
    /** Which button started it: check | explain | translate (null on older conversations). */
    val action: String? = null,
    val created_at: String = "",
    val updated_at: String = "",
    val message_count: Int = 0,
    /** A reply is still being written in the background (docs/CHAT.md "Chat ↔ Coach"). */
    val pending_reply: Boolean = false,
    /** The last reply failed — open it to retry. */
    val failed_reply: Boolean = false,
)

@Serializable
data class CoachMessageDto(
    val id: String,
    val conversation_id: String = "",
    val role: String,
    val content_type: String = "text",
    val content: String = "",
    /** JSON array of CoachToolResult, as stored. */
    val tool_results: String? = null,
    val created_at: String = "",
    /** null = written; 'pending' = being written in the background; 'failed' = [error], Retry. */
    val status: String? = null,
    val error: String? = null,
) {
    val isPending: Boolean get() = status == "pending"
    val isFailed: Boolean get() = status == "failed"
}

@Serializable data class CoachThreadDto(val conversation: CoachConversationDto, val messages: List<CoachMessageDto> = emptyList(), val reused: Boolean = false) {
    /** Any reply still being written in the background (poll until none). */
    val hasPending: Boolean get() = messages.any { it.isPending }
}
@Serializable data class CoachReplyDto(val messages: List<CoachMessageDto> = emptyList(), val toolResults: List<CoachToolResultDto> = emptyList())
@Serializable data class CoachToolResultDto(val tool: String, val success: Boolean = false, val data: JsonObject? = null, val error: String? = null)
/** `action`: check | explain | translate; `explanation`: Explain's breakdown already cached on the device (stored as is). */
@Serializable
data class CoachStartBody(
    val text: String,
    val action: String? = null,
    val explanation: SentenceExplanation? = null,
    /** The reply is written by the server's queue: a pending message comes back at once (202) and we poll. */
    val background: Boolean? = null,
    /** "Open in Coach" from a chat message: its auto-check seeds the analysis; the same message reuses its conversation. */
    val chat_message_id: String? = null,
)
@Serializable data class CoachMessageBody(val message: String, val background: Boolean? = null)

// ---- the structured first reply (content_type = "analysis") ----

@Serializable data class CoachLine(val hanzi: String = "", val pinyin: String = "", val english: String = "", val note: String? = null)
@Serializable data class CoachWord(val hanzi: String = "", val pinyin: String = "", val english: String = "", val role: String? = null, val notes: String? = null)
@Serializable data class CoachGrammar(val pattern: String = "", val explanation: String = "", val example: String? = null)

@Serializable
data class CoachResultDto(
    val isCorrect: Boolean = false,
    val corrected: CoachLine = CoachLine(),
    val critique: String = "",
    val alternatives: List<CoachLine> = emptyList(),
)

@Serializable
data class CoachExplanationDto(
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val overview: String = "",
    val words: List<CoachWord> = emptyList(),
    val grammar_points: List<CoachGrammar> = emptyList(),
    val nuance: String? = null,
    val similar_examples: List<CoachLine> = emptyList(),
)

@Serializable
data class CoachTranslationDto(
    val primary: CoachLine = CoachLine(),
    val alternatives: List<CoachLine> = emptyList(),
    val usage_note: String? = null,
)

/** Explain's result (`CoachBreakdown`): the learner's sentence + the brief "What's going on here?" breakdown. */
@Serializable
data class CoachBreakdownDto(
    val hanzi: String = "",
    val pinyin: String = "",
    val translation: String? = null,
    val words: List<ExplainedWord> = emptyList(),
    val construction: String? = null,
) {
    fun asExplanation() = SentenceExplanation(words, construction, translation)

    companion object {
        /** A breakdown cached by the sentence's text → the Explain result (pinyin joined from the word rows, like the worker). */
        fun of(hanzi: String, e: SentenceExplanation) =
            CoachBreakdownDto(hanzi, e.words.map { it.pinyin }.filter { it.isNotEmpty() }.joinToString(" "), e.translation, e.words, e.construction)
    }
}

/** Port of `CoachAnalysis`: `kind` chinese → coach (+ legacy explanation), explain → breakdown, english → translation. */
@Serializable
data class CoachAnalysisDto(
    val kind: String,
    val coach: CoachResultDto? = null,
    val explanation: CoachExplanationDto? = null,
    val translation: CoachTranslationDto? = null,
    val breakdown: CoachBreakdownDto? = null,
) {
    /** The Chinese sentence the analysis settled on (the web's `analysisSentence`). */
    val sentence: String? get() = when (kind) {
        "chinese" -> coach?.corrected?.hanzi
        "explain" -> breakdown?.hanzi
        else -> translation?.primary?.hanzi
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

        /** The web's `parseAnalysis`: null unless it is a chinese / explain / english analysis. */
        fun parse(content: String): CoachAnalysisDto? = runCatching { json.decodeFromString(serializer(), content) }.getOrNull()
            ?.takeIf { (it.kind == "chinese" && it.coach != null) || (it.kind == "explain" && it.breakdown != null) || (it.kind == "english" && it.translation != null) }

        /** The web's `parseToolResults`. */
        fun toolResults(raw: String?): List<CoachToolResultDto> =
            if (raw.isNullOrBlank()) emptyList() else runCatching { json.decodeFromString<List<CoachToolResultDto>>(raw) }.getOrDefault(emptyList())
    }
}

suspend fun Api.coachConversations(): List<CoachConversationDto> = get("/api/coach/conversations")
suspend fun Api.coachConversation(id: String): CoachThreadDto = get("/api/coach/conversations/${enc(id)}")
/**
 * Start a conversation. Always `background: true` (docs/CHAT.md "Chat ↔ Coach"): 202 with the user
 * message and a PENDING analysis (polled), 201 when ready at once (a cached Explain / a chat
 * message's auto-check), 200 `reused` for a chat message already opened.
 */
suspend fun Api.startCoachConversation(text: String, action: String? = null, explanation: SentenceExplanation? = null, chatMessageId: String? = null): CoachThreadDto =
    post("/api/coach/conversations", CoachStartBody(text, action, explanation, background = true, chat_message_id = chatMessageId))
/** A follow-up: 202 with my message and the pending reply (written in the background); 409 while one is pending. */
suspend fun Api.sendCoachMessage(id: String, message: String): CoachReplyDto =
    post("/api/coach/conversations/${enc(id)}/messages", CoachMessageBody(message, background = true))
/** Retry a reply that failed: back on the server's queue → 202 the whole thread. */
suspend fun Api.retryCoachReply(id: String, messageId: String): CoachThreadDto =
    post("/api/coach/conversations/${enc(id)}/messages/${enc(messageId)}/retry")
suspend fun Api.deleteCoachConversation(id: String) {
    val r = send("DELETE", "/api/coach/conversations/${enc(id)}")
    if (!r.ok && r.code != 404) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(r.code, r.body.take(200), r.body)
}

// ---- Sentence Breakdown (`/analyze`, web: SentenceAnalysisPage + components/SentenceBreakdown) ----

@Serializable
data class SentenceChunkDto(
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    /** Indices into the full English sentence (0-based, end exclusive). */
    val englishStart: Int = 0,
    val englishEnd: Int = 0,
    val note: String? = null,
)

@Serializable
data class SentenceBreakdownDto(
    val originalInput: String = "",
    val inputLanguage: String = "chinese",
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val chunks: List<SentenceChunkDto> = emptyList(),
    val grammarNotes: String? = null,
)

@Serializable data class AnalyzeBody(val sentence: String)

suspend fun Api.analyzeSentence(sentence: String): SentenceBreakdownDto = post("/api/sentence/analyze", AnalyzeBody(sentence))
