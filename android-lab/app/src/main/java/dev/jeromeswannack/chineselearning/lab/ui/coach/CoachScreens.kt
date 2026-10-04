package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CoachAction
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.CoachBreakdownWord
import dev.jeromeswannack.chineselearning.lab.core.SentenceBumps
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.ui.bumps.SentenceBumpSheet
import dev.jeromeswannack.chineselearning.lab.data.api.CoachAnalysisDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachBreakdownDto
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceBreakdown
import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachLine
import dev.jeromeswannack.chineselearning.lab.data.api.CoachMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachToolResultDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

// ============ Home: new sentence + conversations ============

data class CoachHomeUi(
    val draft: String = "",
    val starting: Boolean = false,
    /** The button that is running (its label says Checking… / Explaining… / Translating…). */
    val pendingAction: CoachAction? = null,
    /** The button that failed, for Try again. */
    val lastAction: CoachAction? = null,
    val startError: String? = null,
    /** Explain's breakdown saved on this device, shown when the coach can't be reached. */
    val savedBreakdown: CoachBreakdownDto? = null,
    val online: Boolean = true,
    val conversations: Loadable<List<CoachConversationDto>> = Loadable(),
)

data class CoachHomeActions(
    val onBack: (() -> Unit)? = null,
    val onDraft: (String) -> Unit = {},
    val onAction: (CoachAction) -> Unit = {},
    val onOpen: (String) -> Unit = {},
    val onDelete: (String) -> Unit = {},
    /** Add a word / the sentence from a saved Explain result (the study card's AddChunkSheet). */
    val cards: SentenceActions = SentenceActions(),
)

private val ACTION_LOADING = mapOf(
    CoachAction.CHECK to "Checking your sentence…",
    CoachAction.EXPLAIN to "Explaining your sentence…",
    CoachAction.TRANSLATE to "Translating your sentence…",
)

/** "✏️ Check my sentence", "🔍 Explain", "Translate" — the web's button labels. */
internal fun CoachAction.buttonLabel() = if (this == CoachAction.TRANSLATE) label else "$icon $label"

/** Test tags on the home buttons. */
fun coachActionTag(a: CoachAction) = "coach-action-" + a.id

