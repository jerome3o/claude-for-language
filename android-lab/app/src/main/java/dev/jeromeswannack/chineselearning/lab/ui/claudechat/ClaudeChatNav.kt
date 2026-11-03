package dev.jeromeswannack.chineselearning.lab.ui.claudechat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeRecapRoute
import dev.jeromeswannack.chineselearning.lab.ui.claude.claudeThread
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** The Coach's "💬 Ask Claude" chat route (web `/coach/chat/:id`) — now a Claude thread (`/chats/claude/:id`). */
fun Routes.claudeChat(id: String) = "/coach/chat/${android.net.Uri.encode(id)}"

/** "📝 N words to recap" of a chat (web `/coach/chat/:id/recap`). */
fun Routes.claudeChatRecap(id: String) = "/coach/chat/${android.net.Uri.encode(id)}/recap"

/**
 * `/coach/chat/{id}` and `/coach/chat/{id}/recap` — registered from the Coach's graph
 * (ui/coach/CoachNav.kt). A coach conversation IS a Claude thread (same id): `/coach/chat/{id}`
 * goes to the thread screen (`/chats/claude/{id}`, ui/claude — the web's CoachChatRedirect); the
 * recap is the readers' word recap pass on the chat's run.
 */
fun NavGraphBuilder.claudeChatGraph(nav: LabNav) {
    composable(Routes.route("/coach/chat/{id}/recap")) { entry ->
        ClaudeRecapRoute(nav, entry.arguments?.getString("id").orEmpty())
    }

    composable(Routes.route("/coach/chat/{id}")) { entry ->
        val id = entry.arguments?.getString("id") ?: "new"
        Box(Modifier.fillMaxSize().background(Lab.colors.background))
        LaunchedEffect(id) {
            nav.back()
            nav.open(Routes.claudeThread(id))
        }
    }
}
