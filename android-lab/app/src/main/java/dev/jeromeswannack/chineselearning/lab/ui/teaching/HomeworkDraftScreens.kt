package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkRemoval
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabToast
import dev.jeromeswannack.chineselearning.lab.data.api.DraftPlanDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftPlanItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftViewDto
import dev.jeromeswannack.chineselearning.lab.data.api.DraftWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonNotesEntryDto
import dev.jeromeswannack.chineselearning.lab.data.api.SessionJobDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.StickyFooter
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.LocalDate

// ---------------- pure rules (unit-tested) ----------------

/** The entry's title: its own, else the first line of the notes (≤ 60 chars) — web: entryTitle. */
fun entryTitle(e: LessonNotesEntryDto): String {
    e.title?.takeIf { it.isNotBlank() }?.let { return it }
    val first = (e.notes ?: "").lines().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: "Lesson"
    return if (first.length > 60) first.take(59) + "…" else first
}

/** A session-notes job's title (web: SessionNotesJobCard jobTitle). */
fun jobTitle(job: SessionJobDto): String {
    job.title?.takeIf { it.isNotBlank() }?.let { return it }
    job.result.deck?.name?.let { return it }
    val first = job.notes.lines().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: "Session notes"
    return if (first.length > 60) first.take(59) + "…" else first
}

/** "words: one-off + long-term · lesson: one-off" under the Assign button. */
fun assignSummary(items: List<DraftPlanItemDto>): String = items.joinToString(" · ") { i ->
    val what = if (i.kind == "deck") "words" else i.kind
    when (i.mode) {
        "fsrs" -> "$what: long-term"
        "both" -> "$what: one-off + long-term"
        else -> "$what: one-off"
    }
}

/** Items the Assign button counts: included, and a deck only when it kept any words. */
fun includedItems(view: DraftViewDto): List<DraftPlanItemDto> = view.plan.items.filter { it.include && (it.kind != "deck" || view.kept_count > 0) }

// ---------------- lesson notes section (on the student page) ----------------

data class LessonNotesActions(
    val add: () -> Unit = {},
    val draft: (LessonNotesEntryDto) -> Unit = {},
    val openDraft: (String) -> Unit = {},
    val open: (String) -> Unit = {},
)

/** "📝 Lesson notes" (web: LessonNotesSection.tsx): each lesson and its homework state, one fitting action. */
@Composable
fun LessonNotesSection(relId: String, studentName: String, entries: List<LessonNotesEntryDto>?, error: String?, drafting: String?, actions: LessonNotesActions, now: Instant = Instant.now()) {
    var showAll by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("📝 Lesson notes") { TeachButton("+ Add lesson notes", primary = true, onClick = actions.add) }
        if (entries == null && error != null) MutedLine("Could not load the lesson notes")
        if (entries != null && entries.isEmpty()) {
            TeachCard {
                MutedLine("After a lesson, add your notes here. The assistant drafts homework for $studentName from them — words, and a mini lesson when you taught a structure — and you review it (with Claude, if you like) before anything is sent.")
            }
        }
        val list = entries.orEmpty()
        (if (showAll) list else list.take(4)).forEach { e ->
            TeachCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MutedLine(TeachingFormat.shortDate(e.lesson_at, now))
                    Spacer(Modifier.width(10.dp))
                    Text(entryTitle(e), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                }
                EntryState(relId, e, drafting == e.id, actions, now)
            }
        }
        if (!showAll && list.size > 4) InlineButton("All lesson notes (${list.size})") { showAll = true }
        InlineButton("Older session-notes jobs ›") { actions.open(Routes.sessionNotes(relId)) }
    }
}

