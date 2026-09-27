package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReaderFailures
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class ReadersUi(
    val readers: List<GradedReaderDto>? = null,
    val offline: Boolean = false,
    val updatedAt: Long? = null,
    val error: String? = null,
    val busy: Set<String> = emptySet(),
    val deletingAll: Boolean = false,
)

class ReadersActions(
    val onBack: (() -> Unit)? = null,
    val onOpen: (String) -> Unit = {},
    val onEdit: (String) -> Unit = {},
    val onGenerate: () -> Unit = {},
    val onCreate: () -> Unit = {},
    val onDelete: (String) -> Unit = {},
    val onRetry: (String) -> Unit = {},
    val onDeleteAllFailed: () -> Unit = {},
    val onRefresh: () -> Unit = {},
)

/** `formatDate` of the list: "Sep 27", with the year when it isn't this year. */
fun readerDate(iso: String, zone: ZoneId = ZoneId.systemDefault(), nowMs: Long = System.currentTimeMillis()): String = runCatching {
    val d = Instant.ofEpochMilli(Js.parseDate(iso)).atZone(zone)
    val sameYear = d.year == Instant.ofEpochMilli(nowMs).atZone(zone).year
    DateTimeFormatter.ofPattern(if (sameYear) "MMM d" else "MMM d, yyyy", Locale.ENGLISH).format(d)
}.getOrDefault("")

/**
 * `/readers` — the web's ReadersListPage: one card per ready / generating story (polls while
 * one is generating), every failed generation folded into ONE row with friendly reasons,
 * Retry / Delete / Delete all. Cached readers render first.
 */
@Composable
fun ReadersListScreen(ui: ReadersUi, actions: ReadersActions) {
    var confirm by rememberSaveable { mutableStateOf<String?>(null) }
    var confirmAll by rememberSaveable { mutableStateOf(false) }
    val all = ui.readers
    val active = all.orEmpty().filter { it.status != "failed" }
    val failed = all.orEmpty().filter { it.status == "failed" }
    LabScreen("Graded Readers", onBack = actions.onBack) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryPill("✨ AI Generate", Modifier.weight(1f).heightIn(min = 52.dp), onClick = actions.onGenerate)
                SecondaryPill("Create New", Modifier.weight(1f).heightIn(min = 52.dp), onClick = actions.onCreate)
            }
        }
        if (ui.offline) item { OfflineNotice(updatedAt = ui.updatedAt) }
        else ui.error?.let { e -> item { InlineNotice(e, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) } }
        if (all == null) { item { LoadingState() }; return@LabScreen }
        if (active.isEmpty()) {
            item {
                EmptyState("📚", "No stories yet", body = "Generate AI-powered reading stories using vocabulary from your decks", actionLabel = "Generate Your First Story", onAction = actions.onGenerate)
            }
        }
        items(active, key = { it.id }) { r -> ReaderCard(r, actions) { confirm = r.id } }
        if (failed.isNotEmpty()) item { FailedRow(failed, ui, actions) { confirmAll = true } }
    }
    confirm?.let { id ->
        val r = all?.firstOrNull { it.id == id }
        val generating = r?.status == "generating"
        ConfirmDialog(
            if (generating) "Cancel generation?" else "Delete story?",
            if (generating) "Cancel generation of \"${r?.titleEnglish}\"?" else "Delete \"${r?.titleEnglish}\"? This cannot be undone.",
            if (generating) "Cancel it" else "Delete",
            onConfirm = { actions.onDelete(id) },
            onDismiss = { confirm = null },
            danger = true,
        )
    }
    if (confirmAll) {
        ConfirmDialog("Delete failed stories?", "Delete all ${failed.size} failed stories? This cannot be undone.", "Delete all", onConfirm = actions.onDeleteAllFailed, onDismiss = { confirmAll = false }, danger = true)
    }
}

@Composable
private fun ReaderCard(r: GradedReaderDto, actions: ReadersActions, onDelete: () -> Unit) {
    val generating = r.status == "generating"
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)),
    ) {
        Column(Modifier.fillMaxWidth().bouncyClickable(!generating, 0.99f) { actions.onOpen(r.id) }.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (generating) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Palette.Easy); Spacer(Modifier.width(8.dp)) }
                Text(r.titleChinese, fontSize = 21.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                DifficultyBadge(r.difficulty)
            }
            Text(r.titleEnglish, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            r.topic?.takeIf { it.isNotBlank() }?.let { Text("Topic: $it", fontSize = 12.sp, color = Lab.colors.muted) }
            if (generating) Text("Generating story and illustrations...", fontSize = 12.sp, fontStyle = FontStyle.Italic, color = Palette.Easy)
            else Text("${r.vocabularyUsed.size} vocabulary items · ${readerDate(r.createdAt)}", fontSize = 12.sp, color = Lab.colors.muted)
        }
        HorizontalDivider(color = Lab.colors.cardBorder)
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (generating) {
                Text("Generating...", fontSize = 13.sp, color = Lab.colors.muted, modifier = Modifier.weight(1f))
            } else {
                PrimaryPill("Read", Modifier.heightIn(min = 44.dp)) { actions.onOpen(r.id) }
                SecondaryPill("Edit", Modifier.heightIn(min = 44.dp)) { actions.onEdit(r.id) }
                Spacer(Modifier.weight(1f))
            }
            SecondaryPill(if (generating) "Cancel" else "Delete", Modifier.heightIn(min = 44.dp), danger = true, onClick = onDelete)
        }
    }
}

@Composable
private fun FailedRow(failed: List<GradedReaderDto>, ui: ReadersUi, actions: ReadersActions, onDeleteAll: () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val details = remember { mutableStateOf(setOf<String>()) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).bouncyClickable(pressedScale = 0.99f) { open = !open }.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(ReaderFailures.label(failed.size), color = Lab.colors.muted, modifier = Modifier.weight(1f))
            Text(if (open) "▾" else "▸", color = Lab.colors.muted)
        }
        AnimatedVisibility(open, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("These stories couldn't be written. Retry one, or clear them all — nothing here affects your study queue.", fontSize = 13.sp, color = Lab.colors.muted)
                for (r in failed) {
                    val busy = r.id in ui.busy || ui.deletingAll
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.card).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(ReaderFailures.title(r.titleChinese, r.titleEnglish, r.topic), fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                        Text("${readerDate(r.createdAt)} · ${ReaderFailures.friendly(r.errorMessage)}", fontSize = 13.sp, color = Lab.colors.muted)
                        r.errorMessage?.takeIf { it.isNotBlank() }?.let { raw ->
                            val shown = r.id in details.value
                            Text(if (shown) "Hide details" else "Show details", fontSize = 13.sp, color = Lab.colors.accent,
                                modifier = Modifier.bouncyClickable { details.value = if (shown) details.value - r.id else details.value + r.id }.padding(vertical = 6.dp))
                            if (shown) Text(raw, fontSize = 12.sp, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Lab.colors.faint).padding(8.dp))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SecondaryPill(if (r.id in ui.busy) "…" else "Retry", enabled = !busy) { actions.onRetry(r.id) }
                            SecondaryPill("Delete", enabled = !busy, danger = true) { actions.onDelete(r.id) }
                        }
                    }
                }
                SecondaryPill(if (ui.deletingAll) "Deleting…" else "Delete all failed (${failed.size})", Modifier.fillMaxWidth(), enabled = !ui.deletingAll, danger = true, onClick = onDeleteAll)
            }
        }
    }
}
