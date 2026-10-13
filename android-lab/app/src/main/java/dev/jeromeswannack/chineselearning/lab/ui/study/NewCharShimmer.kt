package dev.jeromeswannack.chineselearning.lab.ui.study

import android.content.Context
import android.provider.Settings
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.LinearGradientShader
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.core.NewCharacters
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/*
 * "New characters shimmer" on the study card (web components/study/NewCharShimmer.tsx +
 * newCharShimmer.css; core NewCharacters): a character never seen on a reviewed card gets a soft
 * warm sheen sweeping across the glyph every few seconds, with a faint glow. The glyph keeps its
 * own colour between sweeps. With animations off (Developer options / Accessibility → "Remove
 * animations": ANIMATOR_DURATION_SCALE = 0) it is a static warm tint + the glow instead.
 */

/** Test tag on every shimmering character (or the question's hanzi holding them). */
const val NEW_CHAR_TAG = "new-char"

/** What screen readers add to a shimmering character. */
const val NEW_CHAR_STATE = "New character"

/** One sweep + rest (web: 3.6 s, the sweep in the first 45 %). */
private const val CYCLE_MS = 3600
private const val SWEEP_PART = 0.45f
private const val STAGGER_MS = 140
private const val FIRST_DELAY_MS = 400

/**
 * Screenshots / tests: a fixed point of the sweep (0 = band off the left edge, 0.5 = across the
 * glyph, 1 = gone) instead of the running animation; null = the real thing.
 */
val LocalNewCharShimmerPhase = staticCompositionLocalOf<Float?> { null }

/** The system's "remove animations" (animator duration scale 0). */
fun animationsDisabled(context: Context): Boolean =
    runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)

/** [chars] when Settings → Study → "Shimmer new characters" is on (the default), else nothing. */
@Composable
fun rememberShimmerChars(chars: List<String>): Set<String> {
    val context = LocalContext.current
    val prefs = remember { StudyPrefs.get(context) }
    val on by prefs.newCharShimmerOn.collectAsState()
    return remember(chars, on) { if (on) chars.toSet() else emptySet() }
}

/** The warm sheen (the web's --new-char-sheen): amber on a light card, a paler gold on a dark one. */
@Composable
private fun sheenColor(): Color = if (Lab.colors.ink.luminance() > 0.5f) Color(0xFFFCD34D) else Color(0xFFF59E0B)

/**
 * A narrow sheen band at [progress] (0 → off the left edge, 1 → off the right). [bandPx] null = the
 * band is sized to the shape (one glyph); else a band [bandPx] wide crossing the whole text.
 */
private class SheenBrush(
    private val base: Color,
    private val sheen: Color,
    private val progress: Float,
    private val bandPx: Float? = null,
) : ShaderBrush() {
    override fun createShader(size: Size): Shader {
        val w = size.width
        val half = (bandPx ?: (0.9f * w)) / 2f
        val centre = -2f * half + progress * (w + 4f * half)
        return LinearGradientShader(
            from = Offset(centre - half, 0f),
            to = Offset(centre + half, size.height * 0.35f),
            colors = listOf(base, sheen, base),
            colorStops = listOf(0f, 0.5f, 1f),
            tileMode = TileMode.Clamp,
        )
    }

    override fun equals(other: Any?): Boolean =
        other is SheenBrush && other.base == base && other.sheen == sheen && other.progress == progress && other.bandPx == bandPx

    override fun hashCode(): Int = ((base.hashCode() * 31 + sheen.hashCode()) * 31 + progress.hashCode()) * 31 + bandPx.hashCode()
}

/** Where the band is at [cycle] (0..1 of one cycle): the sweep eases across, then rests off the glyph. */
private fun sweepAt(cycle: Float): Float =
    if (cycle < SWEEP_PART) FastOutSlowInEasing.transform(cycle / SWEEP_PART) else 1f

