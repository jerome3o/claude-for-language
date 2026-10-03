package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Package B — graded readers: the endpoints the web's services/readerSync.ts,
 * services/reader-study.ts, ReadersListPage, ReaderPage and GenerateReaderPage call.
 */

@Serializable
data class VocabItemDto(val hanzi: String = "", val pinyin: String = "", val english: String = "")

@Serializable
data class ReaderPageDto(
    val id: String,
    @SerialName("page_number") val pageNumber: Int = 0,
    @SerialName("content_chinese") val contentChinese: String = "",
    @SerialName("content_pinyin") val contentPinyin: String = "",
    @SerialName("content_english") val contentEnglish: String = "",
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_prompt") val imagePrompt: String? = null,
    /** Word chips (shared/reader/words.ts); null when not made yet. Stale ones are refused by `ReaderWords.matches`. */
    val words: List<ReaderWordDto>? = null,
) {
    /** The page's word chips when they still match its text (else null — plain text). */
    fun currentWords(): List<ReaderWordDto>? =
        words?.takeIf { w -> dev.jeromeswannack.chineselearning.lab.core.ReaderWords.matches(w.map { it.text }, contentChinese) }
}

/** One segment of a page: a word (pinyin + gloss) or punctuation / whitespace (both empty). */
@Serializable
data class ReaderWordDto(val text: String = "", val pinyin: String = "", val gloss: String = "")

@Serializable
data class ReaderWordsBackfillBody(@SerialName("reader_id") val readerId: String? = null, val limit: Int? = null)

@Serializable
data class PageWordsDto(val id: String, @SerialName("reader_id") val readerId: String, val words: List<ReaderWordDto> = emptyList())

@Serializable
data class ReaderWordsBackfillDto(val pages: List<PageWordsDto> = emptyList(), val remaining: Int = 0)

@Serializable
data class ReaderWordExplainBody(val word: String, val sentence: String, val pinyin: String? = null, val gloss: String? = null)

/** `ReaderWordExplanation`: the word in its sentence + the card fields for "+ Add as card". */
@Serializable
data class ReaderWordExplanationDto(
    val word: String = "",
    val pinyin: String = "",
    val english: String = "",
    val explanation: String = "",
    @SerialName("fun_facts") val funFacts: String = "",
    @SerialName("sentence_clue") val sentenceClue: String? = null,
    @SerialName("sentence_clue_pinyin") val sentenceCluePinyin: String? = null,
    @SerialName("sentence_clue_translation") val sentenceClueTranslation: String? = null,
)

/** `POST /api/reader-words/backfill`: word chips for up to 12 of my pages without them (the given reader's first). */
suspend fun Api.backfillReaderWords(readerId: String? = null): ReaderWordsBackfillDto =
    post("/api/reader-words/backfill", ReaderWordsBackfillBody(readerId))

/** `POST /api/reader-words/explain`: Haiku's explanation of a word in its sentence (cached server-side). */
suspend fun Api.explainReaderWord(body: ReaderWordExplainBody): ReaderWordExplanationDto = post("/api/reader-words/explain", body)

@Serializable
data class GradedReaderDto(
    val id: String,
    @SerialName("title_chinese") val titleChinese: String = "",
    @SerialName("title_english") val titleEnglish: String = "",
    @SerialName("difficulty_level") val difficulty: String = "beginner",
    val topic: String? = null,
    @SerialName("vocabulary_used") val vocabularyUsed: List<VocabItemDto> = emptyList(),
    /** generating | ready | failed */
    val status: String = "ready",
    @SerialName("error_message") val errorMessage: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    val pages: List<ReaderPageDto> = emptyList(),
    /** The reader's folder (migration 0099; core Folders.kt), null = Unfiled. */
    @SerialName("folder_id") val folderId: String? = null,
) {
    /** `isStudyableReader`. */
    val studyable: Boolean get() = status == "ready" && pages.isNotEmpty()
}

@Serializable
data class ReaderReviewDto(
    val id: String,
    @SerialName("reader_id") val readerId: String,
    val rating: Int,
    @SerialName("time_spent_ms") val timeSpentMs: Long? = null,
    @SerialName("reviewed_at") val reviewedAt: String,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class ReaderReviewsPageDto(val events: List<ReaderReviewDto> = emptyList(), @SerialName("has_more") val hasMore: Boolean = false)

@Serializable
data class ReaderReviewsUpload(val events: List<ReaderReviewDto>)

@Serializable
data class GenerateReaderBody(
    val source: String? = null,
    @SerialName("deck_ids") val deckIds: List<String>? = null,
    @SerialName("note_ids") val noteIds: List<String>? = null,
    val topic: String? = null,
    val difficulty: String,
)

@Serializable
data class DailyReaderBody(@SerialName("note_ids") val noteIds: List<String>, @SerialName("local_date") val localDate: String)

@Serializable
data class DailyReaderDto(@SerialName("reader_id") val readerId: String? = null, val status: String = "")

@Serializable
data class DailyMarkBody(val activity: String, @SerialName("ref_id") val refId: String?)

suspend fun Api.readersWithPages(): List<GradedReaderDto> = get("/api/readers?include_pages=true")

suspend fun Api.reader(id: String): GradedReaderDto = get("/api/readers/${enc(id)}")

suspend fun Api.readerReviews(since: String, afterId: String?, limit: Int = 1000): ReaderReviewsPageDto =
    get("/api/reader-reviews?since=${enc(since)}&limit=$limit" + (afterId?.takeIf { it.isNotEmpty() }?.let { "&after_id=${enc(it)}" } ?: ""))

suspend fun Api.generateReader(body: GenerateReaderBody): GradedReaderDto = post("/api/readers/generate", body)

suspend fun Api.retryReader(id: String): GradedReaderDto = post("/api/readers/${enc(id)}/retry")

suspend fun Api.generatePageImage(readerId: String, pageId: String): PageImageDto =
    post("/api/readers/${enc(readerId)}/pages/${enc(pageId)}/generate-image")

suspend fun Api.dailyReader(noteIds: List<String>, localDate: String): DailyReaderDto = post("/api/daily/reader/generate", DailyReaderBody(noteIds, localDate))

suspend fun Api.markDailyReader(readerId: String): Unit = post("/api/daily/mark", DailyMarkBody("reader", readerId))

