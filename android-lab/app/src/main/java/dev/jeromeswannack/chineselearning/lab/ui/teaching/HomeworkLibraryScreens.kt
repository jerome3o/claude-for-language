package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkLibrary
import dev.jeromeswannack.chineselearning.lab.core.HomeworkLinks
import dev.jeromeswannack.chineselearning.lab.core.HomeworkRemoval
import dev.jeromeswannack.chineselearning.lab.core.LibraryItem
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.homework.LinkThumbnail
import dev.jeromeswannack.chineselearning.lab.ui.homework.ProgressBar
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabToast
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant

/*
 * The tutor's homework library (docs/HOMEWORK.md §9; web: pages/tutor/HomeworkLibraryPage.tsx,
 * components/tutor/MostRecentHomework.tsx): every thing she sent — words, lessons, readers,
 * links — with sent date, due date, progress and a status coloured by core HomeworkLibrary
 * (parity-tested). `/connections/:relId/homework` (one student) and `/homework-library` (all).
 */

/** The colour of a status tone (green / blue / amber / red / grey — HomeworkLibrary.statusTone). */
fun toneColor(tone: String): Color = when (tone) {
    "green" -> Palette.Good
    "blue" -> Palette.Easy
    "amber" -> Color(0xFFD97706)
    "red" -> Palette.Again
    else -> Color(0xFF6B7280)
}

/** "Completed" / "In progress" / "Overdue" / "Not started" / "In long-term review" as a tinted pill. */
@Composable
fun LibraryStatusChip(status: String, dueDate: String?, today: String, modifier: Modifier = Modifier) {
    StatusPill(HomeworkLibrary.statusLabel(status), toneColor(HomeworkLibrary.statusTone(status, dueDate, today)), modifier.testTag("hw-status"))
}

data class LibraryFilter(val status: String? = null, val kind: String? = null)

/** Everything the library screen shows. [studentName] null = all students. */
data class HomeworkLibraryUi(
    val studentName: String? = null,
    val state: Loadable<List<LibraryItem>> = Loadable(loading = true),
    val today: String = Homework.localDate(),
    val filter: LibraryFilter = LibraryFilter(),
    /** The row whose action sheet is open. */
    val selected: LibraryItem? = null,
    /** "Change due date" open for this row. */
    val dueFor: LibraryItem? = null,
    /** The edit-link sheet open for this row. */
    val editLink: LibraryItem? = null,
    /** Cancel-a-link confirm open for this row. */
    val cancelLink: LibraryItem? = null,
    /** The row with a write in flight. */
    val busyKey: String? = null,
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    /** Take-back confirm sheet (deck / lesson / reader), from HomeworkRemovalController. */
    val removal: RemovalSheetUi? = null,
    val toast: String? = null,
    val online: Boolean = true,
) {
    val allStudents: Boolean get() = studentName == null
}

class HomeworkLibraryActions(
    val back: () -> Unit = {},
    val setFilter: (LibraryFilter) -> Unit = {},
    val select: (LibraryItem?) -> Unit = {},
    val open: (LibraryItem) -> Unit = {},
    val edit: (LibraryItem) -> Unit = {},
    val updateCopy: (LibraryItem) -> Unit = {},
    val askDue: (LibraryItem?) -> Unit = {},
    val changeDue: (LibraryItem, String) -> Unit = { _, _ -> },
    val remove: (LibraryItem) -> Unit = {},
    val askCancelLink: (LibraryItem?) -> Unit = {},
    val cancelLink: (LibraryItem) -> Unit = {},
    val closeEditLink: () -> Unit = {},
    /** title, url, instructions, update the student's copy → done(error?). */
    val saveLink: (LibraryItem, String, String, String, Boolean, (String?) -> Unit) -> Unit = { _, _, _, _, _, done -> done(null) },
    val refresh: () -> Unit = {},
    val removalSheet: RemovalSheetActions = RemovalSheetActions(),
)

/** "Jerome Swannack" → "Jerome" (core HomeworkRemoval.studentFirstName — the same rule as the take-back words). */
private fun first(name: String?): String = HomeworkRemoval.studentFirstName(name)

