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
import dev.jeromeswannack.chineselearning.lab.core.AnswerDifference
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.SpokenAnswerResult
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
import kotlinx.coroutines.launch
import androidx.compose.ui.semantics.stateDescription

/** Test tags of the Sentence round. */
object SentenceRoundTags {
    const val ROUND = "sentence-round"
    const val QUESTION = "sentence-round-question"
    const val COUNTER = "sentence-round-counter"
    const val CHEER = "sentence-round-cheer"
    const val EXERCISE = "sentence-round-exercise"
    const val CHINESE = "sentence-round-chinese"
    const val ENGLISH = "sentence-round-english"
    const val READ_ENGLISH = "sentence-round-read-english"
    const val ENGLISH_TOGGLE = "sentence-round-english-toggle"
    const val ENGLISH_PENDING = "sentence-round-english-pending"
    const val PLAY = "sentence-round-play"
    const val RETRY = "sentence-round-retry"
    const val SAY_AGAIN = "sentence-round-say-again"
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
    /** The line under Skip in place of the gate's (the homework pass: Got it isn't held back by the sentences). */
    skipNote: String? = null,
    /** The cheer once enough are right, in place of "Good and Easy unlocked" (the homework pass: "Got it unlocked"). */
    doneCheer: ((got: Int, needed: Int) -> String)? = null,
    /** His practice history of these sentences (null while it loads): the round prefers what he knows least. */
    stats: Map<String, SentenceHistory.Stats>? = emptyMap(),
    /** "✨ New sentences coming for this word" (asked already). */
    coming: Boolean = false,
    /** Every sentence left known, or fewer than four in rotation: ask for more ("known" | "few"). */
    onWantMore: (why: String) -> Unit = {},
    /** "Stop showing this sentence" / Undo (row keys). */
    onHide: (rowKey: String, reason: String) -> Unit = { _, _ -> },
    onUnhide: (rowKey: String) -> Unit = {},
    /** The exercises of this showing's round shown before (resume / back to the question): the same ones come back. */
    initialIds: List<String> = emptyList(),
    /** The exercises as picked (the answer side marks their sentences, in this order). */
    onPicked: (ids: List<String>) -> Unit = {},
    /** A take on an exercise was judged: "right" | "close" | "wrong" (the answer side's outline). */
    onResult: (id: String, result: String) -> Unit = { _, _ -> },
    /** Analytics: "session" | "homework". */
    where: String = "session",
    /** Reads a fix / an alternative of Claude's check aloud (null = no 🔊). */
    onSpeak: ((String) -> Unit)? = null,
    /**
     * A sentence with no English on the note (the card's own, MCP-added / older notes): the English this
     * device holds, and the fetch (the rows' `SentenceActions.translate`, cached by text) once it is shown.
     */
    cachedTranslation: suspend (SentenceRow) -> String? = { null },
    translate: (suspend (SentenceRow) -> String)? = null,
    online: Boolean = true,
) {
    // Picked ONCE per showing (from the history as it stood): a take written meanwhile never reshuffles it.
    var picked by remember { mutableStateOf<List<SentenceRound.Exercise>?>(null) }
    LaunchedEffect(rows, stats != null) {
        if (picked == null && stats != null) {
            val fromLog = if (initialIds.isEmpty()) null else SentenceRound.exercisesFromLog(
                rows.map { SentenceRound.Sentence(it.key, it.hanzi, it.translation) }, initialIds,
            ) { stats[SentenceHistory.key(it)]?.hidden != null }
            val next = fromLog ?: sentenceRoundExercises(rows, stats)
            picked = next
            onPicked(next.map { it.id })
        }
    }
    fun hidden(key: String) = stats?.get(SentenceHistory.key(key))?.hidden != null
    val exercises = picked.orEmpty().filter { !hidden(it.key) }
    val visibleKeys = rows.filter { !hidden(it.key) }.map { it.key }
    val byKey = remember(rows) { rows.associateBy { it.key } }
    val right = practise.rightKeys.toList()
    val progress = SentenceRound.progress(exercises, right, visibleKeys)
    /** Right but not the model sentence (core [AnswerDifference]): why, else null. */
    fun differenceOf(ex: SentenceRound.Exercise?): String? {
        val t = ex?.let { practise.takes[it.id] } ?: return null
        val row = byKey[ex.key] ?: return null
        if (t.claude == SentenceClaude.Checking) return null
        return AnswerDifference.roundTake(ex.mode, t.take.practised.said, row.hanzi, t.take.practised.result.state, (t.claude as? SentenceClaude.Done)?.check?.verdict)
    }
    // Enough right, the last one in other words: stay on it (docs/STUDY_SESSION.md "Right, but said differently").
    val lastRight = right.lastOrNull()
    val heldId = lastRight?.takeIf { id -> progress.done && differenceOf(exercises.firstOrNull { it.id == id }) != null }
    // Once held, or once he said an accepted one again, the round waits for Continue for good: a better
    // retake (now identical) must not send him on by itself.
    var stayPut by remember { mutableStateOf(false) }
    LaunchedEffect(heldId) { if (heldId != null) stayPut = true }
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
    val fetched = remember { mutableStateMapOf<String, String>() }
    val fetchFailed = remember { mutableStateMapOf<String, Boolean>() }
    val fetching = remember { HashSet<String>() }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    fun wantEnglish(key: String) {
        val row = byKey[key] ?: return
        if (!row.translation.isNullOrBlank() || fetched[key] != null || fetchFailed[key] == true || !fetching.add(key)) return
        scope.launch {
            try {
                val t = runCatching { cachedTranslation(row) }.getOrNull()
                    ?: if (online && translate != null) translate(row) else null
                if (!t.isNullOrBlank()) fetched[key] = t
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                fetchFailed[key] = true
            } finally {
                fetching.remove(key)
            }
        }
    }
    val latestDone by rememberUpdatedState(onDone)

    // No sentences after all: straight to the answer.
    LaunchedEffect(picked) { if (picked?.isEmpty() == true) latestDone() }

    // A result landed: right / miss, once per take (a translate take waits for Claude's check).
    val reported = remember { HashSet<SentenceRowTake>() }
    exercises.forEachIndexed { index, ex ->
        val t = practise.takes[ex.id]
        LaunchedEffect(t, t?.claude) {
            if (t == null || t.claude == SentenceClaude.Checking || !reported.add(t)) return@LaunchedEffect
            // A judged take shows its English again, whatever EN said before it (Hide applies until the next take).
            english.remove(ex.id)
            val result = SentencePractise.result(t.take.practised, (t.claude as? SentenceClaude.Done)?.check?.verdict)
            if (result == "right" || result == "close" || result == "wrong") onResult(ex.id, result)
            Analytics.track("study.sentence_round", mapOf("action" to if (result == "right") "right" else "miss", "index" to index, "mode" to ex.mode, "got" to progress.got, "needed" to progress.needed))
            val reason = if (result == "right") differenceOf(ex) else null
            if (reason != null) {
                Analytics.track("study.round_difference_shown", mapOf(
                    "kind" to "translate", "reason" to reason,
                    "verdict" to ((t.claude as? SentenceClaude.Done)?.check?.verdict ?: SpokenAnswerResult.stateName(t.take.practised.result.state)),
                    "where" to where, "held" to progress.done,
                ))
            }
        }
    }

    // A cheer (+ sparks) when the count goes up; confetti and the answer once enough are right.
    var cheer by remember { mutableStateOf<String?>(null) }
    var sparks by remember { mutableIntStateOf(0) }
    var lastGot by remember { mutableIntStateOf(progress.got) }
    LaunchedEffect(progress.got) {
        if (progress.got > lastGot) {
            cheer = doneCheer?.takeIf { progress.done }?.invoke(progress.got, progress.needed) ?: SentenceRound.cheer(progress)
            sparks++
            if (progress.done) Analytics.track("study.sentence_round", mapOf("action" to "done", "got" to progress.got, "needed" to progress.needed))
        }
        lastGot = progress.got
    }
    LaunchedEffect(progress.done, cheer, heldId, stayPut) {
        if (progress.done && cheer != null && heldId == null && !stayPut) {
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
                        difference = differenceOf(ex), held = heldId == ex.id, onSpeak = onSpeak,
                        englishToggled = english[ex.id],
                        onToggleEnglish = { shown -> english[ex.id] = !shown },
                        englishText = row.translation?.takeIf { it.isNotBlank() } ?: fetched[ex.key],
                        englishPending = when {
                            fetchFailed[ex.key] == true -> SentenceRound.TRANSLATION_FAILED
                            !online -> SentenceRound.TRANSLATION_OFFLINE
                            else -> SentenceRound.TRANSLATING
                        },
                        onNeedEnglish = { wantEnglish(ex.key) },
                        onRetry = {
                            Analytics.track("study.sentence_round", mapOf("action" to "retry", "index" to index, "mode" to ex.mode, "got" to progress.got, "needed" to progress.needed))
                        },
                        onSayAgain = {
                            Analytics.track("study.sentence_round", mapOf("action" to "say_again", "index" to index, "mode" to ex.mode, "got" to progress.got, "needed" to progress.needed))
                            stayPut = true
                        },
                        onMore = { hiding = ex },
                    )
                }
                Spacer(Modifier.height(4.dp))
            }
            Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                if (progress.done) {
                    PrimaryPill(
                        "${if (heldId != null || stayPut) AnswerDifference.CONTINUE else SentenceRound.SEE_ANSWER} →",
                        Modifier.fillMaxWidth().height(56.dp).testTag(SentenceRoundTags.CONTINUE), onClick = onDone,
                    )
                    if (heldId != null) {
                        Text(
                            AnswerDifference.HOLD_NOTE, Modifier.fillMaxWidth().padding(top = 6.dp).testTag(DifferenceTags.HELD),
                            color = Lab.colors.muted, fontSize = 13.sp, textAlign = TextAlign.Center,
                        )
                    }
                } else {
                    SecondaryPill("${SentenceRound.SKIP} →", Modifier.fillMaxWidth().height(52.dp).testTag(SentenceRoundTags.SKIP)) {
                        Analytics.track("study.sentence_round", mapOf("action" to "skip", "got" to progress.got, "needed" to progress.needed))
                        onSkip()
                    }
                    if (progress.needed > 0) {
                        Text(
                            skipNote ?: SentenceRound.skipNote(progress), Modifier.fillMaxWidth().padding(top = 6.dp),
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
    /** His own Show / Hide English on this showing (null = untouched: shown at once when Right). */
    englishToggled: Boolean?,
    onToggleEnglish: (shownNow: Boolean) -> Unit,
    onRetry: () -> Unit,
    onMore: () -> Unit = {},
    /** Right but not the model sentence (core [AnswerDifference]): its line; [held] = it holds the round. */
    difference: String? = null,
    held: Boolean = false,
    onSpeak: ((String) -> Unit)? = null,
    /** 🎤 Say it again on an accepted exercise (a new take; the right already counted stays). */
    onSayAgain: () -> Unit = {},
    /** The read exercise's English (the row's, else fetched); null = not here yet → [englishPending]. */
    englishText: String? = row.translation,
    englishPending: String = SentenceRound.TRANSLATING,
    /** Shown without English yet: fetch it. */
    onNeedEnglish: () -> Unit = {},
) {
    val take = practise.takes[ex.id]
    // Claude's check whole: "You said" vs the model answer carries the Chinese, its pinyin and ▶ — unless it
    // was correct in the very same words (core AnswerDifference.roundTakeView): the sentence shows once, here.
    val fullCheck = ex.mode == SentencePractise.TRANSLATE && take?.claude is SentenceClaude.Done &&
        AnswerDifference.roundTakeView(ex.mode, take.take.practised.said, row.hanzi, take.take.practised.result.state, (take.claude as SentenceClaude.Done).check.verdict).compare
    val mine = practise.activeKey == ex.id
    val busy = mine && (practise.listening || practise.finishing)
    val result = take?.takeIf { it.claude != SentenceClaude.Checking }?.let { SentencePractise.result(it.take.practised, (it.claude as? SentenceClaude.Done)?.check?.verdict) }
    val status = when {
        isRight -> "right"
        result == "close" || result == "wrong" -> result
        else -> null
    }
    val answered = isRight || take != null
    val showEnglish = SentenceRound.englishShown(ex.mode, status, answered, englishToggled)
    val readEnglishMissing = ex.mode == SentencePractise.READ && showEnglish && englishText.isNullOrBlank()
    LaunchedEffect(readEnglishMissing) { if (readEnglishMissing) onNeedEnglish() }
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
            .testTag("${SentenceRoundTags.EXERCISE}-$index-${ex.mode}-${status ?: "open"}${if (held) "-held" else ""}"),
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
                if (ex.mode == SentencePractise.READ || (answered && !fullCheck)) {
                    Text(row.hanzi, Modifier.testTag(SentenceRoundTags.CHINESE), color = Lab.colors.ink, fontSize = 22.sp)
                }
                if (answered && !fullCheck && !row.pinyin.isNullOrBlank()) Text(row.pinyin, color = Lab.colors.muted, fontSize = 14.sp)
                if (ex.mode == SentencePractise.READ && showEnglish) {
                    if (!englishText.isNullOrBlank()) Text(englishText, Modifier.testTag(SentenceRoundTags.READ_ENGLISH), color = Lab.colors.muted, fontSize = 14.sp)
                    else Text(
                        englishPending, Modifier.testTag(SentenceRoundTags.ENGLISH_PENDING), color = Lab.colors.muted.copy(alpha = 0.75f), fontSize = 14.sp,
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                    )
                }
            }
            if (ex.mode == SentencePractise.READ) {
                // EN: the English, tap to reveal before reading it / hide (like the rows' EN). 44dp target.
                val label = if (showEnglish) SentenceRound.HIDE_ENGLISH else SentenceRound.SHOW_ENGLISH
                Box(
                    Modifier.size(44.dp).bouncyClickable(true, 0.9f, role = Role.Button) { onToggleEnglish(showEnglish) }
                        .semantics { contentDescription = label; stateDescription = if (showEnglish) "On" else "Off" }
                        .testTag(SentenceRoundTags.ENGLISH_TOGGLE),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.size(34.dp).clip(CircleShape)
                            .background(if (showEnglish) Lab.colors.accentSoft else Lab.colors.card)
                            .border(1.dp, if (showEnglish) Lab.colors.accent else Lab.colors.cardBorder, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { Text(SentenceRound.ENGLISH_CHIP, color = if (showEnglish) Lab.colors.accent else Lab.colors.muted, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                }
            }
            if (!isRight || busy) SentenceMicButton(practise, row, ex.mode)
            if (answered && !fullCheck) {
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
        if (difference != null && !busy) DifferenceTitle(difference)
        SentencePractiseOutcome(practise, row, full = true, onPlayModel = { onPlay(row.audioUrl, row.hanzi) }, onSpeak = onSpeak)
        if (answered) {
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (isRight && !busy) {
                    SecondaryPill(
                        "🎤 ${AnswerDifference.SAY_AGAIN}", Modifier.heightIn(min = 44.dp).testTag(SentenceRoundTags.SAY_AGAIN),
                        enabled = CoachPractise.micEnabled(practise.dictation.blocked) && !practise.listening && !practise.finishing,
                        horizontalPadding = 14.dp, fontSize = 14.sp,
                    ) {
                        onSayAgain()
                        practise.onMic(row, ex.mode)
                    }
                }
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
            }
        }
    }
}
