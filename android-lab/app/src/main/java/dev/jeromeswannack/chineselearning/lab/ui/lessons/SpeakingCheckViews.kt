package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AttemptRecording
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.SpeakingTake
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.liveTranscriptionSession
import dev.jeromeswannack.chineselearning.lab.data.api.transcribe
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.study.LiveSessionCache
import dev.jeromeswannack.chineselearning.lab.ui.study.LiveStream
import dev.jeromeswannack.chineselearning.lab.ui.study.SonioxProtocol
import dev.jeromeswannack.chineselearning.lab.ui.study.SonioxStream
import dev.jeromeswannack.chineselearning.lab.ui.study.TakeTranscription
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionComparison
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

/*
 * A free-speaking exercise's recorded answer — the Lab twin of the web's
 * components/lessons/SpeakingAnswer.tsx + hooks/useSpeakingTake.ts (docs/STUDY_SESSION.md
 * "Claude checks your speaking"): the take streams to the live transcriber as it is spoken (the
 * words appear), "🎤 You said" is ready at Stop — else the take is uploaded (TakeTranscription, the
 * study card's path); both failing → "Couldn't transcribe — tap to retry" with the SAME take;
 * offline → the recording is kept and the server checks it once the attempt uploads. At Done,
 * Claude's speaking check (core LessonAnswerCheck): the task's parts, a cleaner version, tips.
 * The take stops by itself at SpeakingTake.MAX_SECONDS; the live key must outlive it.
 */

/** Where a speaking take is transcribed (fakeable): a live stream for the take, and the upload. */
interface SpeakingTranscriber {
    /** A live stream (null: no key / offline → upload only). [onUpdate] off the main thread. */
    fun open(onUpdate: (SonioxProtocol.Transcript) -> Unit): LiveStream?
    suspend fun upload(take: File, mime: String, liveError: String?): String
    val online: Boolean
    /** Warm a key that outlives a long take. */
    fun prefetch() {}
    /** The key was refused: mint a fresh one next time. */
    fun invalidateKey() {}
}

/** The app's transcriber: the study cards' live key cache (with the long-take margin) and upload. */
class AppSpeakingTranscriber(private val app: LabApp, private val scope: CoroutineScope) : SpeakingTranscriber {
    private val keys = LiveSessionCache { app.repo.api.liveTranscriptionSession() }
    override val online: Boolean get() = app.online.value
    override fun open(onUpdate: (SonioxProtocol.Transcript) -> Unit): LiveStream? =
        if (!online) null else keys.usable(SpeakingTake.LIVE_KEY_MARGIN_MS)?.let { s -> runCatching { SonioxStream(app.repo.api.http, s, onUpdate) }.getOrNull() }
    override suspend fun upload(take: File, mime: String, liveError: String?): String = app.repo.api.transcribe(take, mime, liveError).text
    override fun prefetch() { if (online) keys.prefetch(scope, SpeakingTake.LIVE_KEY_MARGIN_MS) }
    override fun invalidateKey() = keys.invalidate()
}

/** "🎤 You said": nothing yet, being written down, the text, saved offline, or failed (tap to retry). */
sealed interface SpeakingTranscript {
    data object None : SpeakingTranscript
    data object Transcribing : SpeakingTranscript
    data class Done(val text: String, val via: String) : SpeakingTranscript
    data object Offline : SpeakingTranscript
    data object Failed : SpeakingTranscript
}

