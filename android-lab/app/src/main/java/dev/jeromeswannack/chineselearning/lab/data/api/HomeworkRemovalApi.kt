package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/*
 * Take homework back (worker routes/homework-removal.ts) — the relationship's tutor only, online
 * only (not idempotent outbox writes): previews for the confirm sheet and the removals. Also the
 * readers the tutor sent (routes/shared-readers.ts) for the student page's Readers list.
 */

private fun relPath(relId: String) = "/api/relationships/${enc(relId)}"

/** GET …/shared-decks/:id/removal. [deck_name] null = the student already deleted their copy. */
@Serializable
data class DeckRemovalPreviewDto(
    val shared_deck_id: String = "",
    val target_deck_id: String = "",
    val deck_name: String? = null,
    val source_deck_id: String = "",
    val source_deck_name: String? = null,
    val words_total: Int = 0,
    val words_met: Int = 0,
    val reviews: Int = 0,
    val can_delete_source: Boolean = false,
)

/** GET …/student-lessons/:lessonId/removal. */
@Serializable
data class LessonRemovalPreviewDto(
    val lesson_id: String = "",
    val title: String = "",
    val completions: Int = 0,
    val library_item_id: String? = null,
)

/** GET …/shared-readers/:id/removal. [title] null = the student's copy is gone. */
@Serializable
data class ReaderRemovalPreviewDto(
    val shared_reader_id: String = "",
    val target_reader_id: String = "",
    val title: String? = null,
    val page_count: Int = 0,
    val readings: Int = 0,
)

/** What every DELETE answers. */
@Serializable
data class HomeworkRemovalResultDto(
    val removed: Boolean = true,
    val words_met: Int = 0,
    val reviews: Int = 0,
    val assignments_cancelled: Int = 0,
    val source_deleted: Boolean = false,
)

/** GET /api/relationships/:relId/shared-readers row. */
@Serializable
data class SharedReaderDto(
    val id: String,
    val target_reader_id: String = "",
    val shared_at: String = "",
    val source_title_chinese: String? = null,
    val source_title_english: String? = null,
    val target_title_chinese: String? = null,
    val target_title_english: String? = null,
    val target_deleted: Boolean = false,
    val page_count: Int = 0,
    val read_count: Int = 0,
    val last_read_at: String? = null,
) {
    /** The web's `source_title_chinese || target_title_chinese || source_title_english || 'Reader'`. */
    val title: String
        get() = source_title_chinese?.takeIf { it.isNotEmpty() }
            ?: target_title_chinese?.takeIf { it.isNotEmpty() }
            ?: source_title_english?.takeIf { it.isNotEmpty() }
            ?: "Reader"
}

suspend fun Api.sharedReaders(relId: String): List<SharedReaderDto> = get("${relPath(relId)}/shared-readers")

suspend fun Api.previewDeckRemoval(relId: String, id: String): DeckRemovalPreviewDto = get("${relPath(relId)}/shared-decks/${enc(id)}/removal")

suspend fun Api.removeStudentDeck(relId: String, id: String, deleteSource: Boolean): HomeworkRemovalResultDto =
    delete("${relPath(relId)}/shared-decks/${enc(id)}${if (deleteSource) "?delete_source=1" else ""}")

suspend fun Api.previewLessonRemoval(relId: String, lessonId: String): LessonRemovalPreviewDto = get("${relPath(relId)}/student-lessons/${enc(lessonId)}/removal")

suspend fun Api.removeStudentLesson(relId: String, lessonId: String): HomeworkRemovalResultDto = delete("${relPath(relId)}/student-lessons/${enc(lessonId)}")

suspend fun Api.previewReaderRemoval(relId: String, id: String): ReaderRemovalPreviewDto = get("${relPath(relId)}/shared-readers/${enc(id)}/removal")

suspend fun Api.removeStudentReader(relId: String, id: String): HomeworkRemovalResultDto = delete("${relPath(relId)}/shared-readers/${enc(id)}")
