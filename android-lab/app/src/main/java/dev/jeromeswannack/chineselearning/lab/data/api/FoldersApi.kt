package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Folders for decks, Library lessons and readers (worker/src/routes/folders.ts; web:
// frontend/src/api/folders.ts). Organisation only: nothing here touches the study queue.

@Serializable
data class FolderDto(
    val id: String,
    val user_id: String = "",
    /** deck | lesson | reader */
    val kind: String,
    val name: String,
    val parent_id: String? = null,
    val position: Int = 0,
    val created_at: String = "",
    val updated_at: String = "",
    /** Only on `GET /api/folders` (not used: the phone counts its own items). */
    val item_count: Int? = null,
) {
    fun toFolder() = Folder(id, user_id, kind, name, parent_id, position, created_at, updated_at)

    companion object {
        fun of(f: Folder) = FolderDto(f.id, f.userId, f.kind, f.name, f.parentId, f.position, f.createdAt, f.updatedAt)
    }
}

@Serializable data class FoldersListDto(val folders: List<FolderDto> = emptyList())

@Serializable data class FolderAnswerDto(val folder: FolderDto)

/** `POST /api/folders` — the client id makes it idempotent (200 when it exists), so it can wait in the Outbox. */
@Serializable data class NewFolderBody(val kind: String, val name: String, val parent_id: String?, val id: String)

/** `PATCH /api/folders/:id` — only the fields present change. */
@Serializable data class FolderPatchBody(val name: String? = null, val parent_id: String? = null)

@Serializable data class FolderReorderBody(val kind: String, val folder_ids: List<String>)

/** `POST /api/folders/move` — `folder_id: null` = Unfiled (sent explicitly). */
@Serializable data class FolderMoveBody(val kind: String, val ids: List<String>, val folder_id: String?)

object FolderPaths {
    const val LIST = "/api/folders"
    const val REORDER = "/api/folders/reorder"
    const val MOVE = "/api/folders/move"
    fun folder(id: String) = "/api/folders/${enc(id)}"

    /** The id in `/api/folders/<id>` (Outbox items carry it in the path). */
    fun idOf(path: String): String? = path.removePrefix("$LIST/").takeIf { it != path && '/' !in it }?.let { java.net.URLDecoder.decode(it, "UTF-8") }
}

/**
 * Bodies with explicit nulls: `folder_id: null` must reach the server as null (Unfiled), and
 * the API client's own Json drops nulls. PATCH bodies are built by hand (absent ≠ null).
 */
val folderJson = Json { ignoreUnknownKeys = true; explicitNulls = true; encodeDefaults = true }

/** Every folder of the account (all kinds) — the full-sync / fallback source; `/api/sync/changes` carries them too. */
suspend fun Api.folders(): List<FolderDto> = get<FoldersListDto>(FolderPaths.LIST).folders
