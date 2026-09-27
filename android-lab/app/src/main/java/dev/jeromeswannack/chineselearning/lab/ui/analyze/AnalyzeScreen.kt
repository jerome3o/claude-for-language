package dev.jeromeswannack.chineselearning.lab.ui.analyze

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceBreakdownDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

val ANALYZE_EXAMPLES = listOf("我想买这个", "你好，请问洗手间在哪里？", "今天天气很好", "我每天早上喝咖啡", "这本书很有意思", "I want to learn Chinese")

data class AnalyzeUi(
    val draft: String = "",
    val analyzing: Boolean = false,
    val error: String? = null,
    val breakdown: SentenceBreakdownDto? = null,
    val chunk: Int = 0,
    val playing: Boolean = false,
    val playingAll: Boolean = false,
)

data class AnalyzeActions(
    val onBack: (() -> Unit)? = null,
    val onDraft: (String) -> Unit = {},
    val onAnalyze: () -> Unit = {},
    val onClear: () -> Unit = {},
    val onAnother: () -> Unit = {},
    val onChunk: (Int) -> Unit = {},
    val onPlayChunk: () -> Unit = {},
    val onPlayAll: () -> Unit = {},
    val onStop: () -> Unit = {},
)

/** `/analyze` — Sentence Breakdown: step through a sentence chunk by chunk, hanzi ↔ pinyin ↔ English aligned. */
@Composable
fun AnalyzeScreen(ui: AnalyzeUi, actions: AnalyzeActions) {
    val b = ui.breakdown
    LabScreen("Sentence Breakdown", onBack = actions.onBack) {
        if (b != null && b.chunks.isNotEmpty()) {
            item { SecondaryPill("← Analyze another sentence", Modifier.fillMaxWidth(), onClick = actions.onAnother) }
            item { SentenceBreakdownView(b, ui.chunk, ui.playing, ui.playingAll, actions) }
            return@LabScreen
        }
        item {
            Text(
                "Enter a Chinese or English sentence to see how it breaks down into individual words and phrases, with aligned translations.",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
        }
        item {
            Card {
                OutlinedTextField(
                    value = ui.draft,
                    onValueChange = actions.onDraft,
                    label = { Text("Enter a sentence") },
                    placeholder = { Text("e.g., 我想去北京旅游 or I want to travel to Beijing") },
                    minLines = 3,
                    shape = RoundedCornerShape(14.dp),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp),
                    colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.background, unfocusedContainerColor = Lab.colors.background),
                    modifier = Modifier.fillMaxWidth(),
                )
                ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryPill(if (ui.analyzing) "Analyzing…" else "Analyze Sentence", Modifier.weight(1f).height(56.dp), enabled = ui.draft.isNotBlank() && !ui.analyzing, onClick = actions.onAnalyze)
                    if (ui.draft.isNotEmpty()) SecondaryPill("Clear", Modifier.height(56.dp), onClick = actions.onClear)
                }
            }
        }
        item {
            Card {
                Text("Example Sentences", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                ANALYZE_EXAMPLES.forEach { ex ->
                    Text(ex, fontSize = 17.sp, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).clickable { actions.onDraft(ex) }.padding(12.dp))
                }
            }
        }
        item {
            Card {
                Text("How it works", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                listOf(
                    "Enter any Chinese sentence to see its breakdown",
                    "Step through each word/phrase to understand the structure",
                    "See how hanzi, pinyin, and English align",
                    "Learn grammar notes for particles and constructions",
                    "You can also enter English to see the Chinese translation breakdown",
                ).forEach { Text("• $it", color = Lab.colors.muted, fontSize = 14.sp) }
            }
        }
    }
}

/** The web's `<SentenceBreakdown>`: tap a chunk, step with Previous / Next, play one or all. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SentenceBreakdownView(b: SentenceBreakdownDto, current: Int, playing: Boolean, playingAll: Boolean, actions: AnalyzeActions) {
    val chunk = b.chunks[current.coerceIn(0, b.chunks.size - 1)]
    val hl = Lab.colors.accentSoft
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Card {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                b.chunks.forEachIndexed { i, c -> ChunkText(c.hanzi, i == current, 28.sp, hl) { actions.onChunk(i) } }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                b.chunks.forEachIndexed { i, c -> ChunkText(c.pinyin, i == current, 16.sp, hl, Lab.colors.accent) { actions.onChunk(i) } }
            }
            val e = b.english
            val start = chunk.englishStart.coerceIn(0, e.length)
            val end = chunk.englishEnd.coerceIn(start, e.length)
            Text(
                buildAnnotatedString {
                    append(e.substring(0, start))
                    withStyle(SpanStyle(background = hl, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)) { append(e.substring(start, end)) }
                    append(e.substring(end))
                },
                fontSize = 16.sp, color = Lab.colors.muted,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (playingAll) SecondaryPill("■ Stop", Modifier.weight(1f), onClick = actions.onStop)
            else SecondaryPill("▶ Play All", Modifier.weight(1f), enabled = !playing, onClick = actions.onPlayAll)
            SecondaryPill("▶ ${chunk.hanzi}", Modifier.weight(1f), enabled = !playing && !playingAll, onClick = actions.onPlayChunk)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            SecondaryPill("Previous", enabled = current > 0 && !playingAll) { actions.onChunk(current - 1) }
            FlowRow(Modifier.weight(1f).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.Center) {
                b.chunks.indices.forEach { i ->
                    val c by animateColorAsState(if (i == current) Lab.colors.accent else Lab.colors.cardBorder, label = "dot")
                    Box(Modifier.padding(3.dp).size(if (i == current) 12.dp else 9.dp).clip(CircleShape).background(c).clickable(enabled = !playingAll) { actions.onChunk(i) })
                }
            }
            SecondaryPill("Next", enabled = current < b.chunks.size - 1 && !playingAll) { actions.onChunk(current + 1) }
        }
        Card {
            Text("${current + 1} / ${b.chunks.size}", fontSize = 13.sp, color = Lab.colors.muted)
            AnimatedContent(
                current,
                transitionSpec = {
                    val dir = if (targetState > initialState) 1 else -1
                    (slideInHorizontally(tween(220)) { it / 4 * dir } + fadeIn(tween(220))) togetherWith (slideOutHorizontally(tween(160)) { -it / 4 * dir } + fadeOut(tween(160)))
                },
                label = "chunk",
            ) { i ->
                val c = b.chunks[i.coerceIn(0, b.chunks.size - 1)]
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(c.hanzi, fontSize = 40.sp, color = Lab.colors.ink)
                    Text(c.pinyin, fontSize = 18.sp, color = Lab.colors.accent)
                    Text(c.english, fontSize = 17.sp, color = Lab.colors.ink)
                    c.note?.let { Text(it, fontSize = 14.sp, color = Lab.colors.muted, modifier = Modifier.padding(top = 8.dp).clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(10.dp)) }
                }
            }
        }
        b.grammarNotes?.takeIf { it.isNotBlank() }?.let { Card { Text("Grammar Notes", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink); Text(it, color = Lab.colors.ink) } }
    }
}

@Composable
private fun ChunkText(text: String, active: Boolean, size: androidx.compose.ui.unit.TextUnit, hl: Color, color: Color = Lab.colors.ink, onClick: () -> Unit) {
    val bg by animateColorAsState(if (active) hl else Color.Transparent, label = "chunk-bg")
    Text(text, fontSize = size, color = color, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(bg).clickable(onClick = onClick).padding(horizontal = 3.dp, vertical = 2.dp))
}

@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}
