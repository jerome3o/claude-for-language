package dev.jeromeswannack.chineselearning.lab.ui.claudechat

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewActions
import dev.jeromeswannack.chineselearning.lab.ui.explorer.rememberExplorerTap
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/** The "💬 Ask Claude" chat route (web `/coach/chat/:id`; `new` = a fresh chat). */
fun Routes.claudeChat(id: String) = "/coach/chat/${android.net.Uri.encode(id)}"

/** `/coach/chat/{id}` — registered from the Coach's graph (ui/coach/CoachNav.kt). */
fun NavGraphBuilder.claudeChatGraph(nav: LabNav) {
    composable(Routes.route("/coach/chat/{id}")) { entry ->
        val id = entry.arguments?.getString("id") ?: CoachAskViewModel.NEW
        val vm: CoachAskViewModel = viewModel(key = "claude-chat-$id", factory = CoachAskViewModel.Factory(nav.app, id))
        val ui by vm.ui.collectAsStateWithLifecycle()
        LaunchedEffect(vm) { vm.pollWhilePending() }
        val explore = rememberExplorerTap("claude_chat")
        ClaudeChatScreen(
            ui,
            ClaudeChatActions(
                onBack = nav::back,
                onDraft = vm::setDraft,
                onSend = { text, spoken -> vm.send(text, spoken) { newId -> nav.back(); nav.open(Routes.claudeChat(newId)) } },
                onLanguage = vm::setLanguage,
                onListening = vm::setListening,
                onMakeCards = vm::makeCards,
                onRetryLoad = vm::reload,
                thread = ClaudeChatThreadActions(
                    onWord = { w, sentence, _ ->
                        vm.recordTapped(w, sentence)
                        vm.itemFor(w, sentence)?.let { explore?.invoke(it) }
                    },
                    translate = vm::translate,
                    retry = vm::retry,
                    play = vm::play,
                    listen = vm::listen,
                    reveal = vm::reveal,
                    toggleSlow = vm::toggleSlow,
                    audioBusy = vm::audioBusy,
                    onReadBackWords = vm::recordSaidWrong,
                    stopAudio = vm::stopAudio,
                    track = vm::track,
                ),
                review = ReviewActions(
                    onClose = vm::closeReview,
                    onToggle = vm::reviewToggle,
                    onEdit = vm::reviewEdit,
                    onOpenEdit = vm::reviewOpenEdit,
                    onPickDeck = vm::reviewPickDeck,
                    onNewDeck = vm::reviewNewDeck,
                    onSave = vm::saveReview,
                ),
            ),
        )
    }
}
