package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.jeromeswannack.chineselearning.lab.core.AttemptRecording
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.core.ConversationVoices
import dev.jeromeswannack.chineselearning.lab.core.DictationExercise
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.HandwritingAnswer
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.Lessons
import dev.jeromeswannack.chineselearning.lab.core.OralExpressionExercise
import dev.jeromeswannack.chineselearning.lab.core.QuestionAnswer
import dev.jeromeswannack.chineselearning.lab.core.SentenceFeedback
import dev.jeromeswannack.chineselearning.lab.core.SentenceMakingExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteHandwritingExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteTypedExercise
import dev.jeromeswannack.chineselearning.lab.core.WritingCue
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz
import dev.jeromeswannack.chineselearning.lab.core.WritingExerciseResult
import dev.jeromeswannack.chineselearning.lab.core.WritingMode
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad
import dev.jeromeswannack.chineselearning.lab.ui.strokes.WritingExercise
import androidx.compose.runtime.produceState
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonArray
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

/*
 * Ports of frontend/src/components/practice-exercises.tsx: sentence making, writing
 * (typed / handwritten — separate skills), dictation, oral expression (recorded for the
 * tutor) and two-voice conversations. Handwriting runs on package H's stroke-order
 * WritingExercise (right only when written from memory); when a character's stroke data
 * isn't on the device it falls back to the free sketch pad with self-assessment, like the web.
 */

// ============ Sentence making ============

@Composable
fun SentenceMakingView(ex: SentenceMakingExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    val typed = ex.typed
    var text by remember { mutableStateOf("") }
    var hw by remember { mutableStateOf<HandwritingAnswer?>(null) }
    var phase by remember { mutableStateOf("answer") }
    var feedback by remember { mutableStateOf<SentenceFeedback?>(null) }
    var offlineNote by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val canCheck = if (typed) text.isNotBlank() else hasStrokes(hw)
    val marks = if (typed && phase == "result") ex.words.map { LessonAnswers.sentenceUsesWord(text, it.hanzi) } else null

    fun answer() = ExerciseAnswer(
        text = if (typed) text.trim() else hw?.text,
        handwriting = if (typed) null else hw,
        feedback = feedback,
        selfAssessed = feedback == null,
    )

    PhaseLabel("Make a sentence ${if (typed) "⌨️" else "✍️"}")
    PromptText(ex.task?.takeIf { it.isNotBlank() } ?: "Write your own sentence using these words.")
    WordChips(ex.words, env, marks)

    if (phase != "result") {
        if (typed) AnswerField(text, { text = it }, "Type your sentence in Chinese…", enabled = phase != "checking")
        else SketchPad(null, { hw = it })
        ActionRow {
            Primary(if (phase == "checking") "Claude is checking…" else if (typed) "Check" else "Done", enabled = canCheck && phase != "checking") {
                if (!typed) { phase = "result"; return@Primary }
                phase = "checking"
                scope.launch {
                    try {
                        feedback = env.sentenceFeedback(ex.words.map { it.hanzi }, ex.task, text)
                    } catch (e: Exception) {
                        if (e is kotlinx.coroutines.CancellationException) throw e
                        offlineNote = "Claude can’t check it right now — compare with the example."
                    }
                    phase = "result"
                    feedback?.let { if (it.verdict != "incorrect" && it.usesAllWords) env.onCorrect() else env.onWrong() }
                }
            }
        }
    } else {
        if (typed) YourAnswer(text.trim(), exact = false, label = "Your sentence")
        else hw?.strokes?.let { StrokesView(it, "Your sentence") }
        feedback?.let { FeedbackCard(it, env) }
        offlineNote?.let { Explanation(it) }
        ex.example?.let { Reference(it, env, label = "One way to say it:") }
        val f = feedback
        if (f != null) {
            ActionRow { Primary("Continue") { onNext(f.verdict != "incorrect" && f.usesAllWords, answer()) } }
        } else {
            SelfAssess(
                if (typed) "Is your sentence grammatical, and does it use every word?" else "Compare with the example — is your sentence right, and does it use every word?",
            ) { ok -> onNext(ok, answer()) }
        }
    }
}

