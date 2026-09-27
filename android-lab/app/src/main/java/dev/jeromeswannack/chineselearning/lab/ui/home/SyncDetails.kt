package dev.jeromeswannack.chineselearning.lab.ui.home

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.SyncRun
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** "Syncing · Downloading reviews · 12,000 so far" while a sync runs (a first sync of a big account takes a while). */
internal fun syncProgressText(sync: SyncStatus): String {
    val phase = sync.phase ?: return "Syncing…"
    return listOfNotNull("Syncing", phase, sync.progress).joinToString(" · ")
}

internal fun formatMs(ms: Long): String = if (ms < 1000) "$ms ms" else "%.1f s".format(ms / 1000.0)

/** Lab settings: how the last sync went, step by step (tap to open). */
@Composable
internal fun LastSyncDetails(run: SyncRun?, startOpen: Boolean = false) {
    if (run == null) return
    var open by remember { mutableStateOf(startOpen) }
    Column(Modifier.fillMaxWidth().animateContentSize()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable { open = !open }.padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Last sync: ${if (run.full) "full" else "incremental"} · ${formatMs(run.totalMs)}" + if (run.ok) "" else " · failed",
                style = MaterialTheme.typography.bodyMedium,
                color = if (run.ok) Lab.colors.muted else Palette.Again,
                modifier = Modifier.weight(1f),
            )
            Text(if (open) "Hide" else "Details", style = MaterialTheme.typography.bodySmall, color = Lab.colors.accent)
        }
        if (open) {
            for (p in run.phases) {
                Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    Text(p.name, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                    Text(
                        formatMs(p.ms),
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = Lab.colors.ink,
                        textAlign = TextAlign.End,
                        modifier = Modifier.width(72.dp),
                    )
                }
                if (p.detail.isNotBlank()) {
                    Text(p.detail, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(bottom = 4.dp))
                }
            }
        }
    }
}
