package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.NoteAudio
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Where one of the card's clips stands (data/audio/NoteAudioFixer). */
enum class ClipState {
    READY, GENERATING,
    /** Queued on the server (MiniMax busy): arrives within a minute or two — the card waits for it instead of the device voice. */
    COMING,
    WAITING_FOR_CONNECTION, FAILED,
}

/** The card's word clip and its example sentence's clip. */
data class CardAudio(val word: ClipState = ClipState.READY, val sentence: ClipState = ClipState.READY)

object CardAudioRules {
    const val GENERATING = "Generating audio…"
    const val WAITING = "Audio will be made when you're online"
    const val FAILED = "Couldn't make audio — retry"
    /** The web's `.study-pill--pending` next to Play on the back. */
    const val COMING = "Audio coming…"
    /** The web's `.audio-coming-note` on the front of an audio → hanzi card. */
    const val COMING_FRONT = "Audio coming… (the device voice plays meanwhile)"

    /**
     * A clip that isn't missing is READY; a missing one follows the note's request status —
     * none yet means one is about to start (online) or will be queued (offline).
     */
    fun state(missing: Boolean, status: NoteAudio.Status?, online: Boolean): ClipState = when {
        !missing -> ClipState.READY
        status == NoteAudio.Status.Generating -> ClipState.GENERATING
        // Offline the device voice is the last resort, as before: no waiting for a clip.
        status is NoteAudio.Status.Coming && online -> ClipState.COMING
        status is NoteAudio.Status.Failed -> ClipState.FAILED
        status == NoteAudio.Status.WaitingForConnection || !online -> ClipState.WAITING_FOR_CONNECTION
        else -> ClipState.GENERATING
    }

    fun of(missing: Set<NoteAudio.Clip>, status: NoteAudio.Status?, online: Boolean) = CardAudio(
        word = state(NoteAudio.Clip.WORD in missing, status, online),
        sentence = state(NoteAudio.Clip.SENTENCE in missing, status, online),
    )
}

const val AUDIO_STATUS_TAG = "card-audio-status"

/**
 * One quiet line under a Play button while its clip is being made: "Generating audio…" with a
 * small spinner, "Audio will be made when you're online", or "Couldn't make audio — retry"
 * (tappable). Nothing when the clip is ready.
 */
@Composable
fun AudioStatusLine(state: ClipState, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    if (state == ClipState.READY) return
    if (state == ClipState.COMING) return AudioComingNote(modifier)
    val failed = state == ClipState.FAILED
    Row(
        modifier
            .testTag(AUDIO_STATUS_TAG)
            .clip(RoundedCornerShape(50))
            .then(if (failed) Modifier.heightIn(min = 44.dp).clickable(onClick = onRetry) else Modifier)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (state == ClipState.GENERATING) CircularProgressIndicator(Modifier.size(14.dp), color = Lab.colors.accent, strokeWidth = 2.dp)
        Text(
            when (state) {
                ClipState.GENERATING -> CardAudioRules.GENERATING
                ClipState.WAITING_FOR_CONNECTION -> CardAudioRules.WAITING
                else -> CardAudioRules.FAILED
            },
            style = MaterialTheme.typography.bodySmall,
            color = if (failed) Lab.colors.accent else Lab.colors.muted,
            textAlign = TextAlign.Center,
        )
    }
}

const val AUDIO_COMING_TAG = "card-audio-coming"

/** The web's `.audio-coming-dot`: a small accent dot that pulses (1.4 s), quiet enough to sit beside Play. */
@Composable
fun AudioComingDot(modifier: Modifier = Modifier) {
    val pulse = rememberInfiniteTransition(label = "audio-coming")
    val alpha by pulse.animateFloat(0.25f, 1f, infiniteRepeatable(tween(700, easing = LinearEasing), RepeatMode.Reverse), label = "audio-coming-alpha")
    androidx.compose.foundation.layout.Box(modifier.size(8.dp).alpha(alpha).clip(CircleShape).background(Lab.colors.accent))
}

/**
 * Back of the card, next to Play: "● Audio coming…" in a dashed-looking quiet pill (not a button —
 * a tap on Play still gives the device voice meanwhile). Web `.study-pill--pending`.
 */
@Composable
fun AudioComingPill(modifier: Modifier = Modifier) {
    Row(
        modifier
            .testTag(AUDIO_COMING_TAG)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .clip(CircleShape)
            .border(BorderStroke(1.dp, Lab.colors.muted.copy(alpha = 0.45f)), CircleShape)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        AudioComingDot()
        Text(CardAudioRules.COMING, style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
    }
}

/** Front of an audio → hanzi card: "● Audio coming… (the device voice plays meanwhile)". Web `.audio-coming-note`. */
@Composable
fun AudioComingNote(modifier: Modifier = Modifier) {
    Row(
        modifier.testTag(AUDIO_COMING_TAG).semantics { liveRegion = LiveRegionMode.Polite }.padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        AudioComingDot()
        Text(CardAudioRules.COMING_FRONT, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
    }
}