@Composable
private fun FeedbackCard(f: SentenceFeedback, env: ExerciseEnv) {
    val color = when (f.verdict) { "correct" -> Palette.Good; "minor" -> Palette.Hard; else -> Palette.Again }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(color.copy(alpha = 0.10f)).border(1.5.dp, color.copy(alpha = 0.4f), RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            when (f.verdict) { "correct" -> "✓ Natural and correct"; "minor" -> "≈ Almost — one small fix"; else -> "✗ Not quite" },
            color = color, fontWeight = FontWeight.Bold, fontSize = 17.sp,
        )
        if (!f.usesAllWords) Text("Use every target word.", color = Palette.Again, style = MaterialTheme.typography.bodyMedium)
        f.corrected?.let { c ->
            Column(Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.98f) { env.speak(c.hanzi) }) {
                Text("${c.hanzi} 🔊", fontSize = 21.sp, color = Lab.colors.ink)
                c.pinyin?.let { Text(it, color = Lab.colors.accent, fontSize = 14.sp) }
                c.english?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp) }
            }
        }
        Text(f.comment, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
    }
}

// ============ Writing: cues ============

@Composable
private fun WritingCues(answer: LessonSentence, cues: List<String>, prompt: String?, env: ExerciseEnv) {
    prompt?.takeIf { it.isNotBlank() }?.let { ContextBox(it) }
    if (WritingCue.ENGLISH in cues) answer.english?.takeIf { it.isNotBlank() }?.let { PromptText(it) }
    if (WritingCue.PINYIN in cues) answer.pinyin?.takeIf { it.isNotBlank() }?.let {
        Text(it, fontSize = 20.sp, color = Lab.colors.accent, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
    if (WritingCue.AUDIO in cues) ListenPlayButton(answer.hanzi, env)
}

// ============ Writing — typed ============

@Composable
fun WriteTypedView(ex: WriteTypedExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    var text by remember { mutableStateOf("") }
    var diff by remember { mutableStateOf<LessonAnswers.HanziDiff?>(null) }
    fun check() {
        val d = LessonAnswers.diffHanzi(text, ex.answer.hanzi, ex.alternatives.orEmpty())
        diff = d
        if (d.correct) env.onCorrect() else env.onWrong()
        env.speak(ex.answer.hanzi)
    }
    PhaseLabel("Type it in characters ⌨️")
    WritingCues(ex.answer, ex.cues ?: WritingCue.DEFAULT, ex.prompt, env)
    val d = diff
    if (d == null) {
        AnswerField(text, { text = it }, "汉字…", singleLine = true, big = true, onDone = { if (text.isNotBlank()) check() })
        ActionRow { Primary("Check", enabled = text.isNotBlank()) { check() } }
    } else {
        ResultBanner(d.correct, if (d.correct) "✓ Correct" else "✗ Not quite — ${Math.round(d.accuracy * 100)}% of the characters")
        CharDiffView(d)
        Reference(ex.answer, env)
        ActionRow { Primary("Continue") { onNext(d.correct, ExerciseAnswer(text = text.trim())) } }
    }
}

// ============ Writing — handwriting ============

/** What the learner wrote by hand next to the model characters. */
@Composable
private fun HandwritingCompare(hw: HandwritingAnswer?, model: LessonSentence, env: ExerciseEnv) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            val s = hw?.strokes
            if (s != null) StrokesView(s, "You wrote") else Explanation("(nothing written)")
        }
        Column(
            Modifier.weight(1f).bouncyClickable { env.speak(model.hanzi) }.clip(RoundedCornerShape(14.dp)).background(Lab.colors.card)
                .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(model.hanzi, fontSize = 40.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Text("${model.pinyin ?: ""} 🔊", color = Lab.colors.accent, fontSize = 14.sp)
        }
    }
}

/** Which pad a known text gets (`useStrokePadAvailable`): the stroke-order pad when every
 * character's data is on the device (or fetchable), else the free sketch pad. */
@Composable
private fun rememberPadKind(text: String, env: ExerciseEnv): String {
    val loader = env.strokeLoader
    val kind by produceState(if (loader == null) "sketch" else "checking", text, loader) {
        if (loader == null) { value = "sketch"; return@produceState }
        val chars = StrokeQuiz.writableCharacters(text).distinct()
        if (chars.isEmpty()) { value = "sketch"; return@produceState }
        val results = chars.map { loader(it) }
        val usable = results.none { it == StrokeLoad.Offline } && results.any { it is StrokeLoad.Ok }
        value = if (usable) "strokes" else "sketch"
    }
    return kind
}

