package dev.jeromeswannack.chineselearning.lab.ui.connections

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.PlaceholderScreen

/**
 * `/connections` — the Tutor tab for a student, the Students tab for a tutor (web:
 * ConnectionsPage renders StudentsDashboard once the account has an active student).
 * Package E owns this file and the student-side routes; package F adds the dashboard as
 * `ui/teaching/StudentsDashboardScreen.kt` and switches to it here on `role.hasStudents`,
 * and registers its own `/connections/{relId}/…` tutor routes in `ui/teaching/TeachingNav.kt`.
 */
fun NavGraphBuilder.connectionsGraph(nav: LabNav) {
    composable(Routes.route(Routes.CONNECTIONS)) {
        val shell by nav.shell.collectAsStateWithLifecycle()
        if (shell?.role?.hasStudents == true) {
            // ---- package F: the Students dashboard replaces this line ----
            PlaceholderScreen(Routes.CONNECTIONS, onBack = null) { nav.openInMainApp(Routes.CONNECTIONS) }
        } else {
            val vm: ConnectionsViewModel = viewModel(factory = factory { ConnectionsViewModel(nav.app) })
            val ui by vm.ui.collectAsStateWithLifecycle()
            ConnectionsScreen(
                ui,
                ConnectionsActions(
                    onOpen = { nav.open(Routes.connection(it)) },
                    onAccept = vm::accept,
                    onRemove = vm::remove,
                    onCancelInvitation = vm::cancelInvitation,
                    onInvite = vm::invite,
                    onRetry = vm::retry,
                    onDismissNotice = vm::dismissNotice,
                ),
            )
        }
    }

    composable(Routes.route("/connections/{relId}")) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val vm: TutorPageViewModel = viewModel(factory = factory { TutorPageViewModel(nav.app, relId) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        val rel = ui.relationship.data
        val iAmTutor = rel != null && ui.myId != null && rel.other(ui.myId)?.id != CLAUDE_USER_ID &&
            (if (rel.requester_role == "tutor") rel.requester_id else rel.recipient_id) == ui.myId
        if (iAmTutor) {
            // ---- package F: the tutor's student page replaces this line ----
            PlaceholderScreen(Routes.connection(relId), onBack = nav::back) { nav.openInMainApp(Routes.connection(relId)) }
        } else {
            val openChat = { convId: String -> nav.open(Routes.chat(relId, convId)) }
            TutorPageScreen(
                ui,
                TutorPageActions(
                    onBack = nav::back,
                    onMessage = { vm.message(openChat) },
                    onNewPracticeConversation = { vm.newPracticeConversation(it, openChat) },
                    // Video calls are package J's; the main app starts one from this page.
                    onVideoCall = { nav.openOrHandoff(Routes.calls()) },
                    onOpenConversation = openChat,
                    onOpenCard = { nav.openOrHandoff(Routes.cardHub(it)) },
                    onToggleFlag = vm::toggleFlag,
                    onDeleteFlag = vm::deleteFlag,
                    onOpenClaudeChats = { nav.open(Routes.claudeChats()) },
                    onRemoveConnection = { vm.removeConnection { nav.openTabPath(Routes.CONNECTIONS) } },
                    onRetry = vm::retry,
                ),
            )
        }
    }

    composable(Routes.route(Routes.claudeChats())) {
        val vm: ClaudeChatsViewModel = viewModel(factory = factory { ClaudeChatsViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        ClaudeChatsScreen(ui, onBack = nav::back, onOpenCard = { nav.openOrHandoff(Routes.cardHub(it)) }, onLoadMore = vm::loadMore, onRetry = vm::retry)
    }

    composable(Routes.route(Routes.lessonNotes())) {
        val vm: LessonNotesViewModel = viewModel(factory = factory { LessonNotesViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { vm.setFiles(it) }
        LessonNotesScreen(
            ui,
            LessonNotesActions(
                onBack = nav::back,
                onSave = vm::save,
                onPickFiles = { picker.launch("*/*") },
                onDelete = vm::delete,
                onRetry = vm::retry,
            ),
        )
    }
}
