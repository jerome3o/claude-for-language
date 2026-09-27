package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.ui.connections.Avatar
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * On a deck the tutor sent as ONE-OFF homework (caps 0 + 0, so the daily budget never
 * introduces it): say so, link to the pass, and let the student add the words to their daily
 * review (web: components/homework/OneOffDeckBanner.tsx).
 */
@Composable
fun OneOffDeckBanner(online: Boolean, busy: Boolean, error: Boolean, onOpenPass: () -> Unit, onAdd: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(Palette.Hard.copy(alpha = 0.10f)).border(1.dp, Palette.Hard.copy(alpha = 0.45f), shape).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Homework only.") }
                append(" These words aren’t in your daily review — go through them once in the ")
                withStyle(SpanStyle(color = Lab.colors.accent, fontWeight = FontWeight.SemiBold)) { append("homework pass") }
                append(".")
            },
            style = MaterialTheme.typography.bodyMedium,
            color = Lab.colors.ink,
            modifier = Modifier.bouncyClickable(onClick = onOpenPass),
        )
        SecondaryPill(if (busy) "Adding…" else "Add to my daily review", enabled = online && !busy) { onAdd() }
        if (error) Text("Couldn’t change it — try again when you’re online.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}

/** "Shared with Tutors (N)" with Stop sharing (DeckDetailPage.tsx tutor shares). */
@Composable
fun TutorSharesCard(shares: List<TutorShareUi>, busy: Boolean, onUnshare: (String) -> Unit) {
    var confirm by remember { mutableStateOf<TutorShareUi?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Shared with Tutors (${shares.size})", style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted, modifier = Modifier.padding(start = 4.dp))
        LabCard {
            shares.forEachIndexed { i, s ->
                if (i > 0) RowDivider()
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Avatar(s.name, s.email, size = 32.dp)
                    Column(Modifier.weight(1f)) {
                        Text(s.name ?: "Unknown", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                        Text("Shared ${sharedDate(s.sharedAt)}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    }
                    SecondaryPill("Stop sharing", enabled = !busy) { confirm = s }
                }
            }
        }
    }
    confirm?.let { s ->
        ConfirmDialog(
            title = "Stop sharing?",
            text = "Stop sharing this deck with ${s.name ?: s.email ?: "this tutor"}?",
            confirmLabel = "Stop sharing",
            danger = true,
            onConfirm = { confirm = null; onUnshare(s.relationshipId) },
            onDismiss = { confirm = null },
        )
    }
}

/** The Share with Tutor sheet: my tutors, the ones already shared with greyed out. */
@Composable
fun ShareWithTutorSheet(ui: DeckUi, onShare: (String) -> Unit, onFindTutors: () -> Unit, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss, title = "Share with Tutor") { ShareWithTutorForm(ui, onShare, onFindTutors) }
}

/** The sheet's body (screenshot-testable). */
@Composable
fun ShareWithTutorForm(ui: DeckUi, onShare: (String) -> Unit, onFindTutors: () -> Unit) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Share this deck with a tutor so they can view your study progress.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            ui.shareError?.let { InlineNotice(it, kind = NoticeKind.Error) }
            if (ui.tutors.isEmpty()) {
                EmptyState("👨‍🏫", "No tutors connected", body = "Connect with a tutor first to share decks", actionLabel = "Find Tutors", onAction = onFindTutors)
            } else {
                val shared = ui.tutorShares.map { it.relationshipId }.toSet()
                LabCard {
                    ui.tutors.forEachIndexed { i, t ->
                        if (i > 0) RowDivider()
                        val already = t.relationshipId in shared
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 64.dp).alpha(if (already) 0.6f else 1f)
                                .bouncyClickable(enabled = !already && !ui.shareBusy) { onShare(t.relationshipId) }
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Avatar(t.name, t.email, size = 36.dp)
                            Column(Modifier.weight(1f)) {
                                Text(t.name ?: "Unknown", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                                t.email?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
                            }
                            if (already) Text("Shared", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = Palette.Good)
                        }
                    }
                }
            }
            if (ui.shareBusy) Text("Sharing…", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
}

private fun sharedDate(iso: String): String = runCatching {
    Instant.ofEpochMilli(Js.parseDate(iso)).atZone(ZoneId.systemDefault()).toLocalDate().format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
}.getOrDefault(iso)