@Composable
private fun EntryState(relId: String, e: LessonNotesEntryDto, drafting: Boolean, actions: LessonNotesActions, now: Instant) {
    val job = e.job
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        when {
            job == null -> {
                MutedLine("No homework yet", Modifier.weight(1f))
                TeachButton(if (drafting) "Starting…" else "✨ Draft homework", enabled = !drafting && !e.notes.isNullOrBlank()) { actions.draft(e) }
            }
            job.status == "queued" || job.status == "running" -> {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Pulse()
                    Spacer(Modifier.width(8.dp))
                    Text("Drafting… ${job.progress ?: ""}", style = MaterialTheme.typography.bodySmall, color = Palette.Secondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                TeachButton("Open") { actions.openDraft(job.id) }
            }
            job.status == "failed" || job.status == "cancelled" -> {
                Text(if (job.status == "failed") "Draft failed" else "Cancelled", color = Palette.Again, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                TeachButton("Open") { actions.openDraft(job.id) }
            }
            !job.review -> {
                MutedLine("Sent automatically", Modifier.weight(1f))
                // Take it back from the job card (web: "What was sent · undo ›").
                InlineButton("What was sent · undo ›") { actions.open(Routes.sessionNotes(relId)) }
            }
            job.assigned_at != null -> {
                Text("✓ Assigned ${TeachingFormat.shortDate(job.assigned_at, now)}", color = Palette.Good, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                InlineButton("View") { actions.openDraft(job.id) }
            }
            else -> {
                Text("Draft ready", color = Palette.Easy, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                TeachButton("Review", primary = true) { actions.openDraft(job.id) }
            }
        }
    }
}

/** A soft pulsing dot for "the assistant is working". */
@Composable
fun Pulse(color: Color = Palette.Secondary) {
    val t = rememberInfiniteTransition(label = "pulse")
    val a by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "a")
    Box(Modifier.size(10.dp).alpha(a).clip(CircleShape).background(color))
}

/** Add lesson notes: title, date, notes, "draft homework from these notes" (web: LessonNotesSheet). */
@Composable
fun LessonNotesSheet(studentName: String, online: Boolean, save: (notes: String, title: String?, lessonAt: String, draft: Boolean, (String?) -> Unit) -> Unit, onDismiss: () -> Unit) {
    LabSheetFrame(onDismiss = onDismiss) {
        LessonNotesForm(online, save, title = "Lesson notes for $studentName", onDismiss = onDismiss)
    }
}

@Composable
fun LessonNotesForm(online: Boolean, save: (String, String?, String, Boolean, (String?) -> Unit) -> Unit, title: String? = null, modifier: Modifier = Modifier, onDismiss: () -> Unit) {
    val sheetTitle = title
    val today = LocalDate.now().toString()
    var title by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var lessonAt by remember { mutableStateOf(today) }
    var draft by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    val chars = notes.trim().length
    val tooShort = if (draft) chars < 20 else chars == 0
    SheetScaffold(
        modifier,
        header = sheetTitle?.let { t -> { SheetTitle(t) } },
        footerAbove = if (error == null && online) null else {
            {
                error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                if (!online) InlineNotice("You're offline — the notes can be saved once you're back online.", kind = NoticeKind.Offline)
            }
        },
        footer = {
            TeachButton("Cancel", Modifier.weight(1f).height(52.dp), onClick = onDismiss)
            TeachButton(if (saving) "Saving…" else if (draft) "Save & draft homework" else "Save notes", Modifier.weight(1.4f).height(52.dp), primary = true, enabled = !tooShort && !saving && online) {
                saving = true; error = null
                save(notes.trim(), title.trim().ifEmpty { null }, lessonAt, draft) { e -> saving = false; error = e }
            }
        },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(title, { if (it.length <= 120) title = it }, Modifier.weight(1f), label = { Text("Title (optional)") }, placeholder = { Text("Restaurant ordering") }, singleLine = true)
            InlineButton(TutorPageFormat.day(lessonAt)) { picking = true }
        }
        OutlinedTextField(
            notes, { notes = it }, Modifier.fillMaxWidth().heightIn(min = 180.dp), label = { Text("Notes") },
            placeholder = { Text("Any format, e.g.\n今天复习了点菜。新词：菜单 càidān menu, 服务员 fúwùyuán waiter…\n把 sentences: 把门关上。把书放在桌子上。") },
        )
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable { draft = !draft }, verticalAlignment = Alignment.CenterVertically) {
            Checkbox(draft, { draft = it }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
            Text("Draft homework from these notes — you review it before anything is sent", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
        }
    }
    if (picking) DatePickerSheet(lessonAt, null, { picking = false; lessonAt = minOf(it, today) }, { picking = false })
}

// ---------------- homework draft review ----------------

val CHAT_SUGGESTIONS = listOf("Drop the words they already find easy", "Split the words over two days", "Add a short listening lesson", "Make the example sentences simpler")

data class DraftUi(
    val relId: String,
    val view: DraftViewDto? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val assignedNote: String? = null,
    val assigning: Boolean = false,
    val sending: Boolean = false,
    val chatError: String? = null,
    val online: Boolean = true,
)

data class DraftActions(
    val back: () -> Unit = {},
    val open: (String) -> Unit = {},
    val updatePlan: (DraftPlanDto) -> Unit = {},
    val removeWord: (DraftWordDto) -> Unit = {},
    val assign: () -> Unit = {},
    val cancelJob: () -> Unit = {},
    val retryJob: () -> Unit = {},
    val send: (String, () -> Unit) -> Unit = { _, done -> done() },
    val retry: () -> Unit = {},
)

/**
 * Review a homework DRAFT made from lesson notes (web: pages/tutor/HomeworkDraftPage.tsx):
 * load now → after, the words (the ones they have are skipped, "Include anyway"), each
 * item's mode / due date / split, a Claude chat that edits the same draft, then Assign.
 * Phone: Draft / Claude tabs; unfolded: side by side.
 */
@Composable
fun HomeworkDraftScreen(ui: DraftUi, actions: DraftActions, now: Instant = Instant.now(), initialTab: Int = 0) {
    var tab by remember { mutableStateOf(initialTab) }
    val view = ui.view
    Box(
        Modifier.fillMaxSize().background(Lab.colors.background)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)).imePadding(),
        contentAlignment = Alignment.TopCenter,
    ) {
        BoxWithConstraints(Modifier.fillMaxSize().widthIn(max = 1180.dp)) {
            val wide = maxWidth >= 840.dp
            Column(Modifier.fillMaxSize()) {
                val job = view?.job
                ScreenTitle(
                    "Homework draft",
                    subtitle = if (job == null) null else (job.title ?: job.result.deck?.name ?: "Lesson notes") +
                        (job.lesson_at?.let { " · lesson ${TeachingFormat.shortDate(it, now)}" } ?: "") +
                        if (job.assigned_at != null) "" else " · nothing is sent until you assign it",
                    onBack = actions.back,
                )
                val pad = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 28.dp)
                when {
                    view == null && ui.loading -> LoadingState()
                    view == null -> Box(Modifier.padding(20.dp)) { InlineNotice(ui.error ?: "Draft not found", kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.retry) }
                    wide -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1.3f).fillMaxHeight()) {
                            val listState = rememberLazyListState()
                            LazyColumn(Modifier.weight(1f), state = listState, contentPadding = pad, verticalArrangement = Arrangement.spacedBy(12.dp)) { draftColumn(ui, view, actions, now) }
                            AssignBar(ui, view, actions, listState.canScrollForward)
                        }
                        Box(Modifier.weight(1f).padding(end = 20.dp, bottom = 20.dp)) { DraftChat(ui, view, actions) }
                    }
                    else -> Column(Modifier.fillMaxSize()) {
                        Row(Modifier.padding(horizontal = 20.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(4.dp)) {
                            listOf("Draft", "✨ Claude" + if (view.job.chat.size > 1) " (${view.job.chat.size})" else "").forEachIndexed { i, label ->
                                Text(
                                    label, color = if (tab == i) Lab.colors.ink else Lab.colors.muted, fontWeight = if (tab == i) FontWeight.SemiBold else FontWeight.Normal,
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                    modifier = Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(11.dp)).background(if (tab == i) Lab.colors.card else Color.Transparent).bouncyClickable { tab = i }.padding(vertical = 12.dp),
                                )
                            }
                        }
                        if (tab == 0) {
                            val listState = rememberLazyListState()
                            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = pad, verticalArrangement = Arrangement.spacedBy(12.dp)) { draftColumn(ui, view, actions, now) }
                            AssignBar(ui, view, actions, listState.canScrollForward)
                        } else Box(Modifier.fillMaxSize().padding(20.dp)) { DraftChat(ui, view, actions) }
                    }
                }
            }
        }
    }
}

