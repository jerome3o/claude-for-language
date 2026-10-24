package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.SentencePractise
import dev.jeromeswannack.chineselearning.lab.core.SentenceRound
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.fx.SparkBurst
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay

/** Test tags of the Sentence round. */
object SentenceRoundTags {
    const val ROUND = "sentence-round"
    const val QUESTION = "sentence-round-question"
    const val COUNTER = "sentence-round-counter"
    const val CHEER = "sentence-round-cheer"
    const val EXERCISE = "sentence-round-exercise"
    const val CHINESE = "sentence-round-chinese"
    const val ENGLISH = "sentence-round-english"
    const val PLAY = "sentence-round-play"
    const val RETRY = "sentence-round-retry"
    const val SKIP = "sentence-round-skip"
    const val CONTINUE = "sentence-round-continue"
    const val MORE = "sentence-round-more"
}

/** The round's exercises over the card's sentence rows and his history of them (core [SentenceRound.pick]). */
fun sentenceRoundExercises(rows: List<SentenceRow>, stats: Map<String, SentenceHistory.Stats>? = null): List<SentenceRound.Exercise> =
    SentenceRound.pick(rows.map { SentenceRound.Sentence(it.key, it.hanzi, it.translation) }, stats)

/**
 * The Sentence round (the web's components/study/SentenceRound.tsx; rules in core [SentenceRound];
 * docs/STUDY_SESSION.md "Sentence round"): between a reading / meaning card's question and its answer,
 * four sentence exercises — 📖 Read it aloud (the Chinese up) and 🔁 Say it in Chinese (the English up;
 * its Chinese and ▶ only once answered) — any two right open the answer with Good / Easy unlocked
 * ([onDone]); Skip ([onSkip]) opens it with the gate still on. Takes go through [practise] (the list's
 * one microphone) under the exercise ids, so its `rightKeys` are the gate's count. Practice only.
 */
