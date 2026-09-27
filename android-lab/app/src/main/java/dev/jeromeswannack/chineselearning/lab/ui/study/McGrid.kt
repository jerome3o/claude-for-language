package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/**
 * The multiple-choice grid (StudyPage.tsx `renderMultipleChoiceGrid`): one row of options
 * per character (punctuation / English rows shown as text, pre-selected), Check Answer
 * once every row is chosen, then right in green / wrong in red and Continue.
 * [onContinue] gets the chosen characters joined — the typed answer the back diffs.
 */
@Composable
fun McGrid(
    rows: List<MultipleChoice.Row>,
    aiAvailable: Boolean,
    regenerating: Boolean,
    onContinue: (String) -> Unit,
    onTypeInstead: () -> Unit,
    onRegenerate: () -> Unit,
    onPick: () -> Unit = {},
    startSelections: List<String?>? = null,
    startSubmitted: Boolean = false,
) {
    var selections by remember(rows) { mutableStateOf(startSelections ?: MultipleChoice.initialSelections(rows)) }
    var submitted by remember(rows) { mutableStateOf(startSubmitted) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        rows.forEachIndexed { r, row ->
            if (row.options.size == 1 || MultipleChoice.isEnglishEntry(row.correct)) {
                Text(row.correct, fontSize = 22.sp, color = Lab.colors.ink, modifier = Modifier.padding(4.dp))
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (opt in row.options) {
                        val selected = selections.getOrNull(r) == opt
                        val correct = opt == row.correct
                        val border by animateColorAsState(
                            when {
                                submitted && correct -> Palette.Good
                                submitted && selected -> Palette.Again
                                selected -> Lab.colors.accent
                                else -> Lab.colors.cardBorder
                            },
                            label = "mc",
                        )
                        val fill = when {
                            submitted && correct -> Palette.Good.copy(alpha = 0.18f)
                            submitted && selected -> Palette.Again.copy(alpha = 0.18f)
                            selected -> Lab.colors.accentSoft
                            else -> Lab.colors.card
                        }
                        Box(
                            Modifier
                                .widthIn(min = 56.dp)
                                .heightIn(min = 56.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(fill)
                                .border(2.dp, border, RoundedCornerShape(14.dp))
                                .bouncyClickable(enabled = !submitted, pressedScale = 0.9f) {
                                    selections = selections.toMutableList().also { it[r] = opt }
                                    onPick()
                                },
                            contentAlignment = Alignment.Center,
                        ) { Text(opt, fontSize = 26.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium) }
                    }
                }
            }
        }
        val all = selections.all { it != null }
        if (!submitted) {
            PrimaryPill("Check answer", Modifier.fillMaxWidth().height(54.dp), enabled = all) { submitted = true }
        } else {
            PrimaryPill("Continue", Modifier.fillMaxWidth().height(54.dp)) { onContinue(selections.joinToString("") { it.orEmpty() }) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onTypeInstead) { Text("Type instead", color = Lab.colors.muted) }
            TextButton(onClick = onRegenerate, enabled = aiAvailable && !regenerating) {
                Text(if (regenerating) "Regenerating…" else if (aiAvailable) "Regenerate" else "Regenerate · $NEEDS_INTERNET", color = if (aiAvailable) Lab.colors.accent else Lab.colors.muted)
            }
        }
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