private fun LazyListScope.draftColumn(ui: DraftUi, view: DraftViewDto, actions: DraftActions, now: Instant) {
    val job = view.job
    val plan = view.plan
    val working = view.working
    val assigned = job.assigned_at != null
    val locked = working || assigned
    fun update(p: DraftPlanDto) = actions.updatePlan(p)
    fun updateItem(key: String, f: (DraftPlanItemDto) -> DraftPlanItemDto) = update(plan.copy(items = plan.items.map { if (it.key == key) f(it) else it }))
    val today = LocalDate.now().toString()

    if (working) item(key = "working") {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Secondary.copy(alpha = 0.1f)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Pulse(); Spacer(Modifier.width(8.dp)); Text(job.progress ?: "The assistant is working on the draft…", color = Lab.colors.ink, modifier = Modifier.weight(1f)) }
            job.steps.takeLast(3).forEach { MutedLine("· ${it.text}") }
            InlineButton("Cancel", danger = true, onClick = actions.cancelJob)
        }
    }
    if (job.status == "failed") item(key = "failed") { InlineNotice("Failed: ${job.error ?: ""}", kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.retryJob) }
    if (assigned) item(key = "assigned") {
        InlineNotice("✓ Assigned ${TeachingFormat.shortDate(job.assigned_at, now)} · ${TeachingFormat.plural(view.assignments.size, "assignment")}. It reaches their homework list with their next sync.", kind = NoticeKind.Success)
    }
    ui.assignedNote?.let { item(key = "note") { InlineNotice(it, kind = NoticeKind.Success) } }
    ui.error?.let { item(key = "err") { InlineNotice(it, kind = NoticeKind.Error) } }
    item(key = "load") { LoadGauge(view.load, view.student_name, after = if (assigned) null else view.load_after) }
    if (!job.result.summary.isNullOrBlank() && !working) item(key = "summary") { MarkdownText(job.result.summary!!, style = MaterialTheme.typography.bodyMedium) }

    plan.items.forEach { it0 ->
        item(key = "item-${it0.key}") {
            TeachCard(Modifier.animateContentSize()) {
                if (it0.kind == "deck") {
                    val kept = view.words.filter { !it.skipped }
                    val skipped = view.words.filter { it.skipped }
                    val forced = view.words.filter { it.known != null && !it.skipped }
                    ItemHead("📚 Words (${kept.size})", it0.include, locked, { inc -> updateItem(it0.key) { i -> i.copy(include = inc) } }, "Edit deck") { actions.open(Routes.deck(it0.source_id)) }
                    kept.forEach { w -> WordLine(w, if (w in forced) "they have it" else null, if (locked) null else ({ actions.removeWord(w) })) }
                    if (skipped.isNotEmpty()) {
                        Text("Skipped ${TeachingFormat.plural(skipped.size, "word")} ${view.student_name} already has", style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted)
                        skipped.forEach { w ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(w.hanzi, fontSize = 20.sp, color = Lab.colors.muted)
                                Spacer(Modifier.width(10.dp))
                                MutedLine(w.known?.let { "in ${it.deck_name} · ${it.state}" } ?: "twice in the draft", Modifier.weight(1f))
                                if (w.known != null && !locked) InlineButton("Include anyway") { update(plan.copy(include_known = plan.include_known + w.hanzi)) }
                            }
                        }
                    }
                    if (forced.isNotEmpty() && !locked) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            MutedLine("Sending anyway: ${forced.joinToString("、") { it.hanzi }}", Modifier.weight(1f))
                            InlineButton("skip them again") { update(plan.copy(include_known = emptyList())) }
                        }
                    }
                    if (it0.include) Column(Modifier.alpha(if (locked) 0.5f else 1f)) {
                        ModePicker(
                            modeOf(it0.mode), { m -> if (!locked) updateItem(it0.key) { i -> i.copy(mode = m.wire) } },
                            it0.due_date ?: today, { d -> if (!locked) updateItem(it0.key) { i -> i.copy(due_date = d) } },
                            today, kept.size, plan.split_days,
                        ) { d -> if (!locked) update(plan.copy(split_days = d)) }
                        if (modeOf(it0.mode).hasFsrs) {
                            Spacer(Modifier.height(8.dp))
                            MutedLine("Long-term copy goes to")
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OptionTile("Top of their queue", "Core", plan.priority == "core", Modifier.weight(1f)) { if (!locked) update(plan.copy(priority = "core")) }
                                OptionTile("Bottom of their queue", "Non-urgent", plan.priority == "non_urgent", Modifier.weight(1f)) { if (!locked) update(plan.copy(priority = "non_urgent")) }
                            }
                        }
                    }
                } else {
                    val lesson = if (it0.kind == "lesson") job.result.lessons.firstOrNull { "lesson:${it.library_item_id}" == it0.key } else null
                    ItemHead("${if (it0.kind == "lesson") "🎓" else "📖"} ${it0.title}", it0.include, locked, { inc -> updateItem(it0.key) { i -> i.copy(include = inc) } }, "Edit") {
                        actions.open(if (it0.kind == "lesson") Routes.libraryEdit(it0.source_id) else Routes.readerEdit(it0.source_id))
                    }
                    if (lesson != null) MutedLine("Mini lesson · ${TeachingFormat.plural(lesson.exercise_count, "exercise")}")
                    if (it0.include) Column(Modifier.alpha(if (locked) 0.5f else 1f)) {
                        ModePicker(modeOf(it0.mode), { m -> if (!locked) updateItem(it0.key) { i -> i.copy(mode = m.wire) } }, it0.due_date ?: today, { d -> if (!locked) updateItem(it0.key) { i -> i.copy(due_date = d) } }, today, null, 1) {}
                    }
                }
            }
        }
    }
    if (plan.items.isEmpty() && !working) item(key = "empty") { MutedLine("This draft has nothing in it yet — ask Claude, or write the notes again.") }
}

