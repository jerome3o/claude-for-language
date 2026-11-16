package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.LessonPatternIntro
import dev.jeromeswannack.chineselearning.lab.core.LessonPatterns
import dev.jeromeswannack.chineselearning.lab.core.PatternExamplePart
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipScene
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PatternChips
import dev.jeromeswannack.chineselearning.lab.ui.lessons.structureToneColor
import dev.jeromeswannack.chineselearning.lab.ui.study.devicePinyinLine
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/*
 * The `pattern` layout (a structure intro, core LessonPatternIntro; web ClipPatternScene.tsx): the structure's
 * pieces building up one by one (the structure card's chips), then — with an example — the example big on a
 * card, every part coloured like its piece, the part being read lit up as the voice reads it.
 */

/** The example part lit at the clock's position (-1 when another line is read). */
@Composable
private fun litPart(clock: SpeechClock?, hanzi: String, parts: List<PatternExamplePart>): Int {
    val live = clock != null && clock.text == hanzi
    val lit by produceState(-1, clock, live) {
        if (!live || clock == null) { value = -1; return@produceState }
        if (!clock.live) {
            val d = clock.durationMs() ?: return@produceState
            value = LessonPatternIntro.litPart(parts, clock.positionMs().toDouble(), d.toDouble())
            return@produceState
        }
        while (true) {
            withFrameMillis { }
            val d = clock.durationMs()
            if (d != null && d > 0) value = LessonPatternIntro.litPart(parts, clock.positionMs().toDouble(), d.toDouble())
        }
    }
    return lit
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PatternSceneView(scene: ClipScene, ctx: SceneCtx, clock: SpeechClock?, building: Boolean) {
    val p = scene.pattern ?: return
    val look = ctx.look
    val tones = LessonPatterns.pieceTones(p.pieces)
    Column(Modifier.fillMaxWidth().testTag("clip-pattern"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        p.name?.takeIf { it.isNotBlank() }?.let { Text(it, color = look.fg, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, fontFamily = look.zhFont, textAlign = TextAlign.Center) }
        PatternChips(p.pieces, stagger = if (building && ctx.animate) 520L else 0L, center = true)
        if (p.example == null) p.meaning?.takeIf { it.isNotBlank() }?.let { Text("= $it", color = look.fg, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center) }
        p.example?.let { e ->
            val parts = e.parts ?: listOf(PatternExamplePart(e.hanzi))
            val lit = litPart(clock, e.hanzi, parts)
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).padding(16.dp).testTag("clip-pattern-example"),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                FlowRow(horizontalArrangement = Arrangement.Center) {
                    parts.forEachIndexed { i, part ->
                        val tone = part.piece?.let { tones.getOrNull(it) }
                        val color = structureToneColor(tone) ?: Lab.colors.ink
                        val on = lit == i
                        ExplorableText(
                            part.text, source = "clips", fontSize = 30.sp,
                            fontWeight = if (tone == "fixed") FontWeight.ExtraBold else FontWeight.Bold, color = color,
                            onTap = { ctx.onExplore() },
                            modifier = Modifier.graphicsLayer { translationY = if (on) -6f else 0f; scaleX = if (on) 1.06f else 1f; scaleY = if (on) 1.06f else 1f }
                                .clip(RoundedCornerShape(6.dp)).background(if (on) color.copy(alpha = 0.16f) else Color.Transparent),
                        )
                    }
                }
                if (ctx.pinyin) Text(e.pinyin?.takeIf { it.isNotBlank() } ?: devicePinyinLine(e.hanzi), color = Lab.colors.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
                if (ctx.english) e.english?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.ink.copy(alpha = 0.85f), fontSize = 14.sp, textAlign = TextAlign.Center) }
            }
        }
    }
}
