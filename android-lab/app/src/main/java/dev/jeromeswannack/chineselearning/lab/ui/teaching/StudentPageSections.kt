package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkPlan
import dev.jeromeswannack.chineselearning.lab.data.api.ActivityDayDto
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.TeachFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeQuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.NeedsAttentionDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipHomeworkDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant
import java.time.LocalDate

// ---------------- needs attention ----------------

/** Wrong characters in red, the ones they got right in normal weight. */
private fun wrongAnswer(typed: String, correct: String) = buildAnnotatedString {
    val t = typed.codePoints().toArray()
    val c = correct.codePoints().toArray()
    t.forEachIndexed { i, cp ->
        val ch = String(Character.toChars(cp))
        if (i < c.size && c[i] == cp) append(ch) else withStyle(SpanStyle(color = Palette.Again, fontWeight = FontWeight.SemiBold)) { append(ch) }
    }
}

private fun describe(item: NeedsAttentionDto) = buildAnnotatedString {
    val parts = mutableListOf<() -> Unit>()
    if (item.again_count > 0) parts += { append(if (item.again_count > 1) "Again ×${item.again_count}" else "Again") }
    else if (item.hard_count > 0) parts += { append(if (item.hard_count > 1) "Hard ×${item.hard_count}" else "Hard") }
    if (item.wrong_answers.isNotEmpty()) parts += {
        append("typed ")
        append(wrongAnswer(item.wrong_answers[0], item.note.hanzi))
        if (item.wrong_answers.size > 1) append(" +${item.wrong_answers.size - 1}")
    }
    if (item.recording != null && parts.isEmpty()) parts += { append("recording waiting") }
    else if (item.recordings_unheard > 1) parts += { append("${item.recordings_unheard} recordings waiting") }
    parts.forEachIndexed { i, p -> if (i > 0) append(" · "); p() }
}

/** Top words of the last 7 days that need the tutor's attention (web: NeedsAttention.tsx). */
@Composable
fun NeedsAttentionCard(
    relId: String,
    items: List<NeedsAttentionDto>,
    unheardTotal: Int,
    playingKey: String?,
    onPlay: (String) -> Unit,
    open: (String) -> Unit,
) {
    TeachCard {
        if (items.isEmpty()) {
            Text(
                "Nothing needs attention this week" + if (unheardTotal > 0) " — ${TeachingFormat.plural(unheardTotal, "recording")} to hear." else ".",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
        }
        items.forEach { item ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).bouncyClickable(pressedScale = 0.98f) { open(Routes.insights(relId)) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(item.note.hanzi, fontSize = 26.sp, color = Lab.colors.ink, modifier = Modifier.widthIn(min = 56.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("${item.note.pinyin} · ${item.note.english}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(describe(item), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
                val rec = item.recording
                if (rec != null) {
                    val playing = playingKey == rec.recording_url
                    InlineButton(if (playing) "🎤 stop" else "🎤 hear") { onPlay(rec.recording_url) }
                } else Text("›", color = Lab.colors.muted, fontSize = 22.sp)
            }
        }
        val toRecordings = unheardTotal > 0 && items.all { it.recording == null }
        Text(
            "All words & recordings →",
            color = Lab.colors.accent, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.heightIn(min = 44.dp).bouncyClickable { open(if (toRecordings) Routes.recordings(relId) else Routes.insights(relId)) }.padding(vertical = 12.dp),
        )
    }
}

// ---------------- getting set up (new student) ----------------

private fun setupAction(key: String, done: Boolean): String? = if (done) null else when (key) {
    "homework" -> "Send homework"
    "installed" -> "Send how-to"
    "first_session" -> "Message"
    else -> null
}

/** Full "Getting set up" + "If they get stuck" for a brand-new student (web: SetupChecklist.tsx). */
@Composable
fun SetupChecklistCard(
    o: StudentOverviewDto,
    howToState: String?,
    onSendHomework: () -> Unit,
    onSendHowTo: () -> Unit,
    onMessage: () -> Unit,
    onShowQr: () -> Unit,
    onCopyLink: (String) -> Unit,
    now: Instant = Instant.now(),
) {
    val setup = o.setup
    TeachCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Getting set up", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            TeachPill("${setup.done_count} of ${setup.steps.size}", PillTone.Setup)
        }
        setup.steps.forEach { step ->
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                CheckBox(step.done)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(step.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = if (step.done) Lab.colors.ink else Lab.colors.ink.copy(alpha = 0.85f))
                    val detail = when {
                        step.key == "signed_in" && step.done -> listOfNotNull(o.student.email, TeachingFormat.shortDate(o.joined_at, now)).filter { it.isNotEmpty() }.joinToString(" · ")
                        step.key == "first_session" && step.done -> step.detail.replace(Regex("(\\d{4}-\\d{2}-\\d{2}T\\S+)")) { TeachingFormat.shortDate(it.value, now) }
                        else -> step.detail
                    }
                    if (detail.isNotEmpty()) MutedLine(detail)
                }
                when (setupAction(step.key, step.done)) {
                    "Send homework" -> InlineButton("Send homework", onClick = onSendHomework)
                    "Send how-to" -> InlineButton(howToState ?: "Send how-to", enabled = howToState == null, onClick = onSendHowTo)
                    "Message" -> InlineButton("Message", onClick = onMessage)
                }
            }
        }
        val audio = setup.audio
        val audioText = if (audio.cached == null) "Audio: not downloaded yet"
        else "Audio: ${minOf(audio.cached, if (audio.total > 0) audio.total else audio.cached)}/${audio.total} clips on their device${if (audio.total > 0 && audio.cached >= audio.total) " ✓" else ""}"
        MutedLine("$audioText · Last opened: ${if (setup.last_opened_at != null) TeachingFormat.relativeTime(setup.last_opened_at, now) else "not yet"}")
    }
    TeachCard {
        Text("If they get stuck", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        val invite = setup.invite
        if (invite != null) {
            var copied by remember { mutableStateOf(false) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TeachButton("Show QR again", Modifier.weight(1f), onClick = onShowQr)
                TeachButton(if (copied) "Copied ✓" else "Copy invite link", Modifier.weight(1f)) { onCopyLink(invite.url); copied = true }
            }
            MutedLine("The link keeps working for this student even after they have signed in — scanning it again just opens the app.")
        } else {
            SecondaryPill("Message", Modifier.fillMaxWidth(), onClick = onMessage)
            MutedLine("This student did not join through one of your invite links. Create a new link from Students → + Invite if they need to sign in on another phone.")
        }
    }
}

