package dev.jeromeswannack.chineselearning.lab.ui.strokes

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.WritingExerciseResult
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** A word the practice page can offer (from the learner's notes). */
data class PracticeWord(val hanzi: String, val pinyin: String? = null, val english: String? = null)

data class StrokePracticeUi(
    /** The word being written (`?text=`), blank = pick one. */
    val text: String = "",
    /** The note it came from (for the pinyin / English prompt), if any. */
    val found: PracticeWord? = null,
    /** Recently studied words, newest first; empty → the starter words. */
    val recent: List<PracticeWord>? = null,
    /** Characters from the decks: total and how many are saved on this phone (null = checking). */
    val offlineTotal: Int? = null,
    val offlineCached: Int = 0,
    val saving: Pair<Int, Int>? = null,
    val saveNote: String? = null,
    /** Bumped to restart the run for the same word. */
    val runKey: Int = 0,
)

data class StrokePracticeActions(
    val onBack: (() -> Unit)? = null,
    val onPick: (String) -> Unit = {},
    val onSaveAll: () -> Unit = {},
    val onComplete: (WritingExerciseResult) -> Unit = {},
    /** Stroke-data source (tests pass their own; null = the app's StrokeStore). */
    val loader: (suspend (String) -> StrokeLoad)? = null,
)

/** Port of the web's `STARTERS`. */
val STROKE_STARTERS = listOf("一", "十", "人", "口", "大", "你好", "中国", "谢谢")

/**
 * `/practice/strokes` — handwriting with stroke-order feedback (the web's
 * StrokePracticePage): pick or type a word, write it in Trace or From memory, and keep the
 * characters of your decks on the phone for the train.
 */
@Composable
fun StrokePracticeScreen(ui: StrokePracticeUi, actions: StrokePracticeActions) {
    var draft by remember(ui.text) { mutableStateOf(ui.text) }
    LabScreen("Write characters", onBack = actions.onBack, subtitle = "Preview · every stroke checked as you go") {
        if (ui.text.isEmpty()) {
            item {
                Text(
                    "Draw each stroke with your finger or a stylus — every stroke is checked as you go: the right stroke, in the right order, in the right direction.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Lab.colors.muted,
                )
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text("Type a character or word, e.g. 你好") },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { if (draft.isNotBlank()) actions.onPick(draft.trim()) }),
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.card, unfocusedContainerColor = Lab.colors.card),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                PrimaryPill("Write", Modifier.height(56.dp), enabled = draft.isNotBlank()) { actions.onPick(draft.trim()) }
            }
        }
        item {
            val recent = ui.recent
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (!recent.isNullOrEmpty()) "Your recent words" else "Try", fontSize = 13.sp, color = Lab.colors.muted, fontWeight = FontWeight.SemiBold)
                ChipRow {
                    for (w in if (!recent.isNullOrEmpty()) recent.map { it.hanzi } else STROKE_STARTERS) {
                        LabChip(w, selected = w == ui.text) { actions.onPick(w) }
                    }
                }
            }
        }
        item {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(20.dp)).padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (ui.text.isNotEmpty()) {
                    androidx.compose.runtime.key(ui.text, ui.runKey) {
                        WritingExercise(
                            text = ui.text,
                            pinyin = ui.found?.pinyin,
                            english = ui.found?.english,
                            onComplete = actions.onComplete,
                            loader = actions.loader,
                        )
                    }
                } else {
                    Text("永", fontSize = 96.sp, color = Lab.colors.faint)
                    Text(
                        "Pick a word above. Trace shows the character in grey with the stroke order animated; From memory gives you an empty grid and the pinyin.",
                        textAlign = TextAlign.Center,
                        color = Lab.colors.muted,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
        item {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val line = when {
                    ui.offlineTotal == null -> "Checking…"
                    ui.offlineTotal == 0 -> "Each character is saved on this phone the first time you write it."
                    else -> "${ui.offlineCached} of ${ui.offlineTotal} characters from your decks are saved on this phone."
                }
                Text(
                    buildString { append("📴 Offline  ·  "); append(line) },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Lab.colors.ink,
                )
                ui.saveNote?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
                val total = ui.offlineTotal
                if (total != null && total > ui.offlineCached) {
                    SecondaryPill(
                        ui.saving?.let { (d, t) -> "Saving… $d/$t" } ?: "Save all (${StrokeStore.sizeLabel(total - ui.offlineCached)})",
                        Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        enabled = ui.saving == null,
                        onClick = actions.onSaveAll,
                    )
                }
            }
        }
        item {
            Text(
                "Stroke data: Make Me a Hanzi via hanzi-writer-data, derived from fonts by Arphic Technology — Arphic Public License. Stroke checking adapted from Hanzi Writer (MIT).",
                fontSize = 12.sp,
                color = Lab.colors.muted,
            )
        }
    }
}
