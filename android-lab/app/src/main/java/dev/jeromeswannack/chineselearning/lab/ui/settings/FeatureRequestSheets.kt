package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.api.FeatureRequestDetailDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFormSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** One feature request with its comments and a comment box (the web's FeatureRequestDetail modal). */
@Composable
fun FeatureRequestSheet(detail: FeatureRequestDetailDto, busy: Busy, onComment: (String, () -> Unit) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    LabSheetFrame(onDismiss = onDismiss) {
        FeatureRequestBody(detail, busy, text, { text = it }, title = "Feature Request") { onComment(text) { text = "" } }
    }
}

@Composable
fun FeatureRequestBody(detail: FeatureRequestDetailDto, busy: Busy, text: String, onText: (String) -> Unit, title: String? = null, modifier: Modifier = Modifier, onSend: () -> Unit) {
    val r = detail.request
    // The comment thread scrolls; the comment box and its button stay pinned (SheetScaffold).
    SheetScaffold(
        modifier,
        header = title?.let { t -> { SheetTitle(t) } },
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
        footerAbove = {
            OutlinedTextField(
                value = text, onValueChange = onText,
                modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
                placeholder = { Text("Add a comment...", color = Lab.colors.muted) },
                enabled = !busy.busy,
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent, unfocusedBorderColor = Lab.colors.cardBorder),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = Lab.colors.ink),
            )
            busy.error?.let { StatusLine(it, error = true) }
        },
        footer = { PrimaryPill(if (busy.busy) "Sending..." else "Comment", Modifier.weight(1f).height(52.dp), enabled = text.isNotBlank() && !busy.busy, onClick = onSend) },
    ) {
        Text(r.content, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        StatusPill(requestStatusLabel(r.status), requestStatusColor(r.status))
        Text(listOfNotNull(timeAgo(r.created_at), r.page_context?.let { "from $it" }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        if (detail.comments.isNotEmpty()) {
            Text("Comments", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, modifier = Modifier.padding(top = 6.dp))
            detail.comments.forEach { c ->
                Column {
                    Text("${c.author_name} · ${timeAgo(c.created_at)}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                    Text(c.content, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                }
            }
        }
    }
}

/** "💬 Send feedback" — a new feature request (the web's floating feedback button). */
@Composable
fun FeedbackSheet(busy: Busy, onSend: (String, () -> Unit) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    LabFormSheet(
        onDismiss = onDismiss,
        title = "Send feedback",
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
        footerAbove = busy.error?.let { e -> { StatusLine(e, error = true) } },
        footer = { PrimaryPill(if (busy.busy) "Sending..." else "Send", Modifier.weight(1f).height(52.dp), enabled = text.isNotBlank() && !busy.busy) { onSend(text) { text = ""; onDismiss() } } },
    ) {
        run {
            Text("An idea, a bug, something that felt off? It goes to the feature request list.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            OutlinedTextField(
                value = text, onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp),
                placeholder = { Text("What would make the app better?", color = Lab.colors.muted) },
                enabled = !busy.busy,
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent, unfocusedBorderColor = Lab.colors.cardBorder),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = Lab.colors.ink),
            )
        }
    }
}
