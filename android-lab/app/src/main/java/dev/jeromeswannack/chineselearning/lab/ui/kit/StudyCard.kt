package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * The study card's look, shared by the study session (ui/study/CardStage) and the homework
 * pass (ui/homework) so a word feels the same wherever it is asked: the rounded, lifted card
 * surface, the hanzi size scale, the flip spring, the colored answer tiles of the bottom bar
 * and the card-to-card transition.
 */

/** Corner of the study card. */
val StudyCardShape = RoundedCornerShape(28.dp)

/** The card surface: shadow (higher once turned), rounded, filled, bordered ([border] tints it by the verdict). */
fun Modifier.studyCardSurface(background: Color, border: Color, lifted: Boolean, borderWidth: Dp = 1.dp): Modifier =
    shadow(if (lifted) 10.dp else 6.dp, StudyCardShape)
        .clip(StudyCardShape)
        .background(background)
        .border(borderWidth, border, StudyCardShape)

/** The card turning over (rotationY 0 → 180). */
val StudyCardFlip: AnimationSpec<Float> = spring(dampingRatio = 0.78f, stiffness = 240f)

/** How big a word's hanzi is on the card: two characters large, a sentence smaller. */
fun studyHanziSize(hanzi: String): TextUnit = when {
    hanzi.length <= 2 -> 76.sp
    hanzi.length <= 4 -> 60.sp
    hanzi.length <= 8 -> 44.sp
    hanzi.length <= 14 -> 34.sp
    else -> 26.sp
}

/**
 * The next card: it rises in; the one answered leaves by its rating — Good / Easy fling it
 * away to the right, Again drops it, Hard slides it left ([lastRating] 0–3, null = just fade).
 */
fun studyCardTransition(lastRating: Int?): ContentTransform {
    val enter = slideInVertically(spring(dampingRatio = 0.8f, stiffness = 380f)) { it / 6 } +
        scaleIn(spring(dampingRatio = 0.8f, stiffness = 380f), initialScale = 0.94f) + fadeIn(tween(180))
    val exit = when (lastRating) {
        0 -> slideOutVertically(tween(260)) { it / 3 } + fadeOut(tween(200))
        1 -> slideOutHorizontally(tween(240)) { -it / 2 } + fadeOut(tween(200))
        2, 3 -> slideOutHorizontally(tween(260)) { it } + scaleOut(tween(260), targetScale = 0.9f) + fadeOut(tween(240))
        else -> fadeOut(tween(150))
    }
    return enter togetherWith exit
}

/** Height of the study bottom bar's answer tiles (the ratings, the pass's Not yet / Got it). */
val AnswerTileHeight: Dp = 66.dp

/**
 * One colored answer tile of the study bottom bar: white label (+ an optional small line,
 * e.g. the interval), squeezes when pressed.
 */
@Composable
fun AnswerTile(label: String, color: Color, modifier: Modifier = Modifier, sub: String? = null, enabled: Boolean = true, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.92f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium), label = "press")
    Column(
        modifier
            .height(AnswerTileHeight)
            .scale(scale)
            .clip(RoundedCornerShape(18.dp))
            .background(color.copy(alpha = if (enabled) 1f else 0.4f))
            .clickable(interactionSource = source, indication = null, enabled = enabled, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(label, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        sub?.let { Text(it, color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp) }
    }
}