/** One exercise's take (the web's useSpeakingTake). */
class SpeakingTakeState(
    private val exerciseType: String,
    private val recorder: LessonRecorder?,
    private val transcriber: SpeakingTranscriber?,
    private val scope: CoroutineScope,
) {
    var transcript by mutableStateOf<SpeakingTranscript>(SpeakingTranscript.None)
        private set
    /** The words so far while speaking (live stream only). */
    var liveText by mutableStateOf("")
        private set
    var take by mutableStateOf<File?>(null)
        private set
    var durationMs by mutableStateOf(0L)
        private set
    var startedAt = 0L
        private set
    private var live: LiveStream? = null
    private var job: Job? = null
    private var generation = 0

    init { transcriber?.prefetch() }

    /** Starts a take (the caller holds RECORD_AUDIO); false when the microphone can't be used. */
    fun start(): Boolean {
        val r = recorder ?: return false
        drop()
        transcript = SpeakingTranscript.None
        liveText = ""
        take = null
        val gen = generation
        val stream = transcriber?.open { t -> scope.launch { if (gen == generation) liveText = (t.finalText + t.partialText).trim() } }
        val ok = if (stream != null && r.startLive { buf, n -> stream.send(buf, n) }) true else {
            stream?.abort()
            r.start()
        }
        if (!ok) return false
        live = stream.takeIf { r.mime == "audio/wav" }
        startedAt = System.currentTimeMillis()
        return true
    }

    fun stop() {
        val r = recorder ?: return
        durationMs = System.currentTimeMillis() - startedAt
        val file = r.stop()
        val stream = live
        live = null
        if (file == null) {
            stream?.abort()
            return
        }
        take = file
        transcribe(file, r.mime, stream)
    }

    private fun transcribe(file: File, mime: String, stream: LiveStream?) {
        val t = transcriber
        if (t == null) {
            transcript = SpeakingTranscript.Failed
            return
        }
        val gen = ++generation
        transcript = SpeakingTranscript.Transcribing
        val seconds = durationMs / 1000
        job = scope.launch {
            val began = System.currentTimeMillis()
            val liveText = stream?.let { s -> scope.async { s.finish(SpeakingTake.FINISH_TIMEOUT_MS) } }
            val outcome = TakeTranscription.outcome(liveText, { t.online }, { TranscriptionComparison(it.trim(), "", false, false) }) { e -> t.upload(file, mime, e) }
            if (gen != generation) return@launch
            outcome.liveError?.let { if (SonioxProtocol.invalidatesKey(it)) t.invalidateKey() }
            val ui = outcome.ui
            Analytics.track("lesson.speaking_transcribed", mapOf(
                "via" to (outcome.via ?: when (ui) { TranscriptionUi.Offline -> "offline"; else -> "failed" }),
                "live_error" to if (stream != null) SonioxProtocol.errorKind(outcome.liveError) else "none",
                "ms" to System.currentTimeMillis() - began,
                "seconds" to seconds,
                "exercise_type" to exerciseType,
            ))
            transcript = when (ui) {
                is TranscriptionUi.Done -> ui.result.transcribedHanzi.trim().takeIf { it.isNotEmpty() }?.let { SpeakingTranscript.Done(it, outcome.via ?: "upload") } ?: SpeakingTranscript.Failed
                TranscriptionUi.Offline -> SpeakingTranscript.Offline
                else -> SpeakingTranscript.Failed
            }
        }
    }

    /** "Couldn't transcribe — tap to retry": the same take, upload only. */
    fun retry() {
        val file = take ?: return
        transcribe(file, recorder?.mime ?: "audio/mp4", null)
    }

    /** 🔁 Try again: a fresh take. */
    fun reset() {
        drop()
        transcript = SpeakingTranscript.None
        liveText = ""
        take = null
    }

    fun dispose() {
        drop()
        if (recorder?.recording?.value == true) recorder.stop()?.delete()
    }

    private fun drop() {
        generation++
        job?.cancel()
        job = null
        live?.abort()
        live = null
    }
}

/**
 * The recorded half of oral_expression / speak: record → "🎤 You said" → Done → Claude's check under
 * it, "One way to say it", the two self-assessment buttons with the suggested one ringed.
 */