// ---------------- flagged cards ----------------

data class FlagActions(
    val reply: (TeachFlagDto, String, (String?) -> Unit) -> Unit = { _, _, done -> done(null) },
    val toggleResolved: (TeachFlagDto, (String?) -> Unit) -> Unit = { _, done -> done(null) },
    val openCard: (String) -> Unit = {},
)

/** "🚩 Flagged cards" on the student page: open ones first, resolved behind a toggle (web: FlaggedCardsSection). */
@Composable
fun FlaggedCardsSection(flags: List<TeachFlagDto>?, error: String?, actions: FlagActions, now: Instant = Instant.now()) {
    val open = flags.orEmpty().filter { it.status == "open" }
    val resolved = flags.orEmpty().filter { it.status != "open" }
    var showResolved by remember { mutableStateOf(false) }
    Column(Modifier.animateContentSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("🚩 Flagged cards" + if (open.isNotEmpty()) " (${open.size})" else "")
        when {
            flags == null && error != null -> MutedLine("Could not load the flagged cards")
            flags == null -> MutedLine("Loading…")
            open.isEmpty() -> TeachCard { MutedLine("Nothing flagged right now. When the student flags a card during study (⋯ → Flag for tutor) it shows up here.") }
            else -> open.forEach { FlagRow(it, actions, now) }
        }
        if (resolved.isNotEmpty()) {
            InlineButton("${if (showResolved) "Hide" else "Show"} ${resolved.size} resolved") { showResolved = !showResolved }
            AnimatedVisibility(showResolved) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { resolved.forEach { FlagRow(it, actions, now) } }
            }
        }
    }
}

