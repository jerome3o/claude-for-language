package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ImportPlanner
import dev.jeromeswannack.chineselearning.lab.core.WordListParser
import dev.jeromeswannack.chineselearning.lab.data.api.StudentShareDto
import dev.jeromeswannack.chineselearning.lab.ui.cards.Field
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.StickyFooter
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

data class PasteActions(
    val onClose: () -> Unit = {},
    val onText: (String) -> Unit = {},
    val onColumnSeparator: (WordListParser.ColumnSeparator) -> Unit = {},
    val onCustomSeparator: (String) -> Unit = {},
    val onRowSeparator: (WordListParser.RowSeparator) -> Unit = {},
    val onPolicy: (ImportPlanner.Policy) -> Unit = {},
    val onGloss: () -> Unit = {},
    val onEnrich: () -> Unit = {},
    val onToggleEditing: (String) -> Unit = {},
    val onEdit: (String, (RowEdit) -> RowEdit) -> Unit = { _, _ -> },
    val onToggleExcluded: (String) -> Unit = {},
    val onToggleUnchanged: () -> Unit = {},
    val onSave: () -> Unit = {},
    val onUpdateShare: (StudentShareDto) -> Unit = {},
)

private const val PLACEHOLDER = "苹果\tpíng guǒ\tapple\n香蕉\txiāng jiāo\tbanana\n葡萄\n\nOne word per line — columns from a spreadsheet, \"苹果 apple\", or just the characters. Pinyin and English are filled in for you."

/** "Paste a list" (web: PasteWordsModal.tsx) as a full screen. */
@Composable
fun PasteWordsScreen(ui: PasteUi, actions: PasteActions) {
    LabScreenFrame {
        Column(Modifier.fillMaxSize()) {
            ScreenTitle(
                if (ui.stage == PasteStage.DONE) "Words saved" else "Paste a word list",
                subtitle = ui.deckName.ifEmpty { null },
                onBack = if (ui.stage == PasteStage.RUNNING) null else actions.onClose,
            )
            val listState = androidx.compose.foundation.lazy.rememberLazyListState()
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                when (ui.stage) {
                    PasteStage.EDIT -> editStage(ui, actions)
                    PasteStage.RUNNING -> item { Running(ui) }
                    PasteStage.DONE -> doneStage(ui, actions)
                }
            }
            // Save / Done pinned under the list (StickyFooter): the list of rows can be long.
            when (ui.stage) {
                PasteStage.EDIT -> Footer(ui, actions, moreAbove = listState.canScrollForward)
                PasteStage.DONE -> StickyFooter(moreAbove = listState.canScrollForward) {
                    PrimaryPill("Done", Modifier.weight(1f).height(52.dp)) { actions.onClose() }
                }
                PasteStage.RUNNING -> Unit
            }
        }
    }
}

private fun LazyListScope.editStage(ui: PasteUi, a: PasteActions) {
    val d = ui.derived
    item(key = "text") { Field("Word list", ui.inputs.text, lines = if (ui.inputs.text.isEmpty()) 7 else 4, hint = PLACEHOLDER, onChange = a.onText) }
    item(key = "options") { SeparatorOptions(ui, d, a) }
    if (d == null || d.parsed.rows.isEmpty()) return
    item(key = "policy") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Words already in this deck", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
            ChipRow {
                for ((p, label) in listOf(ImportPlanner.Policy.UPDATE to "Update them", ImportPlanner.Policy.SKIP to "Leave them as they are", ImportPlanner.Policy.DUPLICATE to "Add again as new cards")) {
                    LabChip(label, selected = ui.inputs.policy == p) { a.onPolicy(p) }
                }
            }
        }
    }
    item(key = "gloss") { GlossStep(ui, d, a) }
    item(key = "enrich") { EnrichStep(ui, d, a) }

    val groups = listOf(
        "Needs attention" to d.plan.filter { it.action == ImportPlanner.Action.PROBLEM },
        "Updates" to d.plan.filter { it.action == ImportPlanner.Action.UPDATE },
        "New words" to d.plan.filter { it.action == ImportPlanner.Action.ADD },
        "Skipped" to d.plan.filter { it.action == ImportPlanner.Action.SKIP },
    )
    for ((title, items) in groups) {
        if (items.isEmpty()) continue
        item(key = "h-$title") { SectionHeader("$title  ${items.size}") }
        for (p in items) item(key = "r-${p.row.index}") { PlanRow(p, ui, d, a) }
    }
    val unchanged = d.plan.filter { it.action == ImportPlanner.Action.UNCHANGED }
    if (unchanged.isNotEmpty()) {
        item(key = "h-same") {
            SectionHeader("Already the same  ${unchanged.size}") {
                Text(if (ui.showUnchanged) "Hide" else "Show", color = Lab.colors.accent, modifier = Modifier.clickable(onClick = a.onToggleUnchanged).padding(10.dp))
            }
        }
        if (ui.showUnchanged) for (p in unchanged) item(key = "r-${p.row.index}") { PlanRow(p, ui, d, a) }
    }
}

