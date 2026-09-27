package dev.jeromeswannack.chineselearning.lab.ui.cards

import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksEnv
import dev.jeromeswannack.chineselearning.lab.ui.decks.NoteEditorSheets
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/** Package C — the student's card hub, `/cards/:noteId` (the study card's "open" goes here too). */
fun NavGraphBuilder.cardsGraph(nav: LabNav) {
    composable(Routes.route("/cards/{noteId}")) { entry ->
        val noteId = entry.arguments?.getString("noteId").orEmpty()
        val env = remember { DecksEnv.from(nav.app) }
        val vm: CardHubViewModel = viewModel(key = "hub-$noteId", factory = CardHubViewModel.Factory(env, noteId))
        val ui by vm.ui.collectAsStateWithLifecycle()
        CardHubScreen(
            ui,
            CardHubActions(
                onBack = nav::back,
                onPlay = vm::play,
                onEdit = { vm.editor.openEdit(noteId) },
                onOpenDeck = { nav.open(Routes.deck(it)) },
                onRetry = vm::reload,
                onSendFlag = { tutor, message, sent -> vm.sendFlag(tutor.relationshipId, message, tutor.name, sent) },
                onFlagAction = vm::flagAction,
                onPlayRecording = vm::playRecording,
                onAllChats = { nav.open(Routes.claudeChats()) },
                onDismissNotice = vm::dismissNotice,
            ),
        )
        NoteEditorSheets(vm.editor, nav)
    }
}
