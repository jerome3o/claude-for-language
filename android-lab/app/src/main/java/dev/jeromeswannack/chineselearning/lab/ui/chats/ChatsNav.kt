package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.connections.factory
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/** `/chats` — the Chats tab: every conversation (people, then Practice with Claude). */
fun NavGraphBuilder.chatsGraph(nav: LabNav) {
    composable(Routes.route(Routes.CHATS)) { ChatsRoute(nav) }
}

@Composable
private fun ChatsRoute(nav: LabNav) {
    val vm: ChatsViewModel = viewModel(factory = factory { ChatsViewModel(nav.app) })
    val ui by vm.ui.collectAsStateWithLifecycle()
    // Back from a chat (or into the app): refetch, so unread counts and order are the server's.
    LifecycleResumeEffect(vm) {
        vm.refresh()
        onPauseOrDispose { }
    }
    ChatsScreen(
        ui,
        ChatsActions(
            onOpen = { row ->
                nav.app.haptics.tick()
                nav.open(Routes.chat(row.relationshipId, row.conversationId))
            },
            onQuery = vm::setQuery,
            onNewChat = {
                when (val t = vm.newChatTarget()) {
                    ChatsViewModel.NewChat.Connect -> nav.open(Routes.CONNECTIONS)
                    ChatsViewModel.NewChat.Picking -> Unit
                    is ChatsViewModel.NewChat.Open -> vm.openChat(t.relationshipId) { id -> nav.open(Routes.chat(t.relationshipId, id)) }
                }
            },
            // One chat per pair: picking a person opens THE chat with them, never a second one.
            onPick = { p -> vm.closePicker(); vm.openChat(p.relationshipId) { id -> nav.open(Routes.chat(p.relationshipId, id)) } },
            onDismissPicker = vm::closePicker,
            onConnections = { vm.closePicker(); nav.open(Routes.CONNECTIONS) },
            onRetry = vm::refresh,
        ),
    )
}
