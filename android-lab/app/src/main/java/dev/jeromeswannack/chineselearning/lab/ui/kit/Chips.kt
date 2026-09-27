package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * A tappable chip: filters, quick actions (the coach's "Make a card"), choices. Selected
 * chips fill with the accent. 40dp tall so a row of them stays thumb-friendly.
 */
@Composable
fun LabChip(label: String, modifier: Modifier = Modifier, selected: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val bg by animateColorAsState(if (selected) Lab.colors.accent else Lab.colors.card, label = "chip")
    val fg = if (selected) Color.White else Lab.colors.ink
    Text(
        label,
        color = fg,
        fontSize = 14.sp,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        modifier = modifier
            .heightIn(min = 40.dp)
            .bouncyClickable(enabled, 0.94f, onClick = onClick)
            .clip(RoundedCornerShape(50))
            .background(bg)
            .border(1.dp, if (selected) Color.Transparent else Lab.colors.cardBorder, RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

/** Wrapping row of chips. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipRow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        content()
    }
}