/** "Assign N items" pinned under the draft (StickyFooter): the word list can be long. */
@Composable
private fun AssignBar(ui: DraftUi, view: DraftViewDto, actions: DraftActions, moreAbove: Boolean) {
    if (view.job.assigned_at != null) return
    val locked = view.working
    val included = includedItems(view)
    StickyFooter(moreAbove = moreAbove, color = Lab.colors.background, above = { MutedLine(assignSummary(included)) }) {
        PrimaryPill(if (ui.assigning) "Assigning…" else "Assign ${TeachingFormat.plural(included.size, "item")}", Modifier.weight(1f).height(56.dp), enabled = !locked && !ui.assigning && included.isNotEmpty() && ui.online, onClick = actions.assign)
    }
}

private fun modeOf(wire: String) = HomeworkMode.entries.firstOrNull { it.wire == wire } ?: HomeworkMode.ONE_OFF

@Composable
private fun ItemHead(title: String, include: Boolean, locked: Boolean, onInclude: (Boolean) -> Unit, editLabel: String, onEdit: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(include, { if (!locked) onInclude(it) }, enabled = !locked, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        InlineButton(editLabel, onClick = onEdit)
    }
}

@Composable
private fun WordLine(w: DraftWordDto, tag: String?, onRemove: (() -> Unit)?) {
    var confirm by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(w.hanzi, fontSize = 20.sp, color = Lab.colors.ink, modifier = Modifier.widthIn(min = 56.dp))
        Spacer(Modifier.width(8.dp))
        Text("${w.pinyin} · ${w.english}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (tag != null) TeachPill(tag, PillTone.Muted)
        if (onRemove != null) Text("×", fontSize = 22.sp, color = Lab.colors.muted, modifier = Modifier.heightIn(min = 40.dp).bouncyClickable { confirm = true }.padding(horizontal = 12.dp, vertical = 6.dp))
    }
    if (confirm && onRemove != null) ConfirmDialog("Remove ${w.hanzi} from the draft?", "It is deleted from the draft deck.", "Remove", onConfirm = onRemove, onDismiss = { confirm = false }, danger = true)
}