/** "Reading it as: …" with the separator overrides behind "Not parsed right?". */
@Composable
private fun SeparatorOptions(ui: PasteUi, d: PasteDerived?, a: PasteActions) {
    var open by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf(false) }
    val overridden = ui.inputs.columnSeparator != WordListParser.ColumnSeparator.AUTO || ui.inputs.rowSeparator != WordListParser.RowSeparator.AUTO
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.animateContentSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                d?.detectedCaption?.let { "Reading it as: $it" } ?: "Adding to ${ui.deckName} — paste a list, one word per line.",
                style = MaterialTheme.typography.bodySmall,
                color = Lab.colors.muted,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (open || overridden) "Hide options" else "Not parsed right?",
                color = Lab.colors.accent,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { open = !(open || overridden) }.padding(10.dp),
            )
        }
        if (open || overridden) {
            Text("Separator", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
            ChipRow {
                for ((sep, label) in listOf(
                    WordListParser.ColumnSeparator.AUTO to "Auto", WordListParser.ColumnSeparator.TAB to "Tab", WordListParser.ColumnSeparator.COMMA to "Comma",
                    WordListParser.ColumnSeparator.SPACE to "Space", WordListParser.ColumnSeparator.PIPE to "|", WordListParser.ColumnSeparator.COLON to "– / :",
                )) LabChip(label, selected = ui.inputs.columnSeparator == sep) { a.onColumnSeparator(sep) }
            }
            if (ui.inputs.columnSeparator == WordListParser.ColumnSeparator.CUSTOM || ui.inputs.customSeparator.isNotEmpty()) {
                Field("Custom separator", ui.inputs.customSeparator, hint = "e.g. --", onChange = a.onCustomSeparator)
            } else {
                Text("Custom…", color = Lab.colors.accent, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { a.onColumnSeparator(WordListParser.ColumnSeparator.CUSTOM) }.padding(vertical = 8.dp))
            }
            Text("One word per", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
            ChipRow {
                for ((sep, label) in listOf(WordListParser.RowSeparator.AUTO to "Auto", WordListParser.RowSeparator.NEWLINE to "Line", WordListParser.RowSeparator.SEMICOLON to "Semicolon")) {
                    LabChip(label, selected = ui.inputs.rowSeparator == sep) { a.onRowSeparator(sep) }
                }
            }
        }
    }
}

@Composable
private fun GlossStep(ui: PasteUi, d: PasteDerived, a: PasteActions) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (d.glossable.isNotEmpty() && ui.gloss != AiStep.UNAVAILABLE && ui.glossedText != ui.inputs.text) {
            SecondaryPill(
                when {
                    ui.gloss == AiStep.LOADING -> "Asking Claude…"
                    d.missingEnglish > 0 -> "✨ Fill in English with Claude (${d.missingEnglish})"
                    else -> "✨ Check pinyin with Claude"
                },
                enabled = ui.online && ui.gloss != AiStep.LOADING,
            ) { a.onGloss() }
        }
        if (ui.gloss == AiStep.IDLE && ui.glossedText == ui.inputs.text && d.glossable.isNotEmpty()) Muted("✨ Filled in by Claude — tap a row to change anything.")
        if (ui.gloss == AiStep.ERROR) InlineNotice("Claude could not fill these in — try again or type them.", kind = NoticeKind.Error)
        if (ui.gloss == AiStep.UNAVAILABLE) InlineNotice("Claude is not set up on this server — type the English yourself.", kind = NoticeKind.Warning)
    }
}

