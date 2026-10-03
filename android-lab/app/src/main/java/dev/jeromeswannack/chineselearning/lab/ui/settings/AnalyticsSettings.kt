package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.analytics.setShareUsage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

/** The one-line promise under the switch (same copy as the web's Settings → Advanced). */
const val SHARE_USAGE_EXPLAINER = "Which screens and features you use — never your messages, cards or recordings."

/** Settings → Advanced → "Share usage data". Stateless for screenshots. */
@Composable
fun ShareUsageSection(on: Boolean, error: String?, busy: Boolean = false, onChange: (Boolean) -> Unit) {
    SettingsSection("Usage data") {
        // Wraps (a ToggleRow label is one line and would cut the sentence off).
        androidx.compose.foundation.layout.Row(
            androidx.compose.ui.Modifier.fillMaxWidth().heightIn(min = 48.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        ) {
            Text("Share usage data to help improve the app", style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, modifier = androidx.compose.ui.Modifier.weight(1f))
            androidx.compose.foundation.layout.Spacer(androidx.compose.ui.Modifier.width(12.dp))
            androidx.compose.material3.Switch(checked = on, onCheckedChange = { if (!busy) onChange(it) }, enabled = !busy)
        }
        Text(SHARE_USAGE_EXPLAINER, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        if (error != null) InlineNotice(error, kind = NoticeKind.Warning)
    }
}

/**
 * The switch wired up: optimistic, saved with `PUT /api/profile/analytics`; turning it off
 * records `settings.analytics {on:false}`, sends what is queued and then clears the queue
 * (Analytics.changeSharing). A failed save puts the switch back and says why.
 */
@Composable
fun ShareUsageSettings(app: LabApp) {
    var on by remember { mutableStateOf(app.prefs.shareUsage) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    ShareUsageSection(on, error, busy) { next ->
        val prev = on
        on = next
        error = null
        busy = true
        scope.launch {
            try {
                app.analytics.changeSharing(next) { app.prefs.shareUsage = it }
                runCatching { app.repo.api.setShareUsage(next) }.onFailure { e ->
                    on = prev
                    app.prefs.shareUsage = prev
                    error = "Couldn't save: ${e.userMessage()}"
                }
            } finally {
                busy = false
            }
        }
    }
}