@Composable
private fun DraftChat(ui: DraftUi, view: DraftViewDto, actions: DraftActions) {
    var text by remember { mutableStateOf("") }
    val working = view.working
    val assigned = view.job.assigned_at != null
    val disabled = working || assigned || ui.sending || !ui.online
    Column(Modifier.fillMaxSize().clip(RoundedCornerShape(20.dp)).background(Lab.colors.card).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("✨ Ask Claude to change the draft", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp), reverseLayout = false) {
            if (view.job.chat.isEmpty()) item { MutedLine("Claude made this draft from your notes. Ask for changes in plain words.") }
            view.job.chat.forEach { m ->
                item {
                    val tutor = m.role == "tutor"
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (tutor) Arrangement.End else Arrangement.Start) {
                        Text(
                            m.text, color = if (tutor) Color.White else Lab.colors.ink, style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(16.dp)).background(if (tutor) Lab.colors.accent else Lab.colors.faint).padding(horizontal = 12.dp, vertical = 9.dp),
                        )
                    }
                }
            }
            if (working) item { Row(verticalAlignment = Alignment.CenterVertically) { Pulse(); Spacer(Modifier.width(8.dp)); MutedLine(view.job.progress ?: "Working…") } }
        }
        if (!assigned) {
            ChipRow { CHAT_SUGGESTIONS.forEach { s -> LabChip(s, enabled = !disabled) { actions.send(s) {} } } }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(text, { text = it }, Modifier.weight(1f), enabled = !disabled, placeholder = { Text("e.g. drop the food words, split into two days, add a listening lesson") }, maxLines = 4)
                TeachButton("Send", primary = true, enabled = !disabled && text.isNotBlank()) { actions.send(text.trim()) { text = "" } }
            }
        }
        ui.chatError?.let { InlineNotice(it, kind = NoticeKind.Error) }
    }
}

