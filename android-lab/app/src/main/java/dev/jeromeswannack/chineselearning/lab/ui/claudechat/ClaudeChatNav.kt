package dev.jeromeswannack.chineselearning.lab.ui.claudechat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import dev.jeromeswannack.chineselearning.lab.core.WordRecap
import dev.jeromeswannack.chineselearning.lab.data.readers.WordRecapStore
import dev.jeromeswannack.chineselearning.lab.ui.readers.WordRecapRoute
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
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

/** "📝 N words to recap" of a chat (web `/coach/chat/:id/recap`). */
fun Routes.claudeChatRecap(id: String) = "/coach/chat/${android.net.Uri.encode(id)}/recap"

/**
 * `/coach/chat/{id}` and `/coach/chat/{id}/recap` — registered from the Coach's graph
 * (ui/coach/CoachNav.kt). The recap is the readers' word recap pass ([WordRecapRoute]) on the
 * chat's run: brought up to date with the chat's words first ([WordRecapStore.openChat]).
 */
fun NavGraphBuilder.claudeChatGraph(nav: LabNav) {
    composable(Routes.route("/coach/chat/{id}/recap")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val app = nav.app
        val ready by produceState(false, id) {
            runCatching { WordRecapStore.openChat(app, id) }
            value = true
        }
        if (ready) {
            WordRecapRoute(nav, WordRecap.chatRunId(id), WordRecap.SOURCE_CHAT, WordRecap.sourceLabel(WordRecap.SOURCE_CHAT)) { words ->
                app.analytics.track(WordRecap.event(WordRecap.SOURCE_CHAT, "start"), mapOf("from" to "menu", "words" to words))
            }
        } else {
            Box(Modifier.fillMaxSize().background(Lab.colors.background))
        }
    }

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
                onRecap = { nav.open(Routes.claudeChatRecap(id)) },
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