/** A finished stroke-order run as the attempt keeps it (`summarizeWriting`, StrokeWritingSummary). */
fun summarizeWriting(r: WritingExerciseResult): JsonObject = buildJsonObject {
    put("text", r.text)
    put("mode", r.mode.wire)
    put("grade", r.grade.wire)
    putJsonArray("skipped") { r.skipped.forEach { add(it) } }
    putJsonArray("characters") {
        for (c in r.characters) addJsonObject {
            put("character", c.character)
            put("grade", c.grade.wire)
            put("mistakes", c.mistakes)
            put("hints", c.hints)
            put("revealed", c.revealed)
            put("ms", c.ms)
            put("accuracy", c.accuracy)
            putJsonArray("strokes") {
                for (st in c.strokes) addJsonObject {
                    put("misses", st.misses)
                    putJsonArray("mistakes") { st.mistakes.forEach { add(it.wire) } }
                    put("hinted", st.hinted)
                    put("revealed", st.revealed)
                    st.drawn?.let { d -> putJsonArray("drawn") { d.forEach { p -> addJsonArray { add(p[0]); add(p[1]) } } } }
                }
            }
        }
    }
}

/** `strokeAnswer`: right only when written from memory (a Trace run counts as needing help). */
fun strokeAnswer(r: WritingExerciseResult): HandwritingAnswer =
    HandwritingAnswer(engine = "strokes", text = r.text, checked = StrokeQuiz.writtenFromMemory(r), mistakes = r.characters.sumOf { it.mistakes }, writing = summarizeWriting(r))

@Composable
fun WriteHandwritingView(ex: WriteHandwritingExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    val cues = ex.cues ?: WritingCue.DEFAULT
    val pad = rememberPadKind(ex.answer.hanzi, env)
    var hw by remember { mutableStateOf<HandwritingAnswer?>(null) }
    var checked by remember { mutableStateOf(false) }
    var run by remember { mutableStateOf<WritingExerciseResult?>(null) }
    PhaseLabel("Write it by hand ✍️")
    if (pad == "strokes") {
        ex.prompt?.takeIf { it.isNotBlank() }?.let { ContextBox(it) }
        if (WritingCue.AUDIO in cues) ListenPlayButton(ex.answer.hanzi, env)
        WritingExercise(
            text = ex.answer.hanzi,
            pinyin = if (WritingCue.PINYIN in cues) ex.answer.pinyin else null,
            english = if (WritingCue.ENGLISH in cues) ex.answer.english else null,
            initialMode = WritingMode.RECALL,
            hideCharacters = true,
            onComplete = { r -> run = r; env.speak(ex.answer.hanzi) },
            onDone = { run?.let { r -> onNext(StrokeQuiz.writtenFromMemory(r), ExerciseAnswer(handwriting = strokeAnswer(r))) } },
            doneLabel = "Continue",
            loader = env.strokeLoader,
        )
        return
    }
    WritingCues(ex.answer, cues, ex.prompt, env)
    if (pad == "checking") return
    if (!checked) {
        SketchPad(ex.answer.hanzi, { hw = it })
        ActionRow { Primary("Check", enabled = hasStrokes(hw)) { checked = true; env.speak(ex.answer.hanzi) } }
    } else {
        HandwritingCompare(hw, ex.answer, env)
        ex.answer.english?.takeIf { it.isNotBlank() }?.let { Explanation(it) }
        SelfAssess("Did you write every character correctly — right components, nothing missing?") { ok ->
            onNext(ok, ExerciseAnswer(handwriting = hw, selfAssessed = true))
        }
    }
}

// ============ Dictation ============