@Composable
fun FlagRow(flag: TeachFlagDto, actions: FlagActions, now: Instant = Instant.now(), showCard: Boolean = true) {
    var replying by remember { mutableStateOf(false) }
    var reply by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    TeachCard(Modifier.animateContentSize()) {
        if (showCard) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(pressedScale = 0.98f) { actions.openCard(flag.note_id) }, verticalAlignment = Alignment.CenterVertically) {
                Text(flag.hanzi, fontSize = 24.sp, color = Lab.colors.ink)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(flag.pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                    Text(flag.english, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("›", color = Lab.colors.muted, fontSize = 22.sp)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val (label, tone) = when {
                flag.status == "open" -> "Waiting for a reply" to PillTone.Flags
                flag.tutor_reply != null -> "Replied" to PillTone.Ok
                else -> "Resolved" to PillTone.Muted
            }
            TeachPill(label, tone)
            MutedLine("${flag.student_name ?: "Student"} flagged it ${TeachingFormat.relativeDay(flag.created_at, now)}${if (showCard) " · ${flag.deck_name}" else ""}", Modifier.weight(1f))
        }
        Text(flag.message, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        if (flag.tutor_reply != null) {
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("You replied${flag.replied_at?.let { " " + TeachingFormat.relativeDay(it, now) }.orEmpty()}: ") }
                    append(flag.tutor_reply)
                },
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.accentSoft).padding(10.dp),
            )
        }
        if (error != null) Text(error!!, color = Palette.Again, style = MaterialTheme.typography.bodySmall)
        if (replying) {
            OutlinedTextField(reply, { if (it.length <= 2000) reply = it }, Modifier.fillMaxWidth(), placeholder = { Text("Reply to ${flag.student_name ?: "the student"} — they see it on the back of this card") }, minLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TeachButton("Cancel", Modifier.weight(1f), enabled = !busy) { replying = false }
                PrimaryPill(if (busy) "Sending…" else "Send reply", Modifier.weight(1f).height(48.dp), enabled = !busy && reply.isNotBlank()) {
                    busy = true; error = null
                    actions.reply(flag, reply.trim()) { e -> busy = false; error = e; if (e == null) { replying = false; reply = "" } }
                }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                InlineButton(if (flag.tutor_reply != null) "Reply again" else "Reply", enabled = !busy) { replying = true }
                InlineButton(if (flag.status == "open") "Resolve" else "Reopen", enabled = !busy) {
                    busy = true; error = null
                    actions.toggleResolved(flag) { e -> busy = false; error = e }
                }
            }
        }
    }
}

// ---------------- Asked Claude ----------------

/** One conversation: a card's questions within 30 min of each other (port of groupQuestionThreads). */
data class ClaudeThread(val id: String, val noteId: String, val questions: List<ClaudeQuestionDto>, val lastAt: String)

const val THREAD_GAP_MS = 30 * 60 * 1000L

/** Port of groupQuestionThreads() (shared/chats/threads.ts): newest thread first, questions oldest first. */
fun groupQuestionThreads(rows: List<ClaudeQuestionDto>, gapMs: Long = THREAD_GAP_MS): List<ClaudeThread> {
    fun time(iso: String) = TeachingFormat.parse(iso)?.toEpochMilli() ?: 0L
    val sorted = rows.sortedBy { time(it.asked_at) }
    val open = HashMap<String, Int>()
    val threads = mutableListOf<ClaudeThread>()
    for (row in sorted) {
        val idx = open[row.note_id]
        if (idx != null && time(row.asked_at) - time(threads[idx].lastAt) <= gapMs) {
            val t = threads[idx]
            threads[idx] = t.copy(questions = t.questions + row, lastAt = row.asked_at)
            continue
        }
        open[row.note_id] = threads.size
        threads += ClaudeThread(row.id, row.note_id, listOf(row), row.asked_at)
    }
    return threads.sortedByDescending { time(it.lastAt) }
}

@Composable
fun ClaudeThreadRow(thread: ClaudeThread, onOpenCard: (String) -> Unit, now: Instant = Instant.now(), initiallyOpen: Boolean = false, showCard: Boolean = true) {
    var open by remember { mutableStateOf(initiallyOpen) }
    val first = thread.questions.first()
    TeachCard(Modifier.animateContentSize()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(pressedScale = 0.98f) { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            if (showCard) {
                Text(first.hanzi, fontSize = 22.sp, color = Lab.colors.ink)
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                if (showCard) Text("${first.pinyin} · ${first.english}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                MutedLine("${TeachingFormat.relativeDay(thread.lastAt, now)} · ${TeachingFormat.plural(thread.questions.size, "question")}")
                if (!open) Text(first.question, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text(if (open) "▾" else "▸", color = Lab.colors.muted, fontSize = 18.sp)
        }
        if (open) {
            thread.questions.forEach { q ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)) { append("Asked  ") }; append(q.question) }, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                    Text(buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Palette.Secondary)) { append("Claude  ") }; append(q.answer) }, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                    MutedLine(TeachingFormat.shortDateTime(q.asked_at, now))
                }
            }
            if (showCard) InlineButton("Open this card ›") { onOpenCard(thread.noteId) }
        }
    }
}