@Composable
fun SentenceRoundPage(
    question: String,
    questionIsChinese: Boolean,
    rows: List<SentenceRow>,
    practise: SentencePractiseState,
    playingKey: String?,
    onPlay: (key: String?, text: String) -> Unit,
    onDone: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
    /** His practice history of these sentences (null while it loads): the round prefers what he knows least. */
    stats: Map<String, SentenceHistory.Stats>? = emptyMap(),
    /** "✨ New sentences coming for this word" (asked already). */
    coming: Boolean = false,
    /** Every sentence left known, or fewer than four in rotation: ask for more ("known" | "few"). */
    onWantMore: (why: String) -> Unit = {},
    /** "Stop showing this sentence" / Undo (row keys). */
    onHide: (rowKey: String, reason: String) -> Unit = { _, _ -> },
    onUnhide: (rowKey: String) -> Unit = {},
) {
    // Picked ONCE per showing (from the history as it stood): a take written meanwhile never reshuffles it.
    var picked by remember { mutableStateOf<List<SentenceRound.Exercise>?>(null) }
    LaunchedEffect(rows, stats != null) { if (picked == null && stats != null) picked = sentenceRoundExercises(rows, stats) }
    fun hidden(key: String) = stats?.get(SentenceHistory.key(key))?.hidden != null
    val exercises = picked.orEmpty().filter { !hidden(it.key) }
    val visibleKeys = rows.filter { !hidden(it.key) }.map { it.key }
    val byKey = remember(rows) { rows.associateBy { it.key } }
    val right = practise.rightKeys.toList()
    val progress = SentenceRound.progress(exercises, right, visibleKeys)
    var asked by remember { mutableStateOf(false) }
    LaunchedEffect(rows, stats) {
        val st = stats ?: return@LaunchedEffect
        if (SentenceHistory.wantsMore(rows.map { SentenceRound.Sentence(it.key, it.hanzi, it.translation) }, st)) {
            onWantMore(if (visibleKeys.size < SentenceHistory.MIN_VISIBLE) "few" else "known")
            asked = true
        }
    }
    var hiding by remember { mutableStateOf<SentenceRound.Exercise?>(null) }
    var undoKey by remember { mutableStateOf<String?>(null) }
    val english = remember { mutableStateMapOf<String, Boolean>() }
    val latestDone by rememberUpdatedState(onDone)

    // No sentences after all: straight to the answer.
    LaunchedEffect(picked) { if (picked?.isEmpty() == true) latestDone() }

    // A result landed: right / miss, once per take (a translate take waits for Claude's check).
    val reported = remember { HashSet<SentenceRowTake>() }
    exercises.forEachIndexed { index, ex ->
        val t = practise.takes[ex.id]
        LaunchedEffect(t, t?.claude) {
            if (t == null || t.claude == SentenceClaude.Checking || !reported.add(t)) return@LaunchedEffect
            val result = SentencePractise.result(t.take.practised, (t.claude as? SentenceClaude.Done)?.check?.verdict)
            Analytics.track("study.sentence_round", mapOf("action" to if (result == "right") "right" else "miss", "index" to index, "mode" to ex.mode, "got" to progress.got, "needed" to progress.needed))
        }
    }

    // A cheer (+ sparks) when the count goes up; confetti and the answer once enough are right.
    var cheer by remember { mutableStateOf<String?>(null) }
    var sparks by remember { mutableIntStateOf(0) }
    var lastGot by remember { mutableIntStateOf(progress.got) }
    LaunchedEffect(progress.got) {
        if (progress.got > lastGot) {
            cheer = SentenceRound.cheer(progress)
            sparks++
            if (progress.done) Analytics.track("study.sentence_round", mapOf("action" to "done", "got" to progress.got, "needed" to progress.needed))
        }
        lastGot = progress.got
    }
    LaunchedEffect(progress.done, cheer) {
        if (progress.done && cheer != null) {
            delay(1400)
            latestDone()
        }
    }

    Box(modifier.fillMaxSize().testTag(SentenceRoundTags.ROUND)) {
        Column(Modifier.fillMaxSize()) {
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 4.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    question,
                    Modifier.fillMaxWidth().padding(top = 4.dp).testTag(SentenceRoundTags.QUESTION),
                    color = Lab.colors.ink,
                    fontSize = if (questionIsChinese) 28.sp else 18.sp,
                    textAlign = TextAlign.Center,
                )
                Box(Modifier.fillMaxWidth().height(1.dp).background(Lab.colors.cardBorder))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("🎯 ${SentenceRound.TITLE}", Modifier.weight(1f).semantics { heading() }, color = Lab.colors.ink, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    if (progress.needed > 0) RoundCounter(progress)
                }
                Text(SentenceRound.intro(progress, exercises.size), color = Lab.colors.muted, fontSize = 14.sp)
                if (coming || asked) SentencesComingNote()
                if (!CoachPractise.micEnabled(practise.dictation.blocked)) {
                    CoachPractise.blockNote(practise.dictation.blocked)?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp) }
                }
                cheer?.let { c ->
                    val pop = remember(c) { Animatable(0.6f) }
                    LaunchedEffect(c) { pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy)) }
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Text(
                            c,
                            Modifier.scale(pop.value).clip(RoundedCornerShape(50)).background(Palette.Good.copy(alpha = 0.16f))
                                .padding(horizontal = 14.dp, vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite }.testTag(SentenceRoundTags.CHEER),
                            color = Lab.colors.ink, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                        )
                    }
                }
                exercises.forEachIndexed { index, ex ->
                    val row = byKey[ex.key] ?: return@forEachIndexed
                    RoundExerciseCard(
                        index, ex, row.copy(key = ex.id), ex.id in right, practise, playingKey, onPlay,
                        showEnglish = english[ex.id] == true,
                        onToggleEnglish = { english[ex.id] = english[ex.id] != true },
                        onRetry = {
                            Analytics.track("study.sentence_round", mapOf("action" to "retry", "index" to index, "mode" to ex.mode, "got" to progress.got, "needed" to progress.needed))
                        },
                        onMore = { hiding = ex },
                    )
                }
                Spacer(Modifier.height(4.dp))
            }
            Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                if (progress.done) {
                    PrimaryPill("${SentenceRound.SEE_ANSWER} →", Modifier.fillMaxWidth().height(56.dp).testTag(SentenceRoundTags.CONTINUE), onClick = onDone)
                } else {
                    SecondaryPill("${SentenceRound.SKIP} →", Modifier.fillMaxWidth().height(52.dp).testTag(SentenceRoundTags.SKIP)) {
                        Analytics.track("study.sentence_round", mapOf("action" to "skip", "got" to progress.got, "needed" to progress.needed))
                        onSkip()
                    }
                    if (progress.needed > 0) {
                        Text(
                            SentenceRound.skipNote(progress), Modifier.fillMaxWidth().padding(top = 6.dp),
                            color = Lab.colors.muted, fontSize = 13.sp, textAlign = TextAlign.Center,
                        )
                    }
                }
            }
        }
        SparkBurst(sparks, listOf(Palette.Good, Palette.Gold, Palette.Easy, Color.White), origin = androidx.compose.ui.geometry.Offset(0.5f, 0.2f))
        if (progress.done && cheer != null) ConfettiRain("round-done", listOf(Palette.Good, Palette.Gold, Palette.Easy, Palette.Again), count = 90)
        undoKey?.let { key ->
            SentenceUndoToast(SentenceHistory.HIDDEN_TOAST, onUndo = { onUnhide(key); undoKey = null }, onDone = { undoKey = null }, modifier = Modifier.align(Alignment.BottomCenter))
        }
    }
    hiding?.let { ex ->
        val row = byKey[ex.key]
        if (row != null) SentenceHideSheet(row.hanzi, row.translation, onHide = { reason -> hiding = null; onHide(ex.key, reason); undoKey = ex.key }, onDismiss = { hiding = null })
    }
}

