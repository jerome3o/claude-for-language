package dev.jeromeswannack.chineselearning.lab.ui.add

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import java.io.File

/** The ＋ Add tab's path (web `/add`). */
val Routes.ADD_TAB: String get() = "/add"

/** `/add` — the learner's ＋ Add tab (docs/ADD_TAB.md). A tab page: the tab bar stays. */
fun NavGraphBuilder.addGraph(nav: LabNav) {
    composable(Routes.route(Routes.ADD_TAB)) {
        val vm: AddViewModel = viewModel(factory = factory { AddViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        val context = LocalContext.current
        val explorer = LocalExplorer.current
        androidx.compose.runtime.LaunchedEffect(Unit) { DeviceWords.preload() }
        // 📷 = the camera in ONE tap (no sheet in between); 🖼 = the photo picker (no permission).
        var cameraUri by remember { mutableStateOf<Uri?>(null) }
        val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> cameraUri?.let { if (ok) vm.photo(context, it) } }
        val launchCamera = {
            val uri = cameraFileUri(context)
            cameraUri = uri
            camera.launch(uri)
        }
        // The app declares CAMERA (video calls), so the capture intent needs it granted first.
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) launchCamera() }
        val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.photo(context, uri) }
        val lookUp: (String, String?, String?, String?) -> Unit = { word, pinyin, gloss, sentence ->
            ExplorerStack.itemForText(word, pinyin, gloss, sentence?.takeIf { it != word })?.let { explorer?.open(it, "add") }
        }
        AddScreen(
            ui,
            AddActions(
                onMethod = vm::pickMethod,
                onListened = vm::listened,
                onTakePhoto = {
                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCamera()
                    else permission.launch(Manifest.permission.CAMERA)
                },
                onPickPhoto = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                onFocusLine = vm::focusLine,
                onRetryPhoto = vm::retryPhoto,
                onLookUp = lookUp,
                onSubmitWord = { a -> vm.submitWord(a.text) { word -> lookUp(word, null, null, null) } },
                onTile = vm::openSheet,
                onResult = { r -> nav.open(r.path) },
                onSheetText = vm::sheetText,
                onSheetFormat = vm::sheetFormat,
                onSheetLevel = vm::sheetLevel,
                onCreate = { a -> vm.create(a.text, a.source == "spoken") { path -> nav.open(path) } },
                onCloseSheet = vm::closeSheet,
            ),
        )
    }
}

private fun cameraFileUri(context: Context): Uri {
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    val file = File(dir, "add-camera.jpg") // one file, overwritten: the photo is read, never kept
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

private inline fun <reified T : ViewModel> factory(crossinline make: () -> T) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T2 : ViewModel> create(modelClass: Class<T2>): T2 = make() as T2
}