/** `/coach` — the web's SentenceCoachPage home view. [autoFocus]: focus the sentence box and raise the keyboard. */
@Composable
fun CoachHomeScreen(ui: CoachHomeUi, actions: CoachHomeActions, autoFocus: Boolean = false) {
    var confirmDelete by remember { mutableStateOf<CoachConversationDto?>(null) }
    val inputFocus = remember { FocusRequester() }
    // The box keeps its own cursor; a draft put in from outside (?draft=, a failed send) lands with the cursor at its end.
    var field by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(ui.draft, androidx.compose.ui.text.TextRange(ui.draft.length))) }
    if (field.text != ui.draft) field = androidx.compose.ui.text.input.TextFieldValue(ui.draft, androidx.compose.ui.text.TextRange(ui.draft.length))
    val keyboard = LocalSoftwareKeyboardController.current
    if (autoFocus) {
        LaunchedEffect(Unit) {
            // After the first frame, so the field is attached when focus is requested.
            withFrameNanos { }
            runCatching { inputFocus.requestFocus() }
            keyboard?.show()
        }
    }
    val trimmed = ui.draft.trim()
    val buttons = CoachActions.buttons(ui.draft)
    var adding by remember { mutableStateOf<Chunk?>(null) }
    LabScreen("Sentence Coach", onBack = actions.onBack) {
        item {
            Text(
                "Wrote something in Chinese? Check it. Reading something? Explain it word by word. Or type English to see how to say it in Chinese. Then keep chatting about it.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
            )
        }
        item {
            Card {
                OutlinedTextField(
                    value = field,
                    onValueChange = { field = it; if (it.text != ui.draft) actions.onDraft(it.text) },
                    placeholder = { Text("我昨天去了商店买苹果 — or — How do I say I'm running late?") },
                    minLines = 3,
                    shape = RoundedCornerShape(14.dp),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp),
                    colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.background, unfocusedContainerColor = Lab.colors.background),
                    modifier = Modifier.fillMaxWidth().focusRequester(inputFocus),
                )
                buttons.hint?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
                ui.startError?.let {
                    val retry = ui.lastAction?.takeIf { a -> a in buttons.actions } ?: buttons.actions.first()
                    InlineNotice(it, kind = NoticeKind.Error, actionLabel = if (trimmed.isNotEmpty()) "Try again" else null, onAction = { actions.onAction(retry) })
                }
                // Chinese / mixed: Check my sentence + Explain; English: Translate (shared/coach).
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (a in buttons.actions) {
                        val label = if (ui.pendingAction == a) a.busy else a.buttonLabel()
                        val enabled = buttons.enabled && !ui.starting
                        // "Check my sentence" is the longer label: it gets the wider share so it stays on one line.
                        val share = if (buttons.actions.size > 1 && a == CoachAction.CHECK) 1.5f else 1f
                        CoachActionPill(label, primary = a != CoachAction.EXPLAIN, enabled = enabled, modifier = Modifier.weight(share).heightIn(min = 56.dp).testTag(coachActionTag(a))) { actions.onAction(a) }
                    }
                }
            }
        }
        ui.pendingAction?.let { a -> item { ThinkingCard(ACTION_LOADING.getValue(a)) } }
        ui.savedBreakdown?.let { b ->
            if (!ui.starting) item(key = "saved-breakdown") {
                ExplainResult(b, enabled = ui.online, offlineNote = "Saved on this device — the follow-up chat needs a connection.", onAdd = { adding = it })
            }
        }
        val list = ui.conversations.data.orEmpty()
        if (ui.conversations.offline && ui.conversations.hasData) item { OfflineNotice(updatedAt = ui.conversations.updatedAt) }
        if (list.isNotEmpty()) {
            item { Text("Recent conversations", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, fontSize = 17.sp) }
            items(list.size, key = { list[it].id }) { i ->
                val conv = list[i]
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp))
                        .bouncyClickable { actions.onOpen(conv.id) }.padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("${CoachActions.conversationAction(conv.action, conv.input_language).icon} ${conv.title}", color = Lab.colors.ink, fontSize = 16.sp, maxLines = 2)
                        Text("${conv.message_count} message${if (conv.message_count == 1) "" else "s"} · ${shortDate(conv.updated_at)}", color = Lab.colors.muted, fontSize = 13.sp)
                    }
                    Box(Modifier.size(44.dp).clip(CircleShape).clickable { confirmDelete = conv }, contentAlignment = Alignment.Center) { Text("🗑", fontSize = 18.sp) }
                }
            }
        }
        item {
            Card {
                Text("How it works", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                listOf(
                    "✏️ Check my sentence → corrected, with a short explanation of what changed",
                    "🔍 Explain → the translation and every word with pinyin and meaning — tap a word to add it as a card",
                    "English → translated, with alternatives",
                    "Then one tap: make a card (to the card standard), more examples, other ways to say it, the grammar",
                    "Or ask anything — the coach can also add cards and build a mini lesson",
                    "Conversations are saved, so you can come back and continue",
                    "Tip: select text anywhere on your phone and choose \"Sentence Coach\"",
                ).forEach { Text("• $it", color = Lab.colors.muted, fontSize = 14.sp) }
            }
        }
    }
    confirmDelete?.let { c ->
        ConfirmDialog("Delete this conversation?", c.title, "Delete", onConfirm = { confirmDelete = null; actions.onDelete(c.id) }, onDismiss = { confirmDelete = null }, danger = true)
    }
    adding?.let { chunk -> AddChunkSheet(chunk, preferredDeck = "", actions.cards, onDismiss = { adding = null }, bumpSource = "coach") }
}

internal fun shortDate(ts: String): String = runCatching {
    val instant = if (ts.endsWith("Z") || ts.contains('+')) java.time.Instant.parse(ts.replace(' ', 'T'))
    else java.time.LocalDateTime.parse(ts.replace(' ', 'T')).toInstant(java.time.ZoneOffset.UTC)
    instant.atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("d MMM"))
}.getOrDefault("")

// ============ Conversation ============