@Composable
private fun EnrichStep(ui: PasteUi, d: PasteDerived, a: PasteActions) {
    if (ui.enrich == AiStep.UNAVAILABLE) {
        InlineNotice("Claude is not set up on this server — explanations have to be typed by hand.", kind = NoticeKind.Warning)
        return
    }
    if (d.enrichable.isEmpty() && ui.enrichedText != ui.inputs.text) return
    val nudge = d.enrichable.isNotEmpty() && ui.enrich != AiStep.LOADING && ui.enrichedText != ui.inputs.text
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
            .background(if (nudge) Lab.colors.accentSoft else Lab.colors.card)
            .border(if (nudge) 1.5.dp else 0.dp, if (nudge) Lab.colors.accent.copy(alpha = 0.5f) else Color.Transparent, RoundedCornerShape(16.dp))
            .padding(14.dp)
            .animateContentSize(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when {
            ui.enrich == AiStep.LOADING -> {
                Muted("✨ Writing explanations and example sentences… ${ui.enrichDone} of ${ui.enrichTotal}")
                LinearProgressIndicator(
                    progress = { if (ui.enrichTotal == 0) 0f else ui.enrichDone.toFloat() / ui.enrichTotal },
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(3.dp)), color = Lab.colors.accent, trackColor = Lab.colors.faint,
                )
            }
            d.enrichable.isEmpty() -> Muted("✨ Every word has an explanation and an example sentence — tap a row to read or change them.")
            else -> {
                val n = d.enrichable.size
                Text("$n ${if (n == 1) "word has" else "words have"} no explanation or example sentence yet.", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Text("Cards study much better with both: the explanation goes on the back of the card and the sentence gets its own audio.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                PrimaryPill("✨ Write them with Claude (${minOf(n, PasteWordsViewModel.ENRICH_MAX)})", Modifier.height(48.dp), enabled = ui.online) { a.onEnrich() }
                if (ui.enrich == AiStep.ERROR) InlineNotice("Claude could not write these just now — try again, or save and add them later.", kind = NoticeKind.Error)
            }
        }
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)

@Composable
private fun PlanRow(p: ImportPlanner.Planned, ui: PasteUi, d: PasteDerived, a: PasteActions) {
    val x = d.byIndex(p.row.index) ?: return
    val row = x.row
    val editing = ui.editing == x.key
    val (chip, color) = when (p.action) {
        ImportPlanner.Action.ADD -> "New" to Palette.Good
        ImportPlanner.Action.UPDATE -> "Update" to Palette.Easy
        ImportPlanner.Action.UNCHANGED -> "Same" to Lab.colors.muted
        ImportPlanner.Action.SKIP -> (if (p.reason == "duplicate_in_paste") "Duplicate in paste" else if (p.reason == "policy") "Already in deck" else "Skipped") to Lab.colors.muted
        ImportPlanner.Action.PROBLEM -> (if (p.reason == "no_chinese") "No Chinese" else "Needs ${p.missing.joinToString(" + ")}") to Palette.Hard
    }
    LabCard(Modifier.animateContentSize()) {
        Row(Modifier.fillMaxWidth().clickable { a.onToggleEditing(x.key) }.padding(14.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.hanzi.ifEmpty { row.raw }, fontSize = 20.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val detail = listOfNotNull(
                    row.pinyin.ifEmpty { null }?.let { (if (x.filled.pinyin) "✨ " else "") + it },
                    row.english.ifEmpty { null }?.let { (if (x.filled.english) "✨ " else "") + it },
                ).joinToString(" · ")
                if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (row.sentence.isNotEmpty()) Text((if (x.filled.sentence) "✨ " else "") + row.sentence, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (row.notes.isNotEmpty()) Text(if (x.filled.notes) "✨ explanation written" else "has explanation", style = MaterialTheme.typography.labelSmall, color = Lab.colors.accent)
                if (x.readings.isNotEmpty()) Text("Check the reading: ${x.readings.joinToString(" / ")}", style = MaterialTheme.typography.labelMedium, color = Palette.Hard)
                if (p.action == ImportPlanner.Action.UPDATE) {
                    for (ch in p.changes) {
                        val field = when (ch.field) { "fun_facts" -> "notes"; "sentence_clue" -> "sentence"; else -> ch.field }
                        Row {
                            Text("$field  ", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                            Text(ch.from.ifEmpty { "—" }, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, textDecoration = TextDecoration.LineThrough, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                            Text(" → ${ch.to}", style = MaterialTheme.typography.labelSmall, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            Text(chip, color = color, style = MaterialTheme.typography.labelMedium, modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 4.dp))
        }
        AnimatedVisibility(editing) {
            Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                HorizontalDivider(color = Lab.colors.faint)
                Field("Hanzi", row.hanzi, big = true) { v -> a.onEdit(x.key) { it.copy(hanzi = v) } }
                Field("Pinyin", row.pinyin, hint = "píng guǒ") { v -> a.onEdit(x.key) { it.copy(pinyin = v) } }
                Field("English", row.english, hint = "apple") { v -> a.onEdit(x.key) { it.copy(english = v) } }
                Field("Example sentence (optional)", row.sentence, hint = "我每天吃一个苹果。") { v -> a.onEdit(x.key) { it.copy(sentence = v) } }
                Field("Explanation / fun facts (optional)", row.notes, lines = 4, hint = "苹 (píng) apple + 果 (guǒ) fruit") { v -> a.onEdit(x.key) { it.copy(notes = v) } }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { a.onToggleExcluded(x.key) }) {
                    Checkbox(checked = x.key in ui.inputs.excluded, onCheckedChange = { a.onToggleExcluded(x.key) }, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
                    Text("Skip this row", color = Lab.colors.ink)
                }
                SecondaryPill("Done") { a.onToggleEditing(x.key) }
            }
        }
    }
}

@Composable
private fun Footer(ui: PasteUi, a: PasteActions, moreAbove: Boolean) {
    val d = ui.derived
    val rows = d?.parsed?.rows?.size ?: 0
    StickyFooter(
        moreAbove = moreAbove,
        above = {
            Text(if (rows == 0) "Paste or type a list to see a preview." else PasteWordsModel.summaryLine(d!!.summary), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            if (!ui.online && rows > 0) Text("You are offline — saving needs internet.", style = MaterialTheme.typography.bodySmall, color = Palette.Again)
        },
    ) {
        SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp)) { a.onClose() }
        PrimaryPill(d?.let { PasteWordsModel.saveLabel(it.summary) } ?: "Add", Modifier.weight(1.4f).height(52.dp), enabled = ui.canSave) { a.onSave() }
    }
}

@Composable
private fun Running(ui: PasteUi) {
    Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        LinearProgressIndicator(
            progress = { if (ui.progressTotal == 0) 0f else ui.progressDone.toFloat() / ui.progressTotal },
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)), color = Lab.colors.accent, trackColor = Lab.colors.faint,
        )
        Text("Saving ${ui.current.orEmpty()} — ${ui.progressDone} of ${ui.progressTotal}", color = Lab.colors.ink, style = MaterialTheme.typography.bodyLarge)
    }
}

private fun LazyListScope.doneStage(ui: PasteUi, a: PasteActions) {
    val o = ui.outcome ?: return
    item(key = "done-line") {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val line = listOfNotNull(o.added.takeIf { it > 0 }?.let { "Added $it" }, o.updated.takeIf { it > 0 }?.let { "updated $it" }).joinToString(", ").ifEmpty { "Nothing to save" }
            Text(line + if (o.failed.isNotEmpty()) " · ${o.failed.size} failed" else "", style = MaterialTheme.typography.headlineSmall, color = Lab.colors.ink)
            if (o.added > 0) Muted("Audio and example sentences are generated in the background — give them a minute.")
        }
    }
    if (ui.savedBare > 0) item(key = "bare") {
        InlineNotice(
            "${ui.savedBare} ${if (ui.savedBare == 1) "word was" else "words were"} saved without an explanation. Paste the same list again and tap ✨ Write them with Claude to add explanations and example sentences — existing progress is kept.",
            kind = NoticeKind.Warning,
        )
    }
    for ((hanzi, error) in o.failed) item(key = "fail-$hanzi") { InlineNotice("$hanzi — $error", kind = NoticeKind.Error) }
    if (ui.shares.isNotEmpty()) {
        item(key = "shares-h") { SectionHeader("Send the changes to your students") }
        for (s in ui.shares) item(key = "share-${s.shared_deck_id}") {
            val st = ui.shareState[s.shared_deck_id]
            val behind = listOfNotNull(s.notes_missing.takeIf { it > 0 }?.let { "$it new" }, s.notes_behind.takeIf { it > 0 }?.let { "$it changed" }).joinToString(" · ")
            LabCard {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(s.student_name, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                        Muted(if (s.target_deleted) "no longer has this deck" else st?.note ?: if (behind.isNotEmpty()) "$behind waiting" else "up to date")
                    }
                    if (!s.target_deleted) SecondaryPill(if (st?.busy == true) "Updating…" else "Update their copy", enabled = st?.busy != true && ui.online) { a.onUpdateShare(s) }
                }
            }
        }
    }
}