@Composable
fun DictationView(ex: DictationExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    val typed = ex.typed
    val pad = rememberPadKind(if (typed) "" else ex.audio.hanzi, env)
    val strokes = !typed && pad == "strokes"
    var text by remember { mutableStateOf("") }
    var hw by remember { mutableStateOf<HandwritingAnswer?>(null) }
    var diff by remember { mutableStateOf<LessonAnswers.HanziDiff?>(null) }
    var revealed by remember { mutableStateOf(false) }
    var strokeRun by remember { mutableStateOf<WritingExerciseResult?>(null) }
    var plays by remember { mutableIntStateOf(0) }
    fun check() {
        if (typed) {
            val d = LessonAnswers.diffHanzi(text, ex.audio.hanzi, ex.alternatives.orEmpty())
            diff = d
            if (d.correct) env.onCorrect() else env.onWrong()
        }
        revealed = true
    }
    fun base(selfAssessed: Boolean? = null): ExerciseAnswer = when {
        typed -> ExerciseAnswer(plays = plays, text = text.trim(), selfAssessed = selfAssessed)
        else -> ExerciseAnswer(plays = plays, handwriting = strokeRun?.let(::strokeAnswer) ?: hw, selfAssessed = selfAssessed)
    }
    val verdict: Boolean? = if (typed) diff?.correct else strokeRun?.let { StrokeQuiz.writtenFromMemory(it) }

    PhaseLabel("Dictation ${if (typed) "⌨️" else "✍️"}")
    Explanation("Write down exactly what you hear.")
    ListenPlayButton(ex.audio.hanzi, env) { plays++ }
    if (!revealed) {
        when {
            typed -> {
                AnswerField(text, { text = it }, "汉字…", singleLine = true, big = true, onDone = { if (text.isNotBlank()) check() })
                ActionRow { Primary("Check", enabled = text.isNotBlank()) { check() } }
            }
            strokes -> WritingExercise(
                text = ex.audio.hanzi,
                initialMode = WritingMode.RECALL,
                allowModeSwitch = false,
                hideCharacters = true,
                onComplete = { strokeRun = it },
                onDone = { revealed = true },
                doneLabel = "Show the sentence",
                loader = env.strokeLoader,
            )
            pad == "checking" -> Unit
            else -> {
                SketchPad(ex.audio.hanzi, { hw = it })
                ActionRow { Primary("Check", enabled = hasStrokes(hw)) { check() } }
            }
        }
    } else {
        val d = diff
        if (d != null) {
            ResultBanner(d.correct, if (d.correct) "✓ Every character right" else "${Math.round(d.accuracy * 100)}% of the characters")
            CharDiffView(d)
        }
        strokeRun?.let { r ->
            val ok = StrokeQuiz.writtenFromMemory(r)
            ResultBanner(ok, if (ok) "✓ Written from memory" else "✗ Needed help with some strokes")
        }
        if (!typed && strokeRun == null) HandwritingCompare(hw, ex.audio, env)
        Reference(ex.audio, env)
        ex.note?.takeIf { it.isNotBlank() }?.let { Explanation(it) }
        if (verdict != null) {
            ActionRow { Primary("Continue") { onNext(verdict, base()) } }
        } else {
            SelfAssess("Did you write down every character you heard?") { ok -> onNext(ok, base(selfAssessed = true)) }
        }
    }
}

// ============ Oral expression (recorded) ============

