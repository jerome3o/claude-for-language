package dev.jeromeswannack.chineselearning.lab.ui.lessons

import dev.jeromeswannack.chineselearning.lab.core.LessonImages
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonPicture
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.DescribeImageExercise
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import dev.jeromeswannack.chineselearning.lab.core.LessonFeedback
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.ListenChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ListenTranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.MatchExercise
import dev.jeromeswannack.chineselearning.lab.core.NoteExercise
import dev.jeromeswannack.chineselearning.lab.core.ScrambleExercise
import dev.jeromeswannack.chineselearning.lab.core.ScrambleCheck
import dev.jeromeswannack.chineselearning.lab.core.SpeakExercise
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.UnknownExercise
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextField
import dev.jeromeswannack.chineselearning.lab.core.LessonSpokenCheck
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

/*
 * Ports of frontend/src/components/lesson-exercises.tsx: the nine original exercise
 * types. Same rules (shuffles per attempt, English hidden until asked for, no "wrong"
 * state for self-assessed translations…), same attempt data reported on Continue.
 */

// ============ Teaching note (not scored) ============

@Composable
fun NoteView(ex: NoteExercise, env: ExerciseEnv, onNext: () -> Unit) {
    // Nothing plays by itself on a note (Jerome, Nov 2026): a tap plays an example.
    // Grammar structures — the note's own patterns, or ones read from older free text — are cards.
    val structures = remember(ex) { dev.jeromeswannack.chineselearning.lab.core.LessonPatterns.noteView(ex.body, ex.sentences, ex.patterns) }
    if (structures != null) {
        StructureCardsView(ex.title, structures, env, onNext)
        return
    }
    ex.title?.takeIf { it.isNotBlank() }?.let { PhaseLabel(it) }
    ex.body?.takeIf { it.isNotBlank() }?.let { body ->
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (p in body.split(Regex("\\n{2,}"))) Text(p, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        }
    }
    ex.sentences.orEmpty().forEach { s ->
        Column(
            Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.98f) { env.speak(s.hanzi) }
                .clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.outline, RoundedCornerShape(16.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Text("${s.hanzi} 🔊", fontSize = 21.sp, color = Lab.colors.ink)
            s.pinyin?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.accent, fontSize = 14.sp) }
            s.english?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp) }
        }
    }
    ActionRow { Primary("Continue", onClick = onNext) }
}

