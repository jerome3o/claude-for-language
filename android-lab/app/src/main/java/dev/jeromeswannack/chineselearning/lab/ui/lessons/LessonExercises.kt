package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.graphics.BitmapFactory
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.DescribeImageExercise
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.ListenChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ListenTranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.MatchExercise
import dev.jeromeswannack.chineselearning.lab.core.NoteExercise
import dev.jeromeswannack.chineselearning.lab.core.ScrambleExercise
import dev.jeromeswannack.chineselearning.lab.core.SpeakExercise
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.UnknownExercise
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File

/*
 * Ports of frontend/src/components/lesson-exercises.tsx: the nine original exercise
 * types. Same rules (shuffles per attempt, English hidden until asked for, no "wrong"
 * state for self-assessed translations…), same attempt data reported on Continue.
 */

// ============ Teaching note (not scored) ============

@Composable
fun NoteView(ex: NoteExercise, env: ExerciseEnv, onNext: () -> Unit) {
    // Listen-first: the first example plays right away.
    LaunchedEffect(Unit) { ex.sentences?.firstOrNull()?.let { env.speak(it.hanzi) } }
    ex.title?.takeIf { it.isNotBlank() }?.let { PhaseLabel(it) }
    ex.body?.takeIf { it.isNotBlank() }?.let { body ->
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (p in body.split(Regex("\\n{2,}"))) Text(p, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        }
    }
    ex.sentences.orEmpty().forEach { s ->
        Column(
            Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.98f) { env.speak(s.hanzi) }
                .clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp))
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
    var result by remember { mutableStateOf<Boolean?>(null) }
    // Shuffled per attempt, never presenting an accepted order (exercises repeat under FSRS).
    val pool = remember { LessonAnswers.scramblePoolOrder(ex.tiles, ex.correctOrder, ex.altOrders, env.random) }
    var showEnglish by remember { mutableStateOf(false) }
    val pickedTiles = picked.map { ex.tiles[it] }

    PhaseLabel("Word order")
    if (showEnglish || result != null) {
        PromptText(ex.english)
    } else {
        Text(
            "Tap to show English",
            color = Lab.colors.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable { showEnglish = true; env.onTap() }
                .clip(RoundedCornerShape(14.dp)).border(1.5.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(14.dp),
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
            Tile(ex.tiles[tileIndex], ghost = false, enabled = result == null) { picked.removeAt(i); env.onTap() }
        }
    }
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (i in pool) {
            val isPicked = i in picked
            Tile(ex.tiles[i], ghost = isPicked, enabled = !isPicked && result == null) { picked.add(i); env.onTap() }
        }
    }
    val r = result
    if (r == null) {
        ActionRow {
            Primary("Check", enabled = picked.size == ex.tiles.size) {
                val ok = LessonAnswers.checkScrambleOrder(pickedTiles, ex.correctOrder, ex.altOrders)
                result = ok
                if (ok) env.onCorrect() else env.onWrong()
                env.speak(ex.correctOrder.joinToString(""))
            }
        }
    } else {
        ResultBanner(r, if (r) "✓ Correct" else "✗ Not quite")
        if (!r) Text(ex.correctOrder.joinToString(" "), fontSize = 22.sp, color = Palette.Good, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        ActionRow { Primary("Continue") { onNext(r, ExerciseAnswer(order = pickedTiles, hintUsed = showEnglish)) } }
    }
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
            .border(1.5.dp, Lab.colors.cardBorder.copy(alpha = alpha), RoundedCornerShape(12.dp))
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
        ) {
            choice = index
            if (index == ex.correct) env.onCorrect() else env.onWrong()
            env.speak(s.hanzi)
        }
    }
    if (result != null) {
        ResultBanner(result, if (result) "✓ Correct" else "✗ Not quite")
        ex.explanation?.takeIf { it.isNotBlank() }?.let { Explanation(it) }
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
    var revealed by remember { mutableStateOf(false) }
    PhaseLabel("Say it in Chinese")
    PromptText(ex.english)
    if (!revealed) {
        AnswerField(answer, { answer = it }, "Type it, say it aloud, or build it in your head…")
        ActionRow { Primary("Show answer") { revealed = true; env.speak(ex.referenceHanzi) } }
    } else {
        val typed = answer.trim()
        // An exact match gets a green nudge; there's no "wrong" state — other wordings can be right.
        if (typed.isNotEmpty()) YourAnswer(typed, LessonAnswers.isExactHanziMatch(answer, ex.referenceHanzi))
        Reference(LessonSentence(ex.referenceHanzi, ex.referencePinyin), env)
        SelfAssess(
            ex.note?.takeIf { it.isNotBlank() } ?: "Did yours match the meaning? (Different wording is fine.)",
            no = "✗ Missed it",
        ) { ok -> onNext(ok, ExerciseAnswer(text = typed.ifEmpty { null }, selfAssessed = true)) }
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
        when (state) { OptionState.Correct -> Palette.Good; OptionState.Wrong -> Palette.Again; OptionState.Selected -> Lab.colors.accent; OptionState.Idle -> Lab.colors.cardBorder },
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

/** A cached / downloaded R2 image as a bitmap (null while loading or unavailable). */
@Composable
fun rememberImage(key: String?, env: ExerciseEnv): ImageBitmap? {
    val first = remember(key) { env.cachedImage(key)?.let(::decode) }
    val loaded by produceState(first, key) { if (value == null) value = env.image(key)?.let { withContext(Dispatchers.IO) { decode(it) } } }
    return loaded
}

private fun decode(file: File): ImageBitmap? = runCatching { BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap() }.getOrNull()

@Composable
fun DescribeImageView(ex: DescribeImageExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var revealed by remember { mutableStateOf(false) }
    val image = rememberImage(ex.imageUrl, env)
    PhaseLabel("Describe the picture")
    if (image != null) {
        Image(image, "Scene to describe", Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)), contentScale = ContentScale.FillWidth)
    } else {
        // Not generated (or cached) yet — the exercise still works from the scene description.
        Text(
            buildString { append("Imagine this scene: "); append(ex.imagePrompt) },
            style = MaterialTheme.typography.bodyLarge,
            color = Lab.colors.ink,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).padding(16.dp),
        )
    }
    Explanation(ex.task?.takeIf { it.isNotBlank() } ?: "Describe what you see — out loud, in Chinese.")
    if (!revealed) {
        ActionRow { Primary("🎤 I've described it") { revealed = true; env.speak(ex.referenceHanzi) } }
    } else {
        Reference(LessonSentence(ex.referenceHanzi, ex.referencePinyin, ex.referenceEnglish), env)
        SelfAssess("Did your description capture the scene? (Any correct sentence counts.)") { ok -> onNext(ok, ExerciseAnswer(selfAssessed = true)) }
    }
}

