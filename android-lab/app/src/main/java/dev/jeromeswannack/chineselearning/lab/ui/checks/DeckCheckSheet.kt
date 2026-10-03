package dev.jeromeswannack.chineselearning.lab.ui.checks

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardCheck
import dev.jeromeswannack.chineselearning.lab.core.DeckCheckProposal
import dev.jeromeswannack.chineselearning.lab.data.api.DeckCheckScope
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabToast
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

data class DeckCheckActions(
    val onStart: () -> Unit = {},
    val onToggle: (String) -> Unit = {},
    val onAlsoSource: (Boolean) -> Unit = {},
    val onApply: () -> Unit = {},
    val onCheckAgain: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onClose: () -> Unit = {},
)

const val DECK_CHECK_INTRO =
    "Claude reads every word's pinyin and English and lists likely mistakes — wrong tones, a missing 一/不 tone change, " +
        "the wrong reading of a character, a misleading meaning. Nothing changes until you apply it."

/** "🔎 Check for errors" over the deck page / the tutor's student page; creates its own view model. */
@Composable
fun DeckCheckSheetRoute(app: LabApp, scope: DeckCheckScope, onClose: () -> Unit) {
    val vm: DeckCheckViewModel = viewModel(
        key = "deck-check-${scope.path}",
        factory = DeckCheckViewModel.Factory(app.repo.api, scope, app.online, onApplied = { app.scope.launch { app.repo.sync() } }),
    )
    val ui by vm.ui.collectAsStateWithLifecycle()
    LabSheetFrame(onDismiss = onClose) {
        DeckCheckContent(
            ui,
            DeckCheckActions(
                onStart = vm::start,
                onToggle = vm::toggle,
                onAlsoSource = vm::setAlsoSource,
                onApply = vm::apply,
                onCheckAgain = vm::checkAgain,
                onRetry = vm::load,
                onClose = onClose,
            ),
        )
    }
}

/** The sheet's body (stateless, screenshot-tested): intro → running → results. */
@Composable
fun DeckCheckContent(ui: DeckCheckUi, actions: DeckCheckActions, modifier: Modifier = Modifier) {
    Box(modifier) {
        SheetScaffold(
            header = {
                SheetTitle("🔎 Check for errors")
                ui.deckName?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 6.dp))
                }
            },
            footerAbove = footerAbove(ui, actions),
            footer = footer(ui, actions),
        ) {
            when (ui.stage) {
                DeckCheckStage.LOADING -> LoadingState()
                DeckCheckStage.INTRO -> Intro(ui)
                DeckCheckStage.RUNNING -> Running(ui)
                DeckCheckStage.RESULTS -> Results(ui, actions)
            }
            if (ui.error != null && ui.stage != DeckCheckStage.INTRO) InlineNotice(ui.error, kind = NoticeKind.Error)
            if (ui.failures.isNotEmpty()) {
                InlineNotice("Couldn't apply ${ui.failures.size}:\n" + ui.failures.joinToString("\n"), kind = NoticeKind.Error)
            }
        }
        LabToast(ui.toast, Modifier.align(Alignment.BottomCenter).padding(bottom = 64.dp))
    }
}

private fun footerAbove(ui: DeckCheckUi, actions: DeckCheckActions): (@Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit)? = when {
    ui.stage == DeckCheckStage.INTRO && ui.error != null -> { { InlineNotice(ui.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRetry) } }
    ui.stage == DeckCheckStage.INTRO && !ui.online -> { { InlineNotice("You're offline — checking needs a connection.", kind = NoticeKind.Offline) } }
    ui.stage == DeckCheckStage.RESULTS && ui.canFixSource && ui.open.isNotEmpty() -> {
        {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).clickable { actions.onAlsoSource(!ui.alsoSource) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = ui.alsoSource, onCheckedChange = actions.onAlsoSource, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
                Text("Also fix my source deck", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            }
        }
    }
    else -> null
}

