package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ReaderSpeed
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * The web's ReaderSpeedChip: one tap cycles 1× → 0.75× → 0.5× → 1× (core [ReaderSpeed]).
 * Neutral at 1×, accent while slowed so a slowed reader is obvious at a glance. 44dp tall.
 */
@Composable
fun ReaderSpeedChip(speed: Double, onClick: () -> Unit, minWidth: Dp = 60.dp) {
    val slowed = speed != 1.0
    val bg by animateColorAsState(if (slowed) Lab.colors.accentSoft else Lab.colors.faint, label = "speed-bg")
    val fg by animateColorAsState(if (slowed) Lab.colors.accent else Lab.colors.muted, label = "speed-fg")
    val label = ReaderSpeed.label(speed)
    Box(
        Modifier.widthIn(min = minWidth).height(44.dp)
            .bouncyClickable(pressedScale = 0.9f, onClick = onClick)
            .clip(CircleShape).background(bg)
            .border(1.dp, if (slowed) Color.Transparent else Lab.colors.cardBorder, CircleShape)
            .padding(horizontal = 12.dp)
            .testTag("reader-speed-chip")
            .semantics { contentDescription = "Playback speed $label — tap for ${ReaderSpeed.label(ReaderSpeed.next(speed))}" },
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(label, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "speed") { l ->
            Text(l, color = fg, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
