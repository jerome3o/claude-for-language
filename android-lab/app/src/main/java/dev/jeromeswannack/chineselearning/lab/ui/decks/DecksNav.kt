package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.cards.MoveToDeckSheet
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditActions
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditSheet
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditor
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * Package C — the Decks tab (`/decks`) and the deck page (`/decks/:id`). The card hub
 * (`/cards/:noteId`) is registered by ui/cards/CardsNav.kt.
 */
fun NavGraphBuilder.decksGraph(nav: LabNav) {
    composable(Routes.route(Routes.DECKS)) { DecksRoute(nav) }
    composable(Routes.route("/decks/{id}")) { entry -> DeckRoute(nav, entry.arguments?.getString("id").orEmpty()) }
    composable(Routes.route("/generate")) { GenerateRoute(nav) }
    composable(Routes.route("/decks/{id}/try")) { entry -> DeckTryRoute(nav, entry.arguments?.getString("id").orEmpty()) }
}

@Composable
private fun DeckTryRoute(nav: LabNav, deckId: String) {
    val env = remember { DecksEnv.from(nav.app) }
    val vm: DeckTryViewModel = viewModel(key = "try-$deckId", factory = DeckTryViewModel.Factory(env, deckId))
    val ui by vm.ui.collectAsStateWithLifecycle()
    DeckTryScreen(ui, DeckTryActions(onClose = nav::back, onPlay = vm::play, onFlip = vm::flip))
}

@Composable
private fun GenerateRoute(nav: LabNav) {
    val env = remember { DecksEnv.from(nav.app) }
    val vm: GenerateDeckViewModel = viewModel(factory = GenerateDeckViewModel.Factory(env))
    val ui by vm.ui.collectAsStateWithLifecycle()
    GenerateDeckScreen(
        ui,
        GenerateActions(
            onBack = nav::back,
            onPrompt = vm::setPrompt,
            onDeckName = vm::setDeckName,
            onGenerate = vm::generate,
            onAgain = vm::again,
            onOpenDeck = { nav.open(Routes.deck(it)) },
            onPlay = vm::play,
        ),
    )
}

/** "Paste a list" over the deck page (the web's modal); back closes it. */
@Composable
private fun PasteRoute(env: DecksEnv, deckId: String, onClose: () -> Unit) {
    val vm: PasteWordsViewModel = viewModel(key = "paste-$deckId", factory = PasteWordsViewModel.Factory(env, deckId, dev.jeromeswannack.chineselearning.lab.core.Pinyin::toPinyin))
    val ui by vm.ui.collectAsStateWithLifecycle()
    androidx.activity.compose.BackHandler(enabled = ui.stage != PasteStage.RUNNING, onBack = onClose)
    PasteWordsScreen(
        ui,
        PasteActions(
            onClose = onClose,
            onText = vm::setText,
            onColumnSeparator = vm::setColumnSeparator,
            onCustomSeparator = vm::setCustomSeparator,
            onRowSeparator = vm::setRowSeparator,
            onPolicy = vm::setPolicy,
            onGloss = vm::fillWithClaude,
            onEnrich = vm::writeWithClaude,
            onToggleEditing = vm::toggleEditing,
            onEdit = vm::edit,
            onToggleExcluded = vm::toggleExcluded,
            onToggleUnchanged = vm::toggleUnchanged,
            onSave = { vm.save() },
            onUpdateShare = vm::updateShare,
        ),
    )
}

@Composable
private fun DecksRoute(nav: LabNav) {
    val env = remember { DecksEnv.from(nav.app) }
    val vm: DecksViewModel = viewModel(factory = DecksViewModel.Factory(env, null))
    val ui by vm.ui.collectAsStateWithLifecycle()
    var newDeck by remember { mutableStateOf(false) }
    var newDeckError by remember { mutableStateOf<String?>(null) }
    DecksTabScreen(
        ui,
        DecksActions(
            onBack = nav::back,
            onQuery = vm::setQuery,
            onOpenDeck = { nav.open(Routes.deck(it)) },
            onStudy = { nav.open(Routes.study(it)) },
            onAddMore = vm::addMore,
            onMove = vm::move,
            onCommitOrder = vm::commitOrder,
            onNewDeck = { newDeckError = null; newDeck = true },
            onGenerate = { nav.open(Routes.generate()) },
            onAnalyze = { nav.open(Routes.analyze()) },
            onStarter = { vm.addStarterDeck { id -> nav.open(Routes.deck(id)) } },
            onSettings = { nav.open(Routes.SETTINGS) },
            onEditNote = vm.editor::openEdit,
            onDismissNotice = vm::dismissNotice,
            onLift = env.fx.lift,
            onSlot = env.fx.tick,
        ),
    )
    if (newDeck) {
        NewDeckSheet(
            busy = ui.busy,
            online = ui.online,
            error = newDeckError,
            onCreate = { name, desc -> vm.createDeck(name, desc) { id -> newDeck = false; nav.open(Routes.deck(id)) } },
            onGenerate = { newDeck = false; nav.open(Routes.generate()) },
            onStarter = { vm.addStarterDeck { id -> newDeck = false; nav.open(Routes.deck(id)) } },
            onDismiss = { newDeck = false },
        )
    }
    NoteEditorSheets(vm.editor, nav)
}