private fun footer(ui: DeckCheckUi, actions: DeckCheckActions): (@Composable androidx.compose.foundation.layout.RowScope.() -> Unit)? = when (ui.stage) {
    DeckCheckStage.LOADING -> null
    DeckCheckStage.INTRO -> {
        {
            val words = ui.estimate?.words ?: 0
            PrimaryPill(
                if (ui.starting) "Starting…" else "Check $words word${if (words == 1) "" else "s"}",
                Modifier.weight(1f).height(52.dp),
                enabled = ui.online && words > 0 && !ui.starting,
            ) { actions.onStart() }
        }
    }
    DeckCheckStage.RUNNING -> { { SecondaryPill("Close — it keeps going", Modifier.weight(1f).height(52.dp)) { actions.onClose() } } }
    DeckCheckStage.RESULTS -> {
        {
            if (ui.open.isEmpty()) {
                PrimaryPill("Done", Modifier.weight(1f).height(52.dp)) { actions.onClose() }
            } else {
                PrimaryPill(
                    if (ui.applying) "Applying…" else "Apply selected (${ui.selectedCount})",
                    Modifier.weight(1f).height(52.dp),
                    enabled = ui.online && ui.selectedCount > 0 && !ui.applying,
                ) { actions.onApply() }
            }
        }
    }
}

@Composable
private fun Intro(ui: DeckCheckUi) {
    Text(DECK_CHECK_INTRO, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
    ui.estimate?.let { e ->
        Text(
            e.label,
            style = MaterialTheme.typography.bodyMedium,
            color = Lab.colors.muted,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint.copy(alpha = 0.5f)).padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
    ui.job?.takeIf { it.status == "done" || it.status == "failed" }?.let { job ->
        Text("Last check: ${CardCheck.deckCheckSummary(job.status, job.total, job.checked, job.proposals)}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}

@Composable
private fun Running(ui: DeckCheckUi) {
    val job = ui.job
    val total = job?.total ?: 0
    val checked = job?.checked ?: 0
    Spacer(Modifier.height(4.dp))
    LinearProgressIndicator(
        progress = { if (total == 0) 0f else checked.toFloat() / total },
        modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
        color = Lab.colors.accent,
        trackColor = Lab.colors.faint,
    )
    ui.summary?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink) }
    Text("You can close this — the check keeps going and the results wait here.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
}

@Composable
private fun Results(ui: DeckCheckUi, actions: DeckCheckActions) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        ui.summary?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)) }
        Text(
            "Check again",
            color = Lab.colors.accent,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(12.dp)).clickable { actions.onCheckAgain() }.padding(horizontal = 8.dp, vertical = 10.dp),
        )
    }
    ui.job?.proposals.orEmpty().forEach { p -> ProposalRow(p, p.id in ui.selected, actions.onToggle) }
}

@Composable
private fun ProposalRow(p: DeckCheckProposal, checked: Boolean, onToggle: (String) -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (p.applied) Palette.Good.copy(alpha = 0.08f) else if (checked) Lab.colors.accentSoft else Lab.colors.faint.copy(alpha = 0.35f))
            .then(if (p.applied) Modifier else Modifier.clickable { onToggle(p.id) })
            .padding(end = 12.dp, top = 8.dp, bottom = 8.dp, start = if (p.applied) 12.dp else 0.dp)
            .animateContentSize(),
        verticalAlignment = Alignment.Top,
    ) {
        if (!p.applied) Checkbox(checked = checked, onCheckedChange = { onToggle(p.id) }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
        Column(Modifier.weight(1f).padding(top = if (p.applied) 0.dp else 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p.hanzi, fontSize = 20.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                Spacer(Modifier.width(8.dp))
                Text(CardCheck.fieldLabel(p.field), style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                Spacer(Modifier.weight(1f))
                if (p.applied) Text("✓ Applied", style = MaterialTheme.typography.labelLarge, color = Palette.Good, fontWeight = FontWeight.SemiBold)
            }
            CheckChangeLine(null, p.current, p.proposed)
            if (p.reason.isNotBlank()) Text(p.reason, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}
