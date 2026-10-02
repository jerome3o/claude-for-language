package dev.jeromeswannack.chineselearning.lab.ui.materials

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.deleteMaterial
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.data.api.renameMaterial
import dev.jeromeswannack.chineselearning.lab.data.api.shareMaterial
import dev.jeromeswannack.chineselearning.lab.data.api.unshareMaterial
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.materials.MaterialUploader
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Lesson materials (calls round 4 PR 5): `/materials` and `/materials/:id`. Presenting is in the call (CallScreen). */
fun NavGraphBuilder.materialsGraph(nav: LabNav) {
    composable(Routes.route("/materials")) { MaterialsRoute(nav) }
    composable(Routes.route("/materials/{id}")) { entry -> MaterialViewerRoute(nav, entry.arguments?.getString("id").orEmpty()) }
}

class MaterialsViewModel(private val app: LabApp) : ViewModel() {
    private val store = app.materialStore()
    private val _ui = MutableStateFlow(MaterialsUi())
    val ui: StateFlow<MaterialsUi> = _ui.asStateFlow()
    private var upload: Job? = null

    init {
        // Students to share with: my active tutor relationships (the nav's cached list).
        viewModelScope.launch {
            combine(app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS), app.callAlerts.myId) { rels, me ->
                rels?.students.orEmpty().map { MaterialStudent(it.id, it.other(me.ifEmpty { null }).displayName()) }
            }.collect { st -> _ui.update { it.copy(students = st) } }
        }
        refresh()
    }

    fun refresh() = viewModelScope.launch {
        store.cachedList()?.let { c -> _ui.update { if (it.materials == null) it.copy(materials = c.materials) else it } }
        try {
            val fresh = store.refreshList()
            _ui.update { it.copy(materials = fresh.materials, offline = false, error = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { if (it.materials != null) it.copy(offline = true) else it.copy(error = "Couldn’t load your materials — ${e.userMessage()}") }
        }
    }

    private fun act(what: String, block: suspend () -> Unit) = viewModelScope.launch {
        try {
            block()
            app.haptics.tick()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(error = "$what failed — ${e.userMessage()}") }
        }
        refresh()
    }

    fun rename(m: MaterialDto, title: String) = act("Rename") {
        app.repo.api.renameMaterial(m.id, title)
        _ui.update { s -> s.copy(materials = s.materials?.map { if (it.id == m.id) it.copy(title = title) else it }) }
    }

    fun delete(m: MaterialDto) = act("Delete") {
        app.repo.api.deleteMaterial(m.id)
        store.forget(m.id)
        _ui.update { s -> s.copy(materials = s.materials?.filter { it.id != m.id }) }
    }

    fun share(m: MaterialDto, relId: String, on: Boolean) = act("Sharing") {
        if (on) app.repo.api.shareMaterial(m.id, relId) else app.repo.api.unshareMaterial(m.id, relId)
        _ui.update { s ->
            s.copy(materials = s.materials?.map { x ->
                if (x.id != m.id) x else x.copy(shared_with = if (on) (x.shared_with.orEmpty() + relId).distinct() else x.shared_with.orEmpty() - relId)
            })
        }
    }

    /** Render here, upload, then open the new material (web MaterialsPage upload). */
    fun add(context: Context, uri: Uri, then: (String) -> Unit) {
        if (upload?.isActive == true) return
        upload = viewModelScope.launch {
            _ui.update { it.copy(error = null, stage = dev.jeromeswannack.chineselearning.lab.data.materials.UploadStage.Rendering(0, 1)) }
            val work = File(context.cacheDir, "materials")
            var copy: File? = null
            try {
                val (file, picked) = MaterialUploader.copyIn(context, uri, work)
                copy = file
                val m = MaterialUploader(app.repo.api, store, work).add(file, picked) { st -> _ui.update { it.copy(stage = st) } }
                _ui.update { s -> s.copy(stage = null, materials = listOf(m) + s.materials.orEmpty().filter { it.id != m.id }) }
                app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.CORRECT); app.haptics.correct()
                then(m.id)
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(stage = null, error = e.userMessage()) }
            } finally {
                withContext(Dispatchers.IO) { copy?.delete() }
            }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = MaterialsViewModel(app) as T
    }
}