// ============ Word order (scramble) ============

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ScrambleView(ex: ScrambleExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    val picked = remember { mutableStateListOf<Int>() }
    // The device's verdict on Check (core ScrambleCheck): the listed orders are right at once; any other order of every
    // tile goes to Claude — "Checking…" in place, then ✓ Also right / ✗ Not quite (offline / failed: ✗ at once).
    var local by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<ScrambleCheck.Status?>(null) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val focus = LocalLessonFocus.current
    // Shuffled per attempt, never presenting an accepted order (exercises repeat under FSRS).
    val pool = remember { LessonAnswers.scramblePoolOrder(ex.tiles, ex.correctOrder, ex.altOrders, env.random) }
    var showEnglish by remember { mutableStateOf(false) }
    val pickedTiles = picked.map { ex.tiles[it] }
    val outcome = local?.let { ScrambleCheck.outcome(it, status, ScrambleCheck.sentence(pickedTiles) == ScrambleCheck.sentence(ex.correctOrder)) }
    val checked = outcome != null

    // Play once the verdict is known (his own order when right, else the expected one) and feel it once.
    val toSpeak = outcome?.let { ScrambleCheck.spokenSentence(it.kind, pickedTiles, ex.correctOrder) }
    LaunchedEffect(toSpeak) {
        val o = outcome ?: return@LaunchedEffect
        if (toSpeak == null) return@LaunchedEffect
        if (o.correct) env.onCorrect() else env.onWrong()
        env.speak(toSpeak)
    }

    PhaseLabel("Word order")
    if (showEnglish || checked) {
        PromptText(ex.english)
    } else {
        Text(
            "Tap to show English",
            color = Lab.colors.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable { showEnglish = true; env.onTap() }
                .clip(RoundedCornerShape(14.dp)).border(1.5.dp, Lab.colors.outline, RoundedCornerShape(14.dp)).padding(14.dp),
        )
    }
    // The answer row.
    FlowRow(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).clip(RoundedCornerShape(18.dp)).background(Lab.colors.faint).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (picked.isEmpty()) Text("Tap tiles below", color = Lab.colors.muted, modifier = Modifier.padding(12.dp))
        picked.forEachIndexed { i, tileIndex ->
            // Checked: his blocks are words to explore now (while arranging, a tap places / removes a block).
            if (!checked) Tile(ex.tiles[tileIndex], ghost = false, enabled = true) { picked.removeAt(i); env.onTap() }
            else DoneTile(ex.tiles[tileIndex])
        }
    }
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (i in pool) {
            val isPicked = i in picked
            Tile(ex.tiles[i], ghost = isPicked, enabled = !isPicked && !checked) { picked.add(i); env.onTap() }
        }
    }
    if (outcome == null) {
        ActionRow {
            Primary("Check", enabled = picked.size == ex.tiles.size) {
                val verdict = ScrambleCheck.localVerdict(pickedTiles, ex.tiles, ex.correctOrder, ex.altOrders)
                if (verdict == "incomplete") return@Primary
                if (verdict == "unexpected") {
                    val input = ScrambleCheck.checkInput(ex.english, ex.correctOrder, pickedTiles, focus)
                    status = if (input == null) ScrambleCheck.Status.Unavailable else startScrambleCheck(input, env, scope) { status = it }
                }
                local = verdict
            }
        }
    } else {
        if (outcome.tone == "neutral") CheckingBanner(outcome.banner)
        else ResultBanner(outcome.tone == "good", outcome.banner)
        Reference(LessonSentence(ex.correctOrder.joinToString("")), env, label = outcome.expectedLabel, exerciseType = ex.type, tag = "scramble-correct-sentence")
        LessonFeedback.sayAgainTarget(ex)?.let { SayItAgainRow(it.hanzi, ex.type, it.kind, env) }
        ActionRow {
            Primary("Continue") {
                val done = (status as? ScrambleCheck.Status.Done)?.check?.takeIf { local == "unexpected" }
                onNext(outcome.correct, ExerciseAnswer(order = pickedTiles, hintUsed = showEnglish, check = done))
            }
        }
        // Claude's slot, LAST so nothing he reads moves when it lands (core LessonFeedback).
        if (outcome.checking) ClaudeCheckingRow()
        outcome.note?.let { ScrambleClaudeNote(it, outcome.tone == "good") }
    }
}

/**
 * Claude's check of an unlisted order (env.answerCheck = the device cache, then the API): a punctuation-only difference
 * and a check seen before answer at once; analytics `lesson.scramble_checked`.
 */
private fun startScrambleCheck(
    input: dev.jeromeswannack.chineselearning.lab.core.AnswerCheckInput,
    env: ExerciseEnv,
    scope: kotlinx.coroutines.CoroutineScope,
    set: (ScrambleCheck.Status) -> Unit,
): ScrambleCheck.Status {
    dev.jeromeswannack.chineselearning.lab.core.LessonAnswerCheck.exact(input)?.let { exact ->
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.scramble_checked", mapOf("verdict" to exact.verdict, "cached" to true, "ms" to 0L))
        return ScrambleCheck.Status.Done(exact)
    }
    val began = System.currentTimeMillis()
    scope.launch {
        val next = try {
            val r = env.answerCheck(input)
            dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.scramble_checked", mapOf("verdict" to r.check.verdict, "cached" to r.cached, "ms" to System.currentTimeMillis() - began))
            ScrambleCheck.Status.Done(r.check)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            val offline = e is dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckUnavailable && e.offline
            dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.scramble_checked", mapOf("verdict" to if (offline) "offline" else "error", "cached" to false, "ms" to System.currentTimeMillis() - began))
            ScrambleCheck.Status.Unavailable
        }
        set(next)
    }
    return ScrambleCheck.Status.Checking
}

/** "Checking…" in place of the verdict — the same box, so nothing moves when it lands. */
@Composable
private fun CheckingBanner(text: String) {
    Text(
        text,
        color = Lab.colors.muted,
        fontWeight = FontWeight.Bold,
        fontSize = 18.sp,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint)
            .padding(vertical = 12.dp, horizontal = 14.dp).testTag("scramble-checking-banner"),
    )
}

