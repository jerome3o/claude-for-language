package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyBudgetInfo
import dev.jeromeswannack.chineselearning.lab.core.TutorBudget
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.StudentStudyBudgetDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetInfoDto
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudentStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.studentStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.settings.Stepper
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

/*
 * "Daily new cards" on the tutor's student page (web: the row + sheet on ConnectionDetailPage):
 * the tutor sets the student's ONE global new-card budget; the server posts the chat message
 * as her and the student's next sync applies it. Words: core TutorBudget (parity-tested).
 */

/** "3 new words + 6 extra a day", with " · default" while nothing is set. */
fun budgetRowValue(info: StudyBudgetInfo): String =
    TutorBudget.budgetSummary(info.budget) + if (info.isDefault) " · default" else ""

/** The dashboard card's compact chip — only once someone changed the budget. */
fun budgetChip(dto: StudyBudgetInfoDto?): String? {
    val info = dto?.toInfo() ?: return null
    if (info.isDefault) return null
    return "📚 ${info.newCardsPerDay} + ${info.secondaryCardsPerDay} a day"
}

/** GET (cached for offline reading) and PUT the student's budget. */
class StudentBudgetController(private val app: LabApp, private val vm: ViewModel, private val relId: String, private val onSaved: () -> Unit = {}) {
    val resource: CachedResource<StudentStudyBudgetDto> =
        app.cachedResource(vm.viewModelScope, "teaching/student-budget/$relId", TeachingKeys.KIND) { studentStudyBudget(relId) }

    /** Numbers, or both null = back to the default. [done] gets the error sentence, or null when saved. */
    fun save(newPerDay: Int?, secondaryPerDay: Int?, done: (String?) -> Unit) = vm.viewModelScope.launch {
        attempt { app.repo.api.saveStudentStudyBudget(relId, newPerDay, secondaryPerDay) }
            .onSuccess { r ->
                resource.update { (it ?: StudentStudyBudgetDto()).copy(budget = r.budget) }
                app.haptics.correct()
                app.sounds.play(Sounds.Sfx.POP)
                // The dashboard chip and the overview row follow.
                app.scope.launch { app.cache.delete(TeachingKeys.DASHBOARD) }
                onSaved()
                done(null)
            }
            .onFailure { e ->
                val problems = (e as? HttpException)?.problems().orEmpty()
                done(problems.takeIf { it.isNotEmpty() }?.joinToString("; ") ?: e.userMessage().ifBlank { "Could not save the budget" })
            }
    }
}

/** The row: "Daily new cards" · "3 new words + 6 extra a day · default" · Edit. */
@Composable
fun DailyBudgetRow(info: StudyBudgetInfo?, error: String?, onEdit: () -> Unit, onRetry: () -> Unit) {
    TeachCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Daily new cards", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Text(
                    when {
                        info != null -> budgetRowValue(info)
                        error != null -> "Could not load"
                        else -> "Loading…"
                    },
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                )
            }
            Spacer(Modifier.width(8.dp))
            if (info != null) InlineButton("Edit", onClick = onEdit)
            else if (error != null) InlineButton("Retry", onClick = onRetry)
        }
    }
}

/** The editor sheet: two steppers, the live finish hint, Reset to default / Save. */
@Composable
fun DailyBudgetSheet(
    data: StudentStudyBudgetDto,
    online: Boolean,
    save: (Int?, Int?, (String?) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var draft by remember { mutableStateOf(data.budget.toInfo().budget) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun send(n: Int?, s: Int?) {
        busy = true
        error = null
        save(n, s) { e ->
            busy = false
            if (e == null) onDismiss() else error = e
        }
    }
    LabBottomSheet(onDismiss = onDismiss, title = "Daily new cards") {
        DailyBudgetForm(
            data, draft, { draft = it }, busy, error, online,
            onReset = { draft = data.default.toBudget(); send(null, null) },
            onSave = { send(draft.newCardsPerDay, draft.secondaryCardsPerDay) },
        )
    }
}

/** The sheet's content (stateless, so it renders in screenshot tests). */
@Composable
fun DailyBudgetForm(
    data: StudentStudyBudgetDto,
    draft: StudyBudget,
    onDraft: (StudyBudget) -> Unit,
    busy: Boolean,
    error: String?,
    online: Boolean,
    onReset: () -> Unit,
    onSave: () -> Unit,
) {
    val current = data.budget.toInfo().budget
    val default = data.default.toBudget()
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Stepper("New words a day", "Words they have never seen", draft.newCardsPerDay, { onDraft(draft.copy(newCardsPerDay = it.coerceIn(0, StudyBudget.MAX))) }, StudyBudget.MAX, !busy, accent = Palette.New)
        Stepper("Extra cards a day", "Other card types of words already started", draft.secondaryCardsPerDay, { onDraft(draft.copy(secondaryCardsPerDay = it.coerceIn(0, StudyBudget.MAX))) }, StudyBudget.MAX, !busy, accent = Palette.Secondary)
        val top = data.top_deck
        TutorBudget.budgetFinishHint(draft.newCardsPerDay, top?.name, top?.words_to_go)?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
        }
        Text(
            "They'll get a chat message from you, and can still change it in their Settings.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
        error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        if (!online) InlineNotice("Needs a connection to save.", kind = NoticeKind.Offline)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryPill(
                "Reset to default",
                enabled = !busy && online && !(data.budget.is_default && draft == default),
                onClick = onReset,
            )
            PrimaryPill(
                if (busy) "Saving…" else "Save",
                enabled = !busy && online && draft != current,
                onClick = onSave,
            )
        }
    }
}