@Composable
private fun MaterialsRoute(nav: LabNav) {
    val vm: MaterialsViewModel = viewModel(factory = MaterialsViewModel.Factory(nav.app))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.add(context, uri) { id -> nav.open(Routes.material(id)) }
    }
    MaterialsScreen(
        ui,
        MaterialsActions(
            onBack = nav::back,
            onOpen = { nav.open(Routes.material(it)) },
            onUpload = { runCatching { pick.launch(MaterialUploader.ACCEPT) } },
            onRename = vm::rename,
            onDelete = vm::delete,
            onShare = vm::share,
            onRefresh = { vm.refresh() },
        ),
    )
}

class MaterialViewerViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val store = app.materialStore()
    private val _ui = MutableStateFlow(MaterialViewerUi())
    val ui: StateFlow<MaterialViewerUi> = _ui.asStateFlow()
    private var pageJob: Job? = null

    init {
        viewModelScope.launch {
            // The copy on the phone at once, then the server's.
            store.cachedDetail(id)?.let { d -> _ui.update { it.copy(detail = d, loading = false, kept = if (store.isKept(d)) MaterialViewerUi.Kept.YES else MaterialViewerUi.Kept.NO) }; showPage(0) }
            try {
                val loaded = store.load(id)
                val first = _ui.value.detail == null
                _ui.update { it.copy(detail = loaded.detail, offline = loaded.offline, loading = false, error = null, kept = if (store.isKept(loaded.detail)) MaterialViewerUi.Kept.YES else it.kept) }
                if (first) showPage(0)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { if (it.detail != null) it.copy(offline = true, loading = false) else it.copy(loading = false, error = "Couldn’t load it — ${e.userMessage()}") }
            }
        }
    }

    fun showPage(page: Int) {
        _ui.update { it.copy(page = page, image = null, imageMissing = false) }
        pageJob?.cancel()
        pageJob = viewModelScope.launch {
            val d = _ui.value.detail ?: return@launch
            val info = d.pages.getOrNull(page) ?: return@launch
            if (info.image_url == null) return@launch
            val img = decodePage(store.page(id, info.page_index, app.online.value))
            _ui.update { if (it.page == page) it.copy(image = img, imageMissing = img == null) else it }
            // The next page ahead, so turning is instant.
            d.pages.getOrNull(page + 1)?.let { n -> if (n.image_url != null && app.online.value) store.page(id, n.page_index) }
        }
    }

    fun keep() = viewModelScope.launch {
        val d = _ui.value.detail ?: return@launch
        _ui.update { it.copy(kept = MaterialViewerUi.Kept.SAVING) }
        store.prefetch(d, app.online.value)
        _ui.update { it.copy(kept = if (store.isKept(d)) MaterialViewerUi.Kept.YES else MaterialViewerUi.Kept.NO, error = if (store.isKept(d)) null else "Some pages couldn’t be saved — try again online.") }
        if (store.isKept(d)) app.haptics.tick()
    }

    fun toggleText() = _ui.update { it.copy(showText = !it.showText) }

    /** "Original file": downloaded into the shared cache and handed to an app that opens it. */
    fun original(context: Context) = viewModelScope.launch {
        val m = _ui.value.detail?.material ?: return@launch
        _ui.update { it.copy(downloading = true, error = null) }
        try {
            val name = (m.file_name ?: m.title).replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]+"), "_").trim().ifBlank { "material" }
            val dest = File(File(context.cacheDir, "shared/materials").apply { mkdirs() }, name)
            store.original(m.id, dest)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", dest)
            val view = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, m.mime_type?.takeIf { it.isNotBlank() } ?: "application/octet-stream")
                clipData = ClipData.newRawUri(name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(view, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(error = "Download failed — ${e.userMessage()}") }
        } finally {
            _ui.update { it.copy(downloading = false) }
        }
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = MaterialViewerViewModel(app, id) as T
    }
}

@Composable
private fun MaterialViewerRoute(nav: LabNav, id: String) {
    val vm: MaterialViewerViewModel = viewModel(key = "material-$id", factory = MaterialViewerViewModel.Factory(nav.app, id))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    MaterialViewerScreen(
        ui,
        MaterialViewerActions(
            onBack = nav::back,
            onPage = { vm.showPage(it); nav.app.haptics.tick() },
            onKeep = { vm.keep() },
            onToggleText = vm::toggleText,
            onOriginal = { vm.original(context) },
        ),
    )
}
