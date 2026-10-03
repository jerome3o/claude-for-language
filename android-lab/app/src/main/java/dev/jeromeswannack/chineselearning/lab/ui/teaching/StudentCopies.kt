package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkRemoval
import dev.jeromeswannack.chineselearning.lab.data.api.StudentCopyDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentCopyResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.studentCopies
import dev.jeromeswannack.chineselearning.lab.data.api.updateStudentCopies
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/*
 * "Also update <student>'s copy" after an edit (docs/HOMEWORK.md §10; web:
 * components/tutor/UpdateCopiesSheet.tsx). After the tutor saves a deck word, a library lesson
 * or a reader, the editor asks GET /api/student-copies; when students have a copy, a sheet
 * offers one checkbox per student (default on) and Update → POST /api/student-copies/update.
 */

/** What the sheet shows. [results] after Update (one line per student). */
data class CopiesSheetUi(
    val kind: String,
    val sourceId: String,
    /** "this deck" / "this lesson" / "this reader" / the item's title. */
    val what: String,
    val copies: List<StudentCopyDto>,
    val checked: Set<String> = copies.map { it.relationship_id }.toSet(),
    val busy: Boolean = false,
    val error: String? = null,
    val results: List<StudentCopyResultDto>? = null,
)

data class CopiesSheetActions(val toggle: (String) -> Unit = {}, val update: () -> Unit = {}, val dismiss: () -> Unit = {})

/** "Also update Jerome's copy" (the checkbox label, as on the web). */
fun alsoUpdateLabel(studentName: String?): String = "Also update ${HomeworkRemoval.studentFirstName(studentName)}'s copy"

/** Owns the sheet for one editor: checks for copies after a save and updates the chosen ones. */
class StudentCopiesController(private val app: LabApp, private val scope: CoroutineScope) {
    private val _sheet = MutableStateFlow<CopiesSheetUi?>(null)
    val sheet: StateFlow<CopiesSheetUi?> = _sheet.asStateFlow()

    val actions = CopiesSheetActions(
        toggle = { rel -> _sheet.update { s -> s?.copy(checked = if (rel in s.checked) s.checked - rel else s.checked + rel) } },
        update = { update() },
        dismiss = { _sheet.value = null },
    )

    /** After a successful save: any students with a copy? Quiet when offline or on failure (the save itself succeeded). */
    fun check(kind: String, sourceId: String, what: String) {
        if (!app.online.value) return
        scope.launch {
            attempt { app.repo.api.studentCopies(kind, sourceId) }.onSuccess { copies ->
                if (copies.isNotEmpty()) _sheet.value = CopiesSheetUi(kind, sourceId, what, copies)
            }
        }
    }

    private fun update() {
        val s = _sheet.value ?: return
        if (s.busy || s.checked.isEmpty()) return
        _sheet.value = s.copy(busy = true, error = null)
        scope.launch {
            attempt { app.repo.api.updateStudentCopies(s.kind, s.sourceId, s.copies.map { it.relationship_id }.filter { it in s.checked }) }
                .onSuccess { res ->
                    if (res.results.all { it.ok }) { app.haptics.correct(); app.sounds.play(Sounds.Sfx.POP) } else app.haptics.wrong()
                    _sheet.update { it?.copy(busy = false, results = res.results) }
                    app.cache.delete(HomeworkLibraryKeys.ALL)
                    s.copies.forEach { c -> app.cache.delete(HomeworkLibraryKeys.student(c.relationship_id)) }
                }
                .onFailure { e -> app.haptics.wrong(); _sheet.update { it?.copy(busy = false, error = e.userMessage().ifBlank { "Could not update their copies" }) } }
        }
    }
}

@Composable
fun rememberStudentCopies(app: LabApp): StudentCopiesController {
    val scope = rememberCoroutineScope()
    return remember(app) { StudentCopiesController(app, scope) }
}

/** Renders the controller's sheet while it is open. */
@Composable
fun StudentCopiesHost(controller: StudentCopiesController) {
    val ui by controller.sheet.collectAsStateWithLifecycle()
    ui?.let { UpdateCopiesSheet(it, controller.actions) }
}

@Composable
fun UpdateCopiesSheet(ui: CopiesSheetUi, actions: CopiesSheetActions) {
    LabBottomSheet(onDismiss = { if (!ui.busy) actions.dismiss() }, title = if (ui.copies.size == 1) "Also update their copy?" else "Also update their copies?") {
        UpdateCopiesContent(ui, actions)
    }
}

/** The sheet's body (also rendered on its own in screenshot tests). */
@Composable
fun UpdateCopiesContent(ui: CopiesSheetUi, actions: CopiesSheetActions) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).testTag("copies-sheet"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val results = ui.results
        if (results == null) {
            Text(
                "You saved ${ui.what}. ${if (ui.copies.size == 1) "A student has" else "${ui.copies.size} students have"} a copy — updating it keeps their progress.",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
            ui.copies.forEach { c ->
                Column {
                    CopyCheckbox(alsoUpdateLabel(c.student_name), c.relationship_id in ui.checked, enabled = !ui.busy) { actions.toggle(c.relationship_id) }
                    if (ui.kind == "deck" && c.behind > 0) {
                        MutedLine("${TeachingFormat.plural(c.behind, "new word")} not in their copy yet", Modifier.padding(start = 48.dp))
                    }
                }
            }
            ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill("Not now", Modifier.weight(1f), enabled = !ui.busy, onClick = actions.dismiss)
                PrimaryPill(
                    if (ui.busy) "Updating…" else if (ui.checked.size > 1) "Update ${ui.checked.size} copies" else "Update",
                    Modifier.weight(1f).height(52.dp), enabled = !ui.busy && ui.checked.isNotEmpty(), onClick = actions.update,
                )
            }
        } else {
            results.forEach { r ->
                InlineNotice(
                    if (r.ok) "${HomeworkRemoval.studentFirstName(r.student_name)}: ${r.detail?.takeIf { it.isNotBlank() } ?: "updated"}"
                    else "${HomeworkRemoval.studentFirstName(r.student_name)}: ${r.error ?: "could not update"}",
                    kind = if (r.ok) NoticeKind.Success else NoticeKind.Error,
                )
            }
            PrimaryPill("Done", Modifier.fillMaxWidth().height(52.dp), onClick = actions.dismiss)
        }
    }
}
