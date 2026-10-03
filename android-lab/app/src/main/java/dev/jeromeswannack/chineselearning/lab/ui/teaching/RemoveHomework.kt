package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkRemoval
import dev.jeromeswannack.chineselearning.lab.core.RemovalCopy
import dev.jeromeswannack.chineselearning.lab.core.RemovalFacts
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkRemovalResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.previewDeckRemoval
import dev.jeromeswannack.chineselearning.lab.data.api.previewLessonRemoval
import dev.jeromeswannack.chineselearning.lab.data.api.previewReaderRemoval
import dev.jeromeswannack.chineselearning.lab.data.api.removeStudentDeck
import dev.jeromeswannack.chineselearning.lab.data.api.removeStudentLesson
import dev.jeromeswannack.chineselearning.lab.data.api.removeStudentReader
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFormSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/*
 * Take homework back (web: RemoveHomeworkSheet + worker routes/homework-removal.ts). The words
 * are core's HomeworkRemoval (port of shared/homework/removal.ts, parity-tested).
 */

/**
 * What to take back. [id] = the share id or the student's copy id (deck / reader), the student's
 * lesson id (lesson). [title] as the tutor knows it (her deck's name, the lesson / reader title).
 * [copyGone]: the list already knows the student deleted their copy (reader row `target_deleted`).
 */
data class RemovalTarget(val kind: String, val id: String, val title: String, val copyGone: Boolean = false)

/** The confirm sheet's state. [copy] null = still checking (or [loadError]). */
data class RemovalSheetUi(
    val target: RemovalTarget,
    val studentName: String,
    val copy: RemovalCopy? = null,
    val loadError: String? = null,
    val deleteSource: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
)

data class RemovalSheetActions(
    val toggleSource: (Boolean) -> Unit = {},
    val confirm: () -> Unit = {},
    val dismiss: () -> Unit = {},
)