/** The library page: filter chips (status with counts, kind), then one row per item. */
@Composable
fun HomeworkLibraryScreen(ui: HomeworkLibraryUi, actions: HomeworkLibraryActions, now: Instant = Instant.now()) {
    Box(Modifier.fillMaxSize()) {
        LabScreen(
            "Homework library",
            onBack = actions.back,
            subtitle = ui.studentName?.let { "Everything you sent $it" } ?: "Everything you sent your students",
        ) {
            val all = ui.state.data.orEmpty()
            item(key = "filters") { LibraryFilters(all, ui.filter, actions.setFilter) }
            if (ui.notice != null) item(key = "notice") { InlineNotice(ui.notice, kind = if (ui.noticeIsError) NoticeKind.Error else NoticeKind.Success) }
            item(key = "list") {
                LoadableContent(
                    ui.state,
                    onRetry = actions.refresh,
                    isEmpty = { it.isEmpty() },
                    empty = {
                        EmptyState("📭", "Nothing sent yet", body = if (ui.allStudents) "Homework you send your students shows up here with their progress." else "Send ${first(ui.studentName)} a deck, a lesson, a reader or a link — it shows up here with their progress.")
                    },
                ) { items ->
                    val shown = HomeworkLibrary.filterLibrary(items, ui.filter.status, ui.filter.kind)
                    if (shown.isEmpty()) {
                        LabCard { Text("Nothing matches these filters.", Modifier.padding(16.dp), color = Lab.colors.muted) }
                    } else {
                        LabCard {
                            shown.forEachIndexed { i, item ->
                                if (i > 0) RowDivider()
                                LibraryRow(item, ui.today, showStudent = ui.allStudents, busy = ui.busyKey == item.key, now = now) { actions.select(item) }
                            }
                        }
                    }
                }
            }
        }
        LabToast(ui.toast, Modifier.align(Alignment.BottomCenter))
    }
    ui.selected?.let { LibraryActionSheet(it, ui, actions) }
    ui.dueFor?.let { item -> DueDateSheet(item, ui.today, onPick = { actions.changeDue(item, it) }, onDismiss = { actions.askDue(null) }) }
    ui.editLink?.let { item -> EditLinkSheet(item, ui.online, actions.saveLink, actions.closeEditLink) }
    ui.cancelLink?.let { item ->
        ConfirmDialog(
            "Cancel “${item.title}”?",
            "${first(item.student_name)} won't see this link in their homework any more.",
            "Cancel link",
            onConfirm = { actions.cancelLink(item) },
            onDismiss = { actions.askCancelLink(null) },
            dismissLabel = "Keep it",
            danger = true,
        )
    }
    ui.removal?.let { RemoveHomeworkSheet(it, actions.removalSheet) }
}

/** Status chips (All / Overdue / In progress / Not started / Completed, with counts) and kind chips. */
@Composable
fun LibraryFilters(items: List<LibraryItem>, filter: LibraryFilter, onChange: (LibraryFilter) -> Unit) {
    val counts = HomeworkLibrary.libraryCounts(items)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ChipRow {
            LabChip("All · ${items.size}", selected = filter.status == null) { onChange(filter.copy(status = null)) }
            HomeworkLibrary.STATUSES.forEach { s ->
                val n = counts[s] ?: 0
                LabChip("${HomeworkLibrary.statusLabel(s)} · $n", selected = filter.status == s, enabled = n > 0 || filter.status == s) {
                    onChange(filter.copy(status = if (filter.status == s) null else s))
                }
            }
        }
        ChipRow {
            LabChip("All kinds", selected = filter.kind == null) { onChange(filter.copy(kind = null)) }
            HomeworkLibrary.KINDS.forEach { k ->
                LabChip("${HomeworkLibrary.kindIcon(k)} ${HomeworkLibrary.kindLabel(k)}", selected = filter.kind == k) {
                    onChange(filter.copy(kind = if (filter.kind == k) null else k))
                }
            }
        }
    }
}

/** "Jerome · Sent 2 Oct · Due tomorrow". */
fun libraryMeta(item: LibraryItem, today: String, showStudent: Boolean, now: Instant = Instant.now()): String = listOfNotNull(
    if (showStudent) first(item.student_name) else null,
    "Sent ${TeachingFormat.shortDate(item.sent_at, now)}",
    when {
        // A long-term deck has no end: its words met instead of a due date (web LibraryRow).
        item.status == HomeworkLibrary.LONG_TERM -> item.progress.ifBlank { null }
        item.status == HomeworkLibrary.COMPLETED && item.due_date == null -> null
        else -> HomeworkLibrary.libraryDueText(item.due_date, today)
    },
).joinToString(" · ")