data class CoachChatUi(
    val thread: Loadable<CoachThreadDto> = Loadable(),
    val followUp: String = "",
    val sending: Boolean = false,
    /** What was sent and is waiting for the reply (shown as the user's bubble). */
    val pendingMessage: String? = null,
    val sendError: String? = null,
    val decks: List<CoachDeck> = emptyList(),
    val deckId: String? = null,
    val online: Boolean = true,
    /** "⚡ Study this today": the sentence itself is one of his cards (core SentenceBumps). */
    val bumpExact: BumpStore.BumpWord? = null,
    /** Else "⚡ Study words from this today…": its words that are cards, in picker order. */
    val bumpWords: List<BumpStore.BumpWord> = emptyList(),
    /** Notes already in today's pocket (⚡, can't be ticked). */
    val bumpedNoteIds: Set<String> = emptySet(),
    /** The words picker is open. */
    val bumpPicker: Boolean = false,
    /** The bump's confirmation ("⚡ 银行 will come first in today’s study"), shown for a moment. */
    val bumpMessage: String? = null,
)

data class CoachChatActions(
    val onBack: () -> Unit = {},
    val onNew: () -> Unit = {},
    val onFollowUp: (String) -> Unit = {},
    val onSend: (String) -> Unit = {},
    val onDeck: (String) -> Unit = {},
    val onRetryLoad: () -> Unit = {},
    /** Explain's word rows / whole sentence → a card (the study card's AddChunkSheet). */
    val cards: SentenceActions = SentenceActions(),
    /** "⚡ Study this today": bump the sentence's own card (only it). */
    val onBumpExact: () -> Unit = {},
    /** "⚡ Study words from this today…": open / close the picker. */
    val onOpenBumpPicker: () -> Unit = {},
    val onCloseBumpPicker: () -> Unit = {},
    /** The picker's "⚡ Add N to today": exactly the ticked notes. */
    val onBumpPicked: (List<String>) -> Unit = {},
    /** The add-card sheet's "⚡ Study it today" (null = the app's real bump). */
    val bump: dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi? = null,
)

/** `/coach?c=<id>` — the conversation: the analysis, the chat, quick actions, the follow-up box. */
@Composable
fun CoachChatScreen(ui: CoachChatUi, actions: CoachChatActions) {
    val thread = ui.thread.data
    val messages = thread?.messages.orEmpty()
    val sentence = messages.firstOrNull { it.content_type == "analysis" }?.let { CoachAnalysisDto.parse(it.content)?.sentence }
    val listState = rememberLazyListState()
    var adding by remember { mutableStateOf<Chunk?>(null) }
    val count = messages.size + (if (ui.pendingMessage != null) 2 else 0) + (if (ui.sendError != null) 1 else 0)
    LaunchedEffect(count) { if (count > 2) listState.animateScrollToItem(maxOf(0, count - 1)) }

    LabScreenFrame {
    Column(Modifier.fillMaxSize()) {
        ScreenTitle(thread?.conversation?.title?.ifBlank { null } ?: "Sentence Coach", onBack = actions.onBack) {
            Text("+ New", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = actions.onNew).padding(12.dp))
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (ui.thread.offline && thread != null) item { OfflineNotice(updatedAt = ui.thread.updatedAt) }
            if (thread == null) {
                item {
                    if (ui.thread.loading) ThinkingCard("Loading conversation…")
                    else InlineNotice(ui.thread.error ?: "Couldn't load this conversation.", kind = if (ui.thread.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRetryLoad)
                }
            }
            items(messages, key = { it.id }) { m -> MessageView(m, ui.online) { adding = it } }
            ui.pendingMessage?.let { p ->
                item(key = "pending-user") { UserBubble(p) }
                item(key = "pending") { ThinkingBubble() }
            }
            ui.sendError?.let { item(key = "err") { InlineNotice(it, kind = NoticeKind.Error) } }
        }
        if (thread != null) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)).background(Lab.colors.card)
                    .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (sentence != null) QuickActions(sentence, ui, actions)
                Row(verticalAlignment = Alignment.Bottom) {
                    OutlinedTextField(
                        value = ui.followUp,
                        onValueChange = actions.onFollowUp,
                        placeholder = { Text("Ask a follow-up… (grammar, usage, add words to a deck)") },
                        maxLines = 4,
                        shape = RoundedCornerShape(14.dp),
                        colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.background, unfocusedContainerColor = Lab.colors.background),
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    PrimaryPill(if (ui.sending) "…" else "Send", Modifier.height(56.dp), enabled = ui.followUp.isNotBlank() && !ui.sending) { actions.onSend(ui.followUp.trim()) }
                }
            }
        }
    }
    }
    adding?.let { chunk ->
        AddChunkSheet(
            chunk, preferredDeck = ui.deckId.orEmpty(), actions.cards, onDismiss = { adding = null },
            bumpSource = "coach", bump = actions.bump ?: dev.jeromeswannack.chineselearning.lab.ui.bumps.rememberBumpHanzi("coach"),
        )
    }
    if (ui.bumpPicker && ui.bumpWords.isNotEmpty()) {
        SentenceBumpSheet(ui.bumpWords, ui.bumpedNoteIds, onAdd = actions.onBumpPicked, onDismiss = actions.onCloseBumpPicker)
    }
}