@Composable
fun SpeakingAnswerView(
    exerciseType: String,
    prompt: String,
    hints: List<String>?,
    question: String?,
    example: LessonSentence?,
    targetSeconds: Int,
    mediaKey: String?,
    env: ExerciseEnv,
    gotItLabel: String = "✓ I said it well",
    allowWithoutRecording: Boolean = false,
    onDone: (Boolean, ExerciseAnswer, File?) -> Unit,
) {
    val recorder = env.recorder
    val scope = rememberCoroutineScope()
    val take = remember { SpeakingTakeState(exerciseType, recorder, env.speaking, scope) }
    val recording by (recorder?.recording ?: remember { kotlinx.coroutines.flow.MutableStateFlow(false) }).collectAsState()
    val level by (recorder?.level ?: remember { kotlinx.coroutines.flow.MutableStateFlow(0f) }).collectAsState()
    val recorderError by (recorder?.error ?: remember { kotlinx.coroutines.flow.MutableStateFlow<String?>(null) }).collectAsState()
    var elapsed by remember { mutableStateOf(0) }
    var done by remember { mutableStateOf(false) }
    var skipped by remember { mutableStateOf(false) }
    var checkedFor by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val ac = rememberLessonAnswerCheck(exerciseType, prompt, example?.hanzi ?: "", example?.pinyin, env, hints = hints, question = question) {
        done = false; skipped = false; checkedFor = null; take.reset()
    }
    DisposableEffect(Unit) { onDispose { take.dispose() } }
    LaunchedEffect(recording) {
        while (recording) {
            elapsed = ((System.currentTimeMillis() - take.startedAt) / 1000).toInt()
            if (elapsed >= SpeakingTake.MAX_SECONDS) take.stop()
            delay(250)
        }
    }
    val text = (take.transcript as? SpeakingTranscript.Done)?.text.orEmpty()
    // The check starts once the answer is final (Done) and its transcript exists — whichever comes last.
    LaunchedEffect(done, skipped, text) {
        if (done && !skipped && text.isNotEmpty() && checkedFor != text) {
            checkedFor = text
            ac.onFinal(text, "spoken")
        }
    }

    fun startNow() {
        env.stopAudio()
        elapsed = 0
        if (take.start()) env.onTap()
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startNow() else recorder?.setError("Microphone permission was denied — you can still say it without recording.")
    }
    fun start() {
        if (recorder == null) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startNow()
        else permission.launch(Manifest.permission.RECORD_AUDIO)
    }
    fun finish(withoutRecording: Boolean = false) {
        if (withoutRecording) skipped = true
        done = true
        example?.let { env.speak(it.hanzi) }
    }
    val file = take.take?.takeIf { !skipped }
    fun answer(): ExerciseAnswer = ac.report(
        ExerciseAnswer(
            selfAssessed = true,
            text = text.takeIf { it.isNotEmpty() && !skipped },
            input = if (text.isNotEmpty() && !skipped) "spoken" else null,
            recording = if (file != null && mediaKey != null) AttemptRecording(mediaKey, take.durationMs, recorder?.mime ?: "audio/mp4") else null,
        ),
    )

    if (!done) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val t = take.take
            when {
                recording -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RecDot()
                        Text("  Recording… ${SpeakingTake.clock(elapsed.toDouble())}", color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
                        Text(" / ~${SpeakingTake.clock(targetSeconds.toDouble())}", color = Lab.colors.muted)
                    }
                    Box(Modifier.fillMaxWidth(0.7f).height(8.dp).clip(CircleShape).background(Lab.colors.faint)) {
                        Box(Modifier.fillMaxWidth(level.coerceIn(0.02f, 1f)).fillMaxHeight().clip(CircleShape).background(Palette.Again))
                    }
                    if (take.liveText.isNotEmpty()) Text(take.liveText, color = Lab.colors.muted, fontSize = 17.sp, modifier = Modifier.fillMaxWidth().testTag("speaking-live"))
                    RecButton("■", Palette.Again, "Stop recording") { take.stop() }
                }
                t != null -> {
                    Text("Recorded ${SpeakingTake.clock(take.durationMs / 1000.0)}", color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
                    SpeakingTranscriptBlock(take.transcript, onRetry = take::retry)
                    ActionRow {
                        Secondary("▶ Listen back") { env.playFile(t) }
                        Secondary("🎙 Again") { start() }
                    }
                    ActionRow { Primary("Done") { finish() } }
                }
                else -> {
                    RecButton("🎙", Lab.colors.accent, "Start recording") { start() }
                    Explanation("Tap to record your answer (about $targetSeconds seconds)")
                    val err = recorderError ?: if (recorder == null) "Recording isn't available here." else null
                    if (err != null) Explanation(err)
                    if (err != null || allowWithoutRecording) {
                        ActionRow { Secondary(if (allowWithoutRecording && err == null) "🎤 I said it without recording" else "Say it without recording") { finish(withoutRecording = true) } }
                    }
                }
            }
        }
    } else {
        if (file != null) ActionRow { Secondary("▶ Your answer") { env.playFile(file) } }
        if (file != null) {
            SpeakingTranscriptBlock(take.transcript, onRetry = take::retry) {
                if (text.isNotEmpty()) AnswerCheckView(ac, text, env)
            }
        }
        example?.let { Reference(it, env, label = "One way to say it:") }
        if (mediaKey != null && file != null) Explanation("Your tutor can listen to this recording.")
        SelfAssess("How did it go?", yes = gotItLabel, suggested = ac.suggested?.let { it == "got_it" }) { ok -> onDone(ok, answer(), file) }
    }
}

/** "🎤 You said" — the transcript (tappable Chinese), or where it is. Stateless (screenshots). */
@Composable
fun SpeakingTranscriptBlock(state: SpeakingTranscript, onRetry: () -> Unit, below: @Composable () -> Unit = {}) {
    if (state == SpeakingTranscript.None) return
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).padding(14.dp).testTag("speaking-transcript"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("🎤 You said", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        when (state) {
            is SpeakingTranscript.Done -> ExplorableText(state.text, source = "lesson", fontSize = 18.sp, color = Lab.colors.ink)
            SpeakingTranscript.Failed -> Text(
                "⚠ " + SpeakingTake.line("failed"), color = Palette.Again, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).bouncyClickable(onClick = onRetry).clip(RoundedCornerShape(10.dp))
                    .background(Palette.Again.copy(alpha = 0.08f)).border(1.dp, Palette.Again.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
                    .padding(horizontal = 12.dp, vertical = 11.dp).testTag("speaking-transcript-retry"),
            )
            SpeakingTranscript.Offline -> Text(SpeakingTake.line("offline"), color = Lab.colors.muted, fontSize = 15.sp)
            else -> Text(SpeakingTake.line("transcribing"), color = Lab.colors.muted, fontSize = 15.sp)
        }
        below()
    }
}
