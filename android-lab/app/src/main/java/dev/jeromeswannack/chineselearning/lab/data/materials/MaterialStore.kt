package dev.jeromeswannack.chineselearning.lab.data.materials

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialsListDto
import dev.jeromeswannack.chineselearning.lab.data.api.downloadAuthed
import dev.jeromeswannack.chineselearning.lab.data.api.getMaterial
import dev.jeromeswannack.chineselearning.lab.data.api.listMaterials
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** A material and its pages; [offline] = the copy on this phone (the server couldn't be reached). */
data class LoadedMaterial(val detail: MaterialDetailDto, val offline: Boolean)

/**
 * Lesson materials on the phone (web services/materials/cache.ts): the list and each material's page
 * list in the [JsonCache] (`materials/list`, `materials/detail/<id>`), page pictures as files under
 * `material-pages/<id>/<n>.jpg` — filled whenever a page is shown, presented or uploaded here and read
 * first, so a material presented recently opens on the train.
 */
class MaterialStore(private val api: Api, private val cache: JsonCache, filesDir: File) {
    private val pagesDir = File(filesDir, "material-pages")

    suspend fun cachedList(): MaterialsListDto? = cache.get(LIST)

    /** `GET /api/materials`, kept for offline. */
    suspend fun refreshList(): MaterialsListDto = api.listMaterials().also { cache.put(LIST, KIND, it) }

    /** Online the server's, offline (or on failure) the last copy seen — else the error. */
    suspend fun load(id: String): LoadedMaterial = try {
        val d = api.getMaterial(id)
        cache.put(detailKey(id), KIND, d)
        LoadedMaterial(d, offline = false)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        cache.get<MaterialDetailDto>(detailKey(id))?.let { LoadedMaterial(it, offline = true) } ?: throw e
    }

    suspend fun cachedDetail(id: String): MaterialDetailDto? = cache.get(detailKey(id))

    private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9_-]"), "_")

    fun pageFile(id: String, page: Int): File = File(File(pagesDir, safe(id)), "$page.jpg")

    fun cachedPage(id: String, page: Int): File? = pageFile(id, page).takeIf { it.exists() && it.length() > 0 }

    /** A page picture: from the phone if it has it, else the network (then kept). Null when neither works. */
    suspend fun page(id: String, page: Int, online: Boolean = true): File? {
        cachedPage(id, page)?.let { return it }
        if (!online) return null
        return try {
            val dest = pageFile(id, page)
            api.downloadAuthed("/api/materials/$id/pages/$page/image", dest)
            dest
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    /** Keep every page of a material (when presenting it, or "Keep on this device"). Returns how many are on the phone. */
    suspend fun prefetch(d: MaterialDetailDto, online: Boolean = true): Int {
        var n = 0
        for (p in d.pages) if (p.image_url != null && page(d.material.id, p.page_index, online) != null) n++
        return n
    }

    /** Every page with a picture is on the phone. */
    fun isKept(d: MaterialDetailDto): Boolean = d.pages.filter { it.image_url != null }.all { cachedPage(d.material.id, it.page_index) != null }

    /** My own upload is on the phone from the start (offline viewing). */
    suspend fun keepUploaded(id: String, page: Int, file: File) = withContext(Dispatchers.IO) {
        val dest = pageFile(id, page)
        dest.parentFile?.mkdirs()
        file.copyTo(dest, overwrite = true)
    }

    suspend fun forget(id: String) {
        cache.delete(detailKey(id))
        withContext(Dispatchers.IO) { File(pagesDir, safe(id)).deleteRecursively() }
    }

    /** The original file (for "Original file"), downloaded into [dest]. */
    suspend fun original(id: String, dest: File) = api.downloadAuthed("/api/materials/$id/original", dest)

    companion object {
        const val KIND = "materials"
        const val LIST = "materials/list"
        fun detailKey(id: String) = "materials/detail/$id"
    }
}
