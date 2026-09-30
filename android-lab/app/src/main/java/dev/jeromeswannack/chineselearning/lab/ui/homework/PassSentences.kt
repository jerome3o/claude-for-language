package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceRow
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceRowView
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceRowsState
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Test tag on the pass's "+ N more sentences" / "Fewer sentences" toggle. */
const val PASS_MORE_SENTENCES_TAG = "hw-more-sentences"

/**
 * The example sentences on the answer side of a homework word (web: `PassSentences` in
 * HomeworkPassPage.tsx) — the study card's sentence rows, kept calm: the card's own sentence
 * first with its Chinese already up (taps add the pinyin, then the English; ▶ plays it), and
 * a fully open row has "What's going on here?" (the same word-by-word breakdown, each word
 * tappable to make a card) and + Add as card. The note's generated set waits behind
 * "+ N more sentences". No header, no generate / regenerate, no EN exercise: nothing here
 * writes a review or a homework event.
 *
 * [key] is the card being shown: a new card (or the same word coming back) starts closed.
 */
@Composable
fun PassSentences(
    key: Any,
    rows: List<SentenceRow>,
    deckId: String,
    online: Boolean,
    playingKey: String?,
    actions: SentenceActions,
    onPlay: (key: String?, text: String) -> Unit,
    modifier: Modifier = Modifier,
    startExplained: Map<String, SentenceExplanation> = emptyMap(),
    startSteps: Map<String, Int> = emptyMap(),
    startMore: Boolean = false,
) {
    if (rows.isEmpty()) return
    val state = remember(key) { SentenceRowsState(startExplained).apply { steps.putAll(startSteps) } }
    var more by remember(key) { mutableStateOf(startMore) }
    var adding by remember(key) { mutableStateOf<Chunk?>(null) }
    val shown = if (more) rows else rows.take(1)
    val hidden = rows.size - 1
    Column(modifier.fillMaxWidth().testTag("hw-pass-sentences"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (row in shown) {
            SentenceRowView(row, state, online, playingKey, actions, onPlay, onAdd = { adding = it }, startStep = 1, englishToggle = false)
        }
        if (hidden > 0) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                TextButton(onClick = { more = !more }, modifier = Modifier.testTag(PASS_MORE_SENTENCES_TAG)) {
                    Text(
                        if (more) "Fewer sentences" else "+ $hidden more ${if (hidden == 1) "sentence" else "sentences"}",
                        color = Lab.colors.accent,
                    )
                }
            }
        }
    }
    adding?.let { chunk -> AddChunkSheet(chunk, deckId, actions, onDismiss = { adding = null }) }
}
