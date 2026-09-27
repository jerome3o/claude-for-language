package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.teaching.JobActions

/** Video calls (package J): `/calls`, the live call `/calls/:id` (immersive) and `/calls/:id/review`. */
fun NavGraphBuilder.callsGraph(nav: LabNav) {
    composable(Routes.route("/calls")) {
        val vm: CallsListViewModel = viewModel(factory = CallsListViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        CallsListScreen(
            ui,
            CallsListActions(
                onBack = nav::back,
                onStart = { rel -> vm.start(rel) { id -> nav.open(Routes.call(id)) } },
                onOpen = { c -> nav.open(if (c.status == "live") Routes.call(c.id) else Routes.callReview(c.id)) },
                onRefresh = vm::refresh,
            ),
        )
    }
    composable(Routes.route("/calls/{id}")) { entry -> CallRoute(nav, entry.arguments?.getString("id").orEmpty()) }
    composable(Routes.route("/calls/{id}/review")) { entry ->
        CallReviewRoute(nav, entry.arguments?.getString("id").orEmpty())
    }
}

@Composable
private fun CallReviewRoute(nav: LabNav, id: String) {
    val vm: CallReviewViewModel = viewModel(key = "call-review-$id", factory = CallReviewViewModel.Factory(nav.app, id))
    val ui by vm.ui.collectAsStateWithLifecycle()
    CallReviewScreen(
        ui,
        CallReviewActions(
            onBack = nav::back,
            onJoin = { nav.open(Routes.call(id)) },
            onRefresh = vm::refresh,
            onPlay = vm::play,
            onMakeCards = vm::makeCards,
            onOpenDeck = { nav.open(Routes.deck(it)) },
            onReprocess = vm::reprocess,
            onDelete = { vm.delete { nav.back() } },
            onMakeHomework = vm::makeHomework,
            jobs = JobActions(retry = vm::retryJob, cancel = vm::cancelJob, delete = vm::deleteJob, open = { nav.open(it) }),
            onAllSessionNotes = { nav.open(Routes.sessionNotes(it)) },
        ),
    )
}
