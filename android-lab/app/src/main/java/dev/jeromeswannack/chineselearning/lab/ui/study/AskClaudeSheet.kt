package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.api.AskToolResult
import dev.jeromeswannack.chineselearning.lab.data.api.FlashcardDraft
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/** What the Ask Claude sheet calls (the view-model's ask / approve / reject + the + card flow). */
class AskActions(
    val ask: (question: String, withHistory: Boolean, userAnswer: String?) -> Unit = { _, _, _ -> },
    val approve: () -> Unit = {},
    val reject: () -> Unit = {},
    val toFlashcard: suspend (String) -> FlashcardDraft = { error("offline") },
    val decks: suspend () -> List<Pair<String, String>> = { emptyList() },
    val addFlashcard: suspend (deckId: String, FlashcardDraft) -> Unit = { _, _ -> },
)

/** Friendly labels for Claude's read-only lookups (`TOOL_LABELS`). */
private val TOOL_LABELS = mapOf(
    "search_cards" to "Searched cards",
    "list_conversations" to "Checked conversations",
    "get_deck_info" to "Looked up deck info",
    "get_note_cards" to "Checked card details",
    "get_note_history" to "Checked review history",
    "get_deck_progress" to "Checked deck progress",
    "get_due_cards" to "Checked due cards",
    "get_overall_stats" to "Checked study stats",
)

/**
 * Ask Claude about this card (StudyPage.tsx `renderAskClaudeModal`): quick-question chips
 * before the first question, the conversation (Claude's answers in markdown, its lookups
 * folded into "Used N tools"), its changes to approve or reject, + to turn a message into a
 * card, and the question box. Claude runs an agent loop server-side (edit the card, add
 * cards, delete the card, make a mini lesson).
 */
@Composable
fun AskClaudeSheet(view: CardView, ask: AskUi, userAnswer: String?, actions: AskActions, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss) { AskClaudeBody(view, ask, userAnswer, actions) }
}

