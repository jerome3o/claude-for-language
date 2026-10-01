package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.testTag
import dev.jeromeswannack.chineselearning.lab.core.McOptions
import kotlinx.coroutines.launch
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags: the grid's scrolling rows and the always-visible submit button. */
const val MC_ROWS_TAG = "mc-rows"
const val MC_SUBMIT_TAG = "mc-submit"

/**
 * The multiple-choice grid (StudyPage.tsx `renderMultipleChoiceGrid`): one row of options
 * per character (punctuation / English rows shown as text, pre-selected). ONE tap flips the
 * card with whatever is picked so far — "Show answer" while nothing is picked, "Submit" once
 * something is; there is no check / continue step. [onSubmit] gets the review's answer
 * ([MultipleChoice.submittedAnswer]: picks in row order, "" for none) and the per-row result
 * the back shows ([MultipleChoice.answerSlots]).
 *
 * A long answer (a whole sentence: a dozen rows) never pushes the button off screen: the rows
 * scroll in whatever height [modifier] leaves them, the button and "Type instead" stay pinned
 * under them, a pick scrolls the next unanswered row into view, and past
 * [McOptions.COMPACT_AFTER_ROWS] rows the tiles shrink (48dp, still ≥ 44dp touch targets).
 */
@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun McGrid(
    rows: List<MultipleChoice.Row>,
    aiAvailable: Boolean,
    regenerating: Boolean,
    onSubmit: (answer: String, slots: List<MultipleChoice.Slot>) -> Unit,
    onTypeInstead: () -> Unit,
    onRegenerate: () -> Unit,
    onPick: () -> Unit = {},
    startSelections: List<String?>? = null,
    modifier: Modifier = Modifier,
    scroll: ScrollState = rememberScrollState(),
) {
    var selections by remember(rows) { mutableStateOf(startSelections ?: MultipleChoice.initialSelections(rows)) }
    val compact = remember(rows) { MultipleChoice.isCompact(rows) }
    val tile = if (compact) 48.dp else 56.dp
    val gap = if (compact) 6.dp else 8.dp
    val glyph = if (compact) 22.sp else 26.sp
    val requesters = remember(rows) { List(rows.size) { BringIntoViewRequester() } }
    val scope = rememberCoroutineScope()
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            Modifier
                .weight(1f, fill = false)
                .fillMaxWidth()
                .testTag(MC_ROWS_TAG)
                .verticalScroll(scroll),
            verticalArrangement = Arrangement.spacedBy(gap),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            rows.forEachIndexed { r, row ->
                if (!MultipleChoice.isChoiceRow(row)) {
                    // Punctuation / English text: given, so a slim line — not a full-height row.
                    val punct = !MultipleChoice.isEnglishEntry(row.correct)
                    Text(
                        row.correct,
                        fontSize = if (punct) 18.sp else 20.sp,
                        lineHeight = if (punct) 18.sp else 24.sp,
                        color = if (punct) Lab.colors.muted else Lab.colors.ink,
                        modifier = Modifier.bringIntoViewRequester(requesters[r]),
                    )
                } else {
                    FlowRow(
                        Modifier.fillMaxWidth().bringIntoViewRequester(requesters[r]),
                        horizontalArrangement = Arrangement.spacedBy(gap, Alignment.CenterHorizontally),
                        verticalArrangement = Arrangement.spacedBy(gap),
                    ) {
                        for (opt in row.options) {
                            val selected = selections.getOrNull(r) == opt
                            val border by animateColorAsState(if (selected) Lab.colors.accent else Lab.colors.cardBorder, label = "mc")
                            val fill = if (selected) Lab.colors.accentSoft else Lab.colors.card
                            Box(
                                Modifier
                                    .widthIn(min = tile)
                                    .heightIn(min = tile)
                                    .clip(RoundedCornerShape(if (compact) 12.dp else 14.dp))
                                    .background(fill)
                                    .border(2.dp, border, RoundedCornerShape(if (compact) 12.dp else 14.dp))
                                    .bouncyClickable(pressedScale = 0.9f) {
                                        val next = selections.toMutableList().also { it[r] = opt }
                                        selections = next
                                        onPick()
                                        MultipleChoice.nextUnansweredRow(rows, next, r)?.let { n ->
                                            scope.launch { requesters[n].bringIntoView() }
                                        }
                                    },
                                contentAlignment = Alignment.Center,
                            ) { Text(opt, fontSize = glyph, lineHeight = glyph, color = Lab.colors.ink, fontWeight = FontWeight.Medium) }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(if (compact) 8.dp else 10.dp))
        PrimaryPill(MultipleChoice.submitLabel(rows, selections), Modifier.fillMaxWidth().height(54.dp).testTag(MC_SUBMIT_TAG)) {
            onSubmit(MultipleChoice.submittedAnswer(rows, selections), MultipleChoice.answerSlots(rows, selections))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onTypeInstead) { Text("Type instead", color = Lab.colors.muted) }
            TextButton(onClick = onRegenerate, enabled = aiAvailable && !regenerating) {
                Text(if (regenerating) "Regenerating…" else if (aiAvailable) "Regenerate" else "Regenerate · $NEEDS_INTERNET", color = if (aiAvailable) Lab.colors.accent else Lab.colors.muted)
            }
        }
    }
}

/**
 * The answer side for a multiple-choice answer that isn't fully right (StudyPage.tsx
 * `McAnswerDiff`): each row's pick in green / red + underlined, a skipped row as a "?" with a
 * dashed underline ([AnswerMarks]),
 * "N of M left blank", then the answer with the missed rows marked. Characters are tappable.
 */
@Composable
fun McAnswerDiff(slots: List<MultipleChoice.Slot>, size: TextUnit, onChar: (String) -> Unit) {
    val picked = slots.joinToString("") { it.chosen.orEmpty() }
    val choiceRows = slots.count { it.status != MultipleChoice.SlotStatus.GIVEN }
    val skipped = slots.count { it.status == MultipleChoice.SlotStatus.SKIPPED }
    val muted = Lab.colors.muted
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        // Each row's pick: green when right, red + underlined when wrong, a "?" with a dashed underline when blank.
        MarkedAnswerRow(slots.map(AnswerMarks::forSlot), size * 0.8f, onChar)
        if (picked.isNotEmpty()) Text(Pinyin.of(picked), style = MaterialTheme.typography.bodyMedium, color = muted, textAlign = TextAlign.Center)
        if (skipped > 0) Text("$skipped of $choiceRows left blank", style = MaterialTheme.typography.labelMedium, color = muted)
        Text("↓", color = muted)
        ExpectedAnswerRow(
            slots.map { it.correct },
            slots.map { it.status == MultipleChoice.SlotStatus.RIGHT || it.status == MultipleChoice.SlotStatus.GIVEN },
            size, Lab.colors.ink, onChar,
        )
    }
}

/** Auto multiple choice still loading (≤ 8 s): no flash of the typing box, with an escape hatch. */
@Composable
fun McLoading(onTypeInstead: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        CircularProgressIndicator(Modifier.size(26.dp), strokeWidth = 2.5.dp, color = Lab.colors.accent)
        Text("Generating options…", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        TextButton(onClick = onTypeInstead) { Text("Type instead", color = Lab.colors.accent) }
    }
}