// ============ Speak your own sentence (self-assessed) ============

@Composable
fun SpeakView(ex: SpeakExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var finished by remember { mutableStateOf(false) }
    PhaseLabel("Say it out loud")
    PromptText(ex.prompt)
    if (!finished) {
        ActionRow { Primary("🎤 I've said my sentence") { finished = true; env.onTap() } }
    } else {
        ex.example?.let { Reference(it, env, label = "One way to say it:") }
        SelfAssess("Was your sentence grammatical and on task?", yes = "✓ Yes") { ok -> onNext(ok, ExerciseAnswer(selfAssessed = true)) }
    }
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
        // After answering, tapping an option speaks it — hearing the contrast is the point.
        OptionButton(
            s.hanzi,
            optionState(result != null, index, ex.correct, choice),
            pinyin = if (result != null) s.pinyin else null,
            english = if (result != null) s.english else null,
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
        Reference(ex.audio, env)
        ex.explanation?.takeIf { it.isNotBlank() }?.let { Explanation(it) }
        ActionRow { Primary("Continue") { onNext(result, ExerciseAnswer(choice = choice, plays = plays)) } }
    }
}

// ============ Listening: translate what you heard (self-assessed) ============

@Composable
fun ListenTranslateView(ex: ListenTranslateExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var answer by remember { mutableStateOf("") }
    var revealed by remember { mutableStateOf(false) }
    var plays by remember { mutableIntStateOf(0) }
    fun report() = ExerciseAnswer(text = answer.trim().ifEmpty { null }, selfAssessed = true, plays = plays)

    PhaseLabel("Listen and translate")
    ListenPlayButton(ex.audio.hanzi, env) { plays++ }
    if (!revealed) {
        AnswerField(answer, { answer = it }, "What did it mean? Type it or say it in your head…")
        ActionRow { Primary("Show answer") { revealed = true; env.onTap() } }
    } else {
        val typed = answer.trim()
        if (typed.isNotEmpty()) YourAnswer(typed, LessonAnswers.isListenAnswerMatch(answer, ex.audio))
        Reference(ex.audio, env)
        SelfAssess(ex.note?.takeIf { it.isNotBlank() } ?: "Did you catch the meaning? (Different wording is fine.)", no = "✗ Missed it") { ok -> onNext(ok, report()) }
    }
}

/** A type this build doesn't know (a newer server) — skipped with a Continue. */
@Composable
fun UnknownView(ex: UnknownExercise, onNext: () -> Unit) {
    Explanation("This exercise (${ex.type}) needs a newer version of the app — skipping it.")
    ActionRow { Primary("Continue", onClick = onNext) }
}
