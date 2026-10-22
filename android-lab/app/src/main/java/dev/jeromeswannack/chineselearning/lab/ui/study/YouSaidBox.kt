package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.StartOffset
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tag prefix of the "You said" box: `you-said-match` / `you-said-contains` / `you-said-miss`. */
const val YOU_SAID_TAG = "you-said"
/** The round ✎ on the yellow box: the sentence in the Sentence Coach. */
const val YOU_SAID_COACH_TAG = "you-said-coach"
const val YOU_SAID_COACH_LABEL = "Check in Coach"
/** The round ▶ on a read card's box: the take it was transcribed from. */
const val YOU_SAID_PLAY_TAG = "you-said-play"
const val YOU_SAID_PLAY_LABEL = "Play my recording"
/** The verdict chip's icon: `you-said-verdict-check` / `-approx` / `-close` ([youSaidVerdictIcon]). */
const val YOU_SAID_VERDICT_TAG = "you-said-verdict"

/** The verdict chip's words (web `YOU_SAID_VERDICT` in components/study/YouSaid.tsx). */
fun youSaidVerdictLabel(state: String): String = when (state) {
    "match" -> "Match"
    "contains" -> "Contains the answer"
    else -> "Didn’t match"
}

/** The verdict chip's icon: ✓ match, ≈ contains, ✕ miss — no state relies on colour alone (web `YOU_SAID_VERDICT_ICON`). */
fun youSaidVerdictIcon(state: String): String = when (state) {
    "match" -> "check"
    "contains" -> "approx"
    else -> "close"
}

/** ≈ — two waves, stroked (the web's `ICON.approx` path); tinted like any icon. */
val YouSaidApproxIcon: ImageVector = ImageVector.Builder(
    name = "YouSaidApprox",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
).addPath(
    pathData = addPathNodes("M4 9.5c2.67-2.67 5.33-2.67 8 0s5.33 2.67 8 0M4 15.5c2.67-2.67 5.33-2.67 8 0s5.33 2.67 8 0"),
    fill = null,
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 2.6f,
    strokeLineCap = StrokeCap.Round,
).build()

private fun verdictIconVector(state: String): ImageVector = when (youSaidVerdictIcon(state)) {
    "check" -> Icons.Rounded.Check
    "approx" -> YouSaidApproxIcon
    else -> Icons.Rounded.Close
}

/** The pinyin line under the hanzi: no space before punctuation ("zhōng guó 。" → "zhōng guó。"); web `tidyPinyin`. */
fun tidyYouSaidPinyin(pinyin: String): String = pinyin.replace(Regex("\\s+(?=[。，、！？；：.,!?;:])"), "").trim()

private enum class YouSaidTone { MATCH, CONTAINS, MISS, PENDING, NEUTRAL }

@Composable
private fun isDarkCard(): Boolean = Lab.colors.card.luminance() < 0.5f

@Composable
private fun toneColor(t: YouSaidTone): Color = when (t) {
    YouSaidTone.MATCH -> Palette.Good
    YouSaidTone.CONTAINS -> if (isDarkCard()) Palette.PartialStrong else Palette.Partial
    YouSaidTone.MISS -> Palette.Again
    YouSaidTone.PENDING -> Palette.Easy
    YouSaidTone.NEUTRAL -> Lab.colors.muted
}

/** The tone as text / icon colour: dark enough on the light card, light enough on the dark one. */
@Composable
private fun toneInk(t: YouSaidTone): Color {
    val dark = isDarkCard()
    return when (t) {
        YouSaidTone.MATCH -> if (dark) Color(0xFF4ADE80) else Color(0xFF15803D)
        YouSaidTone.CONTAINS -> if (dark) Palette.PartialStrong else Palette.PartialInk
        YouSaidTone.MISS -> if (dark) Color(0xFFF87171) else Color(0xFFB91C1C)
        YouSaidTone.PENDING -> if (dark) Color(0xFF93C5FD) else Color(0xFF1D4ED8)
        YouSaidTone.NEUTRAL -> Lab.colors.muted
    }
}

/**
 * Every colour of one state's box. The quiet states are a soft wash of their tone; "Contains the
 * answer" is YELLOW and must read as yellow to red / green colour-blind eyes (the old orange looked like
 * the red miss): a lemon tint + a 1.5 dp lemon border, a SOLID lemon chip with dark brown words, and
 * ▶ / ✎ as solid lemon circles with dark icons (light) or a lemon wash with lemon icons (dark).
 * Web: `.you-said--contains` on index.css `--color-partial*`.
 */
