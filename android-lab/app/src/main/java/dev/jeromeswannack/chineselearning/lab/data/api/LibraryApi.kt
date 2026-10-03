package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// The tutor's lesson library (worker/src/routes/lesson-editor.ts; web: frontend/src/api/lessonEditor.ts).
// Specs travel as JSON trees (core/…/spec): the editor and exports work on the same value the web holds.

@Serializable
data class LibraryItemSummary(
    val id: String,
    val title: String = "",
    val description: String? = null,
    val icon: String? = null,
    val tags: List<String> = emptyList(),
    val version: Int = 1,
    val created_at: String = "",
    val updated_at: String = "",
    val assignment_count: Int = 0,
    val exercise_count: Int = 0,
    /** The item's folder (migration 0100; core Folders.kt), null = Unfiled. */
    val folder_id: String? = null,
)

@Serializable
data class LibraryItemDto(
    val id: String,
    val title: String = "",
    val description: String? = null,
    val icon: String? = null,
    val tags: List<String> = emptyList(),
    val version: Int = 1,
    val created_at: String = "",
    val updated_at: String = "",
    val archived_at: String? = null,
    val spec: JsonObject,
    val assignment_count: Int = 0,
)

@Serializable
data class LibraryItemsListDto(val items: List<LibraryItemSummary> = emptyList())

@Serializable
data class LastScoreDto(val correct: Int = 0, val total: Int = 0)

@Serializable
data class LibraryAssignmentDto(
    val lesson_id: String,
    val relationship_id: String? = null,
    val assigned_at: String = "",
    val student: UserSummaryDto,
    val completions: Int = 0,
    val last_completed_at: String? = null,
    val last_rating: Int? = null,
    val last_score: LastScoreDto? = null,
    val last_attempt_id: String? = null,
    val up_to_date: Boolean = true,
)

@Serializable
data class LibraryAssignmentsDto(val assignments: List<LibraryAssignmentDto> = emptyList())

@Serializable
data class AssignRowDto(val relationship_id: String = "", val lesson_id: String? = null, val student_id: String? = null, val error: String? = null)

@Serializable
data class AssignResultDto(
    val assigned: List<AssignRowDto> = emptyList(),
    val already_had: List<AssignRowDto> = emptyList(),
    val errors: List<AssignRowDto> = emptyList(),
)

@Serializable
data class PushUpdateResultDto(val updated: Int = 0, val skipped: Int = 0, val image_jobs: Int = 0)

@Serializable private data class SpecBody(val spec: JsonElement, val tags: List<String>? = null)
@Serializable private data class GenerateInner(val prompt: String)
@Serializable private data class GenerateBody(val generate: GenerateInner)
@Serializable private data class LibraryAssignBody(val relationship_ids: List<String>)
@Serializable private data class PushBody(val relationship_ids: List<String>? = null)

suspend fun Api.libraryItems(): List<LibraryItemSummary> = get<LibraryItemsListDto>("/api/lesson-library").items

suspend fun Api.libraryItem(id: String): LibraryItemDto = get("/api/lesson-library/${enc(id)}")

suspend fun Api.createLibraryItem(spec: JsonObject, tags: List<String> = emptyList()): LibraryItemDto =
    post("/api/lesson-library", SpecBody(spec, tags))

/** Claude drafts the lesson server-side from a description (~a minute). */
suspend fun Api.generateLibraryItem(prompt: String): LibraryItemDto = post("/api/lesson-library", GenerateBody(GenerateInner(prompt)))

suspend fun Api.importLibraryItem(spec: JsonElement): LibraryItemDto = post("/api/lesson-library/import", SpecBody(spec, emptyList()))

suspend fun Api.updateLibraryItem(id: String, spec: JsonObject): LibraryItemDto = put("/api/lesson-library/${enc(id)}", SpecBody(spec))

suspend fun Api.archiveLibraryItem(id: String) { delete<JsonElement>("/api/lesson-library/${enc(id)}") }

suspend fun Api.duplicateLibraryItem(id: String): LibraryItemDto = post("/api/lesson-library/${enc(id)}/duplicate")

suspend fun Api.assignLibraryItem(id: String, relationshipIds: List<String>): AssignResultDto =
    post("/api/lesson-library/${enc(id)}/assign", LibraryAssignBody(relationshipIds))

suspend fun Api.libraryAssignments(id: String): List<LibraryAssignmentDto> =
    get<LibraryAssignmentsDto>("/api/lesson-library/${enc(id)}/assignments").assignments

suspend fun Api.pushLibraryUpdate(id: String): PushUpdateResultDto = post("/api/lesson-library/${enc(id)}/push-update", PushBody())

// ---- homework model (docs/HOMEWORK.md): one-off / both assignments of a library lesson ----

@Serializable
data class HomeworkItemBody(val kind: String, val source_id: String, val mode: String, val due_date: String? = null)

@Serializable private data class HomeworkAssignBody(val items: List<HomeworkItemBody>, val today: String)

@Serializable
data class HomeworkErrorDto(val source_id: String = "", val error: String = "")

@Serializable
data class HomeworkAssignResultDto(val assignments: List<JsonElement> = emptyList(), val errors: List<HomeworkErrorDto> = emptyList())

/** POST /api/relationships/:relId/homework — the same call the web's Send homework sheet makes. */
suspend fun Api.assignLessonHomework(relId: String, libraryItemId: String, mode: String, dueDate: String?, today: String): HomeworkAssignResultDto =
    post("/api/relationships/${enc(relId)}/homework", HomeworkAssignBody(listOf(HomeworkItemBody("lesson", libraryItemId, mode, dueDate)), today))