@Composable
fun AskClaudeBody(view: CardView, ask: AskUi, userAnswer: String?, actions: AskActions) {
    var question by remember { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Ask about: ${view.note.hanzi}", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink)

        if (ask.conversation.isEmpty() && !ask.asking) {
            ChipRow {
                for (qa in CardExtrasLogic.quickActions(view.card.cardType, userAnswer, !view.note.sentenceClue.isNullOrBlank())) {
                    LabChip(qa.label) { actions.ask(qa.question, false, userAnswer) }
                }
            }
        }

        ask.conversation.forEachIndexed { i, qa ->
            val latest = i == ask.conversation.lastIndex
            Exchange(qa, pending = latest && ask.pending != null, actions)
        }

        if (ask.asking) {
            ask.pendingQuestion?.let { UserBubble(it, onCard = null) }
            Thinking()
        }
        ask.error?.takeIf { !ask.asking }?.let { InlineNotice(it, kind = NoticeKind.Error) }

        if (!ask.cardDeleted) {
            Row(verticalAlignment = Alignment.Bottom) {
                OutlinedTextField(
                    value = question,
                    onValueChange = { question = it },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                    placeholder = { Text(if (ask.pending != null) "Approve or reject changes first…" else "Ask a question…") },
                    enabled = !ask.asking && ask.pending == null,
                    maxLines = 5,
                    shape = RoundedCornerShape(18.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
                )
                Spacer(Modifier.width(8.dp))
                PrimaryPill("Ask", Modifier.height(52.dp), enabled = question.isNotBlank() && !ask.asking && ask.pending == null) {
                    actions.ask(question, true, userAnswer)
                    question = ""
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun Exchange(qa: AskAnswer, pending: Boolean, actions: AskActions) {
    var cardOpen by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        UserBubble(qa.question, onCard = { cardOpen = !cardOpen })
        AnimatedVisibility(cardOpen) { MessageToCard(qa.question, actions) }
        qa.readOnlyToolCalls?.takeIf { it.isNotEmpty() }?.let { calls ->
            var expanded by remember { mutableStateOf(false) }
            Column(Modifier.clip(RoundedCornerShape(10.dp)).clickable { expanded = !expanded }.padding(vertical = 4.dp)) {
                Text("${if (expanded) "▾" else "▸"} Used ${calls.size} tool${if (calls.size != 1) "s" else ""}", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                if (expanded) for (c in calls) {
                    val input = c.input?.entries?.joinToString(", ") { (k, v) -> "$k: ${(v as? JsonPrimitive)?.contentOrNull ?: v}" }
                    Text("${TOOL_LABELS[c.tool] ?: c.tool}${if (!input.isNullOrEmpty()) " ($input)" else ""}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.faint).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            MarkdownText(qa.answer, style = MaterialTheme.typography.bodyMedium)
            val results = qa.toolResults.orEmpty()
            if (results.isNotEmpty()) {
                if (pending) ApprovalBox(results, actions) else results.forEach { AppliedResult(it) }
            }
        }
    }
}

@Composable
private fun UserBubble(text: String, onCard: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.Top) {
        if (onCard != null) {
            Box(
                Modifier.size(32.dp).clip(CircleShape).background(Lab.colors.faint).clickable(onClick = onCard),
                contentAlignment = Alignment.Center,
            ) { Text("+", color = Lab.colors.accent, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.width(8.dp))
        }
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = androidx.compose.ui.graphics.Color.White,
            modifier = Modifier.weight(1f, fill = false).clip(RoundedCornerShape(18.dp)).background(Lab.colors.accent).padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

/** "+" on a message: Claude turns the text into a card, then pick a deck (the web's deck buttons). */
@Composable
private fun MessageToCard(text: String, actions: AskActions) {
    var draft by remember { mutableStateOf<FlashcardDraft?>(null) }
    var decks by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var state by remember { mutableStateOf("loading") }
    val scope = rememberCoroutineScope()
    androidx.compose.runtime.LaunchedEffect(text) {
        state = try { draft = actions.toFlashcard(text); decks = actions.decks(); "ready" } catch (e: Exception) { "error" }
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when (state) {
            "loading" -> Text("Generating flashcard…", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
            "saved" -> Text("Flashcard saved!", color = Palette.Good, style = MaterialTheme.typography.bodyMedium)
            "error" -> Text("Failed to generate flashcard. Try again.", color = Palette.Again, style = MaterialTheme.typography.bodySmall)
            else -> draft?.let { d ->
                Text("${d.hanzi} (${d.pinyin}) — ${d.english}", color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                d.fun_facts?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall) }
                ChipRow {
                    for ((id, name) in decks) LabChip(name) {
                        scope.launch { state = try { actions.addFlashcard(id, d); "saved" } catch (e: Exception) { "error" } }
                    }
                }
            }
        }
    }
}

private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.int(key: String) = (this[key] as? JsonPrimitive)?.intOrNull

/** "Claude wants to make changes:" with Approve / Reject (the changes are already made server-side). */
@Composable
private fun ApprovalBox(results: List<AskToolResult>, actions: AskActions) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Claude wants to make changes:", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        for (tr in results) {
            when {
                !tr.success -> Text("Action failed: ${tr.error ?: "Unknown error"}", color = Palette.Again)
                tr.tool == "edit_current_card" -> Column {
                    Text("✎ Edit card", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    (tr.data?.get("changes") as? JsonObject)?.forEach { (field, value) ->
                        Text("$field: ${(value as? JsonPrimitive)?.contentOrNull ?: value}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    }
                }
                tr.tool == "create_flashcards" -> Column {
                    val n = tr.data?.int("count") ?: 0
                    Text("+ Create $n new card${if (n != 1) "s" else ""}", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    (tr.data?.get("created") as? JsonArray)?.forEach { el ->
                        val o = el as? JsonObject ?: return@forEach
                        Text("${o.str("hanzi")}  ${o.str("pinyin")} — ${o.str("english")}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    }
                }
                tr.tool == "delete_current_card" -> Text("🗑 Delete this card", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                tr.tool == "create_custom_lesson" -> Column {
                    Text("🎓 Mini lesson created: ${tr.data?.str("title").orEmpty()}", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    Text("It will appear in your next study session.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryPill("Approve", Modifier.weight(1f).height(46.dp), color = Palette.Good, onClick = actions.approve)
            SecondaryPill("Reject", Modifier.weight(1f).height(46.dp), onClick = actions.reject)
        }
    }
}

@Composable
private fun AppliedResult(tr: AskToolResult) {
    val text = when {
        !tr.success -> "Action failed: ${tr.error ?: "Unknown error"}"
        tr.tool == "edit_current_card" -> "Card updated" + ((tr.data?.get("changes") as? JsonObject)?.keys?.takeIf { it.isNotEmpty() }?.let { ": ${it.joinToString(", ")} changed" } ?: "")
        tr.tool == "create_flashcards" -> (tr.data?.int("count") ?: 0).let { n -> "$n new card${if (n != 1) "s" else ""} created" }
        tr.tool == "delete_current_card" -> "Card deleted — advancing to next card..."
        tr.tool == "create_custom_lesson" -> "Mini lesson created: ${tr.data?.str("title").orEmpty()} — it'll appear in your next study session"
        else -> return
    }
    Text(text, style = MaterialTheme.typography.labelMedium, color = if (tr.success) Palette.Good else Palette.Again)
}

@Composable
private fun Thinking() {
    val t = rememberInfiniteTransition(label = "thinking")
    val a by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "a")
    Text("Thinking…", color = Lab.colors.muted, fontSize = 15.sp, modifier = Modifier.alpha(a))
}
