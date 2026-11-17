package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.StartOffset
import dev.jeromeswannack.chineselearning.lab.core.ReadTakeCheck
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.SpokenAnswerResult
import dev.jeromeswannack.chineselearning.lab.core.AnswerDiff
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tag prefix of the "You said" box: `you-said-match` / `you-said-contains` / `you-said-miss`. */
const val YOU_SAID_TAG = "you-said"
/** The round ✎ on the yellow box: the sentence in the Sentence Coach. */
const val YOU_SAID_COACH_TAG = "you-said-coach"
const val YOU_SAID_COACH_LABEL = "Check in Coach"
/** The round ▶ on a read card's box: the take it was transcribed from. */
const val YOU_SAID_PLAY_TAG = "you-said-play"
const val YOU_SAID_PLAY_LABEL = "Play my recording"
/** The verdict chip's icon: `you-said-verdict-check` / `-approx` / `-close` ([youSaidVerdictIcon]). */
/** A result row's action button target (36dp circle inside). */
val RESULT_ACTION_TARGET = 44.dp

const val YOU_SAID_VERDICT_TAG = "you-said-verdict"

/** The verdict chip's words (web `YOU_SAID_VERDICT` in components/study/YouSaid.tsx). */
fun youSaidVerdictLabel(state: String): String = when (state) {
    "match" -> "Match"
    "contains" -> "Contains the answer"
    "close" -> "Close — tones off"
    else -> "Didn’t match"
}

/** The verdict chip's icon: ✓ match, ≈ contains, ✕ miss — no state relies on colour alone (web `YOU_SAID_VERDICT_ICON`). */
fun youSaidVerdictIcon(state: String): String = when (state) {
    "match" -> "check"
    "contains", "close" -> "approx"
    else -> "close"
}

/** ≈ — two waves, stroked (the web's `ICON.approx` path); tinted like any icon. */
val YouSaidApproxIcon: ImageVector = ImageVector.Builder(
    name = "YouSaidApprox",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
).addPath(
    pathData = addPathNodes("M4 9.5c2.67-2.67 5.33-2.67 8 0s5.33 2.67 8 0M4 15.5c2.67-2.67 5.33-2.67 8 0s5.33 2.67 8 0"),
    fill = null,
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 2.6f,
    strokeLineCap = StrokeCap.Round,
).build()

private fun verdictIconVector(state: String): ImageVector = when (youSaidVerdictIcon(state)) {
    "check" -> Icons.Rounded.Check
    "approx" -> YouSaidApproxIcon
    else -> Icons.Rounded.Close
}

/** The pinyin line under the hanzi: no space before punctuation ("zhōng guó 。" → "zhōng guó。"); web `tidyPinyin`. */
fun tidyYouSaidPinyin(pinyin: String): String = pinyin.replace(Regex("\\s+(?=[。，、！？；：.,!?;:])"), "").trim()

private enum class YouSaidTone { MATCH, CONTAINS, MISS, PENDING, NEUTRAL }

@Composable
private fun isDarkCard(): Boolean = Lab.colors.card.luminance() < 0.5f

/** A tone → its result state (core ResultState): the one colour system every result shares. */
private fun stateOf(t: YouSaidTone): String = when (t) {
    YouSaidTone.MATCH -> dev.jeromeswannack.chineselearning.lab.core.ResultState.RIGHT
    YouSaidTone.CONTAINS -> dev.jeromeswannack.chineselearning.lab.core.ResultState.CLOSE
    YouSaidTone.MISS -> dev.jeromeswannack.chineselearning.lab.core.ResultState.WRONG
    else -> dev.jeromeswannack.chineselearning.lab.core.ResultState.PENDING
}

/** The tone as text / icon colour (the state's ink, ResultColors). */
@Composable
private fun toneInk(t: YouSaidTone): Color = if (t == YouSaidTone.NEUTRAL) Lab.colors.muted else ResultColors.ink(stateOf(t))

/**
 * Every colour of one state's box — the SAME treatment for every state, only the colour differs (Jerome, Nov 2026:
 * the yellow "Contains" box with a thicker outline and solid lemon chip next to a bare green "Match" was "a
 * discrepancy in the UX"): the one result surface (ResultStateUi `resultSurface`), the state's chip, its ink.
 * Close stays yellow (never orange: red / green colour-blind eyes read orange as the red miss).
 */
private data class YouSaidStyle(
    val chip: Color,
    val chipInk: Color,
)

