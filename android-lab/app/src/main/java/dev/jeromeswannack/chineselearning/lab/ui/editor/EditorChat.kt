package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.EditorChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.editorChat
import dev.jeromeswannack.chineselearning.lab.data.api.sendEditorMessage
import dev.jeromeswannack.chineselearning.lab.data.api.setProposalStatus
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

data class EditorChatUi(
    val loading: Boolean = true,
    val loadError: String? = null,
    val aiAvailable: Boolean = true,
    val messages: List<EditorChatMessageDto> = emptyList(),
    val sending: Boolean = false,
    val error: String? = null,
    val draft: String = "",
)

/** What differs between the editor kinds (lesson / reader): quick prompts, the diff card, the author-change lines. */
class EditorChatKind(
    val quickPrompts: List<String>,
    val subject: String,
    val emptyHint: String,
    /** Lines describing what the author changed since an accepted proposal (client-side preview). */
    val pendingChanges: (baseline: JsonObject, current: JsonObject) -> List<String>,
    val diffCard: @Composable (JsonObject) -> Unit,
) {
    companion object {
        val LESSON = EditorChatKind(
            quickPrompts = listOf(
                "Add a listening exercise for the key word",
                "Make it easier",
                "Make it harder",
                "Add pinyin everywhere",
                "Check the Chinese for mistakes",
            ),
            subject = "co-editor for this lesson",
            emptyHint = "Ask for changes in plain words — “add a listening exercise for 又”, “make section 2 easier”. Claude answers with a proposal you can accept or reject.",
            pendingChanges = { a, b ->
                dev.jeromeswannack.chineselearning.lab.core.spec.LessonDiff.format(dev.jeromeswannack.chineselearning.lab.core.spec.LessonDiff.diff(a, b))
            },
            diffCard = { LessonDiffCard(it) },
        )

        val READER = EditorChatKind(
            quickPrompts = listOf("Simplify page 2", "Add a page where the weather changes", "Use 刮风 somewhere", "Check the pinyin", "Make the ending happier"),
            subject = "co-editor for this reader",
            emptyHint = "Ask for changes in plain words — “simplify page 2”, “add a page where they go home”, “use 刮风 somewhere”. Claude answers with a proposal you can accept or reject.",
            pendingChanges = { a, b ->
                dev.jeromeswannack.chineselearning.lab.core.spec.ReaderDiff.format(dev.jeromeswannack.chineselearning.lab.core.spec.ReaderDiff.diff(a, b))
            },
            diffCard = { ReaderDiffCard(it) },
        )
    }
}

/**
 * The Claude side-chat's state (web: components/editor/EditorChat.tsx): loads the conversation,
 * sends a message with the current (possibly unsaved) spec, shows the optimistic message while
 * Claude thinks, and records Accept / Reject. Accepting hands the proposed spec to the editor
 * (unsaved until Save).
 */
class EditorChatModel(
    private val deps: EditorDeps,
    private val scope: CoroutineScope,
    val targetType: String,
    val targetId: String,
    private val onAccept: (JsonObject) -> Unit,
) {
    private val _ui = MutableStateFlow(EditorChatUi())
    val ui: StateFlow<EditorChatUi> = _ui

    init { reload() }

    fun reload() {
        scope.launch {
            _ui.update { it.copy(loading = true, loadError = null) }
            try {
                val chat = deps.api.editorChat(targetType, targetId)
                _ui.update { it.copy(loading = false, aiAvailable = chat.ai_available, messages = chat.messages) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, loadError = "Couldn't load the conversation. ${e.userMessage()}") }
            }
        }
    }

    fun setDraft(text: String) = _ui.update { it.copy(draft = text) }

    fun send(text: String, currentSpec: JsonObject, pendingChanges: List<String>) {
        val message = text.trim()
        if (message.isEmpty() || _ui.value.sending) return
        val optimistic = EditorChatMessageDto(id = "local-${System.currentTimeMillis()}", role = "user", content = message, author_changes = pendingChanges)
        _ui.update { it.copy(sending = true, error = null, draft = "", messages = it.messages + optimistic) }
        deps.feedback.tick()
        scope.launch {
            try {
                val result = deps.api.sendEditorMessage(targetType, targetId, message, currentSpec)
                _ui.update { u -> u.copy(sending = false, messages = u.messages.filter { it.id != optimistic.id } + result.user_message + result.message) }
                if (result.message.proposed_spec != null) deps.feedback.success()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = if (e is HttpException && e.code == 503) "Claude is not configured on this server." else e.userMessage()
                _ui.update { u -> u.copy(sending = false, error = msg, draft = message, messages = u.messages.filter { it.id != optimistic.id }) }
            }
        }
    }

    fun decide(message: EditorChatMessageDto, accept: Boolean) {
        if (accept) message.proposed_spec?.let(onAccept)
        deps.feedback.tick()
        _ui.update { u -> u.copy(messages = u.messages.map { if (it.id == message.id) it.copy(proposal_status = if (accept) "accepted" else "rejected") else it }) }
        scope.launch {
            try {
                deps.api.setProposalStatus(targetType, targetId, message.id, if (accept) "accept" else "reject")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(error = "Could not record your decision. ${e.userMessage()}") }
            }
        }
    }
}