// ---------------- session-notes jobs ----------------

private val STEP_ICON = mapOf("info" to "·", "tool" to "✓", "warn" to "!", "done" to "✓", "error" to "✕")
private val STATUS_LABEL = mapOf("queued" to "Queued", "running" to "Working…", "done" to "Done", "failed" to "Failed", "cancelled" to "Cancelled")

data class JobActions(
    val retry: (SessionJobDto) -> Unit = {},
    val cancel: (SessionJobDto) -> Unit = {},
    val delete: (SessionJobDto) -> Unit = {},
    val open: (String) -> Unit = {},
    /** "Undo — remove from Jerome" on what the job sent; null hides it (a page without the confirm sheet). */
    val remove: ((RemovalTarget) -> Unit)? = null,
)

/** One session-notes job: live progress, what it made, Retry / Cancel / Delete (web: SessionNotesJobCard). */
@Composable
fun SessionJobCard(job: SessionJobDto, actions: JobActions, now: Instant = Instant.now(), studentName: String? = null) {
    var showSteps by remember { mutableStateOf(false) }
    var showNotes by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val active = job.active
    TeachCard(Modifier.animateContentSize()) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(jobTitle(job), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                MutedLine(
                    (job.lesson_at?.let { "Lesson ${TeachingFormat.shortDate(it, now)} · " } ?: "") +
                        "sent ${TeachingFormat.shortDateTime(job.created_at, now)} · ${"%,d".format(job.notes_chars)} characters" +
                        if (job.source_call_id != null) " · 🎥 from a video lesson" else "",
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (active) { Pulse(); Spacer(Modifier.width(6.dp)) }
                TeachPill(STATUS_LABEL[job.status] ?: job.status, when (job.status) { "done" -> PillTone.Ok; "failed" -> PillTone.Flags; "cancelled" -> PillTone.Muted; else -> PillTone.Recordings })
            }
        }
        if (active && job.progress != null) Text(job.progress, style = MaterialTheme.typography.bodyMedium, color = Palette.Secondary)
        if (job.status == "failed" && job.error != null) InlineNotice("Failed: ${job.error}", kind = NoticeKind.Error)
        val steps = job.steps
        if ((active || showSteps || job.status != "done") && steps.isNotEmpty()) {
            val visible = if (active && !showSteps) steps.takeLast(4) else steps
            if (steps.size > visible.size) InlineButton(TeachingFormat.plural(steps.size - visible.size, "earlier step")) { showSteps = true }
            visible.forEach { s ->
                Row {
                    Text(STEP_ICON[s.kind] ?: "·", color = when (s.kind) { "error" -> Palette.Again; "warn" -> Palette.Hard; "info" -> Lab.colors.muted; else -> Palette.Good }, modifier = Modifier.width(18.dp))
                    Text(s.text, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink)
                }
            }
        }
        if (job.status == "done") {
            val r = job.result
            if (r.deck == null && r.lessons.isEmpty() && r.reader == null) MutedLine("Nothing was created from these notes.")
            // Take it back: "Undo — remove from Jerome" while it is with the student, "removed from Jerome" after.
            val first = HomeworkRemoval.studentFirstName(studentName)
            val undo = HomeworkRemoval.removalUndoLabel(studentName)
            fun undoFor(target: RemovalTarget?): (() -> Unit)? = if (target != null && actions.remove != null) ({ actions.remove.invoke(target) }) else null
            r.deck?.let { d ->
                MadeRow(
                    "📚", "${d.name} · ${TeachingFormat.plural(d.note_count, "card")}", d.target_deck_id != null, "sent to student", "in your library, not sent",
                    removed = d.removed_at != null, removedLabel = "removed from $first", undoLabel = undo,
                    onUndo = undoFor(d.target_deck_id?.takeIf { d.removed_at == null }?.let { RemovalTarget(HomeworkRemoval.DECK, it, d.name) }),
                ) { actions.open(Routes.deck(d.id)) }
            }
            r.lessons.forEach { l ->
                MadeRow(
                    "📘", "${l.title} · mini lesson, ${TeachingFormat.plural(l.exercise_count, "exercise")}", l.lesson_id != null, "assigned", "in your library, not assigned",
                    removed = l.removed_at != null, removedLabel = "removed from $first", undoLabel = undo,
                    onUndo = undoFor(l.lesson_id?.takeIf { l.removed_at == null }?.let { RemovalTarget(HomeworkRemoval.LESSON, it, l.title) }),
                ) { actions.open(Routes.libraryItem(l.library_item_id)) }
            }
            r.reader?.let { rd ->
                MadeRow(
                    "📖", "${rd.title_english} · reader, ${TeachingFormat.plural(rd.page_count, "page")}", rd.target_reader_id != null, "sent to student", "in your readers, not sent",
                    removed = rd.removed_at != null, removedLabel = "removed from $first", undoLabel = undo,
                    onUndo = undoFor(rd.target_reader_id?.takeIf { rd.removed_at == null }?.let { RemovalTarget(HomeworkRemoval.READER, it, rd.title_chinese.ifEmpty { rd.title_english }) }),
                ) { actions.open(Routes.readerEdit(rd.id)) }
            }
            r.summary?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink) }
            if (r.skipped.isNotEmpty()) MutedLine("${TeachingFormat.plural(r.skipped.size, "word")} left out: ${r.skipped.joinToString("; ")}")
        }
        ChipRow {
            if (job.status == "done" && steps.isNotEmpty()) InlineButton(if (showSteps) "Hide steps" else "What it did (${steps.size})") { showSteps = !showSteps }
            InlineButton(if (showNotes) "Hide notes" else if (job.source_call_id != null) "Show transcript" else "Show notes") { showNotes = !showNotes }
            if (active) InlineButton("Cancel", danger = true) { actions.cancel(job) }
            if (job.status == "failed" || job.status == "cancelled") InlineButton("Retry") { actions.retry(job) }
            if (!active) InlineButton("Delete", danger = true) { confirmDelete = true }
        }
        if (showNotes) Text(job.notes, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.background).padding(10.dp))
    }
    if (confirmDelete) ConfirmDialog("Forget this job?", "Anything it created stays in your library.", "Delete", onConfirm = { actions.delete(job) }, onDismiss = { confirmDelete = false }, danger = true)
}

