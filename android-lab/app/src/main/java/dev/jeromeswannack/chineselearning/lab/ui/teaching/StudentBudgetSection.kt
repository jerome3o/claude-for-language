package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import dev.jeromeswannack.chineselearning.lab.core.ReviewLoad
import dev.jeromeswannack.chineselearning.lab.core.ReviewLoadState
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyBudgetInfo
import dev.jeromeswannack.chineselearning.lab.core.TutorBudget
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.PauseChange
import dev.jeromeswannack.chineselearning.lab.data.api.ReviewLoadDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentStudyBudgetDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetInfoDto
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudentStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.studentStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.settings.ReviewLoadCapField
import dev.jeromeswannack.chineselearning.lab.ui.settings.Stepper
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

/*
 * "Daily new cards" on the tutor's student page (web: the row + sheet on ConnectionDetailPage):
 * the tutor sets the student's ONE global new-card budget; the server posts the chat message
 * as her and the student's next sync applies it. Words: core TutorBudget (parity-tested).
 */

/** The paused pill's amber (the web's .db-paused / .td-pill-paused). */
private val PAUSED_BG = Color(0xFFFEF3C7)
private val PAUSED_INK = Color(0xFF92400E)

/** "3 new words + 6 extra a day", with " · default" while nothing is set. */
fun budgetRowValue(info: StudyBudgetInfo): String =
    TutorBudget.budgetSummary(info.budget) + if (info.isDefault) " · default" else ""

/** The dashboard card's "⏸ New cards paused today · 124 reviews due" while the student is paused (core ReviewLoad). */
fun pausedChip(dto: ReviewLoadDto?): String? = ReviewLoad.tutorPausedLabel(dto?.toState())

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

    /**
     * Numbers, or both null = back to the default; [pause] = a change of "Pause new cards on heavy
     * days" (null = leave it). [done] gets the error sentence, or null when saved.
     */
    fun save(newPerDay: Int?, secondaryPerDay: Int?, pause: PauseChange? = null, numbers: Boolean = true, done: (String?) -> Unit) = vm.viewModelScope.launch {
        attempt { app.repo.api.saveStudentStudyBudget(relId, newPerDay, secondaryPerDay, pause, numbers) }
            .onSuccess { r ->
                val props = mutableMapOf<String, Any?>("reset" to (numbers && newPerDay == null && secondaryPerDay == null))
                if (numbers) { props["new_cards"] = newPerDay; props["secondary_cards"] = secondaryPerDay }
                if (pause != null) props["pause_over"] = pause.value ?: "off"
                app.analytics.track("tutor.budget_change", props)
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

/**
 * The row: "Daily new cards" · "3 new words + 6 extra a day · default" · Edit, then the student's
 * "Pause new cards on heavy days" limit and — while it holds today — "⏸ New cards paused today ·
 * 124 reviews due" ([reviewLoad] from the overview).
 */
@Composable
fun DailyBudgetRow(info: StudyBudgetInfo?, error: String?, onEdit: () -> Unit, onRetry: () -> Unit, reviewLoad: ReviewLoadState? = null) {
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
                ReviewLoad.capSummary(info?.pauseNewWhenReviewsOver)?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.testTag("daily-budget-cap"))
                }
                ReviewLoad.tutorPausedLabel(reviewLoad)?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = PAUSED_INK,
                        modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(PAUSED_BG).padding(horizontal = 8.dp, vertical = 3.dp).testTag("daily-budget-paused"),
                    )
                }
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
    /** (new, extra, pause change or null, numbers changed?, done) — a pause-only save leaves the numbers alone. */
    save: (Int?, Int?, PauseChange?, Boolean, (String?) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var draft by remember { mutableStateOf(data.budget.toInfo().budget) }
    val savedCap = data.budget.toInfo().pauseNewWhenReviewsOver
    var capDraft by remember { mutableStateOf(savedCap) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val savedNumbers = data.budget.toInfo().budget
    fun send(n: Int?, s: Int?, reset: Boolean = false) {
        busy = true
        error = null
        val numbers = reset || n != savedNumbers.newCardsPerDay || s != savedNumbers.secondaryCardsPerDay
        save(n, s, if (capDraft != savedCap) PauseChange(capDraft) else null, numbers) { e ->
            busy = false
            if (e == null) onDismiss() else error = e
        }
    }
    LabSheetFrame(onDismiss = onDismiss) {
        DailyBudgetForm(
            data, draft, { draft = it }, busy, error, online,
            onReset = { draft = data.default.toBudget(); send(null, null, reset = true) },
            onSave = { send(draft.newCardsPerDay, draft.secondaryCardsPerDay) },
            title = "Daily new cards",
            capDraft = capDraft,
            onCapDraft = { capDraft = it },
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
    title: String? = null,
    modifier: Modifier = Modifier,
    /** "Pause new cards on heavy days": what the field shows (null = off) and its change. */
    capDraft: Int? = data.budget.toInfo().pauseNewWhenReviewsOver,
    onCapDraft: (Int?) -> Unit = {},
) {
    val current = data.budget.toInfo().budget
    val capChanged = capDraft != data.budget.toInfo().pauseNewWhenReviewsOver
    val default = data.default.toBudget()
    SheetScaffold(
        modifier,
        spacing = 14.dp,
        header = title?.let { t -> { SheetTitle(t) } },
        footerAbove = if (error == null && online) null else {
            {
                error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                if (!online) InlineNotice("Needs a connection to save.", kind = NoticeKind.Offline)
            }
        },
        footer = {
            SecondaryPill(
                "Reset to default",
                Modifier.weight(1f).height(52.dp),
                enabled = !busy && online && !(data.budget.is_default && draft == default),
                onClick = onReset,
            )
            PrimaryPill(
                if (busy) "Saving…" else "Save",
                Modifier.weight(1f).height(52.dp),
                enabled = !busy && online && (draft != current || capChanged),
                onClick = onSave,
            )
        },
    ) {
        Stepper("New words a day", "Words they have never seen", draft.newCardsPerDay, { onDraft(draft.copy(newCardsPerDay = it.coerceIn(0, StudyBudget.MAX))) }, StudyBudget.MAX, !busy, accent = Palette.New)
        Stepper("Extra cards a day", "Other card types of words already started", draft.secondaryCardsPerDay, { onDraft(draft.copy(secondaryCardsPerDay = it.coerceIn(0, StudyBudget.MAX))) }, StudyBudget.MAX, !busy, accent = Palette.Secondary)
        val top = data.top_deck
        TutorBudget.budgetFinishHint(draft.newCardsPerDay, top?.name, top?.words_to_go)?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
        }
        ReviewLoadCapField(
            capDraft, onCapDraft, !busy,
            "On a day with more reviews due than this, they get no new cards — Up next waits too — just the reviews. ⚡ bumps and homework still come.",
        )
        Text(
            "They'll get a chat message from you when the numbers change, and can still change it in their Settings.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
    }
}
