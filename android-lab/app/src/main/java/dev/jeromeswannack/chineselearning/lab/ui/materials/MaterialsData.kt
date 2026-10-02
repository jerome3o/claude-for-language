package dev.jeromeswannack.chineselearning.lab.ui.materials

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDto
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.materials.MaterialStore
import dev.jeromeswannack.chineselearning.lab.data.materials.MaterialUploader
import dev.jeromeswannack.chineselearning.lab.data.materials.UploadStage
import dev.jeromeswannack.chineselearning.lab.ui.calls.MaterialPageSource
import dev.jeromeswannack.chineselearning.lab.ui.calls.PresentSheetUi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** The phone's material store (one per app process: the JsonCache and the page files are shared). */
fun LabApp.materialStore(): MaterialStore = MaterialStore(repo.api, cache, filesDir)

/** A page picture file → an ImageBitmap (off the main thread). */
suspend fun decodePage(file: File?): ImageBitmap? = file?.let {
    withContext(Dispatchers.IO) { runCatching { BitmapFactory.decodeFile(it.path)?.asImageBitmap() }.getOrNull() }
}

/** Each page's speaker notes, by page index. */
fun notesOf(d: MaterialDetailDto): List<String> {
    val n = (d.pages.maxOfOrNull { it.page_index } ?: -1) + 1
    val out = MutableList(maxOf(n, 0)) { "" }
    d.pages.forEach { p -> if (p.page_index in out.indices) out[p.page_index] = p.notes }
    return out
}

/**
 * Materials in a call (web PresentMaterialSheet + MaterialTile's loading): the material tile's pages
 * (cache-first, next page ahead, the whole material kept while presented), and the "📑 Present material"
 * sheet — ready materials (mine + shared with me; the cached list offline) and "+ Add" (render on this
 * phone, upload, then present).
 */
class CallMaterials(private val app: LabApp, private val scope: CoroutineScope) : MaterialPageSource {
    private val store = app.materialStore()
    private val _sheet = MutableStateFlow(PresentSheetUi())
    val sheet: StateFlow<PresentSheetUi> = _sheet.asStateFlow()
    private var upload: Job? = null

    override suspend fun page(materialId: String, page: Int): ImageBitmap? = decodePage(store.page(materialId, page, app.online.value))

    override suspend fun notes(materialId: String): List<String>? =
        runCatching { notesOf(store.load(materialId).detail) }.getOrNull()

    override suspend fun prefetch(materialId: String) {
        val d = store.cachedDetail(materialId) ?: runCatching { store.load(materialId).detail }.getOrNull() ?: return
        if (app.online.value) store.prefetch(d)
    }

    private fun ready(list: List<MaterialDto>) = list.filter { it.status == "ready" }

    /** The sheet opened: the cached list at once, then the server's. */
    fun openSheet() = scope.launch {
        val cached = store.cachedList()?.materials
        _sheet.update { it.copy(materials = cached?.let(::ready) ?: it.materials, error = null) }
        try {
            val fresh = store.refreshList()
            _sheet.update { it.copy(materials = ready(fresh.materials), offline = false, error = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _sheet.update { if (cached != null) it.copy(offline = true) else it.copy(error = e.userMessage()) }
        }
    }

    /** "+ Add a PDF, PowerPoint or picture": render here, upload, then [onReady] (present it). */
    fun add(context: Context, uri: Uri, onReady: (String) -> Unit) {
        if (upload?.isActive == true) return
        upload = scope.launch {
            _sheet.update { it.copy(error = null, stage = UploadStage.Rendering(0, 1)) }
            val work = File(context.cacheDir, "materials")
            var copy: File? = null
            try {
                val (file, picked) = MaterialUploader.copyIn(context, uri, work)
                copy = file
                val m = MaterialUploader(app.repo.api, store, work).add(file, picked) { st -> _sheet.update { it.copy(stage = st) } }
                runCatching { store.refreshList() }
                _sheet.update { s -> s.copy(stage = null, materials = (listOf(m) + s.materials.orEmpty().filter { it.id != m.id })) }
                onReady(m.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _sheet.update { it.copy(stage = null, error = e.userMessage()) }
            } finally {
                withContext(Dispatchers.IO) { copy?.delete() }
            }
        }
    }
}