@Composable
private fun QuickActions(hanzi: String, ui: CoachChatUi, actions: CoachChatActions) {
    val deck = ui.decks.firstOrNull { it.id == ui.deckId } ?: ui.decks.firstOrNull()
    ui.bumpMessage?.let { InlineNotice(it, kind = NoticeKind.Success) }
    // The ⚡ chip arrives after the row is drawn (the local lookup is async): a lazy row keeps its
    // first item in place, which would leave the new chip scrolled off to the left — show it.
    val rowState = rememberLazyListState()
    val hasBumpChip = ui.bumpExact != null || ui.bumpWords.isNotEmpty()
    LaunchedEffect(hasBumpChip) { if (hasBumpChip && rowState.firstVisibleItemIndex <= 1) rowState.scrollToItem(0) }
    androidx.compose.foundation.lazy.LazyRow(state = rowState, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        // "⚡ Study … today" (core SentenceBumps): the sentence's own card, else a picker over its
        // words he already has (nothing ticked) — one tap never bumps a pile of words.
        val exact = ui.bumpExact
        if (exact != null) {
            item(key = "bump") {
                val done = exact.noteId in ui.bumpedNoteIds
                LabChip(
                    if (done) SentenceBumps.DONE_LABEL else SentenceBumps.EXACT_LABEL,
                    modifier = Modifier.testTag("coach-bump"),
                    selected = true,
                    enabled = !done,
                    onClick = actions.onBumpExact,
                )
            }
        } else if (ui.bumpWords.isNotEmpty()) {
            item(key = "bump") {
                LabChip(SentenceBumps.WORDS_LABEL, modifier = Modifier.testTag("coach-bump"), selected = true, onClick = actions.onOpenBumpPicker)
            }
        }
        items(COACH_QUICK_ACTIONS, key = { it.key }) { a ->
            LabChip(a.label, enabled = !ui.sending && !(a.needsDeck && deck == null), modifier = Modifier.alpha(if (ui.sending || (a.needsDeck && deck == null)) 0.5f else 1f)) {
                dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("coach.quick_action", mapOf("action" to a.key))
                actions.onSend(a.message(hanzi, deck))
            }
        }
    }
    if (ui.decks.isNotEmpty()) {
        var open by remember { mutableStateOf(false) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Cards go to", fontSize = 13.sp, color = Lab.colors.muted)
            Spacer(Modifier.width(8.dp))
            Box {
                Text(
                    "${deck?.name ?: "—"} ▾",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Lab.colors.ink,
                    modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).clickable(enabled = !ui.sending) { open = true }.padding(horizontal = 10.dp, vertical = 8.dp),
                )
                DropdownMenu(open, onDismissRequest = { open = false }) {
                    ui.decks.forEach { d -> DropdownMenuItem(text = { Text(d.name) }, onClick = { open = false; actions.onDeck(d.id) }) }
                }
            }
        }
    }
}

@Composable
private fun MessageView(m: CoachMessageDto, online: Boolean, onAdd: (Chunk) -> Unit) {
    if (m.role == "user") return UserBubble(m.content)
    if (m.content_type == "analysis") {
        val a = CoachAnalysisDto.parse(m.content)
        if (a != null) return AnalysisView(a, online, onAdd)
    }
    Column(Modifier.fillMaxWidth(0.94f).clip(RoundedCornerShape(18.dp, 18.dp, 18.dp, 6.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp, 18.dp, 18.dp, 6.dp)).padding(14.dp)) {
        MarkdownText(m.content)
        val tools = CoachAnalysisDto.toolResults(m.tool_results)
        if (tools.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            tools.forEach { ToolChip(it) }
        }
    }
}