private data class YouSaidStyle(
    val box: Color,
    val border: Color,
    val borderWidth: Float,
    val chip: Color,
    val chipInk: Color,
    val round: Color,
    val roundInk: Color,
)

@Composable
private fun toneStyle(t: YouSaidTone): YouSaidStyle {
    val card = Lab.colors.card
    if (t == YouSaidTone.CONTAINS) {
        return if (isDarkCard()) {
            YouSaidStyle(
                box = Palette.PartialStrong.copy(alpha = 0.10f).compositeOver(card),
                border = Palette.PartialStrong,
                borderWidth = 1.5f,
                chip = Palette.PartialStrong,
                chipInk = Palette.PartialInkDark,
                round = Palette.PartialStrong.copy(alpha = 0.20f),
                roundInk = Palette.PartialStrong,
            )
        } else {
            YouSaidStyle(
                box = Palette.PartialSoft,
                border = Palette.Partial,
                borderWidth = 1.5f,
                chip = Palette.PartialStrong,
                chipInk = Palette.PartialInk,
                round = Palette.PartialStrong,
                roundInk = Palette.PartialInk,
            )
        }
    }
    val c = toneColor(t)
    val ink = toneInk(t)
    return YouSaidStyle(
        box = c.copy(alpha = 0.08f).compositeOver(card),
        border = c.copy(alpha = 0.24f),
        borderWidth = 1f,
        chip = c.copy(alpha = 0.14f),
        chipInk = ink,
        round = c.copy(alpha = 0.16f),
        roundInk = ink,
    )
}

/**
 * The shell every state shares (the web's `.you-said`): a tinted 14 dp rounded box, at least 88 dp
 * tall so the result replaces "Transcribing…" without a jump, round 44 dp buttons in EQUAL side
 * columns so the text in the middle stays centred.
 */
@Composable
private fun YouSaidShell(
    tone: YouSaidTone,
    modifier: Modifier = Modifier,
    left: (@Composable () -> Unit)? = null,
    right: (@Composable () -> Unit)? = null,
    sides: Boolean = left != null || right != null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val style = toneStyle(tone)
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 88.dp)
            .clip(shape)
            .background(style.box)
            .border(style.borderWidth.dp, style.border, shape)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (sides) Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) { left?.invoke() }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, content = content)
        if (sides) Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) { right?.invoke() }
    }
}

/** A quiet tinted circle in the box's colour (no border); long-press shows its label. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun YouSaidRound(icon: ImageVector, label: String, tone: YouSaidTone, tag: String, onClick: () -> Unit) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } },
        state = rememberTooltipState(),
    ) {
        val style = toneStyle(tone)
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(style.round)
                .clickable(onClick = onClick)
                .semantics { contentDescription = label; role = Role.Button }
                .testTag(tag),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = style.roundInk, modifier = Modifier.size(22.dp))
        }
    }
}

@Composable
private fun YouSaidHead(tone: YouSaidTone? = null, state: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("You said", fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium, color = Lab.colors.muted)
        if (tone != null && state != null) {
            val style = toneStyle(tone)
            Row(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(style.chip)
                    .padding(start = 6.dp, end = 8.dp, top = 2.dp, bottom = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    verdictIconVector(state),
                    contentDescription = null,
                    tint = style.chipInk,
                    modifier = Modifier.size(14.dp).testTag("$YOU_SAID_VERDICT_TAG-${youSaidVerdictIcon(state)}"),
                )
                Spacer(Modifier.width(3.dp))
                Text(youSaidVerdictLabel(state), fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.SemiBold, color = style.chipInk)
            }
        }
    }
}

/**
 * "You said" — ONE box for what was said, on the read card's back, under a spoken answer on a
 * typing card and for 🎤 Say it practice (the web's `YouSaid`): the hanzi said is the hero with the
 * pinyin under it, the verdict a small chip — green "✓ Match", YELLOW "≈ Contains the answer" (the
 * answer said inside a longer sentence), red "✕ Didn't match"; icon + words differ per state, so none
 * relies on colour alone. [onPlay] = ▶ on the left (a read card's take); [onCoach] = ✎ Check in Coach
 * on the right of the yellow box only.
 */
