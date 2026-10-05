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
 * Round 5 (core CallFollow, web CallPage): "Stop their share" on the student's shared screen (the tutor
 * only) and, on the student's side, the "Minghui stopped your screen share" note. Round 5's "Show for
 * student" button and "… is showing you this" pill were replaced by "Same view" (CallViewUi.kt).
 */
data class LeadActions(
    /** The tutor stops the student's screen share. */
    val onStopTheirShare: () -> Unit = {},
    val onDismissShareStopped: () -> Unit = {},
    /** The call screen's width (dp): the controller's stage is the screen's. */
    val onStageWidth: (Double) -> Unit = {},
)

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
