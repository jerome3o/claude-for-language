package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
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
import dev.jeromeswannack.chineselearning.lab.core.StudyDay
import dev.jeromeswannack.chineselearning.lab.data.StudyDayClock
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * Settings → Study → "New day starts at" (web components/settings/DayRolloverSetting.tsx; core
 * StudyDay): per account, 4 am by default. Before this hour it is still yesterday — the queue, the
 * new-card budget, the daily reader and the celebration don't roll over at midnight. Saved on the
 * phone at once (offline too) and on the server through the Outbox.
 */
@Composable
fun DayRolloverSettingsCard(app: LabApp) {
    val hour by StudyDayClock.hour.collectAsState()
    DayRolloverSettingsView(hour) { next ->
        app.haptics.tick()
        StudyDayClock.save(app, next)
    }
}

/** Stateless (screenshots). */
@Composable
fun DayRolloverSettingsView(hour: Int, onChoose: (Int) -> Unit) {
    LabCard {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).testTag("day-rollover"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🌙", fontSize = 22.sp, modifier = Modifier.width(44.dp))
                Text("New day starts at", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
            }
            Segmented(StudyDay.CHOICES.map { it to if (it == 0) "Midnight" else "$it am" }, hour) { onChoose(it) }
            Text(
                if (hour == 0) "A new day starts at midnight: your queue, new cards and story roll over at 00:00."
                else "Until ${StudyDay.label(hour)} it's still yesterday — study past midnight and your queue, new cards and story don't roll over.",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            )
        }
    }
}
