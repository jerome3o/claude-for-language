package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.claude.CardTools
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/*
 * Card Claude threads as rows — the one store of a card's questions (docs/CHAT.md "Claude threads"):
 * one row per conversation (its last words, when, how many replies are new), each opening the thread
 * itself. Web: components/claude/CardClaudeThreads.tsx.
 *   CardClaudeThreadRows   one card's (the card hub), from the phone's thread cache, refreshed on open
 *   CardThreadRow          one row; "Claude conversations" (/claude-chats) shows the card on it
 */

object CardClaudeThreadTags {
    const val ROW = "card-claude-thread-row"
    const val EMPTY = "card-claude-threads-empty"
}

private fun ClaudeThreadDto.ref() = CardTools.ThreadRef(id, context_kind, context.note_id, last_message_at, created_at, archived)

/** The card threads among [threads], newest activity first (not archived; [noteId] = one card's). */
fun cardThreadsOf(threads: List<ClaudeThreadDto>, noteId: String? = null): List<ClaudeThreadDto> {
    if (noteId != null) {
        val byId = threads.associateBy { it.id }
        return CardTools.earlierCardThreads(threads.map { it.ref() }, noteId, null).mapNotNull { byId[it.id] }
    }
    return threads.filter { it.context_kind == ClaudeChats.CARD && !it.archived }
        .sortedWith(compareByDescending<ClaudeThreadDto> { runCatching { Js.parseDate(it.last_message_at ?: it.created_at) }.getOrDefault(0L) }.thenByDescending { it.id })
}

/** One card's Claude threads (the card hub): rows → the thread; [emptyText] when there are none. */
@Composable
fun CardClaudeThreadRows(app: LabApp, noteId: String, emptyText: String, open: (threadId: String) -> Unit) {
    val flow = remember(noteId) { ClaudeThreads.of(app).observeCardThreads(noteId) }
    val threads by flow.collectAsState(initial = null)
    val online by app.online.collectAsState()
    LaunchedEffect(noteId, online) { if (online) runCatching { ClaudeThreads.of(app).refreshCardThreads(noteId) } }
    val all = threads ?: return
    val rows = remember(all, noteId) { cardThreadsOf(all, noteId) }
    CardThreadRows(rows, emptyText, showCard = false, open = open)
}

@Composable
fun CardThreadRows(rows: List<ClaudeThreadDto>, emptyText: String, showCard: Boolean, open: (threadId: String) -> Unit) {
    if (rows.isEmpty()) {
        Text(emptyText, color = Lab.colors.muted, modifier = Modifier.padding(vertical = 8.dp).testTag(CardClaudeThreadTags.EMPTY))
        return
    }
    val now = System.currentTimeMillis()
    val offset = java.util.TimeZone.getDefault().getOffset(now) / 60_000
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (t in rows) CardThreadRow(t, showCard, now, offset) { open(t.id) }
    }
}

@Composable
fun CardThreadRow(t: ClaudeThreadDto, showCard: Boolean, nowMs: Long, offsetMinutes: Int, onClick: () -> Unit) {
    LabCard(Modifier.testTag(CardClaudeThreadTags.ROW)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).bouncyClickable(pressedScale = 0.98f, role = Role.Button, onClick = onClick)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val card = t.context.label?.takeIf { showCard && it.isNotBlank() }
            if (card != null) {
                Text(card, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = Modifier.widthIn(min = 44.dp))
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text("💬 " + (t.preview?.takeIf { it.isNotBlank() } ?: t.title), color = Lab.colors.ink, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val meta = buildList {
                    if (showCard) t.context.sublabel?.takeIf { it.isNotBlank() }?.let(::add)
                    add(ChatInbox.relativeTime(t.last_message_at ?: t.created_at, nowMs, offsetMinutes))
                    if (t.unread > 0) add("${t.unread} new")
                    if (t.pending) add("Claude is writing…")
                }.filter { it.isNotEmpty() }.joinToString(" · ")
                Text(meta, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(if (showCard) "›" else "Open ›", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
    }
}