/** "💬 Asked Claude" on the student page: the four newest threads + a link to all. */
@Composable
fun AskedClaudeSection(relId: String, questions: List<ClaudeQuestionDto>?, total: Int, studentName: String?, open: (String) -> Unit, now: Instant = Instant.now()) {
    val threads = remember(questions) { groupQuestionThreads(questions.orEmpty()) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("💬 Asked Claude" + if (total > 0) " (${TeachingFormat.plural(total, "question")})" else "")
        when {
            questions == null -> MutedLine("Loading…")
            threads.isEmpty() -> TeachCard { MutedLine("${studentName ?: "The student"} has not asked Claude about a card yet.") }
            else -> {
                threads.take(4).forEach { ClaudeThreadRow(it, { noteId -> open(Routes.studentCardHub(relId, noteId)) }, now) }
                InlineButton("All conversations${if (total > 0) " ($total)" else ""} ›") { open(Routes.studentClaudeChats(relId)) }
            }
        }
    }
}

// ---------------- homework ----------------

private val KIND_ICON = mapOf("deck" to "🃏", "lesson" to "🎓", "reader" to "📖")

private fun progressText(a: AssignmentDto): String = when {
    a.status == "done" -> if (a.kind == "deck") "all ${a.item_count} words" else "done"
    a.kind != "deck" -> if (a.done_count > 0) "done" else "not started"
    a.done_count == 0 -> "${a.item_count} words · not started"
    else -> "${a.done_count}/${a.item_count} words"
}

/** The one-off homework in this relationship: load gauge, open items (move date / cancel), done (web: AssignedHomeworkSection). */
@Composable
fun AssignedHomeworkCard(
    data: RelationshipHomeworkDto,
    studentName: String,
    onMoveDate: (AssignmentDto, String) -> Unit,
    onCancel: (AssignmentDto) -> Unit,
) {
    val oneOff = data.assignments.filter { it.mode != "fsrs" && it.status != "cancelled" }
    val active = oneOff.filter { it.status == "active" }.sortedWith { a, b -> HomeworkPlan.compareDue(a.due_date, b.due_date).takeIf { it != 0 } ?: (a.part_index - b.part_index) }
    val doneAll = oneOff.filter { it.status == "done" }
    val done = doneAll.take(5)
    var openId by remember { mutableStateOf<String?>(null) }
    var confirmCancel by remember { mutableStateOf<AssignmentDto?>(null) }
    var showDone by remember { mutableStateOf(false) }
    val today = data.today.ifEmpty { LocalDate.now().toString() }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LoadGauge(data.load, studentName)
        if (active.isEmpty() && done.isEmpty()) MutedLine("No one-off homework yet. Send a deck or lesson as One-off to give it a due date.")
        active.forEach { a ->
            TeachCard(Modifier.animateContentSize()) {
                Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).bouncyClickable(pressedScale = 0.98f) { openId = if (openId == a.id) null else a.id }, verticalAlignment = Alignment.CenterVertically) {
                    Text(KIND_ICON[a.kind] ?: "📝", fontSize = 20.sp)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(a.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        MutedLine(progressText(a) + if (a.mode == "both") " · + long-term" else "")
                    }
                    DueChip(HomeworkPlan.dueLabel(a.due_date, today))
                }
                if (openId == a.id) {
                    DueDateChooser(a.due_date, today, label = "Due") { onMoveDate(a, it); openId = null }
                    InlineButton("Cancel this homework", danger = true) { confirmCancel = a }
                }
            }
        }
        if (doneAll.isNotEmpty()) {
            InlineButton("${if (showDone) "▾" else "▸"} Done (${doneAll.size})") { showDone = !showDone }
            AnimatedVisibility(showDone) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(start = 8.dp)) {
                    done.forEach { a ->
                        val completed = a.completed_at?.take(10)
                        MutedLine(
                            "${KIND_ICON[a.kind] ?: "📝"} ${a.title} · ${progressText(a)}" +
                                (completed?.let { " · ${HomeworkPlan.shortDay(it)}" } ?: "") +
                                (if (a.due_date != null && completed != null && completed > a.due_date) " · late" else ""),
                        )
                    }
                }
            }
        }
    }
    confirmCancel?.let { a ->
        ConfirmDialog("Cancel \"${a.title}\"?", "It disappears from $studentName's homework.", "Cancel homework", onConfirm = { onCancel(a) }, onDismiss = { confirmCancel = null }, dismissLabel = "Keep", danger = true)
    }
}

/**
 * A due date picker in the web's shape (date + Tomorrow / In 2 days / In a week chips), with
 * the Material date picker for any other day (never before today).
 */
