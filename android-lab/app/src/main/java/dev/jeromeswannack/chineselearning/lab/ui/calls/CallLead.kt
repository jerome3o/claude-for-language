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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable

/**
 * Round 5 (core CallFollow, web CallPage): the tutor leads the student's screen. Her corner button on a
 * stage tile ("Show for student" / "Showing ✓"), "Stop their share" on the student's shared screen, and
 * on the student's side the quiet "Minghui is showing you this" pill and the "Minghui stopped your
 * screen share" note.
 */
data class LeadActions(
    /** The tutor's corner button on a stage tile: show it to the student. */
    val onShow: (CallLayout.TileId) -> Unit = {},
    /** The tutor stops the student's screen share. */
    val onStopTheirShare: () -> Unit = {},
    /** ✕ on "… is showing you this". */
    val onDismissShowing: () -> Unit = {},
    val onDismissShareStopped: () -> Unit = {},
    /** The call screen's width (dp): the controller's stage is the screen's. */
    val onStageWidth: (Double) -> Unit = {},
)

/** The tutor's corner button: "Show for student", or "Showing ✓" while that is what the student sees. */
@Composable
fun ShowForStudentButton(showing: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val bg by animateColorAsState(if (showing) Color(0xE6059669) else Color(0xE61F2937), label = "show-bg")
    Text(
        if (showing) CallFollow.SHOWN_BUTTON_LABEL else "👀 ${CallFollow.SHOW_BUTTON_LABEL}",
        color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .border(1.dp, Color(0x40FFFFFF), RoundedCornerShape(999.dp))
            .semantics { contentDescription = if (showing) "The student sees this" else CallFollow.SHOW_BUTTON_LABEL }
            .bouncyClickable(onClick = onClick)
            .testTag(if (showing) "showing-for-student" else "show-for-student")
            .heightIn(min = 40.dp)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    )
}

/** On the student's shared screen, for the tutor: stop it (the room stops their capture). */
@Composable
fun StopTheirShareButton(modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        "⏹ ${CallFollow.STOP_THEIR_SHARE_LABEL}",
        color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color(0xE6DC2626))
            .bouncyClickable(onClick = onClick)
            .testTag("stop-their-share")
            .heightIn(min = 40.dp)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    )
}

/** The student's subtle "Minghui is showing you this" pill, with ✕. */
@Composable
fun ShowingBannerPill(text: String?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    AnimatedVisibility(text != null, modifier, enter = fadeIn() + slideInVertically { -it }, exit = fadeOut() + slideOutVertically { -it }) {
        val t = remember(text) { text } ?: return@AnimatedVisibility
        Row(
            Modifier.widthIn(max = 360.dp).clip(RoundedCornerShape(999.dp)).background(Color(0xCC111827))
                .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(999.dp))
                .padding(start = 12.dp, end = 2.dp)
                .testTag("showing-banner"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("👀 $t", color = Color(0xFFE5E7EB), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Box(
                Modifier.size(40.dp).clip(CircleShape).semantics { contentDescription = "Hide" }.bouncyClickable(onClick = onDismiss),
                contentAlignment = Alignment.Center,
            ) { Text("✕", color = Color(0xFF9CA3AF), fontSize = 13.sp) }
        }
    }
}

/** "Minghui stopped your screen share" — a few seconds, or until tapped. */
@Composable
fun ShareStoppedPill(note: BoardNotice?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    LaunchedEffect(note?.id) {
        if (note == null) return@LaunchedEffect
        kotlinx.coroutines.delay(SHARE_STOPPED_NOTE_MS)
        onDismiss()
    }
    AnimatedVisibility(note != null, modifier, enter = fadeIn() + slideInVertically { -it }, exit = fadeOut() + slideOutVertically { -it }) {
        val n = remember(note?.id) { note } ?: return@AnimatedVisibility
        Text(
            "🖥️ ${n.text}", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xE6B45309)).bouncyClickable(onClick = onDismiss)
                .testTag("share-stopped-note")
                .padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
}

/** How long "… stopped your screen share" stays up. */
const val SHARE_STOPPED_NOTE_MS = 6_000L