@Composable
private fun toneStyle(t: YouSaidTone): YouSaidStyle =
    if (t == YouSaidTone.NEUTRAL) YouSaidStyle(Lab.colors.faint, Lab.colors.muted)
    else YouSaidStyle(chip = ResultColors.chip(stateOf(t)), chipInk = ResultColors.ink(stateOf(t)))

/**
 * The shell every state shares (the web's `.you-said`): a tinted 14 dp rounded box, at least 88 dp
 * tall so the result replaces "Transcribing…" without a jump, round 44 dp buttons in EQUAL side
 * columns so the text in the middle stays centred.
 */
@Composable
private fun YouSaidShell(
    tone: YouSaidTone,
    modifier: Modifier = Modifier,
    left: (@Composable () -> Unit)? = null,
    right: (@Composable () -> Unit)? = null,
    sides: Boolean = left != null || right != null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Row(
        modifier
            .fillMaxWidth()
            // The one result surface (light outline + faint tint in the state's colour), the same for every state.
            .then(if (tone == YouSaidTone.NEUTRAL) Modifier else Modifier.resultSurface(stateOf(tone)))
            .heightIn(min = 72.dp)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (sides) Box(Modifier.size(RESULT_ACTION_TARGET), contentAlignment = Alignment.Center) { left?.invoke() }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, content = content)
        if (sides) Box(Modifier.size(RESULT_ACTION_TARGET), contentAlignment = Alignment.Center) { right?.invoke() }
    }
}

/** The result rows' one action button (▶ / ✎): a 36dp circle with a hairline in a 44dp target — the same in every
 *  state (web `.you-said-round` / `.result-action`); long-press shows its label. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun YouSaidRound(icon: ImageVector, label: String, tone: YouSaidTone, tag: String, onClick: () -> Unit) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } },
        state = rememberTooltipState(),
    ) {
        Box(
            Modifier
                .size(RESULT_ACTION_TARGET)
                .clickable(onClick = onClick)
                .semantics { contentDescription = label; role = Role.Button }
                .testTag(tag),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = Lab.colors.ink, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun YouSaidHead(tone: YouSaidTone? = null, state: String? = null, label: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("You said", fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium, color = Lab.colors.muted)
        if (tone != null && state != null) {
            val style = toneStyle(tone)
            Row(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(style.chip)
                    .padding(start = 6.dp, end = 8.dp, top = 2.dp, bottom = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (state == "checking") {
                    // Claude is reading the take: three pulsing dots, never a ✗.
                    val pulse = rememberInfiniteTransition(label = "you-said-checking")
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.testTag("$YOU_SAID_VERDICT_TAG-checking")) {
                        repeat(3) { i ->
                            val a by pulse.animateFloat(0.3f, 1f, infiniteRepeatable(tween(480), RepeatMode.Reverse, StartOffset(i * 150)), label = "c$i")
                            Box(Modifier.size(4.dp).alpha(a).clip(CircleShape).background(style.chipInk))
                        }
                    }
                } else {
                    Icon(
                        verdictIconVector(state),
                        contentDescription = null,
                        tint = style.chipInk,
                        modifier = Modifier.size(14.dp).testTag("$YOU_SAID_VERDICT_TAG-${youSaidVerdictIcon(state)}"),
                    )
                }
                Spacer(Modifier.width(3.dp))
                Text(label ?: youSaidVerdictLabel(state), fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.SemiBold, color = style.chipInk)
            }
        }
    }
}

/**
 * "You said" — ONE box for what was said, on the read card's back, under a spoken answer on a
 * typing card and for 🎤 Say it practice (the web's `YouSaid`): the hanzi said is the hero with the
 * pinyin under it, the verdict a small chip — green "✓ Match", YELLOW "≈ Contains the answer" (the
 * answer said inside a longer sentence) and "≈ Close — tones off" (the same syllables, other tones), red
 * "✕ Didn't match"; icon + words differ per state, so none
 * relies on colour alone. [onPlay] = ▶ on the left (a read card's take); [onCoach] = ✎ Check in Coach
 * on the right of the yellow box only.
 */
