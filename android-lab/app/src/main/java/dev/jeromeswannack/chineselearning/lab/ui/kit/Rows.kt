package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** A small uppercase-ish heading above a group of rows (the web's `.nav-section-title`). */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, trailing: @Composable (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(top = 12.dp, bottom = 2.dp, start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** A rounded card surface grouping rows (the web's `.nav-list`). Rows inside get hairline dividers via [RowDivider]. */
@Composable
fun LabCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card), content = content)
}

@Composable
fun RowDivider() = HorizontalDivider(Modifier.padding(start = 60.dp), color = Lab.colors.faint)

/** [SectionHeader] + [LabCard] with dividers between the rows — one More-page group. */
@Composable
fun NavSection(title: String, modifier: Modifier = Modifier, rows: List<@Composable () -> Unit>) {
    Column(modifier) {
        SectionHeader(title)
        LabCard {
            rows.forEachIndexed { i, row ->
                if (i > 0) RowDivider()
                row()
            }
        }
    }
}

/**
 * One 56dp+ row: emoji icon · label (+ badge) + one-line description · trailing (chevron by
 * default, ↗ when [external] — the row opens the main app). The web's `NavRow`.
 */
@Composable
fun NavRow(
    icon: String,
    label: String,
    modifier: Modifier = Modifier,
    desc: String? = null,
    danger: Boolean = false,
    enabled: Boolean = true,
    external: Boolean = false,
    badge: String? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(if (onClick != null) Modifier.clickable(enabled = enabled, onClick = onClick) else Modifier)
            .alpha(if (enabled) 1f else 0.5f)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(28.dp).clipToBounds(), contentAlignment = Alignment.Center) { Text(icon, fontSize = 20.sp, maxLines = 1, softWrap = false) }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    color = if (danger) Palette.Again else Lab.colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (badge != null) {
                    Spacer(Modifier.width(8.dp))
                    CountBadge(badge)
                }
            }
            if (desc != null) Text(desc, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        when {
            trailing != null -> trailing()
            external -> Icon(Icons.AutoMirrored.Filled.OpenInNew, "Opens the main app", Modifier.size(18.dp), tint = Lab.colors.muted)
            onClick != null -> Text("›", color = Lab.colors.muted, fontSize = 22.sp)
        }
    }
}

/** A row with a switch (settings). The whole row toggles. */
@Composable
fun ToggleRow(icon: String, label: String, checked: Boolean, desc: String? = null, onChange: (Boolean) -> Unit) {
    NavRow(
        icon = icon,
        label = label,
        desc = desc,
        trailing = {
            Switch(
                checked = checked,
                onCheckedChange = onChange,
                colors = SwitchDefaults.colors(checkedTrackColor = Lab.colors.accent),
            )
        },
        onClick = { onChange(!checked) },
    )
}

/** A small pill with a number or word (unread counts, "new"). */
@Composable
fun CountBadge(text: String, color: Color = Lab.colors.accent) {
    Text(
        text,
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(CircleShape).background(color).padding(horizontal = 7.dp, vertical = 1.dp),
    )
}
