package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import dev.jeromeswannack.chineselearning.lab.core.CharStrokeData
import dev.jeromeswannack.chineselearning.lab.core.RunCharacter
import dev.jeromeswannack.chineselearning.lab.core.StrokePoint
import dev.jeromeswannack.chineselearning.lab.core.StrokeRun
import dev.jeromeswannack.chineselearning.lab.core.StrokeRunReview
import dev.jeromeswannack.chineselearning.lab.core.StrokeTone
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Where the review gets the model outlines (package H's StrokeStore: cached per character, fetched when online). */
val LocalStrokeLoader = staticCompositionLocalOf<(suspend (String) -> StrokeLoad)?> { null }

/** Provides [loader] to every [StrokeRunView] below. */
@Composable
fun ProvideStrokeLoader(loader: (suspend (String) -> StrokeLoad)?, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalStrokeLoader provides loader, content = content)

/** The web's StrokeRunView colours (the legend reads them too). */
object StrokeRunColors {
    val FirstTry = Color(0xFF16A34A)
    val AfterMiss = Color(0xFFD97706)
    val Hinted = Color(0xFF3B82F6)
    val Shown = Color(0xFF9CA3AF)
    fun of(t: StrokeTone) = when (t) {
        StrokeTone.FIRST_TRY -> FirstTry
        StrokeTone.AFTER_MISS -> AfterMiss
        StrokeTone.HINTED -> Hinted
        StrokeTone.SHOWN -> Shown
    }
    fun border(grade: String) = when (grade) {
        "perfect" -> Color(0xFF86EFAC)
        "good" -> Color(0xFFFCD34D)
        else -> Color(0xFFFCA5A5)
    }
}

/**
 * A stroke-order checked handwriting run, for review (web: StrokeRunView.tsx): per character
 * the learner's own strokes re-drawn over the faint model outline, coloured by how each stroke
 * went (first try · after a miss · with a hint · shown by the app — a stroke with no ink kept is
 * the model's centre line, dashed), with the grade, mistakes, hints and time; the legend; and
 * the characters that had no stroke data.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StrokeRunView(run: StrokeRun, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(StrokeRunReview.heading(run), fontSize = 13.sp, color = Lab.colors.muted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (c in run.characters) RunCharacterView(c)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for ((t, label) in listOf(StrokeTone.FIRST_TRY to "first try", StrokeTone.AFTER_MISS to "after a miss", StrokeTone.HINTED to "with a hint", StrokeTone.SHOWN to "shown by the app")) {
                Text("● $label", fontSize = 12.sp, color = StrokeRunColors.of(t))
            }
        }
        StrokeRunReview.skippedLine(run)?.let { Text(it, fontSize = 12.sp, color = Lab.colors.muted) }
    }
}

@Composable
private fun RunCharacterView(c: RunCharacter) {
    val loader = LocalStrokeLoader.current
    val model by produceState<CharStrokeData?>(null, c.character, loader) {
        value = (runCatching { loader?.invoke(c.character) }.getOrNull() as? StrokeLoad.Ok)?.data
    }
    Column(
        Modifier.width(128.dp).clip(RoundedCornerShape(10.dp)).border(1.5.dp, StrokeRunColors.border(c.grade), RoundedCornerShape(10.dp)).padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        CharacterCanvas(c, model, Modifier.fillMaxWidth().aspectRatio(1f).semantics { contentDescription = "${c.character} as written" })
        Text(StrokeRunReview.characterLabel(c), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Text(StrokeRunReview.detail(c), fontSize = 12.sp, color = Lab.colors.muted, textAlign = TextAlign.Center)
        StrokeRunReview.mistakeKinds(c)?.let { Text(it, fontSize = 12.sp, color = Lab.colors.muted, textAlign = TextAlign.Center) }
    }
}

private const val VIEW = 1024f

@Composable
private fun CharacterCanvas(c: RunCharacter, model: CharStrokeData?, modifier: Modifier) {
    val outlines = remember(model) { model?.strokes?.map { runCatching { PathParser().parsePathString(it).toPath() }.getOrNull() }.orEmpty() }
    val outlineColor = Lab.colors.faint
    val gridColor = Color(0x5994A3B8)
    Canvas(modifier) {
        val s = size.width / VIEW
        // The 田字格 cross, like the web's two gradients.
        drawLine(gridColor, Offset(size.width / 2, 0f), Offset(size.width / 2, size.height), strokeWidth = 1f)
        drawLine(gridColor, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), strokeWidth = 1f)
        withTransform({
            translate(top = 900f * s)
            scale(s, -s, pivot = Offset.Zero)
        }) {
            outlines.forEach { p -> if (p != null) drawPath(p, outlineColor) }
            c.strokes.forEachIndexed { i, st ->
                if (!StrokeRunReview.hasInk(st)) {
                    val median = model?.medians?.getOrNull(i) ?: return@forEachIndexed
                    drawPath(polyline(median), StrokeRunColors.Shown, style = Stroke(40f, cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(60f, 50f))))
                } else {
                    drawPath(polyline(st.drawn!!), StrokeRunColors.of(StrokeRunReview.tone(st)), style = Stroke(56f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
            }
        }
    }
}

private fun polyline(points: List<StrokePoint>) = Path().apply {
    points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x.toFloat(), p.y.toFloat()) else lineTo(p.x.toFloat(), p.y.toFloat()) }
}