/** The sweep's position now, or null = still (animations off: the static tint). */
@Composable
private fun shimmerProgress(index: Int): Float? {
    val context = LocalContext.current
    val fixed = LocalNewCharShimmerPhase.current
    if (fixed != null) return fixed
    val still = remember(context) { animationsDisabled(context) }
    if (still) return null
    val transition = rememberInfiniteTransition(label = "new-char")
    val cycle by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(CYCLE_MS, easing = LinearEasing),
            initialStartOffset = StartOffset(FIRST_DELAY_MS + STAGGER_MS * index),
        ),
        label = "new-char-sweep",
    )
    return sweepAt(cycle)
}

@Composable
private fun glowFor(sheen: Color, fontSize: TextUnit): Shadow =
    with(LocalDensity.current) { Shadow(sheen.copy(alpha = 0.45f), Offset.Zero, blurRadius = fontSize.toPx() * 0.14f) }

/**
 * One character of the study card's hanzi: plain when [isNew] is false; else shimmering (or the
 * static tint with animations off). [index] staggers the sweep across a word.
 */
@Composable
fun NewCharGlyph(
    ch: String,
    isNew: Boolean,
    fontSize: TextUnit,
    color: Color,
    modifier: Modifier = Modifier,
    fontWeight: FontWeight = FontWeight.Medium,
    lineHeight: TextUnit = TextUnit.Unspecified,
    index: Int = 0,
) {
    if (!isNew) {
        Text(ch, fontSize = fontSize, fontWeight = fontWeight, color = color, lineHeight = lineHeight, modifier = modifier)
        return
    }
    val sheen = sheenColor()
    val glow = glowFor(sheen, fontSize)
    val tagged = modifier.testTag(NEW_CHAR_TAG).semantics { stateDescription = NEW_CHAR_STATE }
    val progress = shimmerProgress(index)
    if (progress == null) {
        // "Remove animations": no movement — a warm tint and the glow.
        Text(ch, fontSize = fontSize, fontWeight = fontWeight, color = lerp(color, sheen, 0.3f), lineHeight = lineHeight, style = TextStyle(shadow = glow), modifier = tagged)
        return
    }
    Text(
        ch,
        fontSize = fontSize,
        fontWeight = fontWeight,
        lineHeight = lineHeight,
        style = TextStyle(brush = SheenBrush(color, sheen, progress), shadow = glow),
        modifier = tagged,
    )
}

/**
 * A whole hanzi line in ONE Text (the read card's question, which wraps like text) with its
 * never-seen characters shimmering: one band, about a glyph wide, crosses the line and lights the
 * new characters as it passes; the rest of the text is plain [color].
 */
@Composable
fun NewCharText(
    text: String,
    newChars: Set<String>,
    fontSize: TextUnit,
    color: Color,
    modifier: Modifier = Modifier,
    fontWeight: FontWeight = FontWeight.Medium,
    lineHeight: TextUnit = TextUnit.Unspecified,
    textAlign: TextAlign = TextAlign.Center,
) {
    val fresh = remember(text, newChars) { Known.hanCharacters(text).filter { it in newChars } }
    if (fresh.isEmpty()) {
        Text(text, fontSize = fontSize, fontWeight = fontWeight, color = color, lineHeight = lineHeight, textAlign = textAlign, modifier = modifier)
        return
    }
    val sheen = sheenColor()
    val glow = glowFor(sheen, fontSize)
    val progress = shimmerProgress(0)
    val bandPx = with(LocalDensity.current) { fontSize.toPx() * 0.9f }
    val newStyle = if (progress == null) {
        SpanStyle(color = lerp(color, sheen, 0.3f), shadow = glow)
    } else {
        SpanStyle(brush = SheenBrush(color, sheen, progress, bandPx), shadow = glow)
    }
    val annotated = buildAnnotatedString {
        for (cp in text.codePoints().toArray()) {
            val ch = String(Character.toChars(cp))
            if (ch in newChars) withStyle(newStyle) { append(ch) } else append(ch)
        }
    }
    Text(
        annotated,
        fontSize = fontSize,
        fontWeight = fontWeight,
        color = color,
        lineHeight = lineHeight,
        textAlign = textAlign,
        modifier = modifier.testTag(NEW_CHAR_TAG).semantics { stateDescription = NewCharacters.label(fresh) },
    )
}
