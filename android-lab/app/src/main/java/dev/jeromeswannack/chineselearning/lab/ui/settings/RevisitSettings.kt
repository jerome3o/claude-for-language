package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Revisit
import dev.jeromeswannack.chineselearning.lab.core.RevisitSettings
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.revisit.RevisitStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One field of Settings → "Lessons & readers" (RevisitSettingsSection's FIELDS). */
private data class RevisitField(val key: String, val label: String, val hint: String, val unit: String)

private val FIELDS = listOf(
    RevisitField("hard_days", "Hard", "First gap after Hard", "days"),
    RevisitField("good_days", "Good", "First gap after Good", "days"),
    RevisitField("easy_days", "Easy", "First gap after Easy", "days"),
    RevisitField("growth", "Growth", "Each later visit multiplies the gap", "×"),
    RevisitField("cap_days", "Longest gap", "Never longer than", "days"),
)

/** `toDraft`: the saved settings as the fields' text. */
fun revisitDraft(s: RevisitSettings): Map<String, String> = Revisit.KEYS.associateWith { Js.numberToString(s[it]) }

/** What the section shows: the saved settings, the fields as typed, and the save state. */
data class RevisitSettingsUi(
    val saved: RevisitSettings = Revisit.DEFAULT,
    val draft: Map<String, String> = revisitDraft(Revisit.DEFAULT),
    val busy: Boolean = false,
    val savedFlash: Boolean = false,
    /** The server's problems (or the error) from the last save. */
    val problems: List<String> = emptyList(),
    val online: Boolean = true,
) {
    private val pick get() = Revisit.pickUpdate(draft, saved)
    val draftProblems: List<String> get() = pick.problems
    /** `dirty`: a field differs from the saved value (Number(draft) !== saved). */
    val dirty: Boolean get() = Revisit.KEYS.any { k -> draft[k].orEmpty().trim().toDoubleOrNull() != saved[k] }
    /** The settings the "Good each time" chain shows: the draft when it is valid, else the saved ones. */
    val preview: RevisitSettings get() = if (draftProblems.isNotEmpty()) saved else Revisit.applyUpdate(saved, pick.update.filterValues { it != null })
    /** The changed fields only (the PUT body). */
    val changes: Map<String, Double> get() = pick.update.mapNotNull { (k, v) -> if (v != null && v != saved[k]) k to v else null }.toMap()
    val isDefault: Boolean get() = Revisit.isDefault(saved)
    /** What the red line shows: the save's problems, else the draft's while it is edited. */
    val shownProblems: List<String> get() = problems.ifEmpty { if (dirty) draftProblems else emptyList() }
}

class RevisitSettingsActions(
    val onChange: (key: String, text: String) -> Unit = { _, _ -> },
    val onSave: () -> Unit = {},
    val onReset: () -> Unit = {},
)

/** Test tag of the section (web: data-testid="revisit-settings"). */
const val REVISIT_SETTINGS_TAG = "revisit-settings"

/**
 * Settings → "Lessons & readers" (the web's RevisitSettingsSection): when a finished mini lesson
 * or graded reader comes back — the Hard / Good / Easy gaps, the growth, the longest gap; the
 * "Good each time" chain follows the fields as they're typed; Save, Reset to defaults; the
 * problems (shared/study/revisit.ts, verbatim) inline. Saving needs a connection; the saved
 * settings live on the phone so the schedule works offline.
 */
@Composable
fun RevisitSettingsSection(ui: RevisitSettingsUi, actions: RevisitSettingsActions) {
    SettingsSection(
        "Lessons & readers",
        "When a finished mini lesson or story comes back. Again brings it back tomorrow; each later visit makes the gap longer. Done for good after finishing means it never comes back.",
        Modifier.testTag(REVISIT_SETTINGS_TAG),
    ) {
        FIELDS.forEach { f -> FieldRow(f, ui.draft[f.key].orEmpty(), !ui.busy) { actions.onChange(f.key, it) } }
        Text(
            "Good each time: ${Revisit.goodChain(ui.preview)}",
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            color = Lab.colors.accent,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PrimaryPill(
                when {
                    ui.busy -> "Saving…"
                    ui.savedFlash -> "Saved ✓"
                    else -> "Save"
                },
                enabled = !ui.busy && ui.dirty && ui.online,
                color = if (ui.savedFlash) Palette.Good else Lab.colors.accent,
                onClick = actions.onSave,
            )
            SecondaryPill("Reset to defaults", enabled = !ui.busy && ui.online && !(ui.isDefault && !ui.dirty), onClick = actions.onReset)
        }
        if (ui.dirty && !ui.online) StatusLine("Needs a connection to save.")
        if (ui.isDefault && !ui.dirty) {
            val d = Revisit.DEFAULT
            Text(
                "Defaults: Hard ${Js.numberToString(d.hardDays)} days · Good ${Js.numberToString(d.goodDays)} days · Easy ${Js.numberToString(d.easyDays)} days · ×${Js.numberToString(d.growth)} · at most ${Js.numberToString(d.capDays)} days.",
                style = MaterialTheme.typography.bodySmall,
                color = Lab.colors.muted,
            )
        }
        if (ui.shownProblems.isNotEmpty()) InlineNotice(ui.shownProblems.joinToString(" · "), kind = NoticeKind.Error)
    }
}

@Composable
private fun FieldRow(f: RevisitField, value: String, enabled: Boolean, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(f.label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
            Text(f.hint, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            enabled = enabled,
            singleLine = true,
            modifier = Modifier.width(88.dp).testTag("revisit-${f.key}").semantics { contentDescription = "${f.label} (${f.unit})" },
            textStyle = TextStyle(fontSize = 17.sp, color = Lab.colors.ink, textAlign = TextAlign.Center, fontWeight = FontWeight.SemiBold),
            keyboardOptions = KeyboardOptions(keyboardType = if (f.key == "growth") KeyboardType.Decimal else KeyboardType.Number),
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Lab.colors.accent,
                unfocusedBorderColor = Lab.colors.cardBorder,
                focusedContainerColor = Lab.colors.background,
                unfocusedContainerColor = Lab.colors.background,
                cursorColor = Lab.colors.accent,
            ),
        )
        Spacer(Modifier.width(8.dp))
        Text(f.unit, color = Lab.colors.muted, modifier = Modifier.width(36.dp))
    }
}

