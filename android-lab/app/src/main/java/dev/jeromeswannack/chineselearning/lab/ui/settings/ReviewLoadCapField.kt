package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ReviewLoad
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Steps of the limit's stepper (100 → 110 → …; 10–1000, ReviewLoad.CAP_MIN / CAP_MAX). */
const val REVIEW_CAP_STEP = 10

/**
 * "Pause new cards on heavy days" (core ReviewLoad; the web's components/ReviewLoadCapField.tsx)
 * under the budget's steppers — the learner's Settings and the tutor's "Daily new cards" sheet:
 * a switch, then "when more than [− 100 +] reviews are due" and the one-line explanation.
 * [value] null = off; switching it on offers the last number, else 100.
 */
@Composable
fun ReviewLoadCapField(value: Int?, onChange: (Int?) -> Unit, enabled: Boolean, hint: String, modifier: Modifier = Modifier) {
    val lastOn = remember { intArrayOf(value ?: ReviewLoad.CAP_SUGGESTED) }
    if (value != null && ReviewLoad.isValid(value)) lastOn[0] = value
    val on = value != null
    Column(modifier.fillMaxWidth().testTag("review-cap")) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = enabled) { onChange(if (on) null else lastOn[0]) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Pause new cards on heavy days",
                style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink,
                modifier = Modifier.weight(1f),
            )
            Switch(
                checked = on,
                onCheckedChange = { onChange(if (it) lastOn[0] else null) },
                enabled = enabled,
                colors = SwitchDefaults.colors(checkedTrackColor = Lab.colors.accent),
                modifier = Modifier.testTag("review-cap-switch"),
            )
        }
        AnimatedVisibility(on) {
            val v = value ?: lastOn[0]
            Column(Modifier.padding(top = 4.dp)) {
                Stepper(
                    "When more than", "reviews are due",
                    v,
                    { next -> onChange((if (next > v) v + REVIEW_CAP_STEP else v - REVIEW_CAP_STEP).coerceIn(ReviewLoad.CAP_MIN, ReviewLoad.CAP_MAX)) },
                    ReviewLoad.CAP_MAX,
                    enabled && v > 0,
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(hint, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}