@Composable
fun DueDateChooser(value: String?, today: String, label: String = "Due", nextLesson: String? = null, onChange: (String) -> Unit) {
    var picking by remember { mutableStateOf(false) }
    // web: HomeworkModePicker's quick chips — "Next lesson · Thu 1 Oct" first when one is logged.
    val lesson = if (nextLesson != null && nextLesson > today) listOf("Next lesson · ${HomeworkPlan.shortDay(nextLesson)}" to nextLesson) else emptyList()
    val quick = lesson + listOf("Tomorrow" to HomeworkPlan.addDays(today, 1), "In 2 days" to HomeworkPlan.addDays(today, 2), "In a week" to HomeworkPlan.addDays(today, 7)).filter { it.second != nextLesson }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            Spacer(Modifier.width(10.dp))
            Text(
                value?.let { HomeworkPlan.shortDay(it) } ?: "Pick a day",
                color = Lab.colors.accent, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(12.dp)).bouncyClickable { picking = true }.background(Lab.colors.accentSoft).padding(horizontal = 12.dp, vertical = 10.dp),
            )
        }
        dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow {
            quick.forEach { (l, d) -> dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip(l, selected = value == d) { onChange(d) } }
        }
    }
    if (picking) DatePickerSheet(value ?: HomeworkPlan.addDays(today, 1), minDate = today, onPick = { picking = false; onChange(it) }, onDismiss = { picking = false })
}

/** Rows for the decks sent in this relationship: progress bar, words met, #N queue badge with its menu, Update. */
@Composable
fun HomeworkDeckRow(
    relId: String,
    d: HomeworkDeckDto,
    updating: Boolean,
    onMove: (String) -> Unit,
    onUpdate: () -> Unit,
    open: (String) -> Unit,
    now: Instant = Instant.now(),
) {
    var menu by remember { mutableStateOf(false) }
    TeachCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(
                Modifier.weight(1f).bouncyClickable(pressedScale = 0.98f) { open("/connections/${Routes.seg(relId)}/shared-decks/${Routes.seg(d.shared_deck_id)}/progress") },
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(d.source_deck_name) }
                        withStyle(SpanStyle(color = Lab.colors.muted)) { append(" · sent ${TeachingFormat.shortDate(d.shared_at, now)}") }
                    },
                    style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink,
                )
                ProgressBar2(d.percent_started, d.percent_mastered)
                MutedLine(
                    if (d.target_deck_name == null) "The student deleted their copy"
                    else "${d.notes_introduced}/${d.notes_total} words met · ${d.cards_mastered} cards mastered · " +
                        if (d.words_to_go == 0) "all introduced" else "${d.words_to_go} to go, ~${d.days_to_go} ${if (d.days_to_go == 1) "day" else "days"}",
                )
                if (d.notes_missing > 0) TeachPill("${TeachingFormat.plural(d.notes_missing, "new word")} not sent", PillTone.Muted)
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (d.target_deck_name != null && d.queue_position != null) QueueBadge(d.queue_position) { menu = true }
                if (d.notes_missing > 0 && d.target_deck_name != null) InlineButton(if (updating) "Updating…" else "Update", enabled = !updating, onClick = onUpdate)
            }
        }
    }
    if (menu && d.queue_position != null) {
        val pos = d.queue_position
        LabBottomSheet(onDismiss = { menu = false }, title = "${d.source_deck_name} · #$pos of ${d.queue_total} in their queue") {
            listOf("top" to "⤒ Move to top", "up" to "↑ Move up", "down" to "↓ Move down", "bottom" to "⤓ Move to bottom").forEach { (to, text) ->
                val disabled = if (to == "top" || to == "up") pos == 1 else pos == d.queue_total
                NavRow(text.take(1), text.drop(2), enabled = !disabled, trailing = {}, onClick = { menu = false; onMove(to) })
            }
        }
    }
}

private val RATING_LABELS = mapOf(0 to "Again", 1 to "Hard", 2 to "Good", 3 to "Easy")

