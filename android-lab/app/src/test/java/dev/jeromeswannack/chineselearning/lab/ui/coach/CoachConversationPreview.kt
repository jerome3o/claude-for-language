package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CoachAction
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * A Coach conversation's messages as the Claude thread screen draws them ([CoachMessageItem]: the check /
 * explain / translate cards, 🎤 Practise saying it, the mistake lesson, pending / failed replies) — for the
 * tests of those pieces. The Coach's own page is gone (Nov 2026): the thread screen (ui/claude) is the
 * only place they appear, with its own composer.
 */
@Composable
fun CoachConversationPreview(ui: CoachChatUi, actions: CoachChatActions = CoachChatActions()) {
    val thread = ui.thread.data
    val messages = thread?.messages.orEmpty()
    val firstAnalysisId = messages.firstOrNull { it.content_type == "analysis" && it.status == null }?.id
    val convAction = thread?.conversation?.let { CoachActions.conversationAction(it.action, it.input_language) } ?: CoachAction.CHECK
    var adding by remember { mutableStateOf<Chunk?>(null) }
    Column(Modifier.fillMaxSize().background(Lab.colors.background)) {
        ScreenTitle(thread?.conversation?.title?.ifBlank { null } ?: "Claude", onBack = actions.onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(messages, key = { it.id }) { m ->
                CoachMessageItem(m, ui, actions, convAction, isFirstAnalysis = m.id == firstAnalysisId) { adding = it }
            }
            ui.pendingMessage?.let { p -> item(key = "pending-user") { Text(p, color = Lab.colors.ink) } }
            ui.sendError?.let { item(key = "err") { InlineNotice(it, kind = if (!ui.online) NoticeKind.Offline else NoticeKind.Error) } }
            ui.lessonError?.let { item(key = "lesson-err") { InlineNotice(it, kind = if (!ui.online) NoticeKind.Offline else NoticeKind.Error) } }
        }
    }
    adding?.let { chunk -> AddChunkSheet(chunk, preferredDeck = "", actions.cards, onDismiss = { adding = null }, bumpSource = "coach", bump = actions.bump) }
}
