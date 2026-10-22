package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/**
 * The Lab app's press feel: the element sinks a little on touch and springs back
 * (`Spring.DampingRatioMediumBouncy`). Use it instead of a plain `clickable` on anything
 * big and tappable (cards, pills, hero buttons) — no ripple, just the spring.
 */
fun Modifier.bouncyClickable(enabled: Boolean = true, pressedScale: Float = 0.97f, role: Role? = Role.Button, onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && enabled) pressedScale else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "press")
    this.scale(scale).clickable(interactionSource = source, indication = null, enabled = enabled, role = role, onClick = onClick)
}

/**
 * A button's outline (`Lab.colors.outline`, ≥ 3:1 on every surface — `ThemeContrastTest`):
 * solid while [enabled], DASHED when not, so a disabled button reads as off without relying on
 * colour (Jerome is somewhat colour-blind) yet stays visible. Every non-primary button wears it;
 * put it after `clip(shape)` / `background(…)`. [color] for an accent / danger outline.
 */
fun Modifier.buttonBorder(shape: Shape, enabled: Boolean = true, color: Color? = null, width: Dp = 1.dp): Modifier = composed {
    val c = color ?: Lab.colors.outline
    if (enabled) this.border(width, c, shape)
    else this.dashedBorder(shape, Lab.colors.outline, width)
}

/** A dashed outline drawn inside the bounds (the disabled look of [buttonBorder]). */
fun Modifier.dashedBorder(shape: Shape, color: Color, width: Dp = 1.dp): Modifier = drawBehind {
    val w = width.toPx()
    val inset = w / 2
    val outline = shape.createOutline(androidx.compose.ui.geometry.Size(size.width - w, size.height - w), layoutDirection, this)
    translate(inset, inset) {
        drawOutline(outline, color, style = Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))))
    }
}

/**
 * The main call to action: accent pill, `onAccent` label, springy press. Disabled = a grey
 * (`faint`) pill with a muted label and a dashed outline — never the accent at half strength,
 * which looked enabled in dark mode (the mini lesson's Check).
 */
@Composable
fun PrimaryPill(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = Lab.colors.accent, onClick: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    val labelColor = when {
        !enabled -> Lab.colors.muted
        color == Lab.colors.accent -> Lab.colors.onAccent
        else -> Color.White
    }
    Box(
        modifier
            .heightIn(min = 48.dp)
            .bouncyClickable(enabled, 0.95f, onClick = onClick)
            .clip(shape)
            .background(if (enabled) color else Lab.colors.faint)
            .then(if (enabled) Modifier else Modifier.buttonBorder(shape, enabled = false))
            .padding(horizontal = 22.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = labelColor, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
    }
}

/**
 * A quieter action beside a [PrimaryPill]: outlined (`accentOutline`, ≥ 3:1), accent label.
 * Disabled = muted label + dashed outline. [horizontalPadding] and [fontSize] make it smaller
 * when two sit beside a wide primary in one row (study's voice-first row).
 */
@Composable
fun SecondaryPill(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    danger: Boolean = false,
    horizontalPadding: Dp = 20.dp,
    fontSize: TextUnit = 16.sp,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(20.dp)
    val fg = if (danger) Palette.Again else Lab.colors.accent
    Box(
        modifier
            .heightIn(min = 48.dp)
            .bouncyClickable(enabled, 0.95f, onClick = onClick)
            .clip(shape)
            .buttonBorder(shape, enabled, color = if (danger) Palette.Again else Lab.colors.accentOutline, width = 1.5.dp)
            .padding(horizontal = horizontalPadding),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (enabled) fg else Lab.colors.muted, fontWeight = FontWeight.SemiBold, fontSize = fontSize)
    }
}
