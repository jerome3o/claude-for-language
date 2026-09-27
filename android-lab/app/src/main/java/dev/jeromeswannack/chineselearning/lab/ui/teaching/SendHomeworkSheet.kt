package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkPlan
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** One of the tutor's own decks, from the Room mirror (web: getDecks() filtered to user decks). */
data class DeckOption(val id: String, val name: String, val description: String?, val wordCount: Int)

/** How the student does it (shared/homework types.ts HomeworkMode). */
enum class HomeworkMode(val wire: String, val title: String, val sub: String) {
    ONE_OFF("one_off", "One-off", "Once, by a date"),
    FSRS("fsrs", "Long-term", "Spaced review"),
    BOTH("both", "Both", "Once by a date, then long-term");

    val hasOneOff: Boolean get() = this != FSRS
    val hasFsrs: Boolean get() = this != ONE_OFF
}

data class SendOptions(val mode: HomeworkMode, val dueDate: String, val splitDays: Int, val priority: String, val skipKnown: Boolean)

/** What the sheet hands back for the result line: the sentence to show, or an error. */
data class SendOutcome(val result: String? = null, val error: String? = null)

data class SendHomeworkActions(
    val sendDeck: (DeckOption, SendOptions, (SendOutcome) -> Unit) -> Unit = { _, _, _ -> },
    val updateCopy: (DeckOption, HomeworkDeckDto, (SendOutcome) -> Unit) -> Unit = { _, _, _ -> },
    val assignLesson: (LibraryItemSummaryDto, SendOptions, (SendOutcome) -> Unit) -> Unit = { _, _, _ -> },
    val loadLibrary: () -> Unit = {},
    val open: (String) -> Unit = {},
)

/** The sentence after a deck went out (web: SendHomeworkSheet `how`). */
fun sendHow(kind: String, o: SendOptions): String {
    if (!o.mode.hasOneOff) return if (kind == "deck") {
        if (o.priority == "core") "at the top of their queue, so their new words come from it next" else "at the bottom of their queue, after everything they already have"
    } else "in their long-term review"
    val due = if (o.splitDays > 1 && kind == "deck") "over ${o.splitDays} days from ${HomeworkPlan.shortDay(o.dueDate)}" else "by ${HomeworkPlan.shortDay(o.dueDate)}"
    return "as one-off homework $due${if (o.mode == HomeworkMode.BOTH) ", then in long-term review" else ""}"
}

/** "Send homework" as a bottom sheet (web: SendHomeworkSheet.tsx). */
@Composable
fun SendHomeworkSheet(
    studentName: String,
    decks: List<DeckOption>?,
    library: Loadable<List<LibraryItemSummaryDto>>,
    sharedDecks: List<HomeworkDeckDto>,
    assignedLessons: List<HomeworkLessonDto>,
    online: Boolean,
    today: String,
    actions: SendHomeworkActions,
    onDismiss: () -> Unit,
) {
    LabBottomSheet(onDismiss = onDismiss, title = "Send homework to $studentName") {
        SendHomeworkContent(studentName, decks, library, sharedDecks, assignedLessons, online, today, actions)
    }
}