/** "Mini Lessons": the student's lessons with completions, Answers / Edit (web: StudentLessonsSection). */
@Composable
fun StudentLessonsCard(relId: String, lessons: List<StudentLessonDto>?, error: String?, open: (String) -> Unit, now: Instant = Instant.now()) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Mini Lessons") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                InlineButton("📝 Answers") { open(Routes.studentLessonAttempts(relId)) }
                InlineButton("📚 Assign") { open(Routes.LIBRARY) }
            }
        }
        TeachCard {
            when {
                lessons == null && error != null -> MutedLine("Couldn't load the student's lessons.")
                lessons == null -> MutedLine("Loading lessons…")
                lessons.isEmpty() -> MutedLine("No mini lessons yet. Assign one from your library.")
                else -> lessons.forEach { l ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${l.icon ?: "🎓"} ${l.title}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                            MutedLine(
                                (if (l.assigned_by_me) "Assigned by you" else if (l.assigned_by != null) "Assigned by another tutor" else "From ${l.source}") +
                                    " • ${l.exercise_count} exercises • " +
                                    if (l.completions == 0) "not studied yet" else "studied ${l.completions}× · last ${l.last_rating?.let { RATING_LABELS[it] }.orEmpty()} ${TeachingFormat.shortDate(l.last_completed_at, now)}",
                            )
                        }
                        if (l.last_attempt_id != null) InlineButton("📝 Answers") { open(Routes.studentLessonAttempts(relId, l.last_attempt_id)) }
                        if (l.assigned_by_me) InlineButton("✏️ Edit") { open(Routes.lessonEdit(l.id)) }
                    }
                }
            }
        }
    }
}

// ---------------- conversations + activity ----------------

private fun conversationDate(iso: String, now: Instant): String {
    val d = TeachingFormat.parse(iso) ?: return iso
    val diffDays = ((now.toEpochMilli() - d.toEpochMilli()) / 86_400_000L)
    val z = d.atZone(java.time.ZoneId.systemDefault())
    return when {
        diffDays == 0L -> TeachingFormat.time(iso)
        diffDays == 1L -> "Yesterday"
        diffDays < 7 -> java.time.format.DateTimeFormatter.ofPattern("EEE", java.util.Locale.US).format(z)
        else -> java.time.format.DateTimeFormatter.ofPattern("MMM d", java.util.Locale.US).format(z)
    }
}

@Composable
fun ConversationsCard(relId: String, conversations: List<ConversationDto>?, onStart: () -> Unit, open: (String) -> Unit, now: Instant = Instant.now()) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Conversations")
        TeachCard {
            when {
                conversations == null -> MutedLine("Loading conversations…")
                conversations.isEmpty() -> {
                    Text("No conversations yet", style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                    MutedLine("Send a message to get started")
                    PrimaryPill("Message", Modifier.height(48.dp), onClick = onStart)
                }
                else -> conversations.forEach { c ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).bouncyClickable(pressedScale = 0.98f) { open(Routes.chat(relId, c.id)) }, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(c.title ?: "Chat", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                            c.last_message?.content?.let { MutedLine(it.take(50) + if (it.length > 50) "..." else "") }
                        }
                        MutedLine(conversationDate(c.last_message_at ?: c.created_at, now))
                    }
                }
            }
        }
    }
}

@Composable
fun ActivityCard(relId: String, activity: List<ActivityDayDto>, open: (String) -> Unit, today: LocalDate = LocalDate.now()) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("Activity")
        TeachCard {
            if (activity.isEmpty()) MutedLine("No reviews in the last 30 days.")
            activity.forEach { day ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(pressedScale = 0.98f) { open("/connections/${Routes.seg(relId)}/progress/day/${day.day}") }, verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(TeachingFormat.dayLabel(day.day, today)) }
                            withStyle(SpanStyle(color = Lab.colors.muted)) {
                                append(" · ${TeachingFormat.plural(day.reviews, "review")} · ${TeachingFormat.percent(day.accuracy)}")
                                if (day.time_ms > 0) append(" · ${TeachingFormat.minutes(day.time_ms)}")
                            }
                        },
                        style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.weight(1f),
                    )
                    Text("›", color = Lab.colors.muted, fontSize = 22.sp)
                }
            }
            SecondaryPill("Show 30 days", Modifier.fillMaxWidth()) { open(Routes.studentProgress(relId)) }
        }
    }
}

/** Quick links to the deeper pages. */
@Composable
fun StudentNavLinks(relId: String, recordingsToHear: Int, open: (String) -> Unit) {
    dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow {
        listOf(
            "📊 Insights" to Routes.insights(relId),
            "🕘 History" to Routes.studentHistory(relId),
            ("🎤 Recordings" + if (recordingsToHear > 0) " ($recordingsToHear)" else "") to Routes.recordings(relId),
            "📈 Progress" to Routes.studentProgress(relId),
        ).forEach { (label, path) -> dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip(label) { open(path) } }
    }
}