@Composable
private fun UserBubble(text: String) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            text,
            color = Color.White,
            fontSize = 16.sp,
            modifier = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp)).background(Lab.colors.accent).padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

/** Port of ToolResultChips. */
@Composable
private fun ToolChip(r: CoachToolResultDto) {
    val text = when {
        r.tool == "create_flashcards" && r.success -> {
            val notes = (r.data?.get("notes") as? kotlinx.serialization.json.JsonArray).orEmpty()
            val hanzi = notes.mapNotNull { ((it as? kotlinx.serialization.json.JsonObject)?.get("hanzi") as? kotlinx.serialization.json.JsonPrimitive)?.content }.joinToString("、")
            val deckName = (r.data?.get("deck_name") as? kotlinx.serialization.json.JsonPrimitive)?.content
            "✓ Added ${notes.size} card${if (notes.size == 1) "" else "s"}${deckName?.let { " to $it" }.orEmpty()}${if (hanzi.isNotEmpty()) ": $hanzi" else ""}"
        }
        r.tool == "create_custom_lesson" && r.success -> {
            val title = (r.data?.get("title") as? kotlinx.serialization.json.JsonPrimitive)?.content
            "🎓 Mini lesson created${title?.let { ": $it" }.orEmpty()} — it'll appear in your next study session"
        }
        r.success -> "✓ ${r.tool}"
        else -> "✗ ${r.tool}: ${r.error ?: "failed"}"
    }
    val color = if (r.success) Palette.Good else Palette.Again
    Text(text, fontSize = 13.sp, color = Lab.colors.ink, modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(10.dp)).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 6.dp))
}

@Composable
private fun AnalysisView(a: CoachAnalysisDto, online: Boolean, onAdd: (Chunk) -> Unit) {
    if (a.kind == "explain" && a.breakdown != null) return ExplainResult(a.breakdown, enabled = online, onAdd = onAdd)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (a.kind == "chinese" && a.coach != null) {
            val r = a.coach
            Card {
                Badge(if (r.isCorrect) "✓ Looks good!" else "Needs a little work", if (r.isCorrect) Palette.Good else Palette.Hard)
                Headline(r.corrected)
                if (r.critique.isNotBlank()) MarkdownText(r.critique, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp))
            }
            Alternatives(r.alternatives)
            a.explanation?.let { Explanation(it) }
        } else if (a.translation != null) {
            val t = a.translation
            Card {
                Badge("Translation", Palette.Good)
                Headline(t.primary)
                t.primary.note?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
                t.usage_note?.let { MarkdownText(it, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp)) }
            }
            Alternatives(t.alternatives)
        }
    }
}

/** A home button: the kit's pill look (filled accent / outlined) with tighter padding, so two fit side by side. */
@Composable
private fun CoachActionPill(label: String, primary: Boolean, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    val fg = if (primary) Color.White else Lab.colors.accent
    Box(
        modifier
            .bouncyClickable(enabled, 0.95f, onClick = onClick)
            .clip(shape)
            .then(if (primary) Modifier.background(Lab.colors.accent) else Modifier.border(1.5.dp, Lab.colors.accent.copy(alpha = 0.5f), shape))
            .alpha(if (enabled) 1f else 0.5f)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = fg, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 2, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** Test tag on Explain's "+ Add whole sentence as card". */
const val COACH_ADD_SENTENCE_TAG = "coach-add-sentence"

/**
 * Explain (the web's ExplainResultBlock): the translation — used instead of Google Translate — then
 * the SAME one-word-per-row breakdown as the study card's "What's going on here?" (every row adds
 * that word as a card) and the whole sentence as a card, its fun_facts glossing every word.
 */
@Composable
internal fun ExplainResult(b: CoachBreakdownDto, enabled: Boolean, onAdd: (Chunk) -> Unit, offlineNote: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Card {
            Badge("🔍 Explained", Palette.Secondary)
            offlineNote?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
            Text(b.hanzi, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            if (b.pinyin.isNotBlank()) Text(b.pinyin, fontSize = 16.sp, color = Lab.colors.accent)
            b.translation?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 17.sp, color = Lab.colors.ink.copy(alpha = 0.85f)) }
        }
        Card {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Word by word", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                if (enabled) Text("Tap a word to add it as a card", fontSize = 12.sp, color = Lab.colors.muted)
            }
            SentenceBreakdown(b.asExplanation().copy(translation = null), enabled = enabled, onWord = { w -> onAdd(Chunk(w.hanzi, w.pinyin, w.gloss)) })
            val card = CoachActions.sentenceCard(b.hanzi, b.pinyin, b.translation, b.words.map { CoachBreakdownWord(it.hanzi, it.pinyin, it.gloss) }, b.construction)
            SecondaryPill(
                "+ Add whole sentence as card",
                Modifier.fillMaxWidth().padding(top = 6.dp).height(48.dp).testTag(COACH_ADD_SENTENCE_TAG),
                enabled = enabled && card.english.isNotEmpty(),
            ) { onAdd(Chunk(card.hanzi, card.pinyin, card.english, card.funFacts)) }
        }
    }
}

