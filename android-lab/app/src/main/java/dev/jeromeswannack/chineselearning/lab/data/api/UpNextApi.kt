package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

// "Up next" — the account's ordered list of chosen notes (worker/src/routes/up-next.ts,
// shared/decks/up-next.ts; data/upnext/UpNextStore.kt). `/api/sync/changes` carries it as `up_next`.

/** One entry of the list (active: not removed, not done), with the note's text and card state. */
@Serializable
data class UpNextDto(
    val id: String,
    val note_id: String,
    val position: Int = 0,
    val created_at: String,
    val source: String? = null,
    val added_by: String? = null,
    /** Set only when someone other than the learner (their tutor) added it. */
    val added_by_name: String? = null,
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_id: String? = null,
    val deck_name: String? = null,
    /** "new" | "started". */
    val status: String = "new",
    val new_cards: Int = 0,
    val total_cards: Int = 0,
)

@Serializable data class UpNextListDto(val up_next: List<UpNextDto> = emptyList())

@Serializable data class UpNextItemBody(val id: String, val note_id: String, val created_at: String)

/** POST /api/me/up-next: [position] = "top" | "bottom" | a 0-based index (JSON number). */
@Serializable
data class UpNextAddBody(
    val items: List<UpNextItemBody>? = null,
    val note_ids: List<String>? = null,
    val position: JsonElement? = null,
    val source: String? = null,
)

@Serializable data class UpNextOrderBody(val note_ids: List<String>)

@Serializable data class UpNextHanzi(val note_id: String, val hanzi: String = "")

@Serializable
data class UpNextAddResultDto(
    val up_next: List<UpNextDto> = emptyList(),
    val added: List<UpNextHanzi> = emptyList(),
    val already: List<UpNextHanzi> = emptyList(),
    val moved: List<UpNextHanzi> = emptyList(),
    val no_new_cards: List<UpNextHanzi> = emptyList(),
    val not_found: List<String> = emptyList(),
)

@Serializable data class UpNextRemoveDto(val removed: Int = 0, val up_next: List<UpNextDto> = emptyList())

/** A student's note from the tutor's search (to pick words for their list). */
@Serializable
data class StudentNoteHitDto(
    val id: String,
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_id: String? = null,
    val deck_name: String? = null,
    val new_cards: Int = 0,
    val total_cards: Int = 0,
    val on_up_next: Boolean = false,
)

@Serializable data class StudentNoteHitsDto(val notes: List<StudentNoteHitDto> = emptyList())

/** The API's position: "top" / "bottom" as strings, an index as a number. */
fun upNextPosition(position: Any?): JsonElement? = when (position) {
    null -> null
    is Int -> JsonPrimitive(position)
    is String -> JsonPrimitive(position)
    else -> null
}

private fun upNextBase(relId: String?) = if (relId == null) "/api/me/up-next" else "/api/relationships/${enc(relId)}/student-up-next"

/** `GET /api/me/up-next` (a full sync; incremental ones get it in /sync/changes) — or the student's (tutor). */
suspend fun Api.upNext(relId: String? = null): List<UpNextDto> = get<UpNextListDto>(upNextBase(relId)).up_next

suspend fun Api.addUpNext(body: UpNextAddBody, relId: String? = null): UpNextAddResultDto = post(upNextBase(relId), body)

suspend fun Api.reorderUpNext(noteIds: List<String>, relId: String? = null): List<UpNextDto> =
    put<UpNextOrderBody, UpNextListDto>("${upNextBase(relId)}/order", UpNextOrderBody(noteIds)).up_next

suspend fun Api.removeUpNext(noteId: String, relId: String? = null): UpNextRemoveDto = delete("${upNextBase(relId)}/${enc(noteId)}")

suspend fun Api.searchStudentNotes(relId: String, q: String): List<StudentNoteHitDto> =
    get<StudentNoteHitsDto>("/api/relationships/${enc(relId)}/student-notes/search?q=${enc(q)}&limit=20").notes