@Composable
fun YouSaidBox(
    r: TranscriptionComparison,
    onCoach: (() -> Unit)? = null,
    onPlay: (() -> Unit)? = null,
    /** Claude is checking a take the device couldn't accept (core ReadTakeCheck): "Checking…" instead of ✗. */
    checking: Boolean = false,
    /** Claude's verdict on such a take: ✓ Right / ≈ Close / ✗ Didn't match + its one-line reason (and a ✗'s tip). */
    claude: ReadTakeClaude? = null,
    /**
     * The card's hanzi: a take that isn't a match shows the slim answer diff (docs/STUDY_SESSION.md "Answer feedback:
     * one line and a diff") — what was said marked against it and ONE line that says what differs (never Claude's
     * tip; its reason only when the take is too different for a count).
     */
    expected: String? = null,
    modifier: Modifier = Modifier,
) {
    val device = if (r.isMatch) "match" else if (r.containsExpected) "contains" else if (r.tonesOff) "close" else "miss"
    val state = claude?.state ?: device
    val diff = remember(r.transcribedHanzi, expected, state) {
        if (expected != null && r.transcribedHanzi.isNotBlank() && (state == "close" || state == "miss")) AnswerDiff.of(r.transcribedHanzi, expected).takeIf { !it.empty } else null
    }
    val diffLine = diff?.let { AnswerDiff.line(it, accepted = claude?.state == "match", headline = claude?.reason?.reason) }
    val waiting = checking && claude == null
    // Close — tones off is partly right: the same yellow as Contains (never orange — red / green colour-blind).
    val tone = if (waiting) YouSaidTone.PENDING else when (state) { "match" -> YouSaidTone.MATCH; "contains", "close" -> YouSaidTone.CONTAINS; else -> YouSaidTone.MISS }
    val coach = onCoach?.takeIf { state == "contains" }
    YouSaidShell(
        tone,
        modifier.testTag("$YOU_SAID_TAG-${if (waiting) "checking" else state}"),
        left = onPlay?.let { play -> { YouSaidRound(Icons.Rounded.PlayArrow, YOU_SAID_PLAY_LABEL, tone, YOU_SAID_PLAY_TAG, play) } },
        right = coach?.let { open -> { YouSaidRound(Icons.Rounded.Edit, YOU_SAID_COACH_LABEL, tone, YOU_SAID_COACH_TAG, open) } },
    ) {
        if (waiting) YouSaidHead(tone, "checking", label = ReadTakeCheck.CHECKING)
        else YouSaidHead(tone, state, label = claude?.let { ReadTakeCheck.CHIP[it.state] })
        Spacer(Modifier.size(4.dp))
        if (diff != null && diffLine != null) {
            DiffMarkedText(diff.cells(), 22.sp, Modifier.semantics { contentDescription = AnswerDiff.label(diff, diffLine, AnswerDiff.YOU_SAID) }, tag = YOU_SAID_DIFF_TAG)
        } else {
            Text(r.transcribedHanzi.ifEmpty { "…" }, fontSize = 22.sp, lineHeight = 29.sp, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center)
        }
        if (r.transcribedPinyin.isNotBlank()) {
            Text(tidyYouSaidPinyin(r.transcribedPinyin), fontSize = 14.sp, lineHeight = 19.sp, color = Lab.colors.muted, textAlign = TextAlign.Center)
        }
        // ONE line: what differs (the slim diff), else Claude's one-line reason — never its tip.
        (diffLine ?: claude?.reason?.reason?.takeIf { it.isNotBlank() })?.let { line ->
            Spacer(Modifier.size(6.dp))
            Text(line, fontSize = 14.sp, lineHeight = 20.sp, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = Modifier.testTag(YOU_SAID_REASON_TAG))
        }
    }
}

/** Claude's verdict on a read take the device couldn't accept (core ReadTakeCheck): the box's state + its reason. */
data class ReadTakeClaude(val state: String, val reason: ReadTakeCheck.Reason)

const val YOU_SAID_REASON_TAG = "you-said-reason"
const val YOU_SAID_TIP_TAG = "you-said-tip"
const val YOU_SAID_DIFF_TAG = "you-said-diff"

/** "Transcribing…" in the result's shell (no jump when the result arrives). */
@Composable
fun YouSaidPending() {
    YouSaidShell(YouSaidTone.PENDING, Modifier.testTag("$YOU_SAID_TAG-pending")) {
        YouSaidHead()
        Spacer(Modifier.size(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val ink = toneInk(YouSaidTone.PENDING)
            val pulse = rememberInfiniteTransition(label = "you-said-dots")
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                repeat(3) { i ->
                    val a by pulse.animateFloat(
                        initialValue = 0.3f,
                        targetValue = 1f,
                        animationSpec = infiniteRepeatable(tween(480), RepeatMode.Reverse, StartOffset(i * 150)),
                        label = "dot$i",
                    )
                    Box(Modifier.size(6.dp).alpha(a).clip(CircleShape).background(ink))
                }
            }
            Text("Transcribing…", fontSize = 14.sp, color = Lab.colors.muted)
        }
    }
}

