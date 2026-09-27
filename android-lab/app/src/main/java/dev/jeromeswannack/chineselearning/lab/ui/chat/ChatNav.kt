package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.connections.factory
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * `/connections/:relId/chat/:convId` (immersive) — `?new=1` or `chat/new` opens a fresh untitled
 * conversation first (web: ChatPage `wantsNew`). Package E.
 */
fun NavGraphBuilder.chatGraph(nav: LabNav) {
    composable(
        Routes.route("/connections/{relId}/chat/{convId}?new={new}"),
        arguments = listOf(navArgument("new") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val convId = entry.arguments?.getString("convId").orEmpty()
        val wantsNew = convId == "new" || entry.arguments?.getString("new") == "1"
        if (wantsNew) NewConversation(nav, relId) else ChatRoute(nav, relId, convId)
    }
}

@Composable
private fun NewConversation(nav: LabNav, relId: String) {
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(relId) {
        runCatching { ChatViewModel.newConversation(nav.app, relId) }
            .onSuccess { id -> nav.back(); nav.open(Routes.chat(relId, id)) }
            .onFailure { error = "Couldn't start a new conversation. ${it.userMessage()}" }
    }
    LabScreen("New conversation", onBack = nav::back) {
        item { if (error != null) ErrorState(error!!) else LoadingState(text = "Starting a new conversation...") }
    }
}

@Composable
private fun ChatRoute(nav: LabNav, relId: String, convId: String) {
    val vm: ChatViewModel = viewModel(key = "chat-$convId", factory = factory { ChatViewModel(nav.app, relId, convId) })
    val ui by vm.ui.collectAsStateWithLifecycle()
    ChatScreen(
        ui,
        ChatActions(
            onBack = nav::back,
            onDraft = vm::setDraft,
            onSend = vm::send,
            onReply = vm::reply,
            onPlay = vm::play,
            onOpenSheet = vm::openSheet,
            onReact = vm::react,
            onViewCheck = vm::viewCheck,
            onWord = vm::openWord,
            onGenerateCard = vm::generateCard,
            onDismissNotice = vm::dismissNotice,
            onJoinCall = { nav.open(Routes.call(it)) },
            onRetry = { nav.back(); nav.open(Routes.chat(relId, convId)) },
        ),
    ) {
        ChatSheetHost(
            ui,
            ChatSheetActions(
                onDismiss = { vm.openSheet(null) },
                onTool = vm::onTool,
                onReact = vm::react,
                onSaveCards = { cards, deck, new -> vm.saveCards(cards, deck, new) },
                onTogglePin = vm::togglePin,
                onHelpMeSayIt = vm::helpMeSayIt,
                onToggleOption = vm::toggleOption,
                onRename = vm::rename,
                onVoice = { vm.setVoice(voiceId = it) },
                onSpeed = { vm.setVoice(speed = it) },
                onNewConversation = { vm.openSheet(null); nav.open(Routes.chat(relId, "new")) },
                onOpenRename = { vm.openSheet(ChatSheet.Rename) },
                onOpenVoice = { vm.openSheet(ChatSheet.Voice) },
                onAllConversations = { vm.openSheet(null); nav.back() },
                onAsk = vm::ask,
                onToggleDiscussCard = vm::toggleDiscussCard,
                onSaveDiscussCards = vm::saveDiscussCards,
                define = vm::define,
                deckHolding = vm::deckHolding,
            ),
        )
    }
}
