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
import dev.jeromeswannack.chineselearning.lab.core.QuestionThread
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeChatQuestionDto
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
    val threads: Loadable<List<QuestionThread<ClaudeChatQuestionDto>>> = Loadable(loading = true),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
)

/**
 * Every Ask-Claude conversation, newest first, grouped into threads per card (web:
 * ClaudeChatsPage, the student's own). Cached for offline; "Load older" pages further back.
 */
@Composable
fun ClaudeChatsScreen(ui: ClaudeChatsUi, onBack: () -> Unit, onOpenCard: (String) -> Unit, onLoadMore: () -> Unit, onRetry: () -> Unit) {
    val count = ui.threads.data?.size ?: 0
    LabScreen(
        "Claude conversations",
        onBack = onBack,
        subtitle = if (ui.threads.data != null) "${Fmt.plural(ui.total, "question")} · ${Fmt.plural(count, "conversation")}${if (ui.hasMore) " so far" else ""}" else null,
    ) {
        item {
            LoadableContent(ui.threads, onRetry = onRetry, isEmpty = { it.isEmpty() }, empty = {
                Text("Nothing yet. During study, tap Ask Claude on the back of a card — every question you ask is kept here.", color = Lab.colors.muted, modifier = Modifier.padding(vertical = 24.dp))
            }) { threads ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    threads.forEach { ThreadCard(it, onOpenCard) }
                    if (ui.hasMore) SecondaryPill(if (ui.loadingMore) "Loading…" else "Load older", Modifier.fillMaxWidth(), enabled = !ui.loadingMore, onClick = onLoadMore)
                }
            }
        }
    }
}

@Composable
private fun ThreadCard(thread: QuestionThread<ClaudeChatQuestionDto>, onOpenCard: (String) -> Unit) {
    var open by rememberSaveable(thread.id) { mutableStateOf(false) }
    val first = thread.questions.first()
    LabCard(Modifier.animateContentSize().testTag("claude-thread")) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).bouncyClickable { open = !open }.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(first.hanzi, fontSize = 26.sp, color = Lab.colors.ink)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("${first.pinyin} · ${first.english}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${Fmt.relativeDay(thread.lastAt)} · ${Fmt.plural(thread.questions.size, "question")}", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                if (!open) Text(first.question, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(if (open) "▾" else "▸", color = Lab.colors.muted)
        }
        if (open) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                thread.questions.forEach { q ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Label("Asked")
                        Text(q.question, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                        Label("Claude")
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.background).padding(12.dp)) { MarkdownText(q.answer) }
                        Text(Fmt.shortDateTime(q.asked_at), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                    }
                }
                Text("Open this card ›", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.bouncyClickable { onOpenCard(thread.noteId) }.padding(vertical = 8.dp))
            }
        }
    }
}

@Composable
private fun Label(text: String) = Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = Lab.colors.muted)

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
