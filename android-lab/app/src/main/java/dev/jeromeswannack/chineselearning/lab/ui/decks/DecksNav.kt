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
    DeckScreen(
        ui,
        DeckActions(
            onBack = nav::back,
            onStudy = { nav.open(Routes.study(deckId)) },
            onTry = { nav.open(Routes.deckTry(deckId)) },
            onEdit = vm.editor::openEdit,
            onPlay = vm::play,
            onAddWord = { vm.editor.openAdd(deckId) },
            onPaste = { nav.openInMainApp(Routes.deck(deckId)) },
            onSettings = { vm.clearSettingsError(); settings = true },
            onGenerateAudio = vm::generateMissingAudio,
            onRegenerateMode = { ui.notes.firstOrNull { it.audioUrl != null }?.let { vm.startSelect(it.id) } },
            onExportAnki = { nav.openInMainApp(Routes.deck(deckId)) },
            onDelete = { vm.deleteDeck { nav.back() } },
            onStartSelect = vm::startSelect,
            onToggleSelect = vm::toggleSelect,
            onSelectAll = vm::selectAll,
            onEndSelect = vm::endSelect,
            onMoveSelected = vm::moveSelected,
            onRegenerateSelected = vm::regenerateSelected,
            onDismissNotice = vm::dismissNotice,
        ),
    )
    if (settings) {
        DeckSettingsSheet(ui, onSave = { n, d, a, b -> vm.saveSettings(n, d, a, b) { settings = false } }, onDismiss = { settings = false })
    }
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
        )
    }
    moving?.let { ids ->
        MoveToDeckSheet(targets.decks, targets.currentDeckId, ids.size, onPick = editor::moveTo, onDismiss = editor::cancelMove)
    }
}