@Composable
private fun MadeRow(
    icon: String,
    text: String,
    sent: Boolean,
    sentLabel: String,
    unsentLabel: String,
    removed: Boolean = false,
    removedLabel: String = "",
    undoLabel: String = "",
    onUndo: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    Column {
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).bouncyClickable(pressedScale = 0.98f, onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
            Text(icon, fontSize = 18.sp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent, fontWeight = FontWeight.Medium)
                Text(
                    when { removed -> removedLabel; sent -> sentLabel; else -> unsentLabel },
                    style = MaterialTheme.typography.bodySmall, color = if (sent && !removed) Palette.Good else Lab.colors.muted,
                )
            }
        }
        if (sent && !removed && onUndo != null) Row(Modifier.padding(start = 28.dp)) { InlineButton(undoLabel, danger = true, onClick = onUndo) }
    }
}

data class SessionNotesUi(
    val relId: String,
    val studentName: String,
    val jobs: List<SessionJobDto>? = null,
    val error: String? = null,
    val online: Boolean = true,
    /** The "Undo — remove from Jerome" confirm sheet while open, and the toast after. */
    val removal: RemovalSheetUi? = null,
    val toast: String? = null,
)

/** All session-notes jobs for a student + "Add notes" (web: SessionNotesPage / SessionNotesSection showAll). */
@Composable
fun SessionNotesScreen(
    ui: SessionNotesUi,
    actions: JobActions,
    back: () -> Unit,
    submit: (notes: String, title: String?, lessonAt: String, priority: String, autoShare: Boolean, logLesson: Boolean, (String?) -> Unit) -> Unit,
    now: Instant = Instant.now(),
    removalSheet: RemovalSheetActions = RemovalSheetActions(),
) {
    Box(Modifier.fillMaxSize()) {
        SessionNotesList(ui, actions, back, submit, now)
        LabToast(ui.toast, Modifier.align(Alignment.BottomCenter))
    }
    ui.removal?.let { RemoveHomeworkSheet(it, removalSheet) }
}