/** What the author changed since the last accepted proposal (the only baseline the client has). */
fun pendingChangesFor(messages: List<EditorChatMessageDto>, current: JsonObject, kind: EditorChatKind): List<String> {
    val last = messages.lastOrNull() ?: return emptyList()
    val baseline = last.proposed_spec?.takeIf { last.role == "assistant" && last.proposal_status == "accepted" } ?: return emptyList()
    return runCatching { kind.pendingChanges(baseline, current) }.getOrDefault(emptyList())
}

class EditorChatActions(
    val onDraft: (String) -> Unit = {},
    val onSend: (String) -> Unit = {},
    val onDecide: (EditorChatMessageDto, Boolean) -> Unit = { _, _ -> },
    val onRetry: () -> Unit = {},
)

@Composable
fun EditorChatPane(ui: EditorChatUi, kind: EditorChatKind, pendingChanges: List<String>, actions: EditorChatActions, modifier: Modifier = Modifier) {
    val list = rememberLazyListState()
    LaunchedEffect(ui.messages.size, ui.sending) { if (ui.messages.isNotEmpty() || ui.sending) list.animateScrollToItem(maxOf(0, list.layoutInfo.totalItemsCount - 1)) }
    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("✨ Claude", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, fontSize = 17.sp)
            Spacer(Modifier.widthIn(min = 8.dp))
            Text(kind.subject, color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (ui.loading && ui.messages.isEmpty()) item { SystemLine("Loading conversation…") }
            ui.loadError?.let { item { SystemLine(it) } }
            if (!ui.loading && !ui.aiAvailable) item { SystemLine("Claude isn't configured on this server. The editor still works.") }
            if (ui.messages.isEmpty() && !ui.loading && ui.aiAvailable && ui.loadError == null) item { SystemLine(kind.emptyHint) }
            items(ui.messages, key = { it.id }) { m -> ChatMessage(m, kind, actions) }
            if (ui.sending) item { Bubble("Thinking…", user = false, faint = true) }
            ui.error?.let { item { Text(it, color = Palette.Again, style = MaterialTheme.typography.bodySmall) } }
            item { Spacer(Modifier.height(4.dp)) }
        }
        if (pendingChanges.isNotEmpty()) SystemLine("You've changed: ${pendingChanges.joinToString("; ")}", Modifier.padding(horizontal = 14.dp))
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (p in kind.quickPrompts) LabChip(p, enabled = !ui.sending && ui.aiAvailable) { actions.onSend(p) }
        }
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 10.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            EdTextField(
                ui.draft, actions.onDraft, Modifier.weight(1f),
                placeholder = if (ui.aiAvailable) "Ask Claude to change something…" else "Claude is unavailable",
                singleLine = false, minLines = 1,
            )
            PrimaryPill("Send", Modifier.height(52.dp), enabled = !ui.sending && ui.draft.isNotBlank() && ui.aiAvailable) { actions.onSend(ui.draft) }
        }
    }
}

@Composable
private fun SystemLine(text: String, modifier: Modifier = Modifier) {
    Text(text, color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall, modifier = modifier.fillMaxWidth().padding(vertical = 4.dp))
}

@Composable
private fun Bubble(text: String, user: Boolean, faint: Boolean = false) {
    Box(Modifier.fillMaxWidth(), contentAlignment = if (user) Alignment.CenterEnd else Alignment.CenterStart) {
        Text(
            text,
            color = if (user) Color.White else Lab.colors.ink.copy(alpha = if (faint) 0.6f else 1f),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.widthIn(max = 520.dp).clip(RoundedCornerShape(16.dp))
                .background(if (user) Lab.colors.accent else Lab.colors.card)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun ChatMessage(m: EditorChatMessageDto, kind: EditorChatKind, actions: EditorChatActions) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (m.role == "user" && m.author_changes.isNotEmpty()) SystemLine("Since your last message you changed: ${m.author_changes.joinToString("; ")}")
        if (m.content.isNotBlank()) Bubble(m.content, user = m.role == "user")
        val proposed = m.proposed_spec
        if (m.role == "assistant" && proposed != null) {
            Column(
                Modifier.fillMaxWidth().animateContentSize().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card)
                    .border(1.5.dp, when (m.proposal_status) { "accepted" -> Palette.Good; "rejected" -> Lab.colors.cardBorder; else -> Lab.colors.accent.copy(alpha = 0.5f) }, RoundedCornerShape(16.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Proposed changes", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                    when (m.proposal_status) {
                        "accepted" -> Text("Accepted", color = Palette.Good, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium)
                        "rejected" -> Text("Rejected", color = Lab.colors.muted, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium)
                    }
                }
                m.proposal_diff?.let { kind.diffCard(it) }
                if (m.proposal_status == "pending") {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SecondaryPill("Reject", Modifier.weight(1f).heightIn(min = 48.dp)) { actions.onDecide(m, false) }
                        PrimaryPill("Accept", Modifier.weight(1f).heightIn(min = 48.dp)) { actions.onDecide(m, true) }
                    }
                }
            }
        }
    }
}
