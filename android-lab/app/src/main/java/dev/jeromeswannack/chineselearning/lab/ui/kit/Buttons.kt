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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
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

/** The main call to action: accent pill, white label, springy press. 56dp tall by default. */
@Composable
fun PrimaryPill(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = Lab.colors.accent, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .bouncyClickable(enabled, 0.95f, onClick = onClick)
            .clip(RoundedCornerShape(20.dp))
            .background(color)
            .alpha(if (enabled) 1f else 0.5f)
            .padding(horizontal = 22.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
    }
}

/** A quieter action beside a [PrimaryPill]: outlined, accent label. */
@Composable
fun SecondaryPill(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, danger: Boolean = false, onClick: () -> Unit) {
    val fg = if (danger) Palette.Again else Lab.colors.accent
    Box(
        modifier
            .heightIn(min = 48.dp)
            .bouncyClickable(enabled, 0.95f, onClick = onClick)
            .clip(RoundedCornerShape(20.dp))
            .border(1.5.dp, fg.copy(alpha = 0.5f), RoundedCornerShape(20.dp))
            .alpha(if (enabled) 1f else 0.5f)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = fg, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}
