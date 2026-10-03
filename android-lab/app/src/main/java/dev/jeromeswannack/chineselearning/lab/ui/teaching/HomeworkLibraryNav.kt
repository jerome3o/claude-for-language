package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.ui.homework.openExternal
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.PlaceholderScreen

/**
 * The homework library routes (docs/HOMEWORK.md §9): `/connections/:relId/homework` (one
 * student — only when I am their tutor) and `/homework-library` (every student). Registered
 * with one line in ui/nav/FeatureGraphs.kt.
 */
fun NavGraphBuilder.homeworkLibraryGraph(nav: LabNav) {
    composable(Routes.route("/connections/{relId}/homework")) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val relationships by nav.app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collectAsStateWithLifecycle(null)
        val rel = relationships?.students?.firstOrNull { it.id == relId }
        when {
            rel != null -> HomeworkLibraryRoute(nav, relId, rel.studentUser()?.let { it.name ?: it.email } ?: "Student")
            relationships == null -> Unit
            else -> {
                val path = Routes.studentHomeworkLibrary(relId)
                PlaceholderScreen(path, onBack = nav::back) { nav.openInMainApp(path) }
            }
        }
    }
    composable(Routes.route(Routes.HOMEWORK_LIBRARY)) { HomeworkLibraryRoute(nav, null, null) }
}

@Composable
private fun HomeworkLibraryRoute(nav: LabNav, relId: String?, studentName: String?) {
    val vm: HomeworkLibraryViewModel = viewModel(key = "hw-library-${relId ?: "all"}", factory = HomeworkLibraryViewModel.Factory(nav.app, relId, studentName))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    HomeworkLibraryScreen(
        ui,
        HomeworkLibraryActions(
            back = nav::back,
            setFilter = vm::setFilter,
            select = vm::select,
            open = { item ->
                if (item.kind == "link") item.url?.let { openExternal(context, it) }
                else HomeworkLibraryViewModel.openPath(item)?.let(nav::open)
            },
            edit = { item ->
                if (item.kind == "link") vm.editLink(item)
                else HomeworkLibraryViewModel.editPath(item)?.let(nav::open)
            },
            updateCopy = vm::updateCopy,
            askDue = vm::askDue,
            changeDue = vm::changeDue,
            remove = vm::remove,
            askCancelLink = vm::askCancelLink,
            cancelLink = vm::cancelLink,
            closeEditLink = { vm.editLink(null) },
            saveLink = vm::saveLink,
            refresh = { vm.source.refresh() },
            removalSheet = vm.removal.actions,
        ),
    )
}
