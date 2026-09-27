package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckRow
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeViewModel
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * The Decks tab (package C). Interim: the deck queue from Room, tap to study a deck; the
 * deck page, search, reorder, add / paste / generate open the main app until C lands.
 */
fun NavGraphBuilder.decksGraph(nav: LabNav) {
    composable(Routes.route(Routes.DECKS)) {
        val vm: HomeViewModel = viewModel(factory = HomeViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        DecksTabScreen(ui.loaded, ui.decks, onStudy = { nav.open(Routes.study(it)) }, onOpenMainApp = { nav.openInMainApp(Routes.DECKS) })
    }
}

@Composable
fun DecksTabScreen(loaded: Boolean, decks: List<DeckSummary>, onStudy: (String) -> Unit, onOpenMainApp: () -> Unit) {
    LabScreen(title = "Decks", subtitle = if (decks.isEmpty()) null else "${decks.size} decks · studied top to bottom") {
        item {
            InlineNotice(
                "Deck pages, search, reordering and adding words are in the main app for now.",
                actionLabel = "Open",
                onAction = onOpenMainApp,
            )
        }
        when {
            !loaded -> item { LoadingState() }
            decks.isEmpty() -> item { EmptyState("🗂️", "No decks yet", body = "Make one in the main app — it syncs here.", actionLabel = "Open the main app", onAction = onOpenMainApp) }
            else -> items(decks.size, key = { decks[it].id }) { i -> DeckRow(decks[i]) { onStudy(decks[i].id) } }
        }
    }
}
