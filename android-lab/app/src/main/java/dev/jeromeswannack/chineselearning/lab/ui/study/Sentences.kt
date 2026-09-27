package dev.jeromeswannack.chineselearning.lab.ui.study

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** A sentence row: the card's own clue first, then the generated graded set. */
data class SentenceRow(
    val key: String,
    val hanzi: String,
    val pinyin: String?,
    val translation: String?,
    val audioUrl: String?,
    val badge: String?,
)

fun sentenceRows(view: CardView): List<SentenceRow> {
    val note = view.note
    val rows = ArrayList<SentenceRow>()
    val clue = note.sentenceClue?.takeIf { it.isNotBlank() }
    if (clue != null && view.sentences.none { it.hanzi == clue }) {
        rows += SentenceRow("clue", clue, note.sentenceCluePinyin, note.sentenceClueTranslation, note.sentenceClueAudioUrl, "From the card")
    }
    view.sentences.sortedBy { it.position }.forEach { s ->
        rows += SentenceRow(s.id, s.hanzi, s.pinyin, s.translation, s.audioUrl, s.focus?.takeIf { it != "core" }?.replace('_', ' '))
    }
    return rows
}

/**
 * The web's SentenceSet: every row starts blank (listen first); each tap uncovers
 * one more line (hanzi → pinyin → English) and a tap on a fully open row hides it
 * again. EN flips a row to translate-back mode (English shown, reveal the Chinese).
 */
@Composable
fun SentenceList(view: CardView, playingKey: String?, actions: StudyActions) {
    val rows = remember(view.presentation) { sentenceRows(view) }
    if (rows.isEmpty()) return
    val steps = remember(view.presentation) { mutableStateMapOf<String, Int>() }
    val english = remember(view.presentation) { mutableStateMapOf<String, Boolean>() }
    var showAll by remember(view.presentation) { mutableStateOf(false) }

    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("Example sentences", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, modifier = Modifier.weight(1f))
        TextButton(onClick = { showAll = !showAll; if (!showAll) steps.clear() }) {
            Text(if (showAll) "Hide all" else "Show all", color = Lab.colors.accent)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (row in rows) {
            val en = english[row.key] == true && row.translation != null
            val chain = buildList {
                add("hanzi")
                if (!row.pinyin.isNullOrBlank()) add("pinyin")
                if (!en && !row.translation.isNullOrBlank()) add("translation")
            }
            val step = if (showAll) chain.size else (steps[row.key] ?: 0)
            val playing = playingKey != null && (playingKey == row.audioUrl || playingKey == "tts:${row.hanzi}")
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Lab.colors.faint)
                    .clickable {
                        val cur = steps[row.key] ?: 0
                        steps[row.key] = if (cur >= chain.size) 0 else cur + 1
                    }
                    .animateContentSize()
                    .padding(start = 6.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(34.dp).clip(CircleShape)
                        .background(if (en) Lab.colors.accentSoft else Lab.colors.card)
                        .clickable(enabled = row.translation != null) { english[row.key] = !en; steps[row.key] = 0; showAll = false },
                    contentAlignment = Alignment.Center,
                ) { Text("EN", style = MaterialTheme.typography.labelSmall, color = if (en) Lab.colors.accent else Lab.colors.muted) }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                    if (en) Text(row.translation!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    if (step == 0 && !en) Text("Tap to reveal", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted.copy(alpha = 0.6f))
                    if (step >= 1) Text(row.hanzi, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                    if (step >= 2 && chain.getOrNull(1) == "pinyin") Text(row.pinyin!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent)
                    val translationStep = chain.indexOf("translation") + 1
                    if (translationStep > 0 && step >= translationStep) Text(row.translation!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    if (step >= chain.size && row.badge != null) {
                        Spacer(Modifier.height(4.dp))
                        Text(row.badge, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                    }
                }
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(if (playing) Lab.colors.accentSoft else Lab.colors.card).clickable { actions.onPlay(row.audioUrl, row.hanzi) },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.PlayArrow, "Play sentence", tint = Lab.colors.accent) }
            }
        }
    }
    Spacer(Modifier.height(12.dp))
}
