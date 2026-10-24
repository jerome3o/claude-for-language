package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.clips.Karaoke
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.study.devicePinyinLine

/** The line being read right now: what, and where its audio is (MediaPlayer position / duration). */
class SpeechClock(
    val scene: Int,
    /** The utterance's line (-1 = the scene's voice). */
    val line: Int,
    val text: String,
    val lang: String,
    val positionMs: () -> Long,
    val durationMs: () -> Long?,
)

private val HAN = Regex("\\p{IsHan}")

/**
 * 🎬 Karaoke captions (web components/clips/Karaoke.tsx; timing core [Karaoke]): while the line
 * plays, the word being said is bigger, heavier, underlined and in the accent with a little spring
 * bounce (no bounce with reduced motion); the words already said dim; the next stay plain. With 拼
 * the active word carries its pinyin underneath. Colour-blind safe: size, weight and underline.
 * Without a [clock] for this text the line shows plain. A Chinese word opens the explorer.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KaraokeLine(
    text: String,
    lang: String,
    clock: SpeechClock?,
    pinyin: Boolean,
    style: TextStyle,
    activeColor: Color,
    animate: Boolean,
    onExplore: () -> Unit = {},
    modifier: Modifier = Modifier,
    tag: String = "clip-karaoke",
) {
    val live = clock != null && clock.text == text
    var duration by remember(text, live) { mutableLongStateOf(0L) }
    var position by remember(text, live) { mutableLongStateOf(0L) }
    LaunchedEffect(text, live, clock) {
        if (!live || clock == null) return@LaunchedEffect
        while (true) {
            withFrameMillis { }
            val d = clock.durationMs()
            if (d != null && d > 0) {
                duration = d
                position = clock.positionMs()
            }
        }
    }
    val words = remember(text, DeviceWords.of(text) != null) { if (lang == "zh") DeviceWords.of(text)?.map { it.text } else null }
    val timeline = remember(text, lang, duration, words) { Karaoke.timeline(text, lang, duration.toDouble(), words) }
    val active = if (live && duration > 0) Karaoke.active(timeline, position.toDouble()) else -1
    val states = Karaoke.states(timeline, active)
    // Each word with the punctuation after it, so a line never starts with "，".
    val groups = remember(timeline) {
        val out = mutableListOf<MutableList<Int>>()
        timeline.forEachIndexed { i, t ->
            if (t.kind == "punct" && out.isNotEmpty() && timeline[out.last()[0]].kind != "space") out.last().add(i) else out.add(mutableListOf(i))
        }
        out
    }
    val explorer = LocalExplorer.current
    FlowRow(
        modifier.testTag(tag).semantics { contentDescription = "karaoke active $active" },
        horizontalArrangement = Arrangement.Center,
        verticalArrangement = Arrangement.Center,
    ) {
        for (g in groups) Row(verticalAlignment = Alignment.Top) {
            for (i in g) {
                val t = timeline[i]
                val state = states[i]
                if (t.kind == "space") { Text(" ", style = style); continue }
                if (t.kind != "word") { Text(t.text, style = style, modifier = Modifier.graphicsLayer { alpha = if (live && state == "past") 0.5f else 1f }); continue }
                val isActive = state == "active"
                val han = HAN.containsMatchIn(t.text)
                val bounce = remember(i, isActive) { Animatable(if (isActive && animate) 1f else if (isActive) 1.32f else 1f) }
                LaunchedEffect(i, isActive) { if (isActive && animate) bounce.animateTo(1.32f, spring(dampingRatio = 0.4f, stiffness = Spring.StiffnessMedium)) }
                Column(
                    Modifier
                        .padding(horizontal = if (isActive) 5.dp else 0.dp)
                        .then(if (han) Modifier.clickable { onExplore(); ExplorerStack.itemForText(t.text)?.let { explorer?.open(it, "clips") } } else Modifier)
                        .testTag(if (isActive) "$tag-active" else "$tag-word"),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(Modifier.graphicsLayer { val sc = if (isActive) bounce.value else 1f; scaleX = sc; scaleY = sc; alpha = if (live && state == "past") 0.5f else 1f; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 0.7f) }) {
                        Text(
                            t.text,
                            style = if (isActive) style.copy(fontWeight = FontWeight.Black, color = activeColor, textDecoration = TextDecoration.Underline) else style,
                        )
                    }
                    if (isActive && pinyin && han) Text(devicePinyinLine(t.text), color = activeColor, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