/** "0 / 2" with a dot per exercise needed (✓ in the ones got: shape + colour). */
@Composable
private fun RoundCounter(progress: SentenceRound.Progress) {
    Row(
        Modifier.testTag(SentenceRoundTags.COUNTER).semantics { contentDescription = "${progress.got} of ${progress.needed} right" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        repeat(progress.needed) { i ->
            val on = i < progress.got
            Box(
                Modifier.size(24.dp).clip(CircleShape)
                    .background(if (on) Palette.Good else Color.Transparent)
                    .border(2.dp, if (on) Palette.Good else Lab.colors.cardBorder, CircleShape),
                contentAlignment = Alignment.Center,
            ) { if (on) Text("✓", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
        }
        Spacer(Modifier.width(2.dp))
        Text(SentenceRound.counter(progress), color = Lab.colors.ink, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    }
}

@Composable
private fun RoundExerciseCard(
    index: Int,
    ex: SentenceRound.Exercise,
    /** The sentence's row with its key = the exercise id (the take's key). */
    row: SentenceRow,
    isRight: Boolean,
    practise: SentencePractiseState,
    playingKey: String?,
    onPlay: (key: String?, text: String) -> Unit,
    showEnglish: Boolean,
    onToggleEnglish: () -> Unit,
    onRetry: () -> Unit,
    onMore: () -> Unit = {},
) {
    val take = practise.takes[ex.id]
    val mine = practise.activeKey == ex.id
    val busy = mine && (practise.listening || practise.finishing)
    val result = take?.takeIf { it.claude != SentenceClaude.Checking }?.let { SentencePractise.result(it.take.practised, (it.claude as? SentenceClaude.Done)?.check?.verdict) }
    val status = when {
        isRight -> "right"
        result == "close" || result == "wrong" -> result
        else -> null
    }
    val answered = isRight || take != null
    val shape = RoundedCornerShape(16.dp)
    val border = when (status) {
        "right" -> Palette.Good
        "close" -> Palette.Gold
        "wrong" -> Palette.Hard
        else -> if (busy) Palette.Again else Lab.colors.cardBorder
    }
    Column(
        Modifier.fillMaxWidth().clip(shape)
            .background(if (status == "right") Palette.Good.copy(alpha = 0.08f) else Lab.colors.card)
            .border(if (status == null) 1.dp else 2.dp, border, shape)
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
            Text(SentenceRound.PROMPT[ex.mode].orEmpty(), Modifier.weight(1f), color = Lab.colors.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            status?.let { Text(SentenceRound.RESULT[it].orEmpty(), color = Lab.colors.ink, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
            Box(
                Modifier.size(width = 44.dp, height = 32.dp).bouncyClickable(true, 0.9f, role = Role.Button, onClick = onMore)
                    .semantics { contentDescription = "More: ${SentenceHistory.HIDE_TITLE}" }.testTag(SentenceRoundTags.MORE),
                contentAlignment = Alignment.Center,
            ) { Text("⋯", color = Lab.colors.muted, fontSize = 18.sp) }
        }
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (ex.mode == SentencePractise.TRANSLATE) {
                    Text(row.translation.orEmpty(), Modifier.testTag(SentenceRoundTags.ENGLISH), color = Lab.colors.ink, fontSize = 17.sp)
                }
                if (ex.mode == SentencePractise.READ || answered) {
                    Text(row.hanzi, Modifier.testTag(SentenceRoundTags.CHINESE), color = Lab.colors.ink, fontSize = 22.sp)
                }
                if (answered && !row.pinyin.isNullOrBlank()) Text(row.pinyin, color = Lab.colors.muted, fontSize = 14.sp)
                if (ex.mode == SentencePractise.READ && answered && showEnglish && !row.translation.isNullOrBlank()) {
                    Text(row.translation, color = Lab.colors.muted, fontSize = 14.sp)
                }
            }
            if (!isRight) SentenceMicButton(practise, row, ex.mode)
            if (answered) {
                val playing = playingKey != null && (playingKey == row.audioUrl || playingKey == "tts:${row.hanzi}")
                Box(
                    Modifier.size(44.dp).bouncyClickable(true, 0.9f, role = Role.Button) { onPlay(row.audioUrl, row.hanzi) }
                        .semantics { contentDescription = "Play: ${row.hanzi}" }.testTag(SentenceRoundTags.PLAY),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.size(40.dp).clip(CircleShape).background(if (playing) Lab.colors.accent else Lab.colors.faint),
                        contentAlignment = Alignment.Center,
                    ) { Text("▶", color = if (playing) Lab.colors.onAccent else Lab.colors.ink, fontSize = 14.sp) }
                }
            }
        }
        SentencePractiseOutcome(practise, row)
        if (answered) {
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if ((status == "close" || status == "wrong") && !busy) {
                    SecondaryPill(
                        "🔁 ${SentenceRound.TRY_AGAIN}", Modifier.heightIn(min = 44.dp).testTag(SentenceRoundTags.RETRY),
                        enabled = CoachPractise.micEnabled(practise.dictation.blocked) && !practise.listening && !practise.finishing,
                        horizontalPadding = 14.dp, fontSize = 14.sp,
                    ) {
                        onRetry()
                        practise.onMic(row, ex.mode)
                    }
                }
                if (ex.mode == SentencePractise.READ && !row.translation.isNullOrBlank()) {
                    Box(
                        Modifier.heightIn(min = 44.dp).bouncyClickable(true, 0.97f, role = Role.Button, onClick = onToggleEnglish).padding(horizontal = 4.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (showEnglish) SentenceRound.HIDE_ENGLISH else SentenceRound.SHOW_ENGLISH, color = Lab.colors.muted, fontSize = 14.sp)
                    }
                }
            }
        }
    }
}
