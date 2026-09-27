package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.cards.Field
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

data class DeckActions(
    val onBack: () -> Unit = {},
    val onStudy: () -> Unit = {},
    val onTry: () -> Unit = {},
    val onEdit: (String) -> Unit = {},
    val onPlay: (NoteRowUi) -> Unit = {},
    val onAddWord: () -> Unit = {},
    val onPaste: () -> Unit = {},
    val onSettings: () -> Unit = {},
    val onGenerateAudio: () -> Unit = {},
    val onRegenerateMode: () -> Unit = {},
    val onExportAnki: () -> Unit = {},
    val onDelete: () -> Unit = {},
    val onStartSelect: (String) -> Unit = {},
    val onToggleSelect: (String) -> Unit = {},
    val onSelectAll: () -> Unit = {},
    val onEndSelect: () -> Unit = {},
    val onMoveSelected: () -> Unit = {},
    val onRegenerateSelected: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
    val onOpenHomeworkPass: (String) -> Unit = {},
    val onAddToDailyReview: () -> Unit = {},
    val onShareWithTutor: () -> Unit = {},
    val onUnshareTutor: (String) -> Unit = {},
)

/** The deck page (web: DeckDetailPage.tsx). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DeckScreen(ui: DeckUi, actions: DeckActions) {
    val deck = ui.deck
    if (ui.loaded && deck == null) {
        LabScreen("Deck", onBack = actions.onBack) {
            item { EmptyState("🗑️", "This deck has been deleted", body = "It is gone from this phone too.", actionLabel = "Back to decks", onAction = actions.onBack) }
        }
        return
    }
    var confirmDelete by remember { mutableStateOf(false) }
    LabScreen(
        title = deck?.name ?: "",
        subtitle = deck?.description,
        onBack = actions.onBack,
        actions = { if (deck != null) DeckMenu(ui, actions) { confirmDelete = true } },
    ) {
        if (!ui.loaded || deck == null) {
            item { LoadingState() }
            return@LabScreen
        }
        item(key = "primary") {
            if (ui.isTutorAccount) {
                PrimaryPill("▶ Try it as a student", Modifier.fillMaxWidth().height(56.dp)) { actions.onTry() }
            } else {
                PrimaryPill(if (ui.due > 0) "Study · ${ui.due} due" else "Study", Modifier.fillMaxWidth().height(56.dp)) { actions.onStudy() }
            }
        }
        ui.oneOffBanner?.let { assignmentId ->
            item(key = "one-off") {
                OneOffDeckBanner(ui.online, ui.dailyReviewBusy, ui.dailyReviewError, onOpenPass = { actions.onOpenHomeworkPass(assignmentId) }, onAdd = actions.onAddToDailyReview)
            }
        }
        ui.notice?.let { n -> item(key = "notice") { InlineNotice(n, kind = if (ui.noticeIsError) NoticeKind.Error else NoticeKind.Success, actionLabel = "OK", onAction = actions.onDismissNotice) } }
        ui.audioJob?.let { job ->
            item(key = "audio-job") {
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${if (job.regenerate) "Regenerating" else "Generating"} audio… ${job.done}/${job.total}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    LinearProgressIndicator(
                        progress = { if (job.total == 0) 0f else job.done.toFloat() / job.total },
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(3.dp)),
                        color = Lab.colors.accent,
                        trackColor = Lab.colors.faint,
                    )
                }
            }
        }
        if (ui.completion.total > 0) item(key = "progress") { DeckProgressCard(ui) }
        if (ui.tutorShares.isNotEmpty()) item(key = "tutor-shares") { TutorSharesCard(ui.tutorShares, ui.shareBusy, actions.onUnshareTutor) }

        item(key = "words-header") {
            SectionHeader("Words (${ui.notes.size})") {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    HeaderLink("📋 Paste list", actions.onPaste)
                    HeaderLink("+ Add word", actions.onAddWord)
                }
            }
        }
        ui.selected?.let { sel -> item(key = "select-bar") { SelectBar(sel.size, ui, actions) } }
        if (ui.notes.isEmpty()) {
            item(key = "empty") {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    EmptyState("📝", "No words yet", body = "Add vocabulary to this deck", actionLabel = "📋 Paste a list", onAction = actions.onPaste)
                    SecondaryPill("+ Add a word") { actions.onAddWord() }
                }
            }
        } else {
            item(key = "legend") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Reviews:", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                    Spacer(Modifier.width(8.dp))
                    RatingLegend()
                }
            }
            items(ui.notes, key = { it.id }) { row ->
                val selecting = ui.selected != null
                val checked = ui.selected?.contains(row.id) == true
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (checked) Lab.colors.accentSoft else Lab.colors.card)
                        .combinedClickable(
                            onClick = { if (selecting) actions.onToggleSelect(row.id) else actions.onEdit(row.id) },
                            onLongClick = { if (!selecting) actions.onStartSelect(row.id) },
                        )
                        .padding(start = if (selecting) 4.dp else 14.dp, end = 6.dp, top = 10.dp, bottom = 10.dp)
                        .animateItem(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (selecting) {
                        Checkbox(checked = checked, onCheckedChange = { actions.onToggleSelect(row.id) }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
                    }
                    Column(Modifier.weight(1f)) {
                        Text(row.hanzi, fontSize = 21.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(row.pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.accent, maxLines = 1)
                        Text(row.english, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (!row.sentenceClue.isNullOrEmpty()) Text(row.sentenceClue, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Spacer(Modifier.width(6.dp))
                    RatingsGrid(row.ratings)
                    Spacer(Modifier.width(8.dp))
                    Text("${row.mastery}%", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                    if (row.audioUrl != null) {
                        Text(
                            "▶",
                            color = Lab.colors.accent,
                            fontSize = 16.sp,
                            modifier = Modifier.padding(start = 2.dp).size(44.dp).clip(CircleShape).clickable { actions.onPlay(row) }.padding(top = 12.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    } else {
                        Text("🔇", fontSize = 13.sp, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 14.dp))
                    }
                }
            }
        }
    }
    if (confirmDelete && deck != null) {
        ConfirmDialog(
            title = "Delete deck?",
            text = "Are you sure you want to delete \"${deck.name}\"? This will delete all ${ui.notes.size} notes and their cards. This action cannot be undone.",
            confirmLabel = "Delete deck",
            danger = true,
            onConfirm = actions.onDelete,
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun HeaderLink(label: String, onClick: () -> Unit) {
    Text(
        label,
        color = Lab.colors.accent,
        fontWeight = FontWeight.SemiBold,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 10.dp),
    )
}

@Composable
private fun DeckMenu(ui: DeckUi, actions: DeckActions, onDelete: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Text("⋯", color = Lab.colors.ink, fontSize = 24.sp, modifier = Modifier.clip(CircleShape).clickable { open = true }.padding(horizontal = 14.dp, vertical = 6.dp))
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (ui.tutors.isNotEmpty() && !ui.isTutorAccount) {
                DropdownMenuItem(text = { Text("👩‍🏫 Share with tutor") }, onClick = { open = false; actions.onShareWithTutor() })
            }
            DropdownMenuItem(text = { Text("⚙️ Settings") }, onClick = { open = false; actions.onSettings() })
            if (ui.missingAudio > 0) {
                DropdownMenuItem(
                    text = { Text(ui.audioJob?.let { "🔊 Generating audio (${it.done}/${it.total})…" } ?: "🔊 Generate missing audio (${ui.missingAudio})") },
                    enabled = ui.audioJob == null && ui.online,
                    onClick = { open = false; actions.onGenerateAudio() },
                )
            }
            if (ui.withAudio > 0) {
                DropdownMenuItem(text = { Text("🎙 Regenerate audio…") }, enabled = ui.selected == null && ui.audioJob == null, onClick = { open = false; actions.onRegenerateMode() })
            }
            HorizontalDivider(color = Lab.colors.faint)
            DropdownMenuItem(text = { Text("⬇ Export → Anki (.apkg)") }, onClick = { open = false; actions.onExportAnki() })
            HorizontalDivider(color = Lab.colors.faint)
            DropdownMenuItem(text = { Text("🗑 Delete deck", color = Palette.Again) }, onClick = { open = false; onDelete() })
        }
    }
}

@Composable
private fun SelectBar(count: Int, ui: DeckUi, actions: DeckActions) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Easy.copy(alpha = 0.1f)).border(1.dp, Palette.Easy.copy(alpha = 0.6f), RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$count selected", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            HeaderLink("Select all (${ui.notes.size})", actions.onSelectAll)
            HeaderLink("Cancel", actions.onEndSelect)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryPill("↪ Move ($count)", Modifier.weight(1f).height(48.dp), enabled = count > 0) { actions.onMoveSelected() }
            val withAudio = ui.notes.count { it.id in ui.selected.orEmpty() && it.audioUrl != null }
            SecondaryPill("🎙 Regenerate ($withAudio)", Modifier.weight(1f), enabled = withAudio > 0 && ui.online) { actions.onRegenerateSelected() }
        }
    }
}

/** The web's DeckProgressSummary from local data: seen / mastered and a bar per card type. */
@Composable
fun DeckProgressCard(ui: DeckUi) {
    LabCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Stat("${ui.completion.percentSeen}%", "seen", Modifier.weight(1f))
                Stat("${ui.completion.percentMastered}%", "mastered", Modifier.weight(1f))
                Stat("${ui.completion.total}", "cards", Modifier.weight(1f))
            }
            for (type in DeckStats.CARD_TYPES) {
                val b = ui.breakdown[type] ?: continue
                if (b.total == 0) continue
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(DeckStats.LONG.getValue(type), style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.width(120.dp))
                    Row(Modifier.weight(1f).height(8.dp).clip(RoundedCornerShape(4.dp)).background(Lab.colors.faint)) {
                        for ((n, c) in listOf(b.mastered to Palette.Good, b.familiar to Palette.Easy, b.learning to Palette.Hard)) {
                            if (n > 0) Box(Modifier.weight(n.toFloat()).height(8.dp).background(c))
                        }
                        if (b.new > 0) Box(Modifier.weight(b.new.toFloat()).height(8.dp))
                    }
                    Text("${b.mastered}/${b.total}", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.padding(start = 8.dp).width(44.dp))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for ((label, c) in listOf("Mastered" to Palette.Good, "Familiar" to Palette.Easy, "Learning" to Palette.Hard, "New" to Lab.colors.faint)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(c))
                        Text(" $label", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                    }
                }
            }
        }
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(value, style = MaterialTheme.typography.headlineSmall, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
    }
}

