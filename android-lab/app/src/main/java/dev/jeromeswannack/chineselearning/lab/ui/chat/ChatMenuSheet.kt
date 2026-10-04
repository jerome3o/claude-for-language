package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.CoachBreakdownWord
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachBreakdownDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.ui.coach.ExplainResult
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkBody
import dev.jeromeswannack.chineselearning.lab.ui.kit.BoundedScrollColumn
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * Chat round 2's long-press menu (docs/CHAT.md "Round 2", shared `messageMenu`): the reaction bar
 * (👍 ❤️ 😂 😮 😢 🙏 +) above the message, then every action in order; items that need the network
 * are disabled offline ("Needs internet"). And the Explain / Save-as-flashcard sheet.
 */

/** Test tag of a menu row: `chat-menu-<action id>`. */
fun menuTag(id: String) = "chat-menu-$id"

/**
 * The menu's content (stateless, so tests and screenshots render it without a dialog): the
 * reactions, a preview of the message, the action rows.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MessageMenuContent(
    m: ChatMessageDto,
    menu: MessageMenu.Menu,
    online: Boolean,
    recent: List<String>,
    mine: Boolean,
    onReact: (String) -> Unit,
    onAction: (String) -> Unit,
) {
    var all by remember { mutableStateOf(false) }
    val c = chatColors()
    Column(Modifier.fillMaxWidth().testTag("message-actions")) {
        if (menu.reactions) {
            Row(
                Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(if (c.dark) Color2B else Lab.colors.ink.copy(alpha = 0.05f)).padding(horizontal = 4.dp, vertical = 2.dp).testTag("chat-reaction-bar"),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MessageMenu.REACTIONS.forEach { e -> ReactionKey(e, online) { onReact(e) } }
                ReactionKey(if (all) "−" else "+", true, description = if (all) "Fewer emoji" else "More emoji") { all = !all }
            }
            if (!online) Text("Reactions need internet", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp))
            if (all) {
                Column(Modifier.padding(horizontal = 16.dp).heightIn(max = 260.dp).verticalScroll(rememberScrollState())) {
                    if (recent.isNotEmpty()) {
                        Text("Recent", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp))
                        FlowRow { recent.forEach { e -> ReactionKey(e, online) { onReact(e) } } }
                    }
                    Text("All", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp))
                    FlowRow { ChatLogic.FULL_EMOJIS.forEach { e -> ReactionKey(e, online) { onReact(e) } } }
                }
            }
        }
        // The message itself, lifted (Signal shows the bubble above the list).
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
            Text(
                previewOf(m), maxLines = 3, overflow = TextOverflow.Ellipsis, fontSize = 16.sp, lineHeight = 22.sp,
                color = if (mine) c.onMine else c.onTheirs,
                modifier = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(18.dp)).background(if (mine) c.mine else c.theirs).padding(horizontal = 14.dp, vertical = 9.dp),
            )
        }
        menu.items.forEach { item ->
            val blocked = item.needsInternet && !online
            MenuRow(item, blocked) { onAction(item.id) }
        }
    }
}

private val Color2B = androidx.compose.ui.graphics.Color(0xFF2B2B2E)

@Composable
private fun ReactionKey(e: String, enabled: Boolean, description: String? = null, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(CircleShape).bouncyClickable(enabled = enabled, pressedScale = 0.8f, onClick = onClick).alpha(if (enabled) 1f else 0.4f)
            .semantics { contentDescription = description ?: "React $e" },
        contentAlignment = Alignment.Center,
    ) { Text(e, fontSize = if (e == "+" || e == "−") 22.sp else 25.sp, color = Lab.colors.ink.copy(alpha = 0.7f)) }
}

@Composable
private fun MenuRow(item: MessageMenu.Item, blocked: Boolean, onClick: () -> Unit) {
    val color = if (item.danger) Palette.Again else Lab.colors.ink
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(enabled = !blocked, onClick = onClick).alpha(if (blocked) 0.45f else 1f)
            .padding(horizontal = 22.dp, vertical = 8.dp).testTag(menuTag(item.id)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(30.dp), contentAlignment = Alignment.Center) { Text(item.icon, fontSize = 19.sp, color = color) }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(item.label, fontSize = 17.sp, color = color, fontWeight = if (item.active) FontWeight.SemiBold else FontWeight.Normal)
            if (blocked) Text("Needs internet", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        if (item.active) Text("●", fontSize = 10.sp, color = Lab.colors.accent)
    }
}

/**
 * Explain: the sentence, its translation and the Coach's one-word-per-row breakdown (a row adds that
 * word as a card) + "+ Add whole sentence as card". Save as flashcard: straight to the add-card
 * sheet with the whole message as one sentence card (`breakdownSentenceCard`).
 */
@Composable
fun ExplainContent(e: ExplainUi, saveCard: Boolean, online: Boolean, cards: SentenceActions, onRetry: () -> Unit, onClose: () -> Unit) {
    var adding by remember(e.messageId, saveCard) { mutableStateOf<Chunk?>(null) }
    val result = e.result
    Column(Modifier.fillMaxWidth().testTag("chat-explain")) {
        when {
            e.loading -> Row(Modifier.padding(horizontal = 22.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                Text(if (saveCard) "  Making the card…" else "  Claude is explaining it…", color = Lab.colors.muted)
            }
            result == null -> Column(Modifier.padding(horizontal = 22.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(e.text, fontSize = 20.sp, color = Lab.colors.ink)
                InlineNotice(e.error ?: "Couldn't explain it.", kind = if (online) NoticeKind.Error else NoticeKind.Offline, actionLabel = if (online) "Try again" else null, onAction = if (online) onRetry else null)
            }
            else -> {
                val card = remember(result, e.text, e.translation) { sentenceCardOf(e.text, e.translation, result) }
                val shown = adding ?: if (saveCard) card else null
                if (shown != null) {
                    if (saveCard && adding == null) Text("Save as flashcard", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp))
                    // Queue-ordered decks, top deck preselected; the add button stays pinned (LabFooterSheet host).
                    AddChunkBody(shown, preferredDeck = "", cards, onDismiss = { if (saveCard) onClose() else adding = null }, bumpSource = "chat")
                } else BoundedScrollColumn(Modifier.padding(horizontal = 16.dp)) {
                    ExplainResult(breakdownOf(e.text, e.translation, result), enabled = online, onAdd = { adding = it })
                    Spacer(Modifier.height(12.dp))
                }
            }
        }
        if (result == null) Spacer(Modifier.height(12.dp))
    }
}

/** The explain-text answer as the Coach's Explain result (pinyin joined from the rows, like the worker). */
fun breakdownOf(text: String, translation: String?, e: SentenceExplanation): CoachBreakdownDto =
    CoachBreakdownDto.of(text, e).let { b -> b.copy(translation = translation?.takeIf { it.isNotBlank() } ?: b.translation) }

/** Save as flashcard: the whole message as ONE sentence card, fun_facts glossing every word (`breakdownSentenceCard`). */
fun sentenceCardOf(text: String, translation: String?, e: SentenceExplanation): Chunk {
    val b = breakdownOf(text, translation, e)
    val c = CoachActions.sentenceCard(b.hanzi, b.pinyin, b.translation, b.words.map { CoachBreakdownWord(it.hanzi, it.pinyin, it.gloss) }, b.construction)
    return Chunk(c.hanzi, c.pinyin, c.english, c.funFacts)
}