@Composable
private fun SessionNotesList(ui: SessionNotesUi, actions: JobActions, back: () -> Unit, submit: (notes: String, title: String?, lessonAt: String, priority: String, autoShare: Boolean, logLesson: Boolean, (String?) -> Unit) -> Unit, now: Instant) {
    var sheet by remember { mutableStateOf(false) }
    val activeCount = ui.jobs.orEmpty().count { it.active }
    LabScreen("Session notes", onBack = back, subtitle = ui.studentName, actions = { TeachButton("+ Add notes", Modifier.padding(end = 12.dp), primary = true) { sheet = true } }) {
        if (activeCount > 0) item { TeachPill("$activeCount working", PillTone.Recordings) }
        when {
            ui.jobs == null && ui.error != null -> item { InlineNotice(ui.error, kind = NoticeKind.Error) }
            ui.jobs == null -> item { LoadingState() }
            ui.jobs.isEmpty() -> item {
                TeachCard { MutedLine("After a lesson, paste your notes here. The assistant turns them into a deck of cards for ${ui.studentName} — and a mini lesson when the notes show a grammar point with examples — then sends them as homework.") }
            }
            else -> ui.jobs.forEach { j -> item(key = j.id) { SessionJobCard(j, actions, now, ui.studentName) } }
        }
    }
    if (sheet) LabSheetFrame(onDismiss = { sheet = false }) { SessionNotesForm(ui.studentName, ui.online, submit, title = "Session notes for ${ui.studentName}") { sheet = false } }
}

@Composable
fun SessionNotesForm(studentName: String, online: Boolean, submit: (String, String?, String, String, Boolean, Boolean, (String?) -> Unit) -> Unit, title: String? = null, modifier: Modifier = Modifier, onDone: () -> Unit) {
    val sheetTitle = title
    val today = LocalDate.now().toString()
    var notes by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var lessonAt by remember { mutableStateOf(today) }
    var priority by remember { mutableStateOf("core") }
    var autoShare by remember { mutableStateOf(true) }
    var logLesson by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    val chars = notes.trim().length
    val tooLong = chars > 120_000
    SheetScaffold(
        modifier,
        header = sheetTitle?.let { t -> { SheetTitle(t) } },
        footerAbove = if (error == null && online) null else {
            {
                error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                if (!online) InlineNotice("You're offline — the notes can be sent once you're back online.", kind = NoticeKind.Offline)
            }
        },
        footer = {
            TeachButton("Cancel", Modifier.weight(1f).height(52.dp), onClick = onDone)
            TeachButton(if (busy) "Sending…" else "Start", Modifier.weight(1f).height(52.dp), primary = true, enabled = chars >= 20 && !tooLong && !busy && online) {
                busy = true; error = null
                submit(notes.trim(), title.trim().ifEmpty { null }, lessonAt, priority, autoShare, logLesson) { e -> busy = false; if (e == null) onDone() else error = e }
            }
        },
    ) {
        OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth().heightIn(min = 180.dp), label = { Text("Notes") }, placeholder = { Text("e.g.\n今天复习了点菜。新词：菜单 càidān menu, 服务员 fúwùyuán waiter…\n把 sentences: 把门关上。把书放在桌子上。\nHe keeps confusing 银行 and 很行…") })
        Text("${"%,d".format(chars)} characters" + if (tooLong) " · max 120,000" else "", style = MaterialTheme.typography.bodySmall, color = if (tooLong) Palette.Again else Lab.colors.muted)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(title, { if (it.length <= 120) title = it }, Modifier.weight(1f), label = { Text("Title (optional)") }, placeholder = { Text("Restaurant ordering") }, singleLine = true)
            InlineButton(TutorPageFormat.day(lessonAt)) { picking = true }
        }
        Text("When it’s ready", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable { autoShare = !autoShare }, verticalAlignment = Alignment.CenterVertically) {
            Checkbox(autoShare, { autoShare = it }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
            Text("Send the deck (and any lesson or reader) to $studentName automatically", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
        }
        if (autoShare) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OptionTile("Core", "top of their queue", priority == "core", Modifier.weight(1f)) { priority = "core" }
            OptionTile("Non-urgent", "after their other decks", priority == "non_urgent", Modifier.weight(1f)) { priority = "non_urgent" }
        } else MutedLine("The deck stays in your library until you send it from Send homework.")
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable { logLesson = !logLesson }, verticalAlignment = Alignment.CenterVertically) {
            Checkbox(logLesson, { logLesson = it }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
            Text("Also log this as a lesson (Insights counts “since last lesson” from it)", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
        }
    }
    if (picking) DatePickerSheet(lessonAt, null, { picking = false; lessonAt = minOf(it, today) }, { picking = false })
}