@Composable
fun YouSaidBox(r: TranscriptionComparison, onCoach: (() -> Unit)? = null, onPlay: (() -> Unit)? = null) {
    val state = if (r.isMatch) "match" else if (r.containsExpected) "contains" else "miss"
    val tone = when (state) { "match" -> YouSaidTone.MATCH; "contains" -> YouSaidTone.CONTAINS; else -> YouSaidTone.MISS }
    val coach = onCoach?.takeIf { state == "contains" }
    YouSaidShell(
        tone,
        Modifier.testTag("$YOU_SAID_TAG-$state"),
        left = onPlay?.let { play -> { YouSaidRound(Icons.Rounded.PlayArrow, YOU_SAID_PLAY_LABEL, tone, YOU_SAID_PLAY_TAG, play) } },
        right = coach?.let { open -> { YouSaidRound(Icons.Rounded.Edit, YOU_SAID_COACH_LABEL, tone, YOU_SAID_COACH_TAG, open) } },
    ) {
        YouSaidHead(tone, state)
        Spacer(Modifier.size(4.dp))
        Text(r.transcribedHanzi.ifEmpty { "…" }, fontSize = 22.sp, lineHeight = 29.sp, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center)
        if (r.transcribedPinyin.isNotBlank()) {
            Text(tidyYouSaidPinyin(r.transcribedPinyin), fontSize = 14.sp, lineHeight = 19.sp, color = Lab.colors.muted, textAlign = TextAlign.Center)
        }
    }
}

/** "Transcribing…" in the result's shell (no jump when the result arrives). */
@Composable
fun YouSaidPending() {
    YouSaidShell(YouSaidTone.PENDING, Modifier.testTag("$YOU_SAID_TAG-pending")) {
        YouSaidHead()
        Spacer(Modifier.size(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val ink = toneInk(YouSaidTone.PENDING)
            val pulse = rememberInfiniteTransition(label = "you-said-dots")
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                repeat(3) { i ->
                    val a by pulse.animateFloat(
                        initialValue = 0.3f,
                        targetValue = 1f,
                        animationSpec = infiniteRepeatable(tween(480), RepeatMode.Reverse, StartOffset(i * 150)),
                        label = "dot$i",
                    )
                    Box(Modifier.size(6.dp).alpha(a).clip(CircleShape).background(ink))
                }
            }
            Text("Transcribing…", fontSize = 14.sp, color = Lab.colors.muted)
        }
    }
}

/** Offline: the take is kept and transcribed in the next sync. */
@Composable
fun YouSaidOffline() {
    YouSaidShell(YouSaidTone.NEUTRAL, Modifier.testTag("$YOU_SAID_TAG-offline")) {
        YouSaidHead()
        Spacer(Modifier.size(6.dp))
        Text("Recording saved, will transcribe when online", fontSize = 14.sp, color = Lab.colors.muted, textAlign = TextAlign.Center)
    }
}

/** Never silent: both transcription paths failed — the whole box retries the same take. */
@Composable
fun YouSaidFailed(note: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    YouSaidShell(
        YouSaidTone.MISS,
        modifier.clip(RoundedCornerShape(14.dp)).clickable(onClick = onRetry),
        left = {
            Box(Modifier.size(44.dp).clip(CircleShape).background(toneColor(YouSaidTone.MISS).copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Refresh, contentDescription = null, tint = toneInk(YouSaidTone.MISS), modifier = Modifier.size(22.dp))
            }
        },
        sides = true,
    ) {
        Text("Couldn’t transcribe", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Text("Tap to retry · " + note.replaceFirstChar { it.lowercase() }, fontSize = 12.sp, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 2.dp))
    }
}

/** Test tag of the "≈ Close — the tones are off" note on a spoken typing-card answer. */
const val SPOKEN_CLOSE_NOTE_TAG = "spoken-close-note"

/**
 * "≈ Close — the tones are off" over a wrong spoken answer's diff: the partly-right yellow of the
 * "Contains the answer" box (a solid lemon pill with dark brown words), never orange. Web:
 * `.answer-diff-spoken-note--close`.
 */
@Composable
fun SpokenCloseNote(text: String) {
    val ink = if (isDarkCard()) Palette.PartialInkDark else Palette.PartialInk
    Row(
        Modifier
            .padding(bottom = 4.dp)
            .clip(RoundedCornerShape(50))
            .background(Palette.PartialStrong)
            .padding(horizontal = 10.dp, vertical = 3.dp)
            .testTag(SPOKEN_CLOSE_NOTE_TAG),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(YouSaidApproxIcon, contentDescription = null, tint = ink, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(4.dp))
        Text(text, fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, color = ink, textAlign = TextAlign.Center)
    }
}
