package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.clickable
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.NoteAudio
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Where one of the card's clips stands (data/audio/NoteAudioFixer). */
enum class ClipState { READY, GENERATING, WAITING_FOR_CONNECTION, FAILED }

/** The card's word clip and its example sentence's clip. */
data class CardAudio(val word: ClipState = ClipState.READY, val sentence: ClipState = ClipState.READY)

object CardAudioRules {
    const val GENERATING = "Generating audio…"
    const val WAITING = "Audio will be made when you're online"
    const val FAILED = "Couldn't make audio — retry"

    /**
     * A clip that isn't missing is READY; a missing one follows the note's request status —
     * none yet means one is about to start (online) or will be queued (offline).
     */
    fun state(missing: Boolean, status: NoteAudio.Status?, online: Boolean): ClipState = when {
        !missing -> ClipState.READY
        status == NoteAudio.Status.Generating -> ClipState.GENERATING
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
