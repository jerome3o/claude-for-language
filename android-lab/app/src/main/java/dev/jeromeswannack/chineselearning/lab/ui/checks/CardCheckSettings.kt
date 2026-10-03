package dev.jeromeswannack.chineselearning.lab.ui.checks

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.setCardCheck
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.settings.SettingsSection
import dev.jeromeswannack.chineselearning.lab.ui.settings.StatusLine
import kotlinx.coroutines.launch

const val CARD_CHECK_LABEL = "Check new words for mistakes"
const val CARD_CHECK_DESC = "Claude double-checks the pinyin and meaning of words you add — about a cent per 100 words. On by default for tutors."

/** Settings → "Check new words for mistakes" (stateless for screenshots). */
@Composable
fun CardCheckSection(on: Boolean, note: String?, onChange: (Boolean) -> Unit) {
    SettingsSection("Word checks") {
        // The label and its sentence wrap (a ToggleRow keeps them to one line each).
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(12.dp)).toggleable(value = on, role = Role.Switch, onValueChange = onChange).padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f).padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("🔎 $CARD_CHECK_LABEL", style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                Text(CARD_CHECK_DESC, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
            Switch(checked = on, onCheckedChange = null)
        }
        StatusLine(note, error = note != null)
    }
}

/** PUT /api/profile/card-check; reflects /api/auth/me's `card_check` (cached in Prefs by every sync). */
@Composable
fun CardCheckSettings(app: LabApp) {
    var on by remember { mutableStateOf(app.prefs.cardCheck) }
    var note by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        runCatching { app.repo.api.me() }.getOrNull()?.card_check?.let { on = it; app.prefs.cardCheck = it }
    }
    CardCheckSection(on, note) { next ->
        val prev = on
        on = next
        note = null
        scope.launch {
            runCatching { app.repo.api.setCardCheck(next) }
                .onSuccess {
                    on = it.card_check
                    app.prefs.cardCheck = it.card_check
                    Analytics.track("settings.change", mapOf("setting" to "card_check", "value" to if (it.card_check) "on" else "off"))
                }
                .onFailure { on = prev; note = "Couldn't save: ${it.userMessage()}" }
        }
    }
}
