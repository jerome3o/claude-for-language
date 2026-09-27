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
    val created_at: String = "",
    val updated_at: String = "",
    val message_count: Int = 0,
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
)

@Serializable data class CoachThreadDto(val conversation: CoachConversationDto, val messages: List<CoachMessageDto> = emptyList())
@Serializable data class CoachReplyDto(val messages: List<CoachMessageDto> = emptyList(), val toolResults: List<CoachToolResultDto> = emptyList())
@Serializable data class CoachToolResultDto(val tool: String, val success: Boolean = false, val data: JsonObject? = null, val error: String? = null)
@Serializable data class CoachStartBody(val text: String)
@Serializable data class CoachMessageBody(val message: String)

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

/** Port of `CoachAnalysis`: `kind` chinese → coach (+ legacy explanation), english → translation. */
@Serializable
data class CoachAnalysisDto(
    val kind: String,
    val coach: CoachResultDto? = null,
    val explanation: CoachExplanationDto? = null,
    val translation: CoachTranslationDto? = null,
) {
    /** The Chinese sentence the analysis settled on (the web's `analysisSentence`). */
    val sentence: String? get() = if (kind == "chinese") coach?.corrected?.hanzi else translation?.primary?.hanzi

    companion object {
        private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

        /** The web's `parseAnalysis`: null unless it is a chinese / english analysis. */
        fun parse(content: String): CoachAnalysisDto? = runCatching { json.decodeFromString(serializer(), content) }.getOrNull()
            ?.takeIf { (it.kind == "chinese" && it.coach != null) || (it.kind == "english" && it.translation != null) }

        /** The web's `parseToolResults`. */
        fun toolResults(raw: String?): List<CoachToolResultDto> =
            if (raw.isNullOrBlank()) emptyList() else runCatching { json.decodeFromString<List<CoachToolResultDto>>(raw) }.getOrDefault(emptyList())
    }
}

suspend fun Api.coachConversations(): List<CoachConversationDto> = get("/api/coach/conversations")
suspend fun Api.coachConversation(id: String): CoachThreadDto = get("/api/coach/conversations/${enc(id)}")
suspend fun Api.startCoachConversation(text: String): CoachThreadDto = post("/api/coach/conversations", CoachStartBody(text))
suspend fun Api.sendCoachMessage(id: String, message: String): CoachReplyDto = post("/api/coach/conversations/${enc(id)}/messages", CoachMessageBody(message))
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