/** "Remove “HSK 1” from Jerome's decks?" — what happens in plain words, the copy option, Cancel / red Remove. */
@Composable
fun RemoveHomeworkSheet(ui: RemovalSheetUi, actions: RemovalSheetActions) {
    val copy = ui.copy
    LabFormSheet(
        onDismiss = { if (!ui.busy) actions.dismiss() },
        title = copy?.title ?: "Remove homework",
        spacing = 12.dp,
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
        footerAbove = ui.error?.let { e -> { InlineNotice(e, kind = NoticeKind.Error) } },
        footer = {
            SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp), enabled = !ui.busy, onClick = actions.dismiss)
            PrimaryPill(
                if (ui.busy) "Removing…" else copy?.confirmLabel ?: "Remove",
                Modifier.weight(1f).height(52.dp), enabled = copy != null && !ui.busy, color = Palette.Again, onClick = actions.confirm,
            )
        },
    ) {
        run {
            when {
                ui.loadError != null -> InlineNotice(ui.loadError, kind = NoticeKind.Error)
                copy == null -> MutedLine("Checking what ${ui.studentName.trim().split(Regex("\\s+")).firstOrNull()?.ifEmpty { null } ?: "they"} has done…")
                else -> {
                    Text(copy.body, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                    Text(copy.detail, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    copy.sourceOption?.let { option ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                                .clickable(enabled = !ui.busy) { actions.toggleSource(!ui.deleteSource) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(ui.deleteSource, { actions.toggleSource(it) }, enabled = !ui.busy, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
                            Text(
                                buildAnnotatedString {
                                    append(option)
                                    withStyle(SpanStyle(color = Lab.colors.muted)) { append(" — “${ui.target.title}” in your decks; no other student has it") }
                                },
                                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The facts the words need, from a preview (web: RemoveHomeworkSheet's `removalCopy(...)` call). */
internal fun deckFacts(t: RemovalTarget, wordsMet: Int, wordsTotal: Int, copyGone: Boolean, canDeleteSource: Boolean) =
    RemovalFacts(HomeworkRemoval.DECK, t.title, wordsMet = wordsMet, wordsTotal = wordsTotal, copyGone = copyGone, canDeleteSource = canDeleteSource)

/**
 * Owns the confirm sheet for one relationship: fetches the preview, removes, then reports the
 * toast. Online-only (the removal is not an idempotent outbox write): failures are sentences in
 * the sheet. [onRemoved] refreshes the lists; [toast] is the floating confirmation.
 */
class HomeworkRemovalController(
    private val app: LabApp,
    private val scope: CoroutineScope,
    /** The relationship, read when the sheet opens (the call review learns it after loading). */
    private val relIdOf: () -> String?,
    private val onRemoved: suspend (RemovalTarget, HomeworkRemovalResultDto) -> Unit = { _, _ -> },
) {
    constructor(app: LabApp, scope: CoroutineScope, relId: String, onRemoved: suspend (RemovalTarget, HomeworkRemovalResultDto) -> Unit = { _, _ -> }) :
        this(app, scope, { relId }, onRemoved)

    private val _sheet = MutableStateFlow<RemovalSheetUi?>(null)
    val sheet: StateFlow<RemovalSheetUi?> = _sheet.asStateFlow()
    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast.asStateFlow()
    private var toastJob: Job? = null

    val actions = RemovalSheetActions(
        toggleSource = { on -> _sheet.update { it?.copy(deleteSource = on) } },
        confirm = { confirm() },
        dismiss = { _sheet.value = null },
    )

    fun start(target: RemovalTarget, studentName: String) {
        val relId = relIdOf() ?: return
        _sheet.value = RemovalSheetUi(target, studentName)
        scope.launch {
            val api = app.repo.api
            attempt {
                when (target.kind) {
                    HomeworkRemoval.DECK -> api.previewDeckRemoval(relId, target.id).let { p ->
                        deckFacts(target, p.words_met, p.words_total, p.deck_name == null, p.can_delete_source)
                    }
                    HomeworkRemoval.LESSON -> api.previewLessonRemoval(relId, target.id).let { p ->
                        RemovalFacts(HomeworkRemoval.LESSON, target.title, times = p.completions)
                    }
                    else -> api.previewReaderRemoval(relId, target.id).let { p ->
                        RemovalFacts(HomeworkRemoval.READER, target.title, times = p.readings, copyGone = p.title == null || target.copyGone)
                    }
                }
            }
                .onSuccess { facts -> _sheet.update { s -> if (s?.target == target) s.copy(copy = HomeworkRemoval.removalCopy(facts, studentName)) else s } }
                .onFailure { e -> _sheet.update { s -> if (s?.target == target) s.copy(loadError = e.userMessage().ifBlank { "Could not load" }) else s } }
        }
    }

    private fun confirm() {
        val s = _sheet.value ?: return
        if (s.copy == null || s.busy) return
        val relId = relIdOf() ?: return
        _sheet.value = s.copy(busy = true, error = null)
        scope.launch {
            val api = app.repo.api
            val t = s.target
            attempt {
                when (t.kind) {
                    HomeworkRemoval.DECK -> api.removeStudentDeck(relId, t.id, s.deleteSource && s.copy.sourceOption != null)
                    HomeworkRemoval.LESSON -> api.removeStudentLesson(relId, t.id)
                    else -> api.removeStudentReader(relId, t.id)
                }
            }
                .onSuccess { result ->
                    _sheet.value = null
                    app.haptics.correct()
                    app.sounds.play(Sounds.Sfx.POP)
                    showToast(HomeworkRemoval.removalToast(t.kind, t.title, s.studentName, result.source_deleted))
                    onRemoved(t, result)
                }
                .onFailure { e ->
                    app.haptics.wrong()
                    _sheet.update { it?.copy(busy = false, error = e.userMessage().ifBlank { "Could not remove it" }) }
                }
        }
    }

    private fun showToast(text: String) {
        toastJob?.cancel()
        _toast.value = text
        toastJob = scope.launch { delay(4_500); _toast.value = null }
    }
}