/** The section with its state: the phone's saved settings (cached, offline), saves through the API. */
@Composable
fun RevisitSettingsCard(app: LabApp) {
    val store = remember(app) { RevisitStore(app.cache, app.outbox, app.repo.api) }
    val saved by store.observeSettings().collectAsStateWithLifecycle(Revisit.DEFAULT)
    val online by app.online.collectAsStateWithLifecycle()
    var draft by remember { mutableStateOf(revisitDraft(saved)) }
    var busy by remember { mutableStateOf(false) }
    var flash by remember { mutableStateOf(false) }
    var problems by remember { mutableStateOf(emptyList<String>()) }
    // A sync brought new settings (or the cache loaded): the fields follow.
    LaunchedEffect(saved) { draft = revisitDraft(saved) }
    val scope = rememberCoroutineScope()
    val ui = RevisitSettingsUi(saved, draft, busy, flash, problems, online)
    fun run(changes: Map<String, Double>, reset: Boolean) {
        busy = true
        problems = emptyList()
        scope.launch {
            try {
                val next = store.saveSettings(changes, reset)
                draft = revisitDraft(next)
                app.haptics.tick()
                flash = true
                busy = false
                delay(2_500)
                flash = false
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val p = (e as? HttpException)?.problems().orEmpty()
                problems = p.ifEmpty { listOf(e.userMessage()) }
                busy = false
            }
        }
    }
    RevisitSettingsSection(
        ui,
        RevisitSettingsActions(
            onChange = { key, text -> draft = draft + (key to text); problems = emptyList() },
            onSave = {
                if (ui.draftProblems.isNotEmpty()) problems = ui.draftProblems
                else run(ui.changes, reset = false)
            },
            onReset = { run(emptyMap(), reset = true) },
        ),
    )
}