/** Offline: the take is kept and transcribed in the next sync. */
@Composable
fun YouSaidOffline() {
    YouSaidShell(YouSaidTone.NEUTRAL, Modifier.testTag("$YOU_SAID_TAG-offline")) {
        YouSaidHead()
        Spacer(Modifier.size(6.dp))
        Text("Recording saved, will transcribe when online", fontSize = 14.sp, color = Lab.colors.muted, textAlign = TextAlign.Center)
    }
}

/** Never silent: both transcription paths failed — the whole box retries the same take. */
@Composable
fun YouSaidFailed(note: String, onRetry: () -> Unit, modifier: Modifier = Modifier, title: String = "Couldn’t transcribe") {
    YouSaidShell(
        YouSaidTone.MISS,
        modifier.clip(ResultShape).clickable(onClick = onRetry),
        left = {
            Box(Modifier.size(36.dp).clip(CircleShape).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Refresh, contentDescription = null, tint = toneInk(YouSaidTone.MISS), modifier = Modifier.size(18.dp))
            }
        },
        sides = true,
    ) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Text("Tap to retry · " + note.replaceFirstChar { it.lowercase() }, fontSize = 12.sp, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 2.dp))
    }
}

/** Test tag prefix of the spoken result row: `spoken-result-match` / `-sound` / `-contains` / `-close` / `-wrong`. */
const val SPOKEN_RESULT_TAG = "spoken-result"

/**
 * The card's answer on the back of a spoken answer: normal ink whatever the verdict — the "You said" row under it
 * carries the state (one result look; it used to turn green, a second, different way of saying "right").
 */
@Suppress("UNUSED_PARAMETER")
@Composable
fun spokenAnswerColor(accepted: Boolean): Color = Lab.colors.ink

/** A "You said" mark → the slim answer diff's cell kind ([DiffMarkedText]). */
private fun spokenCellKind(mark: SpokenAnswerResult.Mark): String = when (mark) {
    SpokenAnswerResult.Mark.RIGHT -> "ok"
    SpokenAnswerResult.Mark.PLAIN -> "muted"
    SpokenAnswerResult.Mark.DIFFERS -> "differs"
    SpokenAnswerResult.Mark.WRONG -> "wrong"
    SpokenAnswerResult.Mark.TONE -> "tone"
    SpokenAnswerResult.Mark.EXTRA -> "extra"
    SpokenAnswerResult.Mark.MISSING -> "missing"
}

/**
 * What was said with each character marked (`shared/cards/spoken-result.ts`): written differently = yellow highlight
 * + a DOTTED underline; close / didn't match = the slim answer diff (docs/STUDY_SESSION.md "Answer feedback: one line
 * and a diff") — wrong rose + solid, tone off lemon wavy, extra yellow in a solid box, missing muted in a dashed box;
 * the words around a contained answer muted. Drawn by [DiffMarkedText].
 */
@Composable
private fun SpokenMarkedText(r: SpokenAnswerResult.Result, fontSize: androidx.compose.ui.unit.TextUnit) =
    SpokenMarkedCells(r.chars, fontSize)

@Composable
internal fun SpokenMarkedCells(chars: List<SpokenAnswerResult.Cell>, fontSize: androidx.compose.ui.unit.TextUnit, tag: String = SPOKEN_RESULT_HANZI_TAG) =
    DiffMarkedText(chars.map { DiffCell(it.char, spokenCellKind(it.mark)) }, fontSize, tag = tag)

/** Test tags inside the spoken result row (the row itself is one node for a screen reader). */
const val SPOKEN_RESULT_HANZI_TAG = "spoken-result-hanzi"
const val SPOKEN_RESULT_CHIP_TAG = "spoken-result-chip"
const val SPOKEN_RESULT_PINYIN_TAG = "spoken-result-pinyin"