/** Claude's one line on an unlisted order, below the buttons; its Chinese opens the explorer. */
@Composable
private fun ScrambleClaudeNote(text: String, good: Boolean) {
    val accent = if (good) Palette.Good else Palette.Again
    androidx.compose.foundation.layout.Column(
        Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
            .border(1.dp, accent.copy(alpha = 0.5f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag("scramble-claude-note"),
    ) {
        Text("Claude", color = Lab.colors.muted, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText(text, source = "lesson", fontSize = 15.sp)
    }
}

/** A block once the order is checked: its Chinese opens the language explorer. */
@Composable
private fun DoneTile(text: String) {
    dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText(
        text.trim(),
        source = "lesson",
        fontSize = 22.sp,
        modifier = Modifier.heightIn(min = 48.dp)
            .clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
            .border(1.5.dp, Lab.colors.outline, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 8.dp)
            .testTag("scramble-answer-tile"),
    )
}

@Composable
private fun Tile(text: String, ghost: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val alpha by animateFloatAsState(if (ghost) 0.25f else 1f, tween(160), label = "tile")
    Text(
        text,
        fontSize = 22.sp,
        color = Lab.colors.ink.copy(alpha = alpha),
        modifier = Modifier.heightIn(min = 48.dp).bouncyClickable(enabled, 0.9f, onClick = onClick)
            .clip(RoundedCornerShape(12.dp)).background(Lab.colors.card.copy(alpha = if (ghost) 0.4f else 1f))
            .border(1.5.dp, Lab.colors.outline.copy(alpha = alpha), RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

// ============ Multiple choice ============

@Composable
fun ChoiceView(ex: ChoiceExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var choice by remember { mutableStateOf<Int?>(null) }
    val order = remember { LessonAnswers.shuffledIndexes(ex.options.size, env.random) }
    val result = choice?.let { it == ex.correct }

    PhaseLabel("Which one fits?")
    ContextBox(ex.question)
    for (index in order) {
        val s = ex.options[index]
        OptionButton(
            s.hanzi,
            optionState(result != null, index, ex.correct, choice),
            pinyin = if (result != null) s.pinyin else null,
            english = if (result != null) s.english else null,
            enabled = result == null,
            explore = if (result != null) env else null,
            exerciseType = ex.type,
        ) {
            choice = index
            if (index == ex.correct) env.onCorrect() else env.onWrong()
            env.speak(s.hanzi)
        }
    }
    if (result != null) {
        ResultBanner(result, if (result) "✓ Correct" else "✗ Not quite")
        ex.explanation?.takeIf { it.isNotBlank() }?.let { Explanation(it) }
        LessonFeedback.sayAgainTarget(ex)?.let { SayItAgainRow(it.hanzi, ex.type, it.kind, env) }
        ActionRow { Primary("Continue") { onNext(result, ExerciseAnswer(choice = choice)) } }
    }
}

private fun optionState(answered: Boolean, index: Int, correct: Int?, choice: Int?): OptionState = when {
    !answered -> OptionState.Idle
    index == correct -> OptionState.Correct
    index == choice -> OptionState.Wrong
    else -> OptionState.Idle
}

// ============ Translate (self-assessed) ============

@Composable
fun TranslateView(ex: TranslateExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var answer by remember { mutableStateOf("") }
    var source by remember { mutableStateOf<String?>(null) }
    var revealed by remember { mutableStateOf(false) }
    // Claude's check of the answer (core LessonAnswerCheck), started the moment it is final.
    val ac = rememberLessonAnswerCheck("translate", ex.english, ex.referenceHanzi, ex.referencePinyin, env) { answer = ""; source = null; revealed = false }
    PhaseLabel("Say it in Chinese")
    PromptText(ex.english)
    if (!revealed) {
        // Voice first (core VoiceDictation): Check reveals the reference; Show answer skips answering.
        VoiceTextField(
            value = answer, onValueChange = { answer = it },
            onSubmit = { a -> answer = a.text; source = a.source; ac.onFinal(a.text, a.source); revealed = true; env.speak(ex.referenceHanzi) },
            surface = "lesson_translate", submitLabel = "Check", placeholder = "Type it in Chinese…", multiline = true,
        )
        ActionRow { Secondary("Show answer") { ac.onFinal(answer, "typed"); revealed = true; env.speak(ex.referenceHanzi) } }
    } else {
        val typed = answer.trim()
        // An exact match (or an unchanged spoken answer that sounds right) gets a green nudge; there's
        // no "wrong" state — other wordings can be right.
        val exact = LessonAnswers.isExactHanziMatch(answer, ex.referenceHanzi)
        val matched = exact || LessonSpokenCheck.check(answer, ex.referenceHanzi, emptyList(), source).accepted
        // At once, from the device: what he said (a match is felt; otherwise the characters the model answer
        // doesn't have are marked), the model answer big, 🎤 Say it again — Claude's check lands LAST, below the
        // buttons, so nothing here moves (core LessonFeedback).
        // Never marked on a reordering of the same characters (a neutral note instead) nor once Claude says it's right
        // (core LessonFeedback.answerMarks).
        val marks = LessonFeedback.answerMarks(typed, ex.referenceHanzi, ac.check?.verdict)
        if (typed.isNotEmpty()) FeelBox(if (matched) LessonFeedback.MATCHED_ANSWER else null, env, key = typed) {
            YourAnswer(
                typed, matched, label = if (source == "spoken" || source == "edited") "🎤 You said" else "Your answer", badge = if (exact) "✓ Exact match" else "✓ Sounds right",
                model = ex.referenceHanzi.takeIf { marks.marks }, note = marks.note.takeIf { !matched },
            )
        }
        // The model answer once, unmarked: the diff is on HIS answer above (core AnswerDiff).
        Reference(LessonSentence(ex.referenceHanzi, ex.referencePinyin), env, exerciseType = ex.type)
        SayItAgainRow(ex.referenceHanzi, ex.type, "answer", env)
        SelfAssess(
            ex.note?.takeIf { it.isNotBlank() } ?: "Did yours match the meaning? (Different wording is fine.)",
            no = "✗ Missed it",
            suggested = ac.suggested?.let { it == "got_it" },
        ) { ok -> onNext(ok, ac.report(ExerciseAnswer(text = typed.ifEmpty { null }, selfAssessed = true, input = source?.takeIf { typed.isNotEmpty() }))) }
        if (typed.isNotEmpty()) AnswerCheckView(ac, typed, env, offered = ex.referenceHanzi, celebrated = matched)
    }
}

// ============ Match the pairs ============

@Composable
fun MatchView(ex: MatchExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    val left = remember { LessonAnswers.shuffledIndexes(ex.pairs.size, env.random) }
    val right = remember { LessonAnswers.shuffledIndexes(ex.pairs.size, env.random) }
    var selLeft by remember { mutableStateOf<Int?>(null) }
    var selRight by remember { mutableStateOf<Int?>(null) }
    val matched = remember { mutableStateListOf<Int>() }
    var mistakes by remember { mutableIntStateOf(0) }
    var flash by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    val done = matched.size == ex.pairs.size

    LaunchedEffect(flash) { if (flash != null) { delay(600); flash = null } }

    fun evaluate(l: Int, r: Int) {
        selLeft = null; selRight = null
        if (l == r) {
            matched.add(l)
            if (matched.size == ex.pairs.size) { if (mistakes == 0) env.onCorrect() else env.onTap() } else env.onTap()
        } else {
            mistakes++
            flash = l to r
            env.onWrong()
        }
    }

    fun tap(side: Int, i: Int) {
        if (i in matched || flash != null || done) return
        if (side == 0) {
            env.speak(ex.pairs[i].hanzi)
            val r = selRight
            if (r == null) selLeft = if (selLeft == i) null else i else evaluate(i, r)
        } else {
            val l = selLeft
            if (l == null) selRight = if (selRight == i) null else i else evaluate(l, i)
        }
    }

    fun state(side: Int, i: Int): OptionState = when {
        i in matched -> OptionState.Correct
        flash?.let { (if (side == 0) it.first else it.second) == i } == true -> OptionState.Wrong
        (if (side == 0) selLeft else selRight) == i -> OptionState.Selected
        else -> OptionState.Idle
    }

    PhaseLabel("Match the pairs")
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (i in left) {
                val p = ex.pairs[i]
                MatchItem(p.hanzi, if (i in matched) p.pinyin else null, state(0, i), big = true) { tap(0, i) }
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (i in right) MatchItem(ex.pairs[i].english, null, state(1, i), big = false) { tap(1, i) }
        }
    }
    if (done) {
        ResultBanner(mistakes == 0, if (mistakes == 0) "✓ All matched!" else "Matched with $mistakes miss${if (mistakes == 1) "" else "es"}")
        ActionRow { Primary("Continue") { onNext(mistakes == 0, ExerciseAnswer(mistakes = mistakes)) } }
    }
}

@Composable
private fun MatchItem(text: String, sub: String?, state: OptionState, big: Boolean, onClick: () -> Unit) {
    val border by animateColorAsState(
        when (state) { OptionState.Correct -> Palette.Good; OptionState.Wrong -> Palette.Again; OptionState.Selected -> Lab.colors.accent; OptionState.Idle -> Lab.colors.outline },
        label = "match",
    )
    val scale by animateFloatAsState(if (state == OptionState.Selected) 1.03f else 1f, label = "matchScale")
    Column(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).scale(scale)
            .bouncyClickable(state != OptionState.Correct, 0.95f, onClick = onClick)
            .clip(RoundedCornerShape(14.dp))
            .background(if (state == OptionState.Correct) Palette.Good.copy(alpha = 0.10f) else if (state == OptionState.Selected) Lab.colors.accentSoft else Lab.colors.card)
            .border(2.dp, border, RoundedCornerShape(14.dp)).padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text, fontSize = if (big) 21.sp else 15.sp, color = Lab.colors.ink.copy(alpha = if (state == OptionState.Correct) 0.7f else 1f), textAlign = TextAlign.Center)
        sub?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = Lab.colors.accent) }
    }
}

// ============ Describe the picture (self-assessed) ============

/** A cached / downloaded R2 image file by key (null while loading or unavailable). */
@Composable
internal fun rememberImageFile(key: String?, env: ExerciseEnv): File? {
    val first = remember(key) { env.cachedImage(key) }
    val loaded by produceState(first, key) { if (value == null) value = env.image(key) }
    return loaded
}

@Composable
fun DescribeImageView(ex: DescribeImageExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var revealed by remember { mutableStateOf(false) }
    PhaseLabel("Describe the picture")
    val source = env.picture
    val picture = if (source != null) {
        collectPicture(remember(ex.imageUrl, ex.imagePrompt) { source(ex.imageUrl, ex.imagePrompt) }, ex.imageUrl to ex.imagePrompt)
    } else {
        // No picture source (older callers): the key's file only.
        val image = rememberImageFile(ex.imageUrl, env)
        if (image != null) LessonPicture(LessonImages.State.Ready, image) else LessonPicture(if (ex.imageUrl.isNullOrEmpty()) LessonImages.State.None else LessonImages.State.Loading)
    }
    // "Drawing the picture…" while it is generated, then the picture; the scene text when there is none.
    LessonPictureView(picture, ex.imagePrompt)
    Explanation(ex.task?.takeIf { it.isNotBlank() } ?: "Describe what you see — out loud, in Chinese.")
    if (!revealed) {
        ActionRow { Primary("🎤 I've described it") { revealed = true; env.speak(ex.referenceHanzi) } }
    } else {
        Reference(LessonSentence(ex.referenceHanzi, ex.referencePinyin, ex.referenceEnglish), env, exerciseType = ex.type)
        LessonFeedback.sayAgainTarget(ex)?.let { SayItAgainRow(it.hanzi, ex.type, it.kind, env) }
        SelfAssess("Did your description capture the scene? (Any correct sentence counts.)") { ok -> onNext(ok, ExerciseAnswer(selfAssessed = true)) }
    }
}

// ============ Speak your own sentence (self-assessed) ============

@Composable
fun SpeakView(ex: SpeakExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    PhaseLabel("Say it out loud")
    PromptText(ex.prompt)
    // Record it and Claude checks the transcript (docs/STUDY_SESSION.md "Claude checks your speaking");
    // nothing is kept — or say it without recording, as before.
    SpeakingAnswerView(
        exerciseType = "speak", prompt = ex.prompt, hints = null, question = null, example = ex.example,
        targetSeconds = 15, mediaKey = null, env = env, gotItLabel = "✓ Yes", allowWithoutRecording = true,
    ) { ok, answer, _ -> onNext(ok, answer) }
}

// ============ Listening: pick what you heard ============

@Composable
fun ListenChoiceView(ex: ListenChoiceExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var choice by remember { mutableStateOf<Int?>(null) }
    val order = remember { LessonAnswers.shuffledIndexes(ex.options.size, env.random) }
    var plays by remember { mutableIntStateOf(0) }
    val result = choice?.let { it == ex.correct }

    PhaseLabel("What do you hear?")
    ex.question?.takeIf { it.isNotBlank() }?.let { ContextBox(it) }
    ListenPlayButton(ex.audio.hanzi, env) { plays++ }
    for (index in order) {
        val s = ex.options[index]
        // After answering, tapping an option (or its ▶) speaks it — hearing the contrast is the point; its words explore.
        OptionButton(
            s.hanzi,
            optionState(result != null, index, ex.correct, choice),
            pinyin = if (result != null) s.pinyin else null,
            english = if (result != null) s.english else null,
            explore = if (result != null) env else null,
            exerciseType = ex.type,
        ) {
            if (result == null) {
                choice = index
                if (index == ex.correct) env.onCorrect() else env.onWrong()
            } else {
                env.speak(s.hanzi)
            }
        }
    }
    if (result != null) {
        ResultBanner(result, if (result) "✓ Correct" else "✗ Not quite")
        Reference(ex.audio, env, exerciseType = ex.type)
        LessonFeedback.sayAgainTarget(ex)?.let { SayItAgainRow(it.hanzi, ex.type, it.kind, env) }
        ex.explanation?.takeIf { it.isNotBlank() }?.let { Explanation(it) }
        ActionRow { Primary("Continue") { onNext(result, ExerciseAnswer(choice = choice, plays = plays)) } }
    }
}

// ============ Listening: translate what you heard (self-assessed) ============

@Composable
fun ListenTranslateView(ex: ListenTranslateExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var answer by remember { mutableStateOf("") }
    var source by remember { mutableStateOf<String?>(null) }
    var revealed by remember { mutableStateOf(false) }
    var plays by remember { mutableIntStateOf(0) }
    // Claude checks an answer written in Chinese (an English one keeps the self-assessment alone).
    val ac = rememberLessonAnswerCheck("listen_translate", ex.audio.english, ex.audio.hanzi, ex.audio.pinyin, env) { answer = ""; source = null; revealed = false }
    fun report() = ac.report(ExerciseAnswer(text = answer.trim().ifEmpty { null }, selfAssessed = true, plays = plays, input = source?.takeIf { answer.isNotBlank() }))

    PhaseLabel("Listen and translate")
    ListenPlayButton(ex.audio.hanzi, env) { plays++ }
    if (!revealed) {
        // What it meant, usually in English: the transcriber hears English first here.
        VoiceTextField(
            value = answer, onValueChange = { answer = it },
            onSubmit = { a -> answer = a.text; source = a.source; ac.onFinal(a.text, a.source); revealed = true; env.onTap() },
            surface = "lesson_listen_translate", submitLabel = "Check", placeholder = "What did it mean?", multiline = true, lang = "en",
        )
        ActionRow { Secondary("Show answer") { ac.onFinal(answer, "typed"); revealed = true; env.onTap() } }
    } else {
        val typed = answer.trim()
        val matched = LessonAnswers.isListenAnswerMatch(answer, ex.audio)
        if (typed.isNotEmpty()) FeelBox(if (matched) LessonFeedback.MATCHED_ANSWER else null, env, key = typed) {
            YourAnswer(typed, matched, label = if (source == "spoken" || source == "edited") "🎤 You said" else "Your answer")
        }
        Reference(ex.audio, env, exerciseType = ex.type)
        SayItAgainRow(ex.audio.hanzi, ex.type, "answer", env)
        SelfAssess(ex.note?.takeIf { it.isNotBlank() } ?: "Did you catch the meaning? (Different wording is fine.)", no = "✗ Missed it", suggested = ac.suggested?.let { it == "got_it" }) { ok -> onNext(ok, report()) }
        if (typed.isNotEmpty()) AnswerCheckView(ac, typed, env, offered = ex.audio.hanzi, celebrated = matched)
    }
}

/** A type this build doesn't know (a newer server) — skipped with a Continue. */
@Composable
fun UnknownView(ex: UnknownExercise, onNext: () -> Unit) {
    Explanation("This exercise (${ex.type}) needs a newer version of the app — skipping it.")
    ActionRow { Primary("Continue", onClick = onNext) }
}
