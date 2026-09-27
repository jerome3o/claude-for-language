package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/* Package D (Settings, sentence coverage, feature requests) — the endpoints pages/SettingsPage.tsx uses. */

@Serializable data class BioDto(val bio: String? = null)
@Serializable data class StudyBudgetDto(val new_cards_per_day: Int, val secondary_cards_per_day: Int)
@Serializable data class LandingPageDto(val landing_page: String? = null)

suspend fun Api.bio(): String? = get<BioDto>("/api/profile/bio").bio
// Bodies with a null are built by hand: the API's Json drops nulls (explicitNulls = false),
// and `{}` is not "automatic" to the server (landing_page must be null or a page).
suspend fun Api.saveBio(bio: String?): String? =
    put<JsonObject, BioDto>("/api/profile/bio", buildJsonObject { put("bio", bio?.let(::JsonPrimitive) ?: JsonNull) }).bio

/** PUT /api/profile/study-budget — 0–200 each; a 400 carries `problems`. */
suspend fun Api.saveStudyBudget(b: StudyBudgetDto): StudyBudgetDto = put("/api/profile/study-budget", b)

/** PUT /api/profile/landing-page — study | students | decks, null = automatic. */
suspend fun Api.saveLandingPage(page: String?): String? =
    put<JsonObject, LandingPageDto>("/api/profile/landing-page", buildJsonObject { put("landing_page", page?.let(::JsonPrimitive) ?: JsonNull) }).landing_page

/** GET /api/export — the whole account as JSON (the web's "Download Backup"). */
suspend fun Api.exportBackup(): String {
    val res = send("GET", "/api/export")
    if (!res.ok) throw HttpException(res.code, "Export failed (${res.code})", res.body)
    return res.body
}

// ---- feature requests ----

@Serializable
data class FeatureRequestDto(
    val id: String,
    val content: String,
    val page_context: String? = null,
    val screenshot_url: String? = null,
    val status: String = "new",
    val comment_count: Int = 0,
    val created_at: String,
)

@Serializable data class FeatureRequestsDto(val requests: List<FeatureRequestDto> = emptyList())

@Serializable
data class FeatureRequestCommentDto(val id: String, val author_name: String = "", val content: String, val created_at: String)

@Serializable data class FeatureRequestDetailDto(val request: FeatureRequestDto, val comments: List<FeatureRequestCommentDto> = emptyList())
@Serializable data class NewCommentBody(val content: String)
@Serializable data class NewFeatureRequestBody(val content: String, val pageContext: String? = null)
@Serializable data class IdDto(val id: String = "")

suspend fun Api.featureRequests(): List<FeatureRequestDto> = get<FeatureRequestsDto>("/api/feature-requests").requests
suspend fun Api.featureRequest(id: String): FeatureRequestDetailDto = get("/api/feature-requests/${enc(id)}")
suspend fun Api.commentOnFeatureRequest(id: String, content: String): IdDto = post("/api/feature-requests/${enc(id)}/comments", NewCommentBody(content))
suspend fun Api.createFeatureRequest(content: String, pageContext: String?): IdDto = post("/api/feature-requests", NewFeatureRequestBody(content, pageContext))

// ---- audio quality ----

@Serializable data class AudioQualityCounts(val minimax: Int = 0, val gtts: Int = 0, val unknown: Int = 0)
@Serializable data class AudioQualityDto(val notes: AudioQualityCounts = AudioQualityCounts(), val clues: AudioQualityCounts = AudioQualityCounts(), val sentences: AudioQualityCounts = AudioQualityCounts())
@Serializable data class LimitBody(val limit: Int)
@Serializable data class ClassifyDto(val classified: Int = 0, val found_fallback: Int = 0, val remaining: Boolean = false)
@Serializable data class QueuedDto(val queued: Int = 0, val remaining: Int = 0)

suspend fun Api.audioQuality(): AudioQualityDto = get("/api/audio-quality")
suspend fun Api.classifyAudio(limit: Int): ClassifyDto = post("/api/audio-quality/classify", LimitBody(limit))
suspend fun Api.regenerateFallbackAudio(limit: Int): QueuedDto = post("/api/audio-quality/regenerate", LimitBody(limit))

// ---- sentence coverage ----

@Serializable
data class CoverageNotes(val total: Int = 0, val with_clue: Int = 0, val with_clue_audio: Int = 0, val with_note_audio: Int = 0, val with_set: Int = 0, val with_full_set: Int = 0)
@Serializable data class CoverageSentences(val total: Int = 0, val with_audio: Int = 0, val with_explanation: Int = 0)
@Serializable data class CoverageCards(val total: Int = 0, val new: Int = 0, val learning: Int = 0, val review: Int = 0, val relearning: Int = 0)
@Serializable data class CoverageJobs(val queued: Int = 0, val done: Int = 0, val error: Int = 0, val stale_queued: Int = 0, val exhausted: Int = 0)
@Serializable data class CoverageError(val note_id: String, val hanzi: String, val attempts: Int = 0, val error: String? = null, val updated_at: String = "")
@Serializable data class CoverageDeck(val id: String, val name: String, val notes: Int = 0, val with_clue: Int = 0, val with_set: Int = 0)

@Serializable
data class SentenceCoverageDto(
    val notes: CoverageNotes = CoverageNotes(),
    val sentences: CoverageSentences = CoverageSentences(),
    val cards: CoverageCards = CoverageCards(),
    val jobs: CoverageJobs = CoverageJobs(),
    val recent_errors: List<CoverageError> = emptyList(),
    val decks: List<CoverageDeck> = emptyList(),
)

@Serializable data class PrefetchBody(val note_ids: List<String>, val limit: Int)

suspend fun Api.sentenceCoverage(): SentenceCoverageDto = get("/api/sentences/stats")
suspend fun Api.prefetchSentenceSets(limit: Int): QueuedDto = post("/api/sentences/prefetch", PrefetchBody(emptyList(), limit))
suspend fun Api.backfillClueAudio(limit: Int): QueuedDto = post("/api/sentences/clue-audio", LimitBody(limit))
