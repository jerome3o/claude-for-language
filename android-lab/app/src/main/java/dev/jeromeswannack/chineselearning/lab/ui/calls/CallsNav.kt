package dev.jeromeswannack.chineselearning.lab.ui.calls

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.teaching.JobActions

/**
 * Video calls (package J): `/calls`, the live call `/calls/:id` (immersive), `/calls/:id/review`
 * and a relationship's lesson board `/connections/:relId/board` (board pages, read-only).
 */
fun NavGraphBuilder.callsGraph(nav: LabNav) {
    composable(Routes.route("/connections/{relId}/board")) { entry -> LessonBoardRoute(nav, entry.arguments?.getString("relId").orEmpty()) }
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

@Composable
private fun LessonBoardRoute(nav: LabNav, relId: String) {
    val vm: LessonBoardViewModel = viewModel(key = "lesson-board-$relId", factory = LessonBoardViewModel.Factory(nav.app, relId))
    val pages by vm.pages.state.collectAsStateWithLifecycle()
    val rels by nav.app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collectAsStateWithLifecycle(null)
    val me by nav.app.callAlerts.myId.collectAsStateWithLifecycle()
    val rel = rels?.let { r -> (r.tutors + r.students).firstOrNull { it.id == relId } }
    val context = LocalContext.current
    LessonBoardScreen(
        pages,
        otherName = rel?.other(me.ifEmpty { null })?.displayName(),
        actions = LessonBoardActions(
            onBack = nav::back,
            onCopy = { text ->
                context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Lesson board", text))
                nav.app.haptics.tick()
            },
            onRefresh = { vm.pages.refresh() },
            onTick = { nav.app.haptics.tick() },
        ),
    )
}
