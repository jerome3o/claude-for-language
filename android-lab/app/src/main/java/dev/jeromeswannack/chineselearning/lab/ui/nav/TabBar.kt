package dev.jeromeswannack.chineselearning.lab.ui.nav

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Style
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * The bottom tab bar — same tabs, labels and order as the web's TabBar (NavRules.tabsFor).
 * The selected tab gets a springy accent pill behind a filled icon; the host plays a
 * haptic tick on every switch.
 */
@Composable
fun LabTabBar(tabs: List<TabSpec>, active: TabId?, onSelect: (TabSpec) -> Unit, modifier: Modifier = Modifier, badges: Map<TabId, Int> = emptyMap()) {
    Column(modifier.fillMaxWidth().background(Lab.colors.card).testTag("tab-bar")) {
        HorizontalDivider(color = Lab.colors.cardBorder, thickness = 0.5.dp)
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().height(68.dp).padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (tab in tabs) {
                TabItem(tab, selected = tab.id == active, onClick = { onSelect(tab) }, modifier = Modifier.weight(1f), badge = badges[tab.id] ?: 0)
            }
        }
    }
}

@Composable
private fun TabItem(tab: TabSpec, selected: Boolean, onClick: () -> Unit, modifier: Modifier, badge: Int = 0) {
    val pill by animateFloatAsState(if (selected) 1f else 0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow), label = "pill")
    val tint by animateColorAsState(if (selected) Lab.colors.accent else Lab.colors.muted, label = "tint")
    Column(
        modifier
            .widthIn(max = 120.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Tab, onClick = onClick)
            .semantics { this.selected = selected; contentDescription = if (badge > 0) "${tab.label}, $badge unread" else tab.label }
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .size(width = 60.dp, height = 32.dp)
                    .scale(scaleX = 0.4f + 0.6f * pill, scaleY = 1f)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Lab.colors.accentSoft.copy(alpha = pill.coerceIn(0f, 1f))),
            )
            Icon(iconFor(tab.id, selected), null, Modifier.size(24.dp), tint = tint)
            if (badge > 0) TabBadge(badge, Modifier.align(Alignment.TopEnd))
        }
        Spacer(Modifier.height(3.dp))
        Text(tab.label, fontSize = 12.sp, color = tint, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1)
    }
}

/** Unread count on a tab icon (TabBadges): a red pill, "99+" past 99, springing in. */
@Composable
private fun TabBadge(count: Int, modifier: Modifier) {
    val pop = remember { androidx.compose.animation.core.Animatable(1f) }
    androidx.compose.runtime.LaunchedEffect(count) {
        pop.snapTo(0.5f)
        pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
    }
    Box(
        modifier
            .padding(end = 6.dp)
            .scale(pop.value)
            .heightIn(min = 18.dp)
            .widthIn(min = 18.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(dev.jeromeswannack.chineselearning.lab.ui.theme.Palette.Again)
            .padding(horizontal = 5.dp)
            .testTag("tab-badge"),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = androidx.compose.ui.graphics.Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

private fun iconFor(id: TabId, selected: Boolean): ImageVector = when (id) {
    TabId.STUDY -> if (selected) Icons.Filled.Style else Icons.Outlined.Style
    TabId.CHATS -> if (selected) Icons.Filled.ChatBubble else Icons.Outlined.ChatBubbleOutline
    TabId.TUTOR -> if (selected) Icons.Filled.Person else Icons.Outlined.Person
    TabId.STUDENTS -> if (selected) Icons.Filled.Groups else Icons.Outlined.Groups
    TabId.LIBRARY -> if (selected) Icons.AutoMirrored.Filled.MenuBook else Icons.AutoMirrored.Outlined.MenuBook
    TabId.PROGRESS -> if (selected) Icons.Filled.BarChart else Icons.Outlined.BarChart
    TabId.MORE -> Icons.Filled.Menu
}