// ---------------- settings ----------------

@Composable
fun DeckSettingsSheet(ui: DeckUi, onSave: (String, String, String, String) -> Unit, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss, title = "Deck settings") { DeckSettingsForm(ui, onSave, onDismiss) }
}

/** Name, description and the deck's two daily caps (validated like pickDeckSettings before saving). */
@Composable
fun DeckSettingsForm(ui: DeckUi, onSave: (String, String, String, String) -> Unit, onDismiss: () -> Unit) {
    val d = ui.deck ?: return
    var name by remember(d.id) { mutableStateOf(d.name) }
    var description by remember(d.id) { mutableStateOf(d.description.orEmpty()) }
    var newPerDay by remember(d.id) { mutableStateOf(d.newPerDay.toString()) }
    var secondary by remember(d.id) { mutableStateOf((d.secondaryPerDay ?: dev.jeromeswannack.chineselearning.lab.core.DeckSettings.DEFAULT_SECONDARY_PER_DAY).toString()) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ui.settingsError?.let { InlineNotice(it, kind = NoticeKind.Error) }
        Field("Deck name", name) { name = it }
        Field("Description (optional)", description, lines = 2) { description = it }
        Text(
            "Cards are scheduled with FSRS: each card tracks how stable your memory of it is and how hard it is, and the next review lands just before you'd forget. " +
                "Your account has ONE daily budget of new cards (Settings → New cards a day); these two numbers cap how much of it this deck may take.",
            style = MaterialTheme.typography.bodySmall,
            color = Lab.colors.muted,
        )
        Field("New cards per day", newPerDay, hint = "0–1000") { newPerDay = it }
        Text("Maximum new words introduced from this deck each day. Set to 0 to only review.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        Field("Secondary cards per day", secondary, hint = "0–1000") { secondary = it }
        Text("Extra new cards (purple) for words you've already started — e.g. typing a word you can already say.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 4.dp)) {
            SecondaryPill("Cancel", Modifier.weight(1f)) { onDismiss() }
            PrimaryPill(if (ui.busy) "Saving…" else "Save", Modifier.weight(1f).height(52.dp), enabled = !ui.busy && name.isNotBlank()) { onSave(name, description, newPerDay, secondary) }
        }
    }
}
