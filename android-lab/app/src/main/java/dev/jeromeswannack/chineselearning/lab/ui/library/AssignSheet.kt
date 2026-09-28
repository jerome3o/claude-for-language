package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryAssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.assignLessonHomework
import dev.jeromeswannack.chineselearning.lab.data.api.assignLibraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.libraryAssignments
import dev.jeromeswannack.chineselearning.lab.data.api.myRelationships
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneOffset

// Assign a library lesson to students (web: AssignSheet in LessonLibraryPage.tsx, with the
// homework model's mode picker from components/tutor/HomeworkModePicker.tsx).

/** docs/HOMEWORK.md modes, with the picker's words. */
enum class HomeworkMode(val wire: String, val title: String, val sub: String) {
    ONE_OFF("one_off", "One-off", "Once, by a date"),
    FSRS("fsrs", "Long-term", "Spaced review"),
    BOTH("both", "Both", "Once by a date, then long-term");

    val hasOneOff: Boolean get() = this != FSRS
}

data class StudentOption(val relationshipId: String, val name: String, val hasIt: Boolean)

data class AssignUi(
    val itemId: String,
    val title: String,
    /** Null until the relationships are known (cached or fetched). */
    val students: List<StudentOption>? = null,
    val loadError: String? = null,
    val selected: Set<String> = emptySet(),
    /** Both by default, like the Send homework sheet (docs/HOMEWORK.md "Defaults"). */
    val mode: HomeworkMode = HomeworkMode.BOTH,
    val today: LocalDate,
    val due: LocalDate = today.plusDays(2),
    val busy: Boolean = false,
    val error: String? = null,
)

/** The other person in one of MY students' relationships (I'm the tutor, so it's the non-tutor side). */
fun studentOf(rel: RelationshipDto) = if (rel.requester_role == "tutor") rel.recipient else rel.requester

/** Students with "already has it" from the item's assignments (by relationship or by student id). */
fun studentOptions(rels: MyRelationshipsDto, assignments: List<LibraryAssignmentDto>): List<StudentOption> {
    val byRel = assignments.mapNotNull { it.relationship_id }.toSet()
    val byStudent = assignments.map { it.student.id }.toSet()
    return rels.students.map { rel ->
        val other = studentOf(rel)
        StudentOption(rel.id, other?.name?.takeIf { it.isNotBlank() } ?: other?.email ?: "Student", rel.id in byRel || (other?.id != null && other.id in byStudent))
    }
}

/** The assign sheet's logic, shared by the library list and the item page. */
class AssignController(private val scope: CoroutineScope, private val deps: LibraryDeps, private val onDone: (String) -> Unit) {
    private val _state = MutableStateFlow<AssignUi?>(null)
    val state: StateFlow<AssignUi?> = _state.asStateFlow()

    private val assignmentsSerializer = ListSerializer(LibraryAssignmentDto.serializer())

    fun open(itemId: String, title: String) {
        _state.value = AssignUi(itemId, title, today = deps.today())
        scope.launch {
            // Cached first (instant), then fresh from the server.
            val cachedRels = deps.cache.get(NavKeys.RELATIONSHIPS, MyRelationshipsDto.serializer())
            val cachedAssignments = deps.cache.get(LibraryKeys.assignments(itemId), assignmentsSerializer).orEmpty()
            if (cachedRels != null) show(itemId, studentOptions(cachedRels, cachedAssignments), null)
            var error: String? = null
            val rels = try {
                deps.api.myRelationships().also { deps.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, it, MyRelationshipsDto.serializer()) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.userMessage(); cachedRels
            }
            val assignments = try {
                deps.api.libraryAssignments(itemId).also { deps.cache.put(LibraryKeys.assignments(itemId), LibraryKeys.KIND, it, assignmentsSerializer) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                cachedAssignments
            }
            if (rels != null) show(itemId, studentOptions(rels, assignments), null)
            else show(itemId, null, error ?: "Couldn't load your students.")
        }
    }

    private fun show(itemId: String, students: List<StudentOption>?, error: String?) = _state.update { s ->
        if (s == null || s.itemId != itemId) s
        else s.copy(
            students = students ?: s.students,
            loadError = if (students == null) error else null,
            selected = s.selected.filter { id -> students?.any { it.relationshipId == id && !it.hasIt } ?: true }.toSet(),
        )
    }

    fun dismiss() { if (_state.value?.busy != true) _state.value = null }

    fun toggle(relId: String) {
        deps.feel.tick()
        _state.update { s -> s?.copy(selected = if (relId in s.selected) s.selected - relId else s.selected + relId) }
    }

    fun setMode(mode: HomeworkMode) {
        deps.feel.tick()
        _state.update { it?.copy(mode = mode) }
    }

    fun setDue(date: LocalDate) {
        deps.feel.tick()
        _state.update { it?.copy(due = if (date.isBefore(it.today)) it.today else date) }
    }

    fun submit() {
        val s = _state.value ?: return
        if (s.busy || s.selected.isEmpty()) return
        _state.value = s.copy(busy = true, error = null)
        scope.launch {
            try {
                val message = if (s.mode == HomeworkMode.FSRS) longTerm(s) else oneOff(s)
                _state.value = null
                deps.feel.success()
                onDone(message)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it?.copy(busy = false, error = e.userMessage()) }
            }
        }
    }

