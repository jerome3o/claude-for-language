package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportTarget
import dev.jeromeswannack.chineselearning.lab.ui.catalogue.CatalogueRoute
import dev.jeromeswannack.chineselearning.lab.ui.kit.AnkiExportSheet
import dev.jeromeswannack.chineselearning.lab.ui.editor.Exporter
import dev.jeromeswannack.chineselearning.lab.ui.editor.rememberExporter
import dev.jeromeswannack.chineselearning.lab.ui.editor.rememberJsonPicker
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.flow.SharedFlow

/**
 * `/library` (the tutor's Lesson Library tab) and `/library/{id}` (one item) — package G;
 * web: pages/editor/LessonLibraryPage.tsx, LibraryItemPage.tsx. The editor, Try it and the
 * catalogue trial are other screens (ui/editor); `/library/catalogue` is ui/catalogue.
 */
fun NavGraphBuilder.libraryGraph(nav: LabNav) {
    composable(Routes.route(Routes.LIBRARY)) { LibraryRoute(nav) }
    composable(Routes.route("/library/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        // Belt and braces: the literal /library/catalogue route is registered first and wins,
        // but if a pattern match ever picks this one, still show the catalogue.
        if (id == "catalogue") CatalogueRoute(nav) else LibraryItemRoute(nav, id)
    }
}

@Composable
private fun LibraryRoute(nav: LabNav) {
    val vm: LibraryViewModel = viewModel(factory = viewModelFactory { initializer { LibraryViewModel(LibraryDeps.from(nav.app)) } })
    val model = vm.model
    val ui by model.ui.collectAsStateWithLifecycle()
    val exporter = rememberExporter(onSaved = model::showSuccess, onError = model::showError)
    val pickJson = rememberJsonPicker(onText = model::importJson, onError = model::showError)
    var anki by remember { mutableStateOf<AnkiExportTarget?>(null) }
    AnkiExportSheet(anki) { anki = null }
    Effects(model.effects, nav, exporter) { anki = it }
    val folderUi = model.folders?.ui?.collectAsStateWithLifecycle()?.value
    LibraryScreen(
        ui,
        LibraryActions(
            onRetry = { model.refresh() },
            onNew = model::openNewLesson,
            onPageMenu = model::openPageMenu,
            onClosePageMenu = model::closePageMenu,
            onImport = { model.closePageMenu(); pickJson() },
            onMyLessons = { model.closePageMenu(); nav.open(Routes.lessons()) },
            onCatalogue = { nav.open(Routes.catalogue()) },
            onOpen = model::openItem,
            onEdit = model::edit,
            onAssign = model::assign,
            onMenu = model::openMenu,
            onCloseMenu = model::closeMenu,
            onDuplicate = model::duplicate,
            onExport = model::export,
            onPrint = model::print,
            onAnki = model::anki,
            onArchive = model::askArchive,
            onConfirmArchive = model::archive,
            onCancelArchive = model::cancelArchive,
            onDismissNotice = model::dismissNotice,
            newLesson = NewLessonActions(
                onPrompt = { v -> model.editNewLesson { it.copy(prompt = v) } },
                onSituation = { v -> model.editNewLesson { it.copy(situation = v) } },
                onLevel = { v -> nav.app.haptics.tick(); model.editNewLesson { it.copy(level = v) } },
                onDraft = { model.draft() },
                onDraftConversation = { model.draftConversation() },
                onBlank = model::startBlank,
                onDismiss = model::closeNewLesson,
            ),
            assign = model.assign.actions { nav.open(Routes.CONNECTIONS) },
            onMoveToFolder = model::moveToFolder,
            onLift = { nav.app.haptics.flip() },
            onSlot = { nav.app.haptics.tick() },
        ),
        folders = folderUi,
        folderActions = remember(model) { model.folders?.let(dev.jeromeswannack.chineselearning.lab.ui.folders.FolderActions::of) ?: dev.jeromeswannack.chineselearning.lab.ui.folders.FolderActions() },
    )
}

@Composable
private fun LibraryItemRoute(nav: LabNav, id: String) {
    val vm: LibraryItemViewModel = viewModel(key = "library-item-$id", factory = viewModelFactory { initializer { LibraryItemViewModel(LibraryDeps.from(nav.app), id) } })
    val model = vm.model
    val ui by model.ui.collectAsStateWithLifecycle()
    val exporter = rememberExporter(onSaved = model::showSuccess, onError = model::showError)
    var anki by remember { mutableStateOf<AnkiExportTarget?>(null) }
    AnkiExportSheet(anki) { anki = null }
    Effects(model.effects, nav, exporter) { anki = it }
    LibraryItemScreen(
        ui,
        LibraryItemActions(
            onBack = nav::back,
            onRetry = model::refresh,
            onEdit = model::edit,
            onTry = model::tryIt,
            onAssign = model::openAssign,
            onPrint = model::print,
            onOpenExport = model::openExport,
            onCloseExport = model::closeExport,
            onExport = model::export,
            onAnki = model::anki,
            onPush = model::push,
            onAnswers = model::openAnswers,
            onOpenCopy = model::openCopy,
            onDismissNotice = model::dismissNotice,
            assign = model.assign.actions { nav.open(Routes.CONNECTIONS) },
        ),
    )
}

@Composable
private fun Effects(effects: SharedFlow<LibraryEffect>, nav: LabNav, exporter: Exporter, onAnki: (AnkiExportTarget) -> Unit) {
    LaunchedEffect(effects) {
        effects.collect { e ->
            when (e) {
                is LibraryEffect.Open -> nav.open(e.path)
                is LibraryEffect.OpenInMainApp -> nav.openInMainApp(e.path)
                is LibraryEffect.Export -> if (e.save) exporter.saveAs(e.file) else exporter.share(e.file)
                is LibraryEffect.Print -> exporter.print(e.title, e.markdown)
                is LibraryEffect.Anki -> onAnki(e.target)
            }
        }
    }
}
