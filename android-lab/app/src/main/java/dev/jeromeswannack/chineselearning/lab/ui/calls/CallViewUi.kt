package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallView
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable

/**
 * "Same view" (core CallView, web CallPage): the chip in the call's top bar, its menu (Same view · My
 * own view · Bring <name> to my view) and the invitation pill when they bring me while I look around.
 * Replaces round 5's "Show for student" button and "Minghui is showing you this" pill.
 */
data class ViewActions(
    /** "Same view" / "My own view" picked in the menu. */
    val onMode: (CallView.ViewMode) -> Unit = {},
    /** "Bring <name> to my view". */
    val onBring: () -> Unit = {},
    /** "Join" on the invitation. */
    val onJoin: () -> Unit = {},
    /** ✕ on the invitation. */
    val onDismissInvite: () -> Unit = {},
    /** The 📝 / 💬 guard: true = they just put this tile on my stage, so my press leaves it there (CallController.keepsJustShared). */
    val keepsJustShared: (dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId) -> Boolean = { false },
)

/** The top bar's chip: "👥 Same view ✓" / "👤 My own view". */
@Composable
fun ViewChip(mode: CallView.ViewMode, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val same = mode == CallView.ViewMode.SAME
    val bg by animateColorAsState(if (same) Color(0x33059669) else Color(0x33F59E0B), label = "view-chip")
    Text(
        CallView.viewChipLabel(mode),
        color = if (same) Color(0xFFA7F3D0) else Color(0xFFFDE68A), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .border(1.dp, if (same) Color(0x66059669) else Color(0x66F59E0B), RoundedCornerShape(999.dp))
            .semantics { contentDescription = "View: ${if (same) CallView.SAME_VIEW_LABEL else CallView.OWN_VIEW_LABEL}" }
            .bouncyClickable(onClick = onClick)
            .testTag("view-chip")
            .heightIn(min = 36.dp)
            .padding(horizontal = 10.dp, vertical = 8.dp),
    )
}

/** The chip's sheet: the two modes with their hints, "Bring <name> to my view", and whether they look around. */
@Composable
fun CallViewMenu(mode: CallView.ViewMode, otherName: String, otherHere: Boolean, theyLookAround: Boolean, actions: ViewActions, close: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ViewModeRow("👥", CallView.SAME_VIEW_LABEL, CallView.sameViewHint(otherName), mode == CallView.ViewMode.SAME, "view-same") {
            actions.onMode(CallView.ViewMode.SAME); close()
        }
        ViewModeRow("👤", CallView.OWN_VIEW_LABEL, CallView.ownViewHint(otherName), mode == CallView.ViewMode.OWN, "view-own") {
            actions.onMode(CallView.ViewMode.OWN); close()
        }
        if (otherHere) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.accent)
                    .bouncyClickable(role = Role.Button) { actions.onBring(); close() }
                    .testTag("view-bring")
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
            ) {
                Text("👁 ${CallView.bringLabel(otherName)}", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            }
        }
        if (theyLookAround) Text(
            "👀 ${CallView.theyLookAroundText(otherName)}",
            color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 4.dp).testTag("view-they-look-around"),
        )
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun ViewModeRow(icon: String, label: String, hint: String, selected: Boolean, tag: String, onClick: () -> Unit) {
    val border = if (selected) Lab.colors.accent else Lab.colors.cardBorder
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(14.dp))
            .border(if (selected) 2.dp else 1.dp, border, RoundedCornerShape(14.dp))
            .semantics { this.selected = selected }
            .bouncyClickable(role = Role.RadioButton, onClick = onClick)
            .testTag(tag)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(icon, fontSize = 22.sp)
        Column(Modifier.weight(1f)) {
            Text(label, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = Lab.colors.ink)
            Text(hint, color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
        }
        Box(
            Modifier.size(22.dp).clip(CircleShape).border(2.dp, border, CircleShape),
            contentAlignment = Alignment.Center,
        ) { if (selected) Box(Modifier.size(12.dp).clip(CircleShape).background(Lab.colors.accent)) }
    }
}

/** "👁 Minghui wants you to see their view" with Join and ✕ (I'm on my own view and they brought me). */
@Composable
fun ViewInvitePill(name: String?, onJoin: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    AnimatedVisibility(name != null, modifier, enter = fadeIn() + slideInVertically { it }, exit = fadeOut() + slideOutVertically { it }) {
        val n = remember(name) { name } ?: return@AnimatedVisibility
        Row(
            Modifier.widthIn(max = 400.dp).clip(RoundedCornerShape(999.dp)).background(Color(0xE6111827))
                .border(1.dp, Color(0x40FFFFFF), RoundedCornerShape(999.dp))
                .padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp)
                .testTag("view-invite"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("👁 ${CallView.inviteText(n)}", color = Color(0xFFF3F4F6), fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Text(
                "Join", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xFF059669))
                    .bouncyClickable(role = Role.Button, onClick = onJoin).testTag("view-invite-join")
                    .heightIn(min = 40.dp).padding(horizontal = 16.dp, vertical = 10.dp),
            )
            Box(
                Modifier.size(40.dp).clip(CircleShape).semantics { contentDescription = "Not now" }.bouncyClickable(onClick = onDismiss),
                contentAlignment = Alignment.Center,
            ) { Text("✕", color = Color(0xFF9CA3AF), fontSize = 14.sp) }
        }
    }
}
