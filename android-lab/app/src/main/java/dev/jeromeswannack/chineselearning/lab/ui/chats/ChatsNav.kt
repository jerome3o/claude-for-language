package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.ui.claude.PracticeSituationSheet
import dev.jeromeswannack.chineselearning.lab.ui.claude.claudeThread
import dev.jeromeswannack.chineselearning.lab.ui.connections.factory
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * The Chats tab's route: `/chats`, `?compose=1` (the box, typing), `?text=` (the box with a sentence)
 * and `?practice=1` (the "🎭 Practice a situation" sheet — an old "new chat with Claude" link).
 */
const val CHATS_ROUTE_PATTERN = "/chats?compose={compose}&text={text}&practice={practice}"

/** `/chats?compose=1[&text=]` — More → "✦ Ask Claude / Coach", `/coach`, a sentence handed over. */
fun Routes.chatsCompose(text: String? = null): String =
    "/chats?compose=1" + (text?.trim()?.takeIf { it.isNotEmpty() }?.let { "&text=${android.net.Uri.encode(it)}" } ?: "")

/** `/chats` — the Chats tab: the chats with people and with Claude in one list, the box at the bottom. */
fun NavGraphBuilder.chatsGraph(nav: LabNav) {
    composable(
        Routes.route(CHATS_ROUTE_PATTERN),
        arguments = listOf("compose", "text", "practice").map { a -> navArgument(a) { type = NavType.StringType; nullable = true; defaultValue = null } },
    ) { entry -> ChatsRoute(nav, entry) }
}

@Composable
private fun ChatsRoute(nav: LabNav, entry: NavBackStackEntry) {
    val vm: ChatsViewModel = viewModel(factory = factory { ChatsViewModel(nav.app) })
    val ui by vm.ui.collectAsStateWithLifecycle()
    val shell by nav.shell.collectAsStateWithLifecycle()
    val role = shell?.role
    LaunchedEffect(role) { vm.setTeacher(role != null && (role.isTutorAccount || role.hasStudents)) }
    // ?compose=1 / ?text=: the box, typing, with the text — once (the args are cleared, so a back
    // stack restored later doesn't open it again).
    LaunchedEffect(entry) {
        val args = entry.arguments
        val text = args?.getString("text")
        if (args?.getString("compose") == "1" || !text.isNullOrBlank()) {
            vm.compose(text)
            args?.remove("compose")
            args?.remove("text")
        }
        if (args?.getString("practice") == "1") {
            vm.openPractice()
            args.remove("practice")
        }
    }
    if (ui.practiceOpen) {
        PracticeSituationSheet("chats", onDismiss = vm::closePractice) { id ->
            vm.closePractice()
            nav.open(Routes.claudeThread(id) + "?source=practice")
        }
    }
    // Back from a chat (or into the app): refetch, so unread counts and order are the server's.
    LifecycleResumeEffect(vm) {
        vm.refresh()
        onPauseOrDispose { }
    }
    ChatsScreen(
        ui,
        ChatsActions(
            onOpen = { item -> nav.open(vm.open(item)) },
            onCard = { noteId -> nav.open(Routes.cardHub(noteId)) },
            onPath = { path -> nav.open(path) },
            onQuery = vm::setQuery,
            onFilter = vm::setFilter,
            onToggleClaude = vm::toggleClaudeSection,
            onNewChat = vm::openPicker,
            onPickClaude = { vm.compose() },
            onPickPractice = vm::openPractice,
            // One chat per pair: picking a person opens THE chat with them, never a second one.
            onPick = { p -> vm.closePicker(); vm.openChat(p.relationshipId) { id -> nav.open(Routes.chat(p.relationshipId, id)) } },
            onDismissPicker = vm::closePicker,
            onConnections = { vm.closePicker(); nav.open(Routes.CONNECTIONS) },
            onRetry = vm::refresh,
            compose = ChatsComposeActions(
                onDraft = vm::setDraft,
                onSendToClaude = { text, intent, spoken -> vm.sendToClaude(text, intent, spoken) { id -> nav.open(Routes.claudeThread(id) + "?source=chats") } },
                onSendToPerson = { to, text -> vm.sendToPerson(to, text) { path -> nav.open(path) } },
            ),
        ),
    )
}