@Composable
private fun DeckRoute(nav: LabNav, deckId: String) {
    val env = remember { DecksEnv.from(nav.app) }
    val vm: DeckViewModel = viewModel(key = "deck-$deckId", factory = DeckViewModel.Factory(env, deckId))
    val ui by vm.ui.collectAsStateWithLifecycle()
    var settings by remember { mutableStateOf(false) }
    var shareTutor by remember { mutableStateOf(false) }
    var paste by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    var anki by remember { mutableStateOf<dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportTarget?>(null) }
    if (paste) {
        PasteRoute(env, deckId) { paste = false }
        return
    }
    DeckScreen(
        ui,
        DeckActions(
            onBack = nav::back,
            onStudy = { nav.open(Routes.study(deckId)) },
            onTry = { nav.open(Routes.deckTry(deckId)) },
            onEdit = vm.editor::openEdit,
            onPlay = vm::play,
            onAddWord = { vm.editor.openAdd(deckId) },
            onPaste = { paste = true },
            onSettings = { vm.clearSettingsError(); settings = true },
            onGenerateAudio = vm::generateMissingAudio,
            onRegenerateMode = { ui.notes.firstOrNull { it.audioUrl != null }?.let { vm.startSelect(it.id) } },
            onExportAnki = { anki = dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportTarget.Deck(deckId, ui.deck?.name.orEmpty()) },
            onDelete = { vm.deleteDeck { nav.back() } },
            onStartSelect = vm::startSelect,
            onToggleSelect = vm::toggleSelect,
            onSelectAll = vm::selectAll,
            onEndSelect = vm::endSelect,
            onMoveSelected = vm::moveSelected,
            onRegenerateSelected = vm::regenerateSelected,
            onDismissNotice = vm::dismissNotice,
            onOpenHomeworkPass = { nav.open(Routes.homeworkPass(it)) },
            onAddToDailyReview = vm::addToDailyReview,
            onShareWithTutor = { vm.clearShareError(); vm.refreshTutorShares(); shareTutor = true },
            onUnshareTutor = vm::unshareTutor,
        ),
    )
    if (shareTutor) {
        ShareWithTutorSheet(ui, onShare = { rel -> vm.shareWithTutor(rel) { shareTutor = false } }, onFindTutors = { shareTutor = false; nav.open(Routes.CONNECTIONS) }, onDismiss = { shareTutor = false })
    }
    if (settings) {
        DeckSettingsSheet(ui, onSave = { n, d, a, b -> vm.saveSettings(n, d, a, b) { settings = false } }, onDismiss = { settings = false })
    }
    dev.jeromeswannack.chineselearning.lab.ui.kit.AnkiExportSheet(anki) { anki = null }
    NoteEditorSheets(vm.editor, nav)
}

/** The card editor sheet and its "Move to…" picker for any screen that owns a [NoteEditor]. */
@Composable
fun NoteEditorSheets(editor: NoteEditor, nav: LabNav) {
    val edit by editor.state.collectAsStateWithLifecycle()
    val moving by editor.moving.collectAsStateWithLifecycle()
    val targets by editor.targets.collectAsStateWithLifecycle()
    edit?.let { e ->
        val id = e.noteId
        NoteEditSheet(
            e,
            NoteEditActions(
                onSave = editor::save,
                onClose = editor::close,
                onDelete = if (id != null) editor::delete else null,
                onMove = id?.let { { editor.startMove(listOf(it)) } },
                onOpenHub = id?.let { { editor.close(); nav.open(Routes.cardHub(it)) } },
                onPlay = id?.let { { editor.play() } },
                onGenerateAudio = editor::generateAudio,
                onGenerateSentence = editor::generateSentence,
            ),
            extras = id?.let { noteId -> { fields -> dev.jeromeswannack.chineselearning.lab.ui.cards.NoteMediaSections(nav.app, noteId, fields) } },
        )
    }
    moving?.let { ids ->
        MoveToDeckSheet(targets.decks, targets.currentDeckId, ids.size, onPick = editor::moveTo, onDismiss = editor::cancelMove)
    }
}