    /** Exactly the web library's call and message. */
    private suspend fun longTerm(s: AssignUi): String {
        val r = deps.api.assignLibraryItem(s.itemId, s.selected.toList())
        val parts = buildList {
            if (r.assigned.isNotEmpty()) add("assigned to ${LibraryText.plural(r.assigned.size, "student")}")
            if (r.already_had.isNotEmpty()) add("${r.already_had.size} already had it")
            if (r.errors.isNotEmpty()) add("${r.errors.size} failed")
        }
        return "“${s.title}” ${parts.joinToString(", ").ifEmpty { "nothing to do" }}"
    }

    /** One-off / both: the homework model, one POST per student (the Send homework sheet's call). */
    private suspend fun oneOff(s: AssignUi): String {
        var ok = 0
        val failures = mutableListOf<String>()
        for (relId in s.selected) {
            try {
                val r = deps.api.assignLessonHomework(relId, s.itemId, s.mode.wire, s.due.toString(), s.today.toString())
                if (r.errors.isNotEmpty() && r.assignments.isEmpty()) failures += r.errors.first().error.ifBlank { "Could not assign" } else ok++
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                if (ok == 0 && failures.isEmpty() && e !is dev.jeromeswannack.chineselearning.lab.data.HttpException) throw e // offline: nothing sent
                failures += e.userMessage()
            }
        }
        if (ok == 0) throw IllegalStateException(failures.firstOrNull() ?: "Could not assign")
        val base = "Assigned “${s.title}” to ${LibraryText.plural(ok, "student")} — due ${LibraryText.shortDay(s.due)}"
        return if (failures.isEmpty()) base else "$base · ${failures.size} failed: ${failures.first()}"
    }
}

data class AssignActions(
    val onToggle: (String) -> Unit = {},
    val onMode: (HomeworkMode) -> Unit = {},
    val onDue: (LocalDate) -> Unit = {},
    val onSubmit: () -> Unit = {},
    val onDismiss: () -> Unit = {},
    val onConnections: () -> Unit = {},
)

fun AssignController.actions(onConnections: () -> Unit) = AssignActions(::toggle, ::setMode, ::setDue, ::submit, ::dismiss, { dismiss(); onConnections() })

@Composable
fun AssignSheet(ui: AssignUi, actions: AssignActions) {
    LabBottomSheet(onDismiss = actions.onDismiss, title = "Assign “${ui.title}”") {
        AssignSheetBody(ui, actions)
    }
}

