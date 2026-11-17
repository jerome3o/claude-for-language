package dev.jeromeswannack.chineselearning.lab.ui.connections

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.ui.claude.CardThreadRows
import dev.jeromeswannack.chineselearning.lab.data.api.LessonNoteDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

// ---------------- /claude-chats ----------------

data class ClaudeChatsUi(
    /** Every card thread, newest activity first (null until the thread list was fetched once). */
    val threads: Loadable<List<ClaudeThreadDto>> = Loadable(loading = true),
)

/**
 * Every conversation with Claude about a card, newest first (web: ClaudeChatsPage, the learner's
 * own): one row per card thread with its card, each opening the conversation itself.
 */
@Composable
fun ClaudeChatsScreen(ui: ClaudeChatsUi, onBack: () -> Unit, onOpenThread: (String) -> Unit, onRetry: () -> Unit) {
    LabScreen(
        "Claude conversations",
        onBack = onBack,
        subtitle = ui.threads.data?.let { Fmt.plural(it.size, "conversation") },
    ) {
        item {
            LoadableContent(ui.threads, onRetry = onRetry, isEmpty = { it.isEmpty() }, empty = {
                Text("Nothing yet. During study, tap Ask Claude on the back of a card — every conversation is kept here.", color = Lab.colors.muted, modifier = Modifier.padding(vertical = 24.dp))
            }) { threads ->
                CardThreadRows(threads, emptyText = "", showCard = true, open = onOpenThread)
            }
        }
    }
}

// ---------------- /lesson-notes ----------------

data class LessonNotesUi(
    val notes: Loadable<List<LessonNoteDto>> = Loadable(loading = true),
    val busy: Boolean = false,
    val error: String? = null,
    val online: Boolean = true,
    /** File names picked to attach to the next note. */
    val files: List<String> = emptyList(),
)

class LessonNotesActions(
    val onBack: () -> Unit = {},
    val onSave: (text: String, givenAt: String) -> Unit = { _, _ -> },
    val onPickFiles: () -> Unit = {},
    val onDelete: (String) -> Unit = {},
    val onRetry: () -> Unit = {},
)

/**
 * The student's own lesson notes (web: LessonNotesPage): paste what the tutor sends, it becomes
 * context for grammar practice and role-plays. Save + attach files needs a connection.
 */
@Composable
fun LessonNotesScreen(ui: LessonNotesUi, actions: LessonNotesActions) {
    var text by rememberSaveable { mutableStateOf("") }
    var givenAt by rememberSaveable { mutableStateOf("") }
    var confirm by remember { mutableStateOf<String?>(null) }
    LabScreen("Lesson notes", onBack = actions.onBack) {
        item {
            Text(
                "Paste whatever your tutor sends you — vocab lists, sentences, anything. The next time you generate grammar practice or a role-play, this will be used as context. Format doesn't matter.",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
        }
        ui.error?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }
        item {
            LabCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(text, { text = it }, placeholder = { Text("同学 — tóngxué — classmate\n同事 — tóngshì — colleague\n…") }, minLines = 6, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(givenAt, { givenAt = it }, placeholder = { Text("When (optional, e.g. 'Tue lesson' or 2026-04-28)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SecondaryPill("📎 Attach files", onClick = actions.onPickFiles)
                        Spacer(Modifier.width(10.dp))
                        if (ui.files.isNotEmpty()) Text(ui.files.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2)
                    }
                    if (!ui.online) InlineNotice("You're offline — notes save when you're back online.", kind = NoticeKind.Offline)
                    PrimaryPill(if (ui.busy) "Saving…" else "Save", Modifier.fillMaxWidth().height(52.dp), enabled = text.isNotBlank() && !ui.busy && ui.online) {
                        actions.onSave(text, givenAt)
                        text = ""
                        givenAt = ""
                    }
                }
            }
        }
        item { SectionHeader("Past notes") }
        item {
            LoadableContent(ui.notes, onRetry = actions.onRetry, isEmpty = { it.isEmpty() }, empty = { Text("Nothing yet.", color = Lab.colors.muted) }) { notes ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    notes.forEach { n ->
                        LabCard(Modifier.testTag("lesson-note")) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(n.given_at?.takeIf { it.isNotBlank() } ?: n.created_at.take(10), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                                    Text("delete", color = Lab.colors.muted, modifier = Modifier.bouncyClickable { confirm = n.id }.padding(8.dp))
                                }
                                Text(n.raw_text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 8, overflow = TextOverflow.Ellipsis)
                                if (n.files.isNotEmpty()) Text(n.files.joinToString("   ") { "📎 ${it.filename}" }, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                            }
                        }
                    }
                }
            }
        }
    }
    confirm?.let { id -> ConfirmDialog("Delete this lesson note?", "", "Delete", onConfirm = { actions.onDelete(id) }, onDismiss = { confirm = null }, danger = true) }
}
