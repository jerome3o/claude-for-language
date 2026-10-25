package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.lessons.SkipHandwriting
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * Settings → Study: "Skip handwriting exercises" (web components/settings/SkipHandwritingSetting.tsx;
 * core Handwriting): per account, off by default. Mini lessons leave write_handwriting out and type
 * dictation; skipped exercises never count as mistakes (never a revision); the tutor sees them as skipped.
 */
@Composable
fun SkipHandwritingSettingsCard(app: LabApp) {
    val on by SkipHandwriting.state.collectAsState()
    SkipHandwritingSettingsView(on) { next -> SkipHandwriting.save(app, next, "settings") }
}

/** Stateless (screenshots). */
@Composable
fun SkipHandwritingSettingsView(on: Boolean, onToggle: (Boolean) -> Unit) {
    LabCard {
        Row(
            Modifier.fillMaxWidth().bouncyClickable { onToggle(!on) }.padding(horizontal = 16.dp, vertical = 12.dp).testTag("skip-handwriting-toggle"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("✍️", fontSize = 22.sp, modifier = Modifier.width(44.dp))
            Column(Modifier.weight(1f)) {
                Text("Skip handwriting exercises", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
                Text(
                    if (on) "Mini lessons leave out \"write it by hand\" exercises and you type dictation instead. Skipped exercises never count as mistakes, so they never bring a lesson back as a revision. Your tutor sees them as skipped."
                    else "Off — mini lessons include handwriting exercises.",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                )
            }
            Switch(checked = on, onCheckedChange = onToggle, colors = SwitchDefaults.colors(checkedTrackColor = Lab.colors.accent))
        }
    }
}