/**
 * The spoken answer's result on a typing card (and 🎤 Say it practice) — ONE compact row under the
 * card's own answer, pinyin and meaning (docs/STUDY_SESSION.md "Say the answer"; the web's
 * `YouSaidRow`):
 *
 *   ( ▶ )  You said 朗 lǎng  [≈ Close — tones off]  ( ✎ )
 *
 * The state, chip, icon, ✎ and marks come from core [SpokenAnswerResult] (parity-tested with
 * shared/cards/spoken-result.ts); a screen reader hears the whole row as one sentence.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun SpokenResultRow(
    transcript: String,
    correct: String,
    verdict: AnswerKey.Verdict,
    onPlay: (() -> Unit)? = null,
    onCoach: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    /**
     * The Sentence round (core AnswerDifference.roundTakeView): the sentence is already up with its pinyin,
     * so the row adds only what's new — the transcript when its words differ (marked, smaller), its pinyin
     * when it sounded different; a plain match is just "You said ✓ Match" on one line.
     */
    compact: dev.jeromeswannack.chineselearning.lab.core.AnswerDifference.View? = null,
) {
    val r = SpokenAnswerResult.of(transcript, correct, verdict)
    val fullPinyin = tidyYouSaidPinyin(Transcription.compare(transcript, correct).transcribedPinyin)
    val showHanzi = compact == null || compact.transcript
    val pinyin = if (showHanzi && (compact == null || compact.pinyin)) fullPinyin else ""
    val state = SpokenAnswerResult.stateName(r.state)
    val tone = when (r.state) {
        SpokenAnswerResult.State.MATCH, SpokenAnswerResult.State.SOUND -> YouSaidTone.MATCH
        SpokenAnswerResult.State.CONTAINS, SpokenAnswerResult.State.CLOSE -> YouSaidTone.CONTAINS
        SpokenAnswerResult.State.WRONG -> YouSaidTone.MISS
    }
    val style = toneStyle(tone)
    val coach = onCoach?.takeIf { r.coach }
    val sides = onPlay != null || coach != null
    val label = SpokenAnswerResult.label(r, correct, fullPinyin)
    Row(
        modifier
            .fillMaxWidth()
            // The one result surface, compact or not, in every state (core ResultState; was: the full row boxed with a
            // thicker yellow outline for "contains", the compact row bare — two looks for the same result).
            .resultSurface(stateOf(tone))
            .padding(if (compact != null) 2.dp else 4.dp)
            .testTag("$SPOKEN_RESULT_TAG-$state"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (sides) Box(Modifier.size(RESULT_ACTION_TARGET), contentAlignment = Alignment.Center) {
            onPlay?.let { YouSaidRound(Icons.Rounded.PlayArrow, YOU_SAID_PLAY_LABEL, tone, YOU_SAID_PLAY_TAG, it) }
        }
        androidx.compose.foundation.layout.FlowRow(
            Modifier
                .weight(1f)
                .padding(vertical = 2.dp)
                .semantics(mergeDescendants = true) { contentDescription = label }
                .then(if (compact != null) Modifier.testTag("$SPOKEN_RESULT_TAG-compact-${if (showHanzi) "transcript" else "chip"}") else Modifier),
            horizontalArrangement = Arrangement.spacedBy(6.dp, if (compact != null) Alignment.Start else Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            // Each part is its own item, so a long sentence wraps instead of squeezing its pinyin.
            Text("You said", fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium, color = Lab.colors.muted, modifier = Modifier.align(Alignment.CenterVertically).padding(start = if (compact != null) 6.dp else 0.dp))
            if (showHanzi) Box(Modifier.align(Alignment.CenterVertically)) { SpokenMarkedText(r, if (compact != null) 17.sp else 22.sp) }
            if (pinyin.isNotBlank()) Text(pinyin, fontSize = if (compact != null) 13.sp else 14.sp, lineHeight = 18.sp, color = Lab.colors.muted, modifier = Modifier.align(Alignment.CenterVertically).testTag(SPOKEN_RESULT_PINYIN_TAG))
            Row(
                Modifier
                    .align(Alignment.CenterVertically)
                    .clip(RoundedCornerShape(12.dp))
                    .background(style.chip)
                    .padding(start = 6.dp, end = 8.dp, top = 2.dp, bottom = 2.dp)
                    .testTag(SPOKEN_RESULT_CHIP_TAG),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    when (r.icon) { "check" -> Icons.Rounded.Check; "approx" -> YouSaidApproxIcon; else -> Icons.Rounded.Close },
                    contentDescription = null,
                    tint = style.chipInk,
                    modifier = Modifier.size(14.dp).testTag("$YOU_SAID_VERDICT_TAG-${r.icon}"),
                )
                Spacer(Modifier.width(3.dp))
                Text(r.chip, fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.SemiBold, color = style.chipInk, textAlign = TextAlign.Center)
            }
        }
        if (sides) Box(Modifier.size(RESULT_ACTION_TARGET), contentAlignment = Alignment.Center) {
            coach?.let { YouSaidRound(Icons.Rounded.Edit, YOU_SAID_COACH_LABEL, tone, YOU_SAID_COACH_TAG, it) }
        }
    }
}
