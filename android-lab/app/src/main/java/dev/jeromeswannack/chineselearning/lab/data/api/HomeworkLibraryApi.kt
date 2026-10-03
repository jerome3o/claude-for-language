package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.LibraryItem
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/*
 * The tutor homework hub (docs/HOMEWORK.md §8–10; web: api/homework.ts): the homework library
 * (one student / all students), link homework, and updating students' copies after an edit.
 * Online-only writes like the rest of the tutor side; the library reads are cached by the
 * screens (JsonCache) so they open offline.
 */

/** GET /api/relationships/:relId/homework-library?today= → `{ items, counts, today }`. */
@Serializable
data class HomeworkLibraryDto(
    val items: List<LibraryItem> = emptyList(),
    val counts: Map<String, Int> = emptyMap(),
    val today: String = "",
)

@Serializable
data class LibraryStudentDto(val relationship_id: String, val student_id: String = "", val student_name: String = "")

/** GET /api/tutor/homework-library?today= → `{ students, items, counts, today }`. */
@Serializable
data class TutorHomeworkLibraryDto(
    val students: List<LibraryStudentDto> = emptyList(),
    val items: List<LibraryItem> = emptyList(),
    val counts: Map<String, Int> = emptyMap(),
    val today: String = "",
)

suspend fun Api.relationshipHomeworkLibrary(relId: String, today: String = localToday()): HomeworkLibraryDto =
    get("/api/relationships/${enc(relId)}/homework-library?today=${enc(today)}")

suspend fun Api.tutorHomeworkLibrary(today: String = localToday()): TutorHomeworkLibraryDto =
    get("/api/tutor/homework-library?today=${enc(today)}")

// ---------------- link homework (§8) ----------------

@Serializable
data class HomeworkLinkDto(
    val id: String,
    val title: String = "",
    val url: String = "",
    val instructions: String? = null,
    val thumbnail_url: String? = null,
    val created_at: String = "",
)

@Serializable
data class HomeworkLinkBody(val title: String, val url: String, val instructions: String? = null)

@Serializable
private data class HomeworkLinkResponse(val link: HomeworkLinkDto)

/** POST /api/homework-links — creates the link in the TUTOR's own account (nothing is sent yet). */
suspend fun Api.createHomeworkLink(body: HomeworkLinkBody): HomeworkLinkDto = post<HomeworkLinkBody, HomeworkLinkResponse>("/api/homework-links", body).link

/** PUT /api/homework-links/:id — any subset; [update_student_copies] = the relationships whose sent copies follow. */
@Serializable
data class HomeworkLinkUpdateBody(
    val title: String? = null,
    val url: String? = null,
    val instructions: String? = null,
    val update_student_copies: List<String>? = null,
)

suspend fun Api.updateHomeworkLink(id: String, body: HomeworkLinkUpdateBody): HomeworkLinkDto =
    put<HomeworkLinkUpdateBody, HomeworkLinkResponse>("/api/homework-links/${enc(id)}", body).link

/** Send a link: `POST …/homework { items: [{ kind: 'link', source_id, mode: 'one_off', due_date? }] }`. */
suspend fun Api.sendLinkHomework(relId: String, linkId: String, dueDate: String?): AssignResponseDto =
    assignHomework(relId, listOf(AssignItemDto(kind = "link", source_id = linkId, mode = "one_off", due_date = dueDate)))

// ---------------- updating students' copies (§10) ----------------

@Serializable
data class StudentCopyDto(
    val relationship_id: String,
    val student_id: String = "",
    val student_name: String = "",
    val target_id: String = "",
    val share_id: String? = null,
    val behind: Int = 0,
)

@Serializable
data class StudentCopiesDto(val copies: List<StudentCopyDto> = emptyList())

/** GET /api/student-copies?kind=deck|lesson|reader|link&source_id= — the caller's own sources only. */
suspend fun Api.studentCopies(kind: String, sourceId: String): List<StudentCopyDto> =
    get<StudentCopiesDto>("/api/student-copies?kind=${enc(kind)}&source_id=${enc(sourceId)}").copies

@Serializable
data class StudentCopiesUpdateBody(val kind: String, val source_id: String, val relationship_ids: List<String>? = null)

@Serializable
data class StudentCopyResultDto(
    val relationship_id: String = "",
    val student_name: String = "",
    val ok: Boolean = false,
    val detail: String? = null,
    val error: String? = null,
)

@Serializable
data class StudentCopiesUpdateDto(val updated: Int = 0, val results: List<StudentCopyResultDto> = emptyList())

/** POST /api/student-copies/update. */
suspend fun Api.updateStudentCopies(kind: String, sourceId: String, relationshipIds: List<String>?): StudentCopiesUpdateDto =
    post("/api/student-copies/update", StudentCopiesUpdateBody(kind, sourceId, relationshipIds))
