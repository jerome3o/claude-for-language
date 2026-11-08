package dev.jeromeswannack.chineselearning.lab.ui.study

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.HardMode
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags of 🎤 Read it again (the web's data-testids in components/study/HardModeReadAgain.tsx). */
object ReadAgainTags {
    const val BLOCK = "hard-read-again"
    const val MIC = "hard-read-again-mic"
    const val LIVE = "hard-read-again-live"
    const val CHECKING = "hard-read-again-checking"
    const val RESULT = "hard-read-again-result"
    const val RETRY = "hard-read-again-retry"
    const val EMPTY = "hard-read-again-empty"
    const val BLOCKED = "hard-read-again-blocked"
}

/** The answer in place, for 🎤 Read it again: what he reads, and for analytics the card type and where (session | homework). */
data class ReadAgainInfo(val hanzi: String, val pinyin: String?, val cardType: String, val where: String)

/** A judged read-again take: what was heard (tidied), right / close / wrong, and the "You said" row's verdict. */
data class ReadAgainTake(val said: String, val result: String, val verdict: AnswerKey.Verdict)

/**
 * 🎤 Read it again in Hard mode's answer in place (after 👁 Show answer; the web's `HardModeReadAgain`; rules in core
 * [HardMode.readAgainResult] / [HardMode.readAgainVerdict], parity-tested). The take goes through the question's
 * pipeline (the study recorder + live Soniox words, the upload fallback, "Couldn't transcribe — tap to retry" with the
 * same take — [rememberVoiceDictation]) and is judged with the READ card's rule ([Transcription.compare]); ✓ Right this
 * time / ≈ Nearly / ✗ Not quite + the "You said" row, felt like the question's check (fx/StudyFeel). PRACTICE ONLY:
 * nothing about the card changes — it stays a miss, Good / Easy (the pass's Got it) stay greyed, no take is kept.
 */
@Composable
fun ReadAgainBlock(info: ReadAgainInfo) {
    val controller = rememberVoiceDictation("hard_mode_read_again", autoSubmit = true)
    val ui by controller.ui.collectAsState()
    var take by remember(info.hanzi) { mutableStateOf<ReadAgainTake?>(null) }
    var tries by remember(info.hanzi) { mutableIntStateOf(0) }
    val feel = dev.jeromeswannack.chineselearning.lab.fx.rememberStudyFeel()
    val actions = rememberVoiceFirstActions(controller, value = "", onFill = {}) { answer ->
        val c = Transcription.compare(answer.text, info.hanzi)
        val said = AnswerKey.tidySpokenTranscript(c.transcribedHanzi, info.hanzi).ifBlank { c.transcribedHanzi }
        val result = HardMode.readAgainResult(c.isMatch, c.containsExpected, c.tonesOff)
        tries += 1
        take = ReadAgainTake(said, result, HardMode.readAgainVerdict(c.isMatch, c.containsExpected, c.tonesOff, said, info.hanzi))
        feel(HardMode.questionFeel(result))
        Analytics.track(
            "study.hard_mode_read_again",
            mapOf("result" to result, "tries" to tries, "via" to (answer.via ?: "none"), "card_type" to info.cardType, "where" to info.where),
        )
    }
    // A take that gave nothing is reported once.
    LaunchedEffect(ui.phase, ui.failure) {
        if (ui.phase == "failed") {
            Analytics.track(
                "study.hard_mode_read_again",
                mapOf("result" to if (ui.failure == "empty") "empty" else "failed", "tries" to tries, "via" to "none", "card_type" to info.cardType, "where" to info.where),
            )
        }
    }
    ReadAgainContent(
        ui = ui,
        take = take,
        tries = tries,
        correct = info.hanzi,
        onMic = {
            when (ui.phase) {
                "listening" -> controller.stop()
                "finishing" -> Unit
                else -> {
                    take = null
                    actions.say()
                }
            }
        },
        onRetry = { controller.retryUpload() },
    )
}

/** The block drawn from its state (stateless; screenshot tests render it directly). */
@Composable
fun ReadAgainContent(ui: VoiceDictationUi, take: ReadAgainTake?, tries: Int, correct: String, onMic: () -> Unit, onRetry: () -> Unit) {
    val listening = ui.phase == "listening"
    val finishing = ui.phase == "finishing"
    val enabled = CoachPractise.micEnabled(ui.blocked)
    Column(
        Modifier.fillMaxWidth().padding(top = 4.dp).testTag(ReadAgainTags.BLOCK),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        when {
            listening -> Box(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
                    .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite }
                    .testTag(ReadAgainTags.LIVE),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (ui.finalText.isEmpty() && ui.partialText.isEmpty()) Text(HardMode.READ_AGAIN_LISTENING, color = Lab.colors.muted, fontSize = 14.sp)
                else Text(
                    buildAnnotatedString {
                        append(ui.finalText)
                        withStyle(SpanStyle(color = Lab.colors.muted)) { append(ui.partialText) }
                    },
                    color = Lab.colors.ink, fontSize = 18.sp,
                )
            }
            finishing -> Row(Modifier.testTag(ReadAgainTags.CHECKING), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(16.dp), color = Lab.colors.accent, strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text(HardMode.CHECKING, color = Lab.colors.muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
            ui.phase == "failed" ->
                if (ui.failure == "empty") Text(HardMode.READ_AGAIN_EMPTY, Modifier.testTag(ReadAgainTags.EMPTY), color = Lab.colors.muted, fontSize = 14.sp)
                else Box(Modifier.testTag(ReadAgainTags.RETRY)) { YouSaidFailed("Or read it again", onRetry) }
            take != null -> Column(
                Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }.testTag("${ReadAgainTags.RESULT}-${take.result}"),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                val ink = when (take.result) {
                    "right" -> Palette.Good
                    "close" -> Palette.Gold
                    else -> Palette.Again
                }
                Text(HardMode.READ_AGAIN_RESULT.getValue(take.result), color = ink, fontSize = 17.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                SpokenResultRow(take.said, correct, take.verdict)
                if (take.result == "right") Text(HardMode.READ_AGAIN_PRACTICE, color = Lab.colors.muted, fontSize = 12.sp, textAlign = TextAlign.Center)
            }
        }
        SecondaryPill(
            if (listening) "⏹ ${HardMode.READ_AGAIN_STOP}" else "🎤 ${HardMode.readAgainLabel(tries)}",
            Modifier.widthIn(min = 200.dp).height(48.dp).testTag(ReadAgainTags.MIC),
            enabled = enabled && !finishing,
            danger = listening,
            onClick = onMic,
        )
        if (!enabled) CoachPractise.blockNote(ui.blocked)?.let {
            Text(it, Modifier.testTag(ReadAgainTags.BLOCKED), color = Lab.colors.muted, fontSize = 13.sp, textAlign = TextAlign.Center)
        }
    }
}