@Composable
fun ColumnScope.AssignSheetBody(ui: AssignUi, actions: AssignActions) {
    val students = ui.students
    when {
        students == null && ui.loadError == null -> LoadingState(text = "Loading students…")
        students == null -> InlineNotice(ui.loadError ?: "", Modifier.padding(horizontal = 20.dp), NoticeKind.Error)
        students.isEmpty() -> {
            Text(
                "You have no students yet. Invite one from Connections.",
                style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
            )
            NavRow("👥", "Open Connections", desc = "Invite a student", onClick = actions.onConnections)
        }
        else -> {
            SheetLabel("Who gets it")
            students.forEach { s -> StudentRow(s, s.relationshipId in ui.selected, enabled = !ui.busy, onToggle = { actions.onToggle(s.relationshipId) }) }
            Spacer(Modifier.height(12.dp))
            SheetLabel("How they study it")
            ModePicker(ui.mode, enabled = !ui.busy, onMode = actions.onMode, modifier = Modifier.padding(horizontal = 20.dp))
            AnimatedVisibility(ui.mode.hasOneOff, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                DuePicker(ui.today, ui.due, enabled = !ui.busy, onDue = actions.onDue, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp))
            }
            if (ui.error != null) InlineNotice(ui.error, Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp), NoticeKind.Error)
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 18.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SecondaryPill("Cancel", Modifier.height(52.dp), enabled = !ui.busy, onClick = actions.onDismiss)
                val n = ui.selected.size
                PrimaryPill(
                    when {
                        ui.busy -> "Assigning…"
                        n == 0 -> "Assign"
                        else -> "Assign to $n"
                    },
                    Modifier.weight(1f).height(52.dp),
                    enabled = !ui.busy && n > 0,
                    onClick = actions.onSubmit,
                )
            }
        }
    }
}

@Composable
internal fun SheetLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted, modifier = modifier.padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 6.dp))
}

@Composable
private fun StudentRow(s: StudentOption, checked: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .toggleable(value = s.hasIt || checked, enabled = enabled && !s.hasIt, role = Role.Checkbox, onValueChange = { onToggle() })
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked = s.hasIt || checked,
            onCheckedChange = null,
            enabled = enabled && !s.hasIt,
            colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent, checkmarkColor = Color.White, disabledCheckedColor = Lab.colors.muted.copy(alpha = 0.5f)),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            s.name,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            color = if (s.hasIt) Lab.colors.muted else Lab.colors.ink,
            modifier = Modifier.weight(1f),
        )
        if (s.hasIt) Text("already has it", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(end = 12.dp))
    }
}

/** One-off / Long-term / Both, as three cards. */
@Composable
fun ModePicker(mode: HomeworkMode, enabled: Boolean, onMode: (HomeworkMode) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        HomeworkMode.entries.forEach { m ->
            val selected = m == mode
            val border by animateColorAsState(if (selected) Lab.colors.accent else Lab.colors.cardBorder, spring(stiffness = Spring.StiffnessMediumLow), label = "mode")
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = 76.dp)
                    .bouncyClickable(enabled, 0.95f, role = Role.RadioButton) { onMode(m) }
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (selected) Lab.colors.accentSoft else Color.Transparent)
                    .border(if (selected) 2.dp else 1.dp, border, RoundedCornerShape(16.dp))
                    .padding(horizontal = 10.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                Text(m.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = if (selected) Lab.colors.accent else Lab.colors.ink)
                Text(m.sub, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2)
            }
        }
    }
}

/** Due date: Tomorrow / In 2 days / In a week, or any day from the calendar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DuePicker(today: LocalDate, due: LocalDate, enabled: Boolean, onDue: (LocalDate) -> Unit, modifier: Modifier = Modifier) {
    var picking by rememberSaveable { mutableStateOf(false) }
    val quick = listOf("Tomorrow" to today.plusDays(1), "In 2 days" to today.plusDays(2), "In a week" to today.plusDays(7))
    Column(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Due", style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted)
            Spacer(Modifier.width(8.dp))
            Text(LibraryText.shortDay(due), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        }
        Spacer(Modifier.height(8.dp))
        ChipRow {
            quick.forEach { (label, date) -> LabChip(label, selected = due == date, enabled = enabled) { onDue(date) } }
            val custom = quick.none { it.second == due }
            LabChip(if (custom) "📅 ${LibraryText.shortDay(due)}" else "📅 Pick a date", selected = custom, enabled = enabled) { picking = true }
        }
    }
    if (picking) {
        val todayUtc = today.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = due.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli(),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis >= todayUtc
                override fun isSelectableYear(year: Int) = year >= today.year
            },
        )
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onDue(java.time.Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                    picking = false
                }) { Text("Set due date", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel", color = Lab.colors.muted) } },
        ) { DatePicker(state) }
    }
}
