package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.SentenceStyle
import dev.jeromeswannack.chineselearning.lab.data.SentenceStyleStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * Settings → Study → "Example sentence style" (web components/settings/SentenceStyleSetting.tsx; core
 * SentenceStyle): per account, Everyday by default. The register the example sentences on his cards are written
 * in — Standard / Everyday / Casual. New sentences only. Saved on the phone at once (offline too) and on the server
 * through the Outbox.
 */
@Composable
fun SentenceStyleSettingsCard(app: LabApp) {
    val style by SentenceStyleStore.style.collectAsState()
    SentenceStyleSettingsView(style) { next ->
        app.haptics.tick()
        SentenceStyleStore.save(app, next)
    }
}

/** Stateless (screenshots). */
@Composable
fun SentenceStyleSettingsView(style: String, onChoose: (String) -> Unit) {
    LabCard {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).testTag("sentence-style"),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("💬", fontSize = 22.sp, modifier = Modifier.width(44.dp))
                Text("Example sentence style", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
            }
            Text(
                "How the example sentences on your cards are written. ${SentenceStyle.NOTE}",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            )
            for (s in SentenceStyle.STYLES) {
                val selected = s == style
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (selected) Lab.colors.accentSoft else Color.Transparent)
                        .bouncyClickable(true, 0.98f, role = Role.RadioButton) { onChoose(s) }
                        .padding(horizontal = 10.dp, vertical = 8.dp)
                        .testTag("sentence-style-$s"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            SentenceStyle.label(s) + if (s == SentenceStyle.DEFAULT) " (default)" else "",
                            color = Lab.colors.ink, fontSize = 15.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        )
                        Text(SentenceStyle.description(s), color = Lab.colors.muted, fontSize = 13.sp)
                    }
                    if (selected) Text("✓", color = Lab.colors.accent, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