/** The sheet's body (also rendered on its own in screenshot tests). */
@Composable
fun SendHomeworkContent(
    studentName: String,
    decks: List<DeckOption>?,
    library: Loadable<List<LibraryItemSummaryDto>>,
    sharedDecks: List<HomeworkDeckDto>,
    assignedLessons: List<HomeworkLessonDto>,
    online: Boolean,
    today: String,
    actions: SendHomeworkActions,
    initialDeck: DeckOption? = null,
    initialTab: Int = 0,
) {
    var tab by remember { mutableIntStateOf(initialTab) }
    var pendingDeck by remember { mutableStateOf(initialDeck) }
    var pendingLesson by remember { mutableStateOf<LibraryItemSummaryDto?>(null) }
    var mode by remember { mutableStateOf(HomeworkMode.FSRS) }
    var dueDate by remember { mutableStateOf(HomeworkPlan.addDays(today, 2)) }
    var splitDays by remember { mutableIntStateOf(1) }
    var skipKnown by remember { mutableStateOf(true) }
    var priority by remember { mutableStateOf("core") }
    var result by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val opts = SendOptions(mode, dueDate, splitDays, priority, skipKnown)
    val done: (SendOutcome) -> Unit = { o ->
        busy = false
        if (o.result != null) { result = o.result; pendingDeck = null; pendingLesson = null }
        error = o.error
    }

    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).animateContentSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (pendingDeck == null && pendingLesson == null) {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(4.dp)) {
                listOf("📚 A deck", "🎓 A lesson").forEachIndexed { i, label ->
                    Text(
                        label,
                        color = if (tab == i) Lab.colors.ink else Lab.colors.muted,
                        fontWeight = if (tab == i) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(11.dp))
                            .background(if (tab == i) Lab.colors.card else Color.Transparent)
                            .bouncyClickable { tab = i; if (i == 1) actions.loadLibrary() }
                            .padding(vertical = 12.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
            }
        }
        if (!online) InlineNotice("You're offline — homework can't be sent right now.", kind = NoticeKind.Offline)
        result?.let { InlineNotice(it, kind = NoticeKind.Success) }
        error?.let { InlineNotice(it, kind = NoticeKind.Error) }

        val deck = pendingDeck
        val lesson = pendingLesson
        AnimatedContent(Triple(deck, lesson, tab), label = "send") { (d, l, t) ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                when {
                    d != null -> {
                        val existing = sharedDecks.firstOrNull { it.source_deck_id == d.id }
                        Text(if (existing != null) "${d.name} was already sent" else "Send ${d.name} to $studentName?", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                        Text(
                            if (existing != null) "$studentName got this deck on ${TeachingFormat.shortDate(existing.shared_at)}" +
                                (if (existing.notes_missing > 0) " and is missing ${TeachingFormat.plural(existing.notes_missing, "newer word")}" else " and has every word in it") +
                                ". Updating their copy adds the new words and keeps their progress; sending again would create a second copy."
                            else "They get their own copy with all its words and audio. It shows up on their home screen after their next sync.",
                            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                        )
                        if (existing == null) {
                            ModePicker(mode, { mode = it }, dueDate, { dueDate = it }, today, d.wordCount, splitDays) { splitDays = it }
                            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable { skipKnown = !skipKnown }, verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(skipKnown, { skipKnown = it }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
                                Text("Leave out words $studentName already has", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                            }
                            if (mode.hasFsrs) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OptionTile("Core", "Top of their queue — studied next", priority == "core", Modifier.weight(1f)) { priority = "core" }
                                    OptionTile("Non-urgent", "Bottom of their queue — after what they have", priority == "non_urgent", Modifier.weight(1f)) { priority = "non_urgent" }
                                }
                            }
                        }
                        if (existing != null) {
                            PrimaryPill(if (busy) "Updating…" else "Update their copy" + if (existing.notes_missing > 0) " (+${existing.notes_missing})" else "", Modifier.fillMaxWidth().height(52.dp), enabled = !busy && online) {
                                busy = true; error = null; actions.updateCopy(d, existing, done)
                            }
                            SecondaryPill(if (busy) "Sending…" else "Send a second copy anyway", Modifier.fillMaxWidth(), enabled = !busy && online) {
                                busy = true; error = null; actions.sendDeck(d, opts, done)
                            }
                        } else {
                            PrimaryPill(if (busy) "Sending…" else "Send ${d.name}", Modifier.fillMaxWidth().height(52.dp), enabled = !busy && online) {
                                busy = true; error = null; actions.sendDeck(d, opts, done)
                            }
                        }
                        SecondaryPill("Back", Modifier.fillMaxWidth(), enabled = !busy) { pendingDeck = null }
                    }
                    l != null -> {
                        Text("Assign ${l.title} to $studentName?", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                        Text(
                            "${TeachingFormat.plural(l.exercise_count, "exercise")} · they get their own copy${if (mode.hasOneOff) " in their homework list" else ", mixed into their next study session"}." +
                                if (assignedLessons.any { it.title == l.title }) " They already have a lesson with this title." else "",
                            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                        )
                        ModePicker(mode, { mode = it }, dueDate, { dueDate = it }, today, null, 1) {}
                        PrimaryPill(if (busy) "Assigning…" else "Assign lesson", Modifier.fillMaxWidth().height(52.dp), enabled = !busy && online) {
                            busy = true; error = null; actions.assignLesson(l, opts, done)
                        }
                        SecondaryPill("Back", Modifier.fillMaxWidth(), enabled = !busy) { pendingLesson = null }
                    }
                    t == 0 -> {
                        when {
                            decks == null -> LoadingState(text = "Loading your decks…")
                            decks.isEmpty() -> Text("You have no decks yet. Create or generate one first.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                            else -> decks.forEach { deckOpt ->
                                val existing = sharedDecks.firstOrNull { it.source_deck_id == deckOpt.id }
                                OptionRow(
                                    deckOpt.name,
                                    if (existing != null) "Sent ${TeachingFormat.shortDate(existing.shared_at)}" + if (existing.notes_missing > 0) " · ${TeachingFormat.plural(existing.notes_missing, "new word")} to send" else " · up to date"
                                    else deckOpt.description?.takeIf { it.isNotBlank() } ?: "Not sent yet",
                                    enabled = !busy,
                                ) { result = null; error = null; pendingDeck = deckOpt }
                            }
                        }
                    }
                    else -> {
                        val items = library.data
                        when {
                            items == null && library.loading -> LoadingState(text = "Loading your library…")
                            items == null -> Text(library.error ?: "Couldn't load your lesson library.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                            items.isEmpty() -> Text("Your library is empty. Write or generate a lesson first.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                            else -> {
                                items.forEach { item ->
                                    OptionRow(
                                        "${item.icon ?: "🎓"} ${item.title}",
                                        TeachingFormat.plural(item.exercise_count, "exercise") +
                                            when {
                                                assignedLessons.any { it.title == item.title } -> " · already assigned"
                                                item.assignment_count > 0 -> " · sent to ${TeachingFormat.plural(item.assignment_count, "student")}"
                                                else -> ""
                                            },
                                        enabled = !busy,
                                    ) { result = null; error = null; pendingLesson = item }
                                }
                                Text(
                                    "Open the library to write a new lesson ›", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.heightIn(min = 44.dp).bouncyClickable { actions.open(Routes.LIBRARY) }.padding(vertical = 12.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun OptionRow(title: String, meta: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).clip(RoundedCornerShape(16.dp)).bouncyClickable(enabled, 0.98f, onClick = onClick)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(meta, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text("›", color = Lab.colors.muted, fontSize = 22.sp)
    }
}

@Composable
fun OptionTile(title: String, sub: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier.heightIn(min = 64.dp).clip(RoundedCornerShape(14.dp)).bouncyClickable(pressedScale = 0.96f, onClick = onClick)
            .background(if (selected) Lab.colors.accentSoft else Lab.colors.card)
            .border(if (selected) 2.dp else 1.dp, if (selected) Lab.colors.accent else Lab.colors.cardBorder, RoundedCornerShape(14.dp))
            .padding(10.dp),
    ) {
        Text(title, fontWeight = FontWeight.SemiBold, color = if (selected) Lab.colors.accent else Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
        Text(sub, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}

/**
 * How they study it: One-off / Long-term / Both, the due date, and for words "spread over N
 * days" with the day-by-day preview (web: HomeworkModePicker.tsx).
 */
@Composable
fun ModePicker(
    mode: HomeworkMode,
    onMode: (HomeworkMode) -> Unit,
    dueDate: String,
    onDueDate: (String) -> Unit,
    today: String,
    wordCount: Int?,
    splitDays: Int,
    onSplitDays: (Int) -> Unit,
) {
    val canSplit = mode.hasOneOff && (wordCount ?: 0) > 1
    val parts = if (canSplit && splitDays > 1) HomeworkPlan.splitIntoDays((0 until wordCount!!).toList(), splitDays, dueDate) else emptyList()
    val suggestion = if (wordCount != null && wordCount > 0) HomeworkPlan.suggestSplitDays(wordCount) else 1
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HomeworkMode.entries.forEach { m -> OptionTile(m.title, m.sub, mode == m, Modifier.weight(1f)) { onMode(m) } }
        }
        if (mode.hasOneOff) DueDateChooser(dueDate, today, label = if (parts.size > 1) "First day due" else "Due", onChange = onDueDate)
        if (canSplit) {
            Text("Spread the $wordCount words over", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            ChipRow {
                listOf(1, 2, 3, 4, 5, 7).filter { it <= maxOf(1, wordCount!!) }.forEach { d ->
                    LabChip(if (d == 1) "1 day (all at once)" else "$d days", selected = splitDays == d) { onSplitDays(d) }
                }
            }
            if (splitDays == 1 && suggestion > 1) {
                val s = minOf(suggestion, 7)
                Text(
                    "That’s a lot at once — spread over $s days?", color = Lab.colors.accent, fontWeight = FontWeight.Medium,
                    modifier = Modifier.heightIn(min = 40.dp).bouncyClickable { onSplitDays(s) }.padding(vertical = 10.dp),
                )
            }
            if (parts.size > 1) {
                Column(Modifier.padding(start = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    parts.forEach { p ->
                        MutedLine("Day ${p.index + 1} · due ${HomeworkPlan.shortDay(p.dueDate)} · ${p.items.size} ${if (p.items.size == 1) "word" else "words"}")
                    }
                }
            }
        }
    }
}
