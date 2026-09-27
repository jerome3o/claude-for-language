package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/** `/homework` (the list) and `/homework/:id` (the one-off pass, immersive). Package E. */
fun NavGraphBuilder.homeworkGraph(nav: LabNav) {
    composable(Routes.route(Routes.homework())) {
        val vm: HomeworkListViewModel = viewModel(factory = HomeworkListViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        HomeworkListScreen(ui, onBack = nav::back, onOpen = { nav.open(Routes.homeworkPass(it)) })
    }
    composable(Routes.route("/homework/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val vm: HomeworkPassViewModel = viewModel(factory = HomeworkPassViewModel.Factory(nav.app, id))
        val ui by vm.ui.collectAsStateWithLifecycle()
        HomeworkPassScreen(
            ui,
            PassActions(
                onClose = nav::back,
                onReveal = vm::reveal,
                onAnswer = vm::answer,
                onPlay = vm::play,
                onAddToDaily = vm::addToDaily,
                onRetrySync = vm::retrySync,
                onAllHomework = { nav.open(Routes.homework()) },
                // The lesson / reader players are package B's; until they are native the main
                // app plays it (its completion comes back as a `done` event on the next sync).
                onStartPlayer = { nav.openInMainApp(Routes.homeworkPass(id)) },
            ),
        )
    }
}
