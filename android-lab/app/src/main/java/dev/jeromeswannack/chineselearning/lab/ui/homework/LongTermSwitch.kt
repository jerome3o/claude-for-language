package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/**
 * The answer side's "Add to my long-term review" switch (web: components/homework/LongTermSwitch.tsx,
 * docs/HOMEWORK.md §3a): a compact pill, the whole pill toggles (44dp+ target). On = the word joins
 * daily review at the budget's pace; off = it never does. A word already reviewed shows
 * "✓ Already in your reviews" instead — its schedule is not the pass's to change.
 */
@Composable
fun LongTermSwitch(on: Boolean, started: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(50)
    if (started) {
        Row(
            modifier.heightIn(min = 44.dp).clip(shape).background(Lab.colors.faint).padding(horizontal = 16.dp).testTag("hw-longterm"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("✓ Already in your reviews", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
        }
        return
    }
    val bg by animateColorAsState(if (on) Palette.Secondary.copy(alpha = 0.12f) else Color.Transparent, label = "longterm-bg")
    val border by animateColorAsState(if (on) Palette.Secondary.copy(alpha = 0.45f) else Lab.colors.cardBorder, label = "longterm-border")
    Row(
        modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .background(bg)
            .border(1.dp, border, shape)
            .toggleable(value = on, role = Role.Switch, onValueChange = onChange)
            .padding(start = 16.dp, end = 6.dp)
            .testTag("hw-longterm"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (on) "In my long-term review" else "Add to my long-term review",
            style = MaterialTheme.typography.labelLarge,
            color = if (on) Palette.Secondary else Lab.colors.muted,
        )
        Spacer(Modifier.width(8.dp))
        // The pill handles the tap (one target); the switch only shows the state.
        Switch(
            checked = on,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(checkedTrackColor = Palette.Secondary, checkedBorderColor = Palette.Secondary),
            modifier = Modifier.testTag("hw-longterm-switch"),
        )
    }
}
