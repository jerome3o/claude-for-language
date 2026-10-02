package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File
import java.io.IOException

// Lesson materials (calls round 4 PR 5) — worker/src/routes/materials.ts, web: frontend/src/api/materials.ts.

@Serializable
data class MaterialDto(
    val id: String,
    val owner_id: String = "",
    val title: String = "",
    /** pdf | image | pptx */
    val kind: String = "pdf",
    val file_name: String? = null,
    val mime_type: String? = null,
    val original_size: Long? = null,
    /** uploading | ready | failed */
    val status: String = "ready",
    val page_count: Int = 0,
    val render_note: String? = null,
    val has_text: Boolean = false,
    val created_at: Long = 0,
    val updated_at: Long = 0,
    val mine: Boolean = false,
    val owner_name: String? = null,
    /** Relationship ids it is shared in (mine only). */
    val shared_with: List<String>? = null,
)

@Serializable
data class MaterialPageDto(
    val page_index: Int,
    val width: Int? = null,
    val height: Int? = null,
    val text: String = "",
    val notes: String = "",
    val image_url: String? = null,
)

@Serializable
data class MaterialDetailDto(val material: MaterialDto, val pages: List<MaterialPageDto> = emptyList())

@Serializable
data class MaterialsListDto(val materials: List<MaterialDto> = emptyList())

@Serializable
data class MaterialOneDto(val material: MaterialDto)

@Serializable
data class NewMaterialBody(val title: String? = null, val file_name: String, val mime_type: String, val size: Long)

@Serializable
data class MaterialPageTextBody(val index: Int, val text: String, val notes: String)

@Serializable
data class CompleteMaterialBody(val pages: List<MaterialPageTextBody>, val render_note: String? = null)

@Serializable
data class MaterialTitleBody(val title: String)

@Serializable
data class MaterialShareBody(val relationship_id: String)

@Serializable
data class OkDto(val ok: Boolean = true)

/** `GET /api/materials` — mine + shared with me. */
suspend fun Api.listMaterials(): MaterialsListDto = get("/api/materials")

suspend fun Api.getMaterial(id: String): MaterialDetailDto = get("/api/materials/${enc(id)}")

suspend fun Api.createMaterial(body: NewMaterialBody): MaterialOneDto = post("/api/materials", body)

private suspend fun Api.putFile(path: String, file: File, mime: String) {
    val res = sendFile("PUT", path, file, mime)
    if (!res.ok) throw HttpException(res.code, res.body.take(200), res.body)
}

/** The original file, kept for download (≤ 50 MB). */
suspend fun Api.uploadMaterialOriginal(id: String, file: File, mime: String) = putFile("/api/materials/${enc(id)}/original", file, mime.ifBlank { "application/octet-stream" })

/** Page [n] (0-based) as rendered on this phone. */
suspend fun Api.uploadMaterialPage(id: String, n: Int, image: File) = putFile("/api/materials/${enc(id)}/pages/$n", image, "image/jpeg")

suspend fun Api.completeMaterial(id: String, body: CompleteMaterialBody): MaterialOneDto = post("/api/materials/${enc(id)}/complete", body)

suspend fun Api.renameMaterial(id: String, title: String): MaterialOneDto = patch("/api/materials/${enc(id)}", MaterialTitleBody(title))

suspend fun Api.deleteMaterial(id: String): OkDto = delete("/api/materials/${enc(id)}")

suspend fun Api.shareMaterial(id: String, relationshipId: String): OkDto = post("/api/materials/${enc(id)}/share", MaterialShareBody(relationshipId))

suspend fun Api.unshareMaterial(id: String, relationshipId: String): OkDto = delete("/api/materials/${enc(id)}/share/${enc(relationshipId)}")

/** An authenticated GET of [path] (a page picture, the original file) into [dest]. */
suspend fun Api.downloadAuthed(path: String, dest: File) = withContext(Dispatchers.IO) {
    dest.parentFile?.mkdirs()
    http.newCall(request(path).get().build()).execute().use { res ->
        if (res.code == 401) throw UnauthorizedException()
        if (!res.isSuccessful) throw HttpException(res.code, path)
        val tmp = File(dest.parentFile, dest.name + "." + java.util.UUID.randomUUID().toString().take(8) + ".part")
        try {
            res.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
            if (!tmp.renameTo(dest)) throw IOException("rename failed")
        } finally {
            tmp.delete()
        }
    }
}
