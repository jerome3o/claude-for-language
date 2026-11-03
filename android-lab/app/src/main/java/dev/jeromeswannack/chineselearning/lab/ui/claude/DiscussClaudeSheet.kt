package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.SuggestedCard
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabModalSheet
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/*
 * Discuss with Claude on a chat message = the message's Claude THREAD in a sheet over the chat (the
 * web's components/claude/DiscussClaudeSheet.tsx; docs/CHAT.md "Discuss with Claude"). The same screen
 * as every Claude chat ([ClaudeThreadContent], `sheet`, context chat_message): the message quoted on
 * top, the chips (什么意思 / 自然吗 / 怎么回复 / 做卡片), Ask only, the reply streamed.
 *
 * - Which thread: the message's own ([ClaudeChats.resumeThreadFor] — one per message, whenever), else a
 *   new one made by the first question. It shows in the Chats tab with "💬 About a message · …".
 * - Cards Claude proposes (create_flashcards → `propose_flashcards` on the reply) are never saved by the
 *   server: [proposed] draws them for review (the chat's deck picker).
 * - Replaces the old discussion sheet (`/api/messages/:id/discuss|discussion`, kept on the server for old builds).
 */

object DiscussClaudeTags {
    const val SHEET = "discuss-claude-sheet"
    const val QUOTE = "discuss-claude-quote"
}

/** Port of the web's `proposedCardsOf`: the cards of a reply's `propose_flashcards` result, or null. */
fun proposedCardsOf(toolResults: String?): List<SuggestedCard>? {
    if (toolResults.isNullOrBlank()) return null
    val list = runCatching { Json.parseToJsonElement(toolResults) as? JsonArray }.getOrNull() ?: return null
    for (r in list) {
        val o = r as? JsonObject ?: continue
        if ((o["tool"] as? JsonPrimitive)?.contentOrNull != "propose_flashcards" || (o["success"] as? JsonPrimitive)?.booleanOrNull != true) continue
        val cards = ((o["data"] as? JsonObject)?.get("flashcards") as? JsonArray) ?: continue
        return cards.mapNotNull { c ->
            val x = c as? JsonObject ?: return@mapNotNull null
            fun s(k: String) = (x[k] as? JsonPrimitive)?.contentOrNull
            val hanzi = s("hanzi") ?: return@mapNotNull null
            SuggestedCard(hanzi, s("pinyin").orEmpty(), s("english").orEmpty(), s("fun_facts"))
        }
    }
    return null
}

@Composable
fun DiscussClaudeSheet(
    messageId: String,
    content: String,
    conversationId: String,
    onDismiss: () -> Unit,
    openPath: (String) -> Unit,
    proposed: @Composable (cards: List<SuggestedCard>, replyId: String) -> Unit,
) {
    val app = LocalContext.current.applicationContext as LabApp
    val store = remember { ClaudeThreads.of(app) }
    val flow = remember(messageId) { store.observeMessageThreads(messageId) }
    val threads by flow.collectAsState(initial = emptyList())
    var chosen by rememberSaveable(messageId) { mutableStateOf<String?>(null) }
    val context = remember(messageId, conversationId) { ClaudeChats.Context(ClaudeChats.CHAT_MESSAGE, messageId = messageId, conversationId = conversationId) }
    val now = remember(messageId) { System.currentTimeMillis() }
    val resumed = remember(threads) {
        ClaudeChats.resumeThreadFor(threads.map { ClaudeChats.ResumeCandidate(it.id, it.context.core(), it.last_message_at, it.created_at, it.archived) }, context, now)
    }
    LaunchedEffect(messageId) {
        if (app.online.value) runCatching { store.refreshMessageThreads() }
        val list = runCatching { flow.first() }.getOrDefault(emptyList())
        val resumedNow = ClaudeChats.resumeThreadFor(list.map { ClaudeChats.ResumeCandidate(it.id, it.context.core(), it.last_message_at, it.created_at, it.archived) }, context, now)
        app.analytics.track("claude.discuss_open", mapOf("resumed" to (resumedNow != null)))
    }
    val id = chosen ?: resumed ?: ClaudeThreadViewModel.NEW
    val label = content.replace(Regex("\\s+"), " ").trim().take(40)
    val newContext = ClaudeContextDto(ClaudeChats.CHAT_MESSAGE, message_id = messageId, conversation_id = conversationId, label = label.ifEmpty { null })
    val vm: ClaudeThreadViewModel = viewModel(
        key = "discuss-claude-$messageId-$id",
        factory = ClaudeThreadViewModel.Factory(app, id, if (id == ClaudeThreadViewModel.NEW) newContext else null, "chat_message", false),
    )
    LabModalSheet(onDismiss = onDismiss) {
        Box(Modifier.fillMaxWidth().fillMaxHeight(0.94f).imePadding().testTag(DiscussClaudeTags.SHEET)) {
            ClaudeThreadContent(
                app, vm,
                open = { path -> onDismiss(); openPath(path) },
                back = onDismiss,
                started = { newId -> chosen = newId },
                sheet = true,
                onClose = onDismiss,
                explorerSource = "chat",
                headerExtra = { MessageQuote(content) },
                toolResults = { reply -> proposedCardsOf(reply.tool_results)?.takeIf { it.isNotEmpty() }?.let { proposed(it, reply.id) } },
            )
        }
    }
}

/** The discussed message, quoted under the header. */
@Composable
fun MessageQuote(content: String) {
    Text(
        content,
        color = Lab.colors.ink, fontSize = 15.sp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp).heightIn(max = 96.dp)
            .clip(RoundedCornerShape(10.dp)).background(Color(0xFFD97706).copy(alpha = 0.08f))
            .verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp).testTag(DiscussClaudeTags.QUOTE),
    )
}