/** A long-term deck has no end, so it never shows a % (docs/HOMEWORK.md §11). */
fun showsPercent(item: LibraryItem): Boolean = item.status != HomeworkLibrary.LONG_TERM

/** One row: kind icon, title, meta line, progress bar with % and words, status chip; the student's note on a link. */
@Composable
fun LibraryRow(item: LibraryItem, today: String, showStudent: Boolean, busy: Boolean = false, now: Instant = Instant.now(), onClick: () -> Unit) {
    val tone = HomeworkLibrary.statusTone(item.status, item.due_date, today)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).bouncyClickable(enabled = !busy, pressedScale = 0.98f, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp).testTag("hw-library-row"),
        verticalAlignment = Alignment.Top,
    ) {
        Text(HomeworkLibrary.kindIcon(item.kind), fontSize = 22.sp, modifier = Modifier.padding(top = 2.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(item.title.ifEmpty { HomeworkLibrary.kindLabel(item.kind) }, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(libraryMeta(item, today, showStudent, now), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (showsPercent(item)) Row(verticalAlignment = Alignment.CenterVertically) {
                ProgressBar(item.percent / 100f, Modifier.weight(1f), color = toneColor(tone))
                Spacer(Modifier.width(8.dp))
                Text(
                    "${item.percent}%" + (item.progress.takeIf { it.isNotBlank() && item.kind == "deck" }?.let { " · $it" } ?: ""),
                    style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, maxLines = 1,
                )
            }
            if (item.kind == "deck" && item.behind > 0) {
                Text("${TeachingFormat.plural(item.behind, "new word")} not in their copy yet", style = MaterialTheme.typography.bodySmall, color = Lab.colors.accent)
            }
            item.student_note?.takeIf { it.isNotBlank() }?.let { note ->
                Text("“$note” — ${first(item.student_name)}", style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, color = Lab.colors.ink, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
        Spacer(Modifier.width(10.dp))
        LibraryStatusChip(item.status, item.due_date, today)
    }
}

/** What a row's sheet offers (web: the library row menu). Pure so it is unit-tested. */
data class LibraryRowOptions(val canOpen: Boolean, val canEdit: Boolean, val canUpdate: Boolean, val canChangeDue: Boolean, val removeLabel: String)

fun libraryRowOptions(item: LibraryItem): LibraryRowOptions {
    val hasSource = !item.source_id.isNullOrEmpty()
    return LibraryRowOptions(
        canOpen = if (item.kind == "link") !item.url.isNullOrEmpty() else hasSource,
        canEdit = hasSource,
        canUpdate = hasSource,
        canChangeDue = item.due_assignment_id != null && item.status != HomeworkLibrary.COMPLETED,
        removeLabel = if (item.kind == "link") "Cancel this link" else HomeworkRemoval.removalMenuLabel(item.kind, item.student_name),
    )
}

@Composable
private fun LibraryActionSheet(item: LibraryItem, ui: HomeworkLibraryUi, actions: HomeworkLibraryActions) {
    val o = libraryRowOptions(item)
    val dismiss = { actions.select(null) }
    LabBottomSheet(onDismiss = dismiss, title = item.title.ifEmpty { HomeworkLibrary.kindLabel(item.kind) }) {
        Text(
            (
                if (showsPercent(item)) listOf(first(item.student_name), "${item.percent}%", HomeworkLibrary.statusLabel(item.status), HomeworkLibrary.libraryDueText(item.due_date, ui.today))
                else listOf(first(item.student_name), HomeworkLibrary.statusLabel(item.status), item.progress)
            ).filter { it.isNotBlank() }.joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 24.dp),
        )
        Spacer(Modifier.height(4.dp))
        if (!ui.online) InlineNotice("You're offline — changes need a connection.", kind = NoticeKind.Offline, modifier = Modifier.padding(horizontal = 16.dp))
        NavRow(
            HomeworkLibrary.kindIcon(item.kind), if (item.kind == "link") "Open link ↗" else "Open",
            desc = if (item.kind == "link") item.url?.let { HomeworkLinks.linkSiteName(it) } else "Your copy",
            enabled = o.canOpen, onClick = { dismiss(); actions.open(item) },
        )
        NavRow("✏️", "Edit", desc = if (o.canEdit) null else "Your original is gone", enabled = o.canEdit && (ui.online || item.kind != "link"), onClick = { dismiss(); actions.edit(item) })
        NavRow(
            "🔄", "Update their copy",
            desc = if (item.kind == "deck" && item.behind > 0) "+${TeachingFormat.plural(item.behind, "new word")} · their progress is kept" else "Copy your latest edits · their progress is kept",
            enabled = o.canUpdate && ui.online, onClick = { dismiss(); actions.updateCopy(item) },
        )
        if (o.canChangeDue) NavRow("📅", "Change due date", desc = HomeworkLibrary.libraryDueText(item.due_date, ui.today), enabled = ui.online, onClick = { dismiss(); actions.askDue(item) })
        NavRow(
            "🗑️", o.removeLabel, danger = true, enabled = ui.online,
            onClick = { dismiss(); if (item.kind == "link") actions.askCancelLink(item) else actions.remove(item) },
        )
    }
}

/** "Change due date": today / tomorrow / +3 / +7 (dueDateChoices) or a calendar. */
@Composable
fun DueDateSheet(item: LibraryItem, today: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var calendar by remember { mutableStateOf(false) }
    LabBottomSheet(onDismiss = onDismiss, title = "Change due date") {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("${item.title} · now ${HomeworkLibrary.libraryDueText(item.due_date, today).replaceFirstChar { it.lowercase() }}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            ChipRow {
                HomeworkLibrary.dueDateChoices(today).forEachIndexed { i, d ->
                    val label = when (i) { 0 -> "Today"; 1 -> "Tomorrow"; else -> Homework.shortDay(d) }
                    LabChip(label, selected = d == item.due_date) { onPick(d) }
                }
                LabChip("Pick a date…") { calendar = true }
            }
        }
    }
    if (calendar) DatePickerSheet(item.due_date ?: today, today, onPick = { calendar = false; onPick(it) }, onDismiss = { calendar = false })
}

/** Edit a link (title, URL, instructions) with "Also update <name>'s copy" (docs/HOMEWORK.md §10). */
@Composable
fun EditLinkSheet(
    item: LibraryItem,
    online: Boolean,
    save: (LibraryItem, String, String, String, Boolean, (String?) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember { mutableStateOf(item.title) }
    var url by remember { mutableStateOf(item.url.orEmpty()) }
    var instructions by remember { mutableStateOf(item.instructions.orEmpty()) }
    var alsoCopy by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val normalized = HomeworkLinks.normalizeLinkUrl(url)
    LabBottomSheet(onDismiss = { if (!busy) onDismiss() }, title = "Edit link") {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            LinkFields(title, { title = it }, url, { url = it }, instructions, { instructions = it }, enabled = !busy)
            CopyCheckbox("Also update ${first(item.student_name)}'s copy", alsoCopy, enabled = !busy) { alsoCopy = it }
            error?.let { InlineNotice(it, kind = NoticeKind.Error) }
            PrimaryPill(
                if (busy) "Saving…" else "Save", Modifier.fillMaxWidth().height(52.dp),
                enabled = !busy && online && title.isNotBlank() && normalized != null,
            ) {
                busy = true; error = null
                save(item, title.trim(), normalized!!, instructions.trim(), alsoCopy) { e -> busy = false; error = e; if (e == null) onDismiss() }
            }
        }
    }
}

/** Title / URL (with the YouTube preview) / instructions — the send form and the edit sheet. */
@Composable
fun LinkFields(
    title: String, onTitle: (String) -> Unit,
    url: String, onUrl: (String) -> Unit,
    instructions: String, onInstructions: (String) -> Unit,
    enabled: Boolean = true,
    thumbnailPreview: androidx.compose.ui.graphics.ImageBitmap? = null,
) {
    val normalized = HomeworkLinks.normalizeLinkUrl(url)
    OutlinedTextField(
        url, onUrl, Modifier.fillMaxWidth().testTag("link-url"), enabled = enabled, singleLine = true,
        label = { Text("Link") }, placeholder = { Text("https://youtu.be/…") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        isError = url.isNotBlank() && normalized == null,
        supportingText = if (url.isNotBlank() && normalized == null) ({ Text("That isn't a web link (https://…)") }) else normalized?.let { { Text(HomeworkLinks.linkSiteName(it)) } },
    )
    val thumb = normalized?.let { HomeworkLinks.linkThumbnail(it) }
    if (thumb != null) LinkThumbnail(thumb, Modifier.fillMaxWidth(), preview = thumbnailPreview)
    OutlinedTextField(title, onTitle, Modifier.fillMaxWidth().testTag("link-title"), enabled = enabled, singleLine = true, label = { Text("Title") }, placeholder = { Text("e.g. 《小幸运》 — listen and sing along") })
    OutlinedTextField(
        instructions, onInstructions, Modifier.fillMaxWidth().heightIn(min = 96.dp), enabled = enabled,
        label = { Text("Instructions (optional)") }, placeholder = { Text("What should they do? e.g. Watch to 3:20 and write down 5 words you hear.") },
    )
}

/** A checkbox row ("Also update Jerome's copy"). */
@Composable
fun CopyCheckbox(label: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(enabled = enabled, pressedScale = 0.99f) { onChange(!checked) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked, onChange, enabled = enabled, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
        Text(label, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
    }
}

// ---------------- most recent homework (student page, dashboard card) ----------------

/**
 * "Most recent homework" at the top of the student page (web: MostRecentHomework): the newest
 * item and whatever was sent with it (within 30 min, max 3) with %, due text and status colour.
 */
@Composable
fun MostRecentHomeworkCard(items: List<LibraryItem>, today: String, onSeeAll: () -> Unit, onOpen: (LibraryItem) -> Unit = { onSeeAll() }, now: Instant = Instant.now()) {
    val recent = HomeworkLibrary.mostRecentHomework(items)
    TeachCard(Modifier.testTag("hw-recent")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Most recent homework", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            if (recent.isNotEmpty()) Text("Sent ${TeachingFormat.shortDate(recent.first().sent_at, now)}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        if (recent.isEmpty()) MutedLine("Nothing sent yet.")
        recent.forEach { item -> RecentRow(item, today) { onOpen(item) } }
        Text(
            "See all homework ›", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).bouncyClickable(pressedScale = 0.98f, onClick = onSeeAll).padding(vertical = 12.dp).testTag("hw-see-all"),
        )
    }
}

@Composable
private fun RecentRow(item: LibraryItem, today: String, onClick: () -> Unit) {
    val tone = toneColor(HomeworkLibrary.statusTone(item.status, item.due_date, today))
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
            .background(tone.copy(alpha = 0.07f)).bouncyClickable(pressedScale = 0.98f, onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(36.dp).clip(CircleShape).background(tone))
        Spacer(Modifier.width(10.dp))
        Text(HomeworkLibrary.kindIcon(item.kind), fontSize = 20.sp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title.ifEmpty { HomeworkLibrary.kindLabel(item.kind) }, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (showsPercent(item)) "${item.percent}% · ${HomeworkLibrary.libraryDueText(item.due_date, today)}" else "${item.progress} · in their daily review",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1,
            )
        }
        Spacer(Modifier.width(8.dp))
        LibraryStatusChip(item.status, item.due_date, today)
    }
}

/** The dashboard card's one line: "📚 HSK 1 · 40% · In progress" with the status colour (a long-term deck: no %). */
@Composable
fun RecentHomeworkLine(item: LibraryItem, today: String, onClick: () -> Unit) {
    val tone = toneColor(HomeworkLibrary.statusTone(item.status, item.due_date, today))
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).bouncyClickable(pressedScale = 0.98f, onClick = onClick).testTag("hw-recent-line"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(tone))
        Spacer(Modifier.width(10.dp))
        Text(
            "${HomeworkLibrary.kindIcon(item.kind)} ${item.title.ifEmpty { HomeworkLibrary.kindLabel(item.kind) }}",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
        )
        Text(if (showsPercent(item)) " · ${item.percent}% · " else " · ", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, maxLines = 1)
        Text(HomeworkLibrary.statusLabel(item.status), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = tone, maxLines = 1)
    }
}

/** "📋 Homework library" link (dashboard header, student page). */
@Composable
fun HomeworkLibraryLink(desc: String, onClick: () -> Unit) {
    LabCard { NavRow("📋", "Homework library", desc = desc, onClick = onClick) }
}