@Composable
private fun Headline(l: CoachLine) {
    Text(l.hanzi, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
    Text(l.pinyin, fontSize = 16.sp, color = Lab.colors.accent)
    Text(l.english, fontSize = 15.sp, color = Lab.colors.muted)
}

@Composable
private fun Alternatives(alts: List<CoachLine>) {
    if (alts.isEmpty()) return
    Card {
        Text("Other ways to say it", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        alts.forEach { alt ->
            Column(Modifier.padding(top = 4.dp)) {
                Text(alt.hanzi, fontSize = 19.sp, color = Lab.colors.ink)
                Text("${alt.pinyin} — ${alt.english}", fontSize = 14.sp, color = Lab.colors.muted)
                alt.note?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
            }
        }
    }
}

/** Legacy conversations still carry the full breakdown. */
@Composable
private fun Explanation(e: CoachExplanationDto) {
    if (e.overview.isNotBlank()) Card { Text("Overview", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink); MarkdownText(e.overview) }
    if (e.words.isNotEmpty()) Card {
        Text("Word by word", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        e.words.forEach { w ->
            Text(w.hanzi + (w.role?.let { "  · $it" }.orEmpty()), fontSize = 18.sp, color = Lab.colors.ink)
            Text("${w.pinyin} — ${w.english}", fontSize = 14.sp, color = Lab.colors.muted)
            w.notes?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
        }
    }
    if (e.grammar_points.isNotEmpty()) Card {
        Text("Grammar", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        e.grammar_points.forEach { g ->
            Text(g.pattern, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)
            MarkdownText(g.explanation, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp))
            g.example?.let { Text("e.g. $it", fontSize = 13.sp, color = Lab.colors.muted) }
        }
    }
    e.nuance?.let { Card { Text("Nuance & usage", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink); MarkdownText(it) } }
    if (e.similar_examples.isNotEmpty()) Card {
        Text("Similar sentences", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        e.similar_examples.forEach { Text(it.hanzi, fontSize = 18.sp, color = Lab.colors.ink); Text("${it.pinyin} — ${it.english}", fontSize = 14.sp, color = Lab.colors.muted) }
    }
}

@Composable
private fun Badge(text: String, color: Color) {
    Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp))
}

@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        content = content,
    )
}

@Composable
private fun ThinkingDots() {
    val t = rememberInfiniteTransition(label = "dots")
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        for (i in 0 until 3) {
            val a by t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(500, delayMillis = i * 150), RepeatMode.Reverse), label = "d$i")
            Box(Modifier.size(8.dp).alpha(a).clip(CircleShape).background(Lab.colors.accent))
        }
    }
}

@Composable
private fun ThinkingBubble() {
    AnimatedVisibility(true, enter = fadeIn() + slideInVertically { it / 2 }) {
        Row(
            Modifier.clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)).padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ThinkingDots()
            Spacer(Modifier.width(10.dp))
            Text("Thinking…", color = Lab.colors.muted)
        }
    }
}

@Composable
private fun ThinkingCard(text: String) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ThinkingDots()
            Spacer(Modifier.width(12.dp))
            Text(text, color = Lab.colors.muted)
        }
    }
}