@Composable
fun OralExpressionView(ex: OralExpressionExercise, env: ExerciseEnv, mediaKey: String?, onDone: ExerciseDone) {
    val target = ex.targetSeconds ?: 30
    val recorder = env.recorder
    val recording by (recorder?.recording ?: remember { kotlinx.coroutines.flow.MutableStateFlow(false) }).collectAsState()
    val level by (recorder?.level ?: remember { kotlinx.coroutines.flow.MutableStateFlow(0f) }).collectAsState()
    val recorderError by (recorder?.error ?: remember { kotlinx.coroutines.flow.MutableStateFlow<String?>(null) }).collectAsState()
    var startedAt by remember { mutableLongStateOf(0L) }
    var elapsed by remember { mutableIntStateOf(0) }
    var durationMs by remember { mutableLongStateOf(0L) }
    var take by remember { mutableStateOf<File?>(null) }
    var done by remember { mutableStateOf(false) }
    var skipped by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LaunchedEffect(Unit) { ex.questionAudio?.let { env.speak(it.hanzi) } }
    LaunchedEffect(recording) {
        while (recording) { elapsed = ((System.currentTimeMillis() - startedAt) / 1000).toInt(); delay(250) }
    }
    DisposableEffect(Unit) { onDispose { if (recorder?.recording?.value == true) recorder.stop() } }

    fun startNow() {
        env.stopAudio()
        elapsed = 0
        startedAt = System.currentTimeMillis()
        if (recorder?.start() == true) env.onTap()
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startNow() else recorder?.setError("Microphone permission was denied — you can still say it without recording.")
    }
    fun start() {
        if (recorder == null) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startNow()
        else permission.launch(Manifest.permission.RECORD_AUDIO)
    }
    fun stop() {
        durationMs = System.currentTimeMillis() - startedAt
        take = recorder?.stop()
    }
    fun finish() {
        done = true
        ex.example?.let { env.speak(it.hanzi) }
    }
    fun answer(): ExerciseAnswer {
        val t = take
        return ExerciseAnswer(
            selfAssessed = true,
            recording = if (t != null && mediaKey != null && !skipped) AttemptRecording(mediaKey, durationMs, recorder?.mime ?: "audio/mp4") else null,
        )
    }

    PhaseLabel("Speak — recorded 🎙")
    PromptText(ex.prompt)
    ex.questionAudio?.let { q ->
        Text(
            "🔊 ${q.hanzi}",
            fontSize = 20.sp,
            color = Lab.colors.ink,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().bouncyClickable { env.speak(q.hanzi) }.clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(12.dp),
        )
    }
    ex.hints?.takeIf { it.isNotEmpty() }?.let {
        Explanation("Useful words")
        WordChips(it, env)
    }

    if (!done) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val t = take
            when {
                recording -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RecDot()
                        Text("  Recording… ${elapsed}s", color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
                        Text(" / ~${target}s", color = Lab.colors.muted)
                    }
                    Box(Modifier.fillMaxWidth(0.7f).height(8.dp).clip(CircleShape).background(Lab.colors.faint)) {
                        Box(Modifier.fillMaxWidth(level.coerceIn(0.02f, 1f)).fillMaxHeight().clip(CircleShape).background(Palette.Again))
                    }
                    RecButton("■", Palette.Again, "Stop recording") { stop() }
                }
                t != null -> {
                    Text("Recorded ${Math.round(durationMs / 1000.0)}s", color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
                    ActionRow {
                        Secondary("▶ Listen back") { env.playFile(t) }
                        Secondary("🎙 Again") { start() }
                    }
                    ActionRow { Primary("Done") { finish() } }
                }
                else -> {
                    RecButton("🎙", Lab.colors.accent, "Start recording") { start() }
                    Explanation("Tap to record your answer (about $target seconds)")
                    val err = recorderError ?: if (recorder == null) "Recording isn't available here." else null
                    if (err != null) {
                        Explanation(err)
                        ActionRow { Secondary("Say it without recording") { skipped = true; finish() } }
                    }
                }
            }
        }
    } else {
        val t = take
        if (t != null && !skipped) ActionRow { Secondary("▶ Your answer") { env.playFile(t) } }
        ex.example?.let { Reference(it, env, label = "One way to say it:") }
        if (mediaKey != null && t != null && !skipped) Explanation("Your tutor can listen to this recording.")
        ActionRow {
            Secondary("✗ Not quite") { onDone(false, answer(), t?.takeIf { !skipped }) }
            Primary("✓ I said it well") { onDone(true, answer(), t?.takeIf { !skipped }) }
        }
    }
}

@Composable
private fun RecDot() {
    val pulse by rememberInfiniteTransition(label = "rec").animateFloat(0.3f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "dot")
    Box(Modifier.size(12.dp).alpha(pulse).clip(CircleShape).background(Palette.Again))
}

@Composable
private fun RecButton(icon: String, color: androidx.compose.ui.graphics.Color, label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(96.dp).bouncyClickable(pressedScale = 0.9f, onClick = onClick)
            .semantics { contentDescription = label }
            .clip(CircleShape).background(color.copy(alpha = 0.14f)).border(3.dp, color, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(icon, fontSize = 36.sp, color = color)
    }
}

// ============ Conversation (two voices) ============

