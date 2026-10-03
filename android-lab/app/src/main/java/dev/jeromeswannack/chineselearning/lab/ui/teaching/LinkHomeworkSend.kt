package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkLinks
import dev.jeromeswannack.chineselearning.lab.core.HomeworkPlan
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** What the tutor typed for a link (docs/HOMEWORK.md §8). [url] is already normalised. */
data class LinkDraft(val title: String, val url: String, val instructions: String?, val dueDate: String?)

/**
 * Send homework → 🔗 A link: URL (YouTube thumbnail preview), title, instructions and an
 * optional due date. Saving creates the link in the tutor's own account, then sends it as a
 * one-off assignment (SendHomeworkController.sendLink).
 */
@Composable
fun LinkSendForm(
    studentName: String,
    today: String,
    defaultDue: String,
    nextLesson: String?,
    online: Boolean,
    busy: Boolean,
    onSend: (LinkDraft) -> Unit,
    initialUrl: String = "",
    initialTitle: String = "",
    initialInstructions: String = "",
    thumbnailPreview: ImageBitmap? = null,
) {
    var url by remember { mutableStateOf(initialUrl) }
    var title by remember { mutableStateOf(initialTitle) }
    var instructions by remember { mutableStateOf(initialInstructions) }
    var due by remember { mutableStateOf<String?>(defaultDue) }
    val normalized = HomeworkLinks.normalizeLinkUrl(url)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Send $studentName a link", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        Text(
            "A video, a song, a drama clip, an article — it opens outside the app. They mark it done and can leave you a note.",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
        )
        LinkFields(title, { title = it }, url, { url = it }, instructions, { instructions = it }, enabled = !busy, thumbnailPreview = thumbnailPreview)
        if (due != null) {
            DueDateChooser(due, today, nextLesson = nextLesson) { due = it }
        } else {
            Text("No due date", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        }
        ChipRow {
            LabChip("No due date", selected = due == null) { due = null }
            if (due == null) LabChip("Add a due date") { due = defaultDue }
        }
        PrimaryPill(
            if (busy) "Sending…" else "Send link", Modifier.fillMaxWidth().height(52.dp),
            enabled = !busy && online && normalized != null && title.isNotBlank() && title.trim().length <= HomeworkLinks.LINK_TITLE_MAX &&
                instructions.trim().length <= HomeworkLinks.LINK_INSTRUCTIONS_MAX,
        ) {
            onSend(LinkDraft(title.trim(), normalized!!, instructions.trim().ifEmpty { null }, due))
        }
        if (due != null) MutedLine("Due ${HomeworkPlan.shortDay(due!!)} · one-off: they open it, then mark it done.")
    }
}
