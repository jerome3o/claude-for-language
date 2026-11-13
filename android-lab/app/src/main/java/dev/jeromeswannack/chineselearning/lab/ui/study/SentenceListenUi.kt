package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import dev.jeromeswannack.chineselearning.lab.core.SentenceRound
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextField
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags of a listen exercise (the web's `sentence-listen-*` test ids). */
object SentenceListenTags {
    const val TAP = "sentence-listen-tap"
    const val PLAY = "sentence-listen-play"
    const val SLOW = "sentence-listen-slow"
    const val INPUT = "sentence-listen-input"
    const val SHOW = "sentence-listen-show"
    const val REVEAL = "sentence-listen-reveal"
    const val ENGLISH = "sentence-listen-english"
    const val SAID = "sentence-listen-said"
    const val VERDICT = "sentence-listen-verdict"
    const val GOT = "sentence-listen-got"
    const val MISSED = "sentence-listen-missed"
    const val RETRY = "sentence-listen-retry"
}

/** How a listen exercise was judged (or is being). */
sealed interface ListenVerdict {
    data object Checking : ListenVerdict
    /** Claude's meaning check ([by] "claude") or his English = the sentence's English ([by] "exact"). */
    data class Claude(val check: AnswerCheck, val result: String, val by: String) : ListenVerdict
    /** No check (offline, no English, none to be had, 👁 Show the answer): ✓ Got it / ✗ Missed it. */
    data object Self : ListenVerdict
    data class SelfDone(val result: String) : ListenVerdict
}

/** A listen exercise answered on this showing: what he said ([input] spoken | edited | typed | none) and the verdict. */
data class ListenTake(
    val said: String,
    val input: String,
    val verdict: ListenVerdict,
    /** A 🔁 Try again after the answer was shown (core SentenceRound.takeAfterReveal): counts, not written to the history. */
    val afterReveal: Boolean = false,
)

/** The result a listen take counts as (null while checking / waiting for the self-check). */
fun ListenTake.result(): String? = when (val v = verdict) {
    is ListenVerdict.Claude -> v.result
    is ListenVerdict.SelfDone -> v.result
    else -> null
}

/**
 * Hard mode's "Sentences by ear" (the web's components/study/SentenceListenExercise.tsx; rules in core
 * [SentenceRound]; docs/STUDY_SESSION.md "Sentences by ear"): the clip with no text — never by itself: one big
 * ▶ Tap to listen until [heard], then ▶ Play again and 🐢 0.75× — his meaning in English in the voice-first box, then
 * the reveal — Chinese, pinyin, English, ▶ — at once, and the verdict in a slim row under it whose height is kept
 * from the start (Checking… → ✓ Right · headline), so nothing above it moves.
 */
@Composable
fun ListenExerciseCard(
    index: Int,
    ex: SentenceRound.Exercise,
    row: SentenceRow,
    active: Boolean,
    /** He has tapped to hear it (until then: one big ▶ Tap to listen — the clip never plays by itself). */
    heard: Boolean = true,
    isRight: Boolean,
    take: ListenTake?,
    playingKey: String?,
    /** The round's 🎤 (a read / translate take) is on: the box waits. */
    micBusy: Boolean,
    onPlay: (speed: Double) -> Unit,
    onAnswer: (text: String, input: String) -> Unit,
    onShowAnswer: () -> Unit,
    onSelfCheck: (gotIt: Boolean) -> Unit,
    /** 🔁 Try again — also after the answer was shown (Jerome: "say them again and then get it correct"). */
    onRetry: () -> Unit = {},
    onMore: () -> Unit,
) {
    val result = take?.result()
    val status = if (isRight) "right" else result
    val answered = take != null
    val shape = RoundedCornerShape(16.dp)
    val border = when (status) {
        "right" -> Palette.Good
        "close" -> Palette.Gold
        "wrong" -> Palette.Hard
        else -> if (active && !answered) Palette.Gold else Lab.colors.cardBorder
    }
    val playing = playingKey != null && playingKey == row.audioUrl
    Column(
        Modifier.fillMaxWidth().clip(shape)
            .background(if (status == "right") Palette.Good.copy(alpha = 0.08f) else Lab.colors.card)
            .border(if (status == null && !(active && !answered)) 1.dp else 2.dp, border, shape)
            .pointerInput(ex.id) { detectTapGestures(onLongPress = { onMore() }) }
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .animateContentSize()
            .testTag("${SentenceRoundTags.EXERCISE}-$index-${ex.mode}-${status ?: "open"}"),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.size(24.dp).clip(CircleShape).background(if (status == "right") Palette.Good else Lab.colors.faint),
                contentAlignment = Alignment.Center,
            ) { Text(if (status == "right") "✓" else "${index + 1}", color = if (status == "right") Color.White else Lab.colors.ink, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
            Text(SentenceRound.PROMPT[SentenceRound.LISTEN].orEmpty(), Modifier.weight(1f), color = Lab.colors.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            status?.let { Text(SentenceRound.RESULT[it].orEmpty(), color = Lab.colors.ink, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
            Box(
                Modifier.size(width = 44.dp, height = 32.dp).bouncyClickable(true, 0.9f, role = Role.Button, onClick = onMore)
                    .semantics { contentDescription = "More: ${SentenceHistory.HIDE_TITLE}" }.testTag(SentenceRoundTags.MORE),
                contentAlignment = Alignment.Center,
            ) { Text("⋯", color = Lab.colors.muted, fontSize = 18.sp) }
        }
        if (take == null && !heard) {
            // Nothing plays by itself (Jerome: "I should click the card to make it play"): one big target, the row wide.
            PrimaryPill(
                "▶ ${SentenceRound.LISTEN_EX_TAP_TO_LISTEN}",
                Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 56.dp).testTag(SentenceListenTags.TAP)
                    .semantics { contentDescription = "${SentenceRound.LISTEN_EX_TAP_TO_LISTEN}: ${SentenceRound.PROMPT[SentenceRound.LISTEN].orEmpty()}" },
            ) { onPlay(1.0) }
        }
        if (take == null) {
            // The question: the clip only — no Chinese, no pinyin, no English.
            if (heard) Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill(
                    "▶ ${SentenceRound.LISTEN_EX_PLAY}", Modifier.heightIn(min = 44.dp).testTag(SentenceListenTags.PLAY),
                    horizontalPadding = 14.dp, fontSize = 14.sp,
                ) { onPlay(1.0) }
                SecondaryPill(
                    "🐢 ${SentenceRound.LISTEN_EX_SLOW}", Modifier.heightIn(min = 44.dp).testTag(SentenceListenTags.SLOW)
                        .semantics { contentDescription = "Play at ${SentenceRound.LISTEN_EX_SLOW}" },
                    horizontalPadding = 14.dp, fontSize = 14.sp,
                ) { onPlay(SentenceRound.LISTEN_SLOW_RATE) }
            }
            if (active) {
                var text by remember(ex.id) { mutableStateOf("") }
                VoiceTextField(
                    value = text,
                    onValueChange = { text = it },
                    onSubmit = { a -> if (a.text.isNotBlank()) onAnswer(a.text.trim(), a.source) },
                    surface = "sentence_listen",
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag(SentenceListenTags.INPUT),
                    submitLabel = SentenceRound.LISTEN_EX_SUBMIT,
                    placeholder = SentenceRound.LISTEN_EX_PLACEHOLDER,
                    lang = "en",
                    enabled = !micBusy,
                )
                Box(Modifier.fillMaxWidth().padding(top = 4.dp), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).bouncyClickable(!micBusy) { onShowAnswer() }
                            .padding(horizontal = 14.dp).testTag(SentenceListenTags.SHOW),
                        contentAlignment = Alignment.Center,
                    ) { Text("👁 ${SentenceRound.LISTEN_EX_SHOW_ANSWER}", color = Lab.colors.muted, fontSize = 14.sp) }
                }
            }
        } else {
            // The reveal, at once.
            Row(Modifier.fillMaxWidth().padding(top = 6.dp).testTag(SentenceListenTags.REVEAL), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    RoundChinese(row.hanzi, explorable = true)
                    if (!row.pinyin.isNullOrBlank()) Text(row.pinyin, color = Lab.colors.muted, fontSize = 14.sp)
                    if (!row.translation.isNullOrBlank()) Text(row.translation, Modifier.testTag(SentenceListenTags.ENGLISH), color = Lab.colors.muted, fontSize = 14.sp)
                    else Text(SentenceRound.TRANSLATION_OFFLINE, color = Lab.colors.muted.copy(alpha = 0.75f), fontSize = 14.sp, fontStyle = FontStyle.Italic)
                }
                Box(
                    Modifier.size(44.dp).bouncyClickable(true, 0.9f, role = Role.Button) { onPlay(1.0) }
                        .semantics { contentDescription = "Play: ${row.hanzi}" }.testTag(SentenceRoundTags.PLAY),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.size(40.dp).clip(CircleShape).background(if (playing) Lab.colors.accent else Lab.colors.faint),
                        contentAlignment = Alignment.Center,
                    ) { Text("▶", color = if (playing) Lab.colors.onAccent else Lab.colors.ink, fontSize = 14.sp) }
                }
            }
            if (take.input != "none") {
                Text(
                    "${SentenceRound.LISTEN_EX_YOU_SAID}: ${take.said}", Modifier.padding(top = 4.dp).testTag(SentenceListenTags.SAID),
                    color = Lab.colors.ink, fontSize = 14.sp,
                )
            }
            // The verdict, slim, under the reveal — its height kept from the start so nothing jumps.
            Box(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 4.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite }.testTag(SentenceListenTags.VERDICT),
                contentAlignment = Alignment.CenterStart,
            ) {
                when (val v = take.verdict) {
                    ListenVerdict.Checking -> Text(SentenceRound.LISTEN_EX_CHECKING, color = Lab.colors.muted, fontSize = 14.sp, fontStyle = FontStyle.Italic)
                    is ListenVerdict.Claude -> Text(
                        "${SentenceRound.RESULT[v.result].orEmpty()} · ${v.check.headline}",
                        color = Lab.colors.ink, fontSize = 14.sp,
                    )
                    ListenVerdict.Self -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(SentenceRound.LISTEN_EX_SELF_QUESTION, color = Lab.colors.muted, fontSize = 14.sp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            SecondaryPill("✗ ${SentenceRound.LISTEN_EX_MISSED_IT}", Modifier.weight(1f).heightIn(min = 44.dp).testTag(SentenceListenTags.MISSED), horizontalPadding = 12.dp, fontSize = 14.sp) { onSelfCheck(false) }
                            PrimaryPill("✓ ${SentenceRound.LISTEN_EX_GOT_IT}", Modifier.weight(1f).heightIn(min = 44.dp).testTag(SentenceListenTags.GOT)) { onSelfCheck(true) }
                        }
                    }
                    is ListenVerdict.SelfDone -> Text(SentenceRound.RESULT[v.result].orEmpty(), color = Lab.colors.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
            }
            if (SentenceRound.retryOffered(status, true, take.verdict == ListenVerdict.Checking)) {
                Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                    SecondaryPill(
                        "🔁 ${SentenceRound.TRY_AGAIN}", Modifier.heightIn(min = 44.dp).testTag(SentenceListenTags.RETRY),
                        enabled = !micBusy, horizontalPadding = 14.dp, fontSize = 14.sp, onClick = onRetry,
                    )
                }
            }
            (take.verdict as? ListenVerdict.Claude)?.check?.tips?.takeIf { it.isNotEmpty() }?.let { tips ->
                Column(Modifier.padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    tips.forEach { t -> Text("• ${t.quote?.let { "$it  " } ?: ""}${t.text}", color = Lab.colors.muted, fontSize = 13.sp) }
                }
            }
        }
    }
}