private class QuestionState(val choice: Int? = null, val text: String = "", val revealed: Boolean = false, val correct: Boolean? = null)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ConversationView(ex: ConversationExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    // Voices / speed / delivery from this account's ⚙︎ Audio choices (read from the phone before
    // the first line plays); re-resolved whenever they change.
    val controls = env.conversationAudio
    var now by remember(ex) { mutableStateOf<ConversationAudioNow?>(null) }
    var audioMenu by remember { mutableStateOf(false) }
    var regenerating by remember { mutableStateOf(false) }
    var regenerateNext by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var playing by remember { mutableStateOf(false) }
    var currentLine by remember { mutableStateOf<Int?>(null) }
    var listened by remember { mutableStateOf(false) }
    var audioUnavailable by remember { mutableStateOf(false) }
    var transcriptPeek by remember { mutableStateOf(false) }
    var showTranscript by remember { mutableStateOf(false) }
    val answers = remember { mutableStateListOf<QuestionState>().apply { repeat(ex.questions.size) { add(QuestionState()) } } }
    val optionOrders = remember { ex.questions.map { LessonAnswers.shuffledIndexes(it.options?.size ?: 0, env.random) } }
    var plays by remember { mutableIntStateOf(0) }
    var run by remember { mutableStateOf<Job?>(null) }

    fun icon(i: Int) = if (Lessons.speakerGender(ex.speakers, i) == "male") "👨" else "👩"

    suspend fun current(): ConversationAudioNow = now ?: controls.resolve(ex).also { now = it }
    suspend fun playClip(line: dev.jeromeswannack.chineselearning.lab.core.ConversationLine): Boolean {
        val a = current().audio
        val clip = dev.jeromeswannack.chineselearning.lab.core.ConversationClip(line.hanzi, a.voices.getOrNull(line.speaker), a.speed, a.delivery)
        return env.playLine(clip, regenerateNext)
    }

    fun playAll(onEnd: () -> Unit = {}) {
        run?.cancel()
        plays++
        run = scope.launch {
            try {
                playing = true
                var failures = 0
                for ((i, line) in ex.lines.withIndex()) {
                    currentLine = i
                    if (!playClip(line)) failures++
                    // A natural turn-taking beat before the next speaker, no more.
                    if (i < ex.lines.lastIndex) delay(ConversationVoices.LINE_GAP_MS)
                }
                playing = false
                currentLine = null
                listened = true
                if (failures == ex.lines.size) audioUnavailable = true
            } finally {
                onEnd()
            }
        }
    }
    fun stopPlaying() {
        run?.cancel()
        env.stopAudio()
        playing = false
        currentLine = null
        listened = true
    }
    fun playLine(i: Int) {
        run?.cancel()
        playing = false
        currentLine = i
        run = scope.launch {
            playClip(ex.lines[i])
            if (currentLine == i) currentLine = null
        }
    }
    /** Make every line again (server + phone), then play the conversation with the new audio. */
    fun regenerateAudio() {
        if (regenerating || !controls.online.value) return
        controls.track("lesson.conversation_audio_regenerate", mapOf("lines" to ex.lines.size, "provider" to (now?.audio?.provider ?: "minimax")))
        regenerating = true
        stopPlaying()
        regenerateNext = true
        playAll {
            regenerateNext = false
            regenerating = false
        }
    }
    // Start listening straight away, like every listening exercise.
    LaunchedEffect(Unit) {
        now = controls.resolve(ex)
        playAll()
    }
    // A choice in the ⚙︎ menu (or a sync) changed the settings: the next line plays in the new ones.
    LaunchedEffect(controls) {
        var first = true
        controls.changes.collect {
            if (first) { first = false; return@collect }
            now = controls.resolve(ex)
        }
    }
    DisposableEffect(Unit) { onDispose { run?.cancel() } }

    val allAnswered = answers.all { it.correct != null }
    val score = answers.count { it.correct == true }
    val questionsOpen = listened || audioUnavailable
    val open = showTranscript || transcriptPeek

    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        PhaseLabel("Conversation 💬")
        Box(
            Modifier.align(Alignment.CenterEnd)
                .size(44.dp)
                .clip(CircleShape)
                .bouncyClickable { env.onTap(); audioMenu = true }
                .semantics { contentDescription = "Audio settings: speed, voices, regenerate" }
                .testTag("convo-audio-menu"),
            contentAlignment = Alignment.Center,
        ) {
            Text("⚙︎", fontSize = 22.sp, color = Lab.colors.muted)
        }
    }
    if (audioMenu) {
        now?.let { n ->
            ConversationAudioSheet(
                speakers = ex.speakers,
                now = n,
                controls = controls,
                regenerating = regenerating,
                onTap = env.onTap,
                onRegenerate = { audioMenu = false; regenerateAudio() },
                onClose = { audioMenu = false },
            )
        }
    }
    ContextBox(ex.situation)
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
        ex.speakers.forEachIndexed { i, s ->
            Text("${icon(i)} ${s.name}", color = speakerColor(i), fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(CircleShape).background(speakerColor(i).copy(alpha = 0.12f)).padding(horizontal = 12.dp, vertical = 6.dp))
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ex.lines.forEachIndexed { i, line ->
            val right = line.speaker % 2 == 1
            val active = currentLine == i
            Row(Modifier.fillMaxWidth(), horizontalArrangement = if (right) Arrangement.End else Arrangement.Start) {
                Row(
                    Modifier.widthIn(max = 320.dp)
                        .bouncyClickable(questionsOpen, 0.97f) { playLine(i) }
                        .clip(RoundedCornerShape(18.dp))
                        .background(speakerColor(line.speaker).copy(alpha = if (active) 0.28f else 0.12f))
                        .border(if (active) 2.dp else 0.dp, if (active) speakerColor(line.speaker) else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(18.dp))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(icon(line.speaker), fontSize = 20.sp)
                    Column(Modifier.padding(start = 8.dp)) {
                        if (open) {
                            Text(line.hanzi, fontSize = 19.sp, color = Lab.colors.ink)
                            if (showTranscript) {
                                line.pinyin?.let { Text(it, fontSize = 13.sp, color = Lab.colors.accent) }
                                line.english?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
                            }
                        } else {
                            Text(if (active) "▮▯▮▮▯▮" else "···", fontSize = 18.sp, color = speakerColor(line.speaker), letterSpacing = 2.sp)
                        }
                    }
                }
            }
        }
    }
    ActionRow {
        if (playing) Secondary("■ Stop") { stopPlaying() } else Secondary(if (listened) "↻ Play again" else "▶ Play conversation") { playAll() }
    }
    if (audioUnavailable && !transcriptPeek) {
        Explanation("The audio isn’t on this device yet (it downloads on the next sync online).")
        ActionRow { Secondary("Read it instead") { transcriptPeek = true } }
    }
    if (questionsOpen) {
        ex.questions.forEachIndexed { qi, q ->
            val a = answers[qi]
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("${qi + 1}. ${q.question}", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                val options = q.options
                if (options != null) {
                    for (oi in optionOrders[qi]) {
                        val answered = a.correct != null
                        val st = when { !answered -> OptionState.Idle; oi == q.correct -> OptionState.Correct; oi == a.choice -> OptionState.Wrong; else -> OptionState.Idle }
                        OptionButton(options[oi], st, enabled = !answered, big = false) {
                            val ok = oi == q.correct
                            answers[qi] = QuestionState(choice = oi, correct = ok)
                            if (ok) env.onCorrect() else env.onWrong()
                        }
                    }
                } else if (!a.revealed) {
                    AnswerField(a.text, { answers[qi] = QuestionState(text = it) }, "Your answer (English or Chinese)…")
                    ActionRow { Secondary("Show answer") { answers[qi] = QuestionState(text = a.text, revealed = true) } }
                } else {
                    if (a.text.isNotBlank()) Text("You: ${a.text.trim()}", color = Lab.colors.muted)
                    Text(q.answer ?: "", color = Palette.Good, fontWeight = FontWeight.SemiBold)
                    if (a.correct == null) {
                        ActionRow {
                            Secondary("✗ Missed it") { answers[qi] = QuestionState(text = a.text, revealed = true, correct = false) }
                            Primary("✓ Got it") { answers[qi] = QuestionState(text = a.text, revealed = true, correct = true) }
                        }
                    }
                }
                if (a.correct != null) q.explanation?.takeIf { it.isNotBlank() }?.let { Explanation(it, center = false) }
            }
        }
    }
    if (allAnswered) {
        ResultBanner(score == ex.questions.size, "$score/${ex.questions.size} questions right")
        ActionRow {
            if (!showTranscript) Secondary("Show transcript") { showTranscript = true }
            Primary("Continue") {
                stopPlaying()
                onNext(
                    score == ex.questions.size,
                    ExerciseAnswer(
                        plays = plays,
                        hintUsed = if (transcriptPeek) true else null,
                        questions = answers.map { QuestionAnswer(it.choice, it.text.trim().ifEmpty { null }, it.correct) },
                    ),
                )
            }
        }
    }
}

@Composable
private fun speakerColor(i: Int) = when (i.coerceAtMost(2)) { 0 -> Palette.Secondary; 1 -> Palette.Easy; else -> Palette.Hard }
