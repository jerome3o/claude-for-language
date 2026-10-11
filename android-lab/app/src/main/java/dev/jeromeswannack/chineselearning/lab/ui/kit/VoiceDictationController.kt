package dev.jeromeswannack.chineselearning.lab.ui.kit

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import dev.jeromeswannack.chineselearning.lab.data.api.transcribe
import dev.jeromeswannack.chineselearning.lab.data.api.liveTranscriptionSession
import dev.jeromeswannack.chineselearning.lab.ui.study.LiveSessionCache
import dev.jeromeswannack.chineselearning.lab.ui.study.LiveStream
import dev.jeromeswannack.chineselearning.lab.ui.study.SonioxProtocol
import dev.jeromeswannack.chineselearning.lab.ui.study.SonioxStream
import dev.jeromeswannack.chineselearning.lab.ui.study.TakeTranscription
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionComparison
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionUi
import dev.jeromeswannack.chineselearning.lab.ui.study.VoiceRecorder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

/** What a voice-first box submits (the web's `DictatedAnswer`): source = spoken | edited | typed. */
data class DictatedAnswer(val text: String, val source: String, val transcript: String?)

/** The box's state: the core [VoiceDictation.State] fields plus the live / reviewed text. */
data class VoiceDictationUi(
    val mode: String = VoiceDictation.VOICE,
    val phase: String = "idle",
    val failure: String? = null,
    val blocked: String? = null,
    /** Confirmed so far (ink), or the transcript on review. */
    val finalText: String = "",
    /** Still provisional (grey). */
    val partialText: String = "",
) {
    val state: VoiceDictation.State get() = VoiceDictation.State(if (blocked != null) VoiceDictation.TYPE else mode, phase, failure, blocked)
    val busy: Boolean get() = phase == "listening" || phase == "finishing"
}

/**
 * Where a box's takes are recorded and transcribed (fakeable in tests): the study cards' recorder
 * ([VoiceRecorder.startLive] + [SonioxStream]) with the upload fallback.
 */
interface DictationEngine {
    /** A live stream for this take (null: no key / offline → upload only). [onUpdate] off the main thread. */
    fun open(languageHints: List<String>, onUpdate: (SonioxProtocol.Transcript) -> Unit): LiveStream?
    /** Opens the microphone, streaming into [live] when given; false when it can't. */
    fun start(live: LiveStream?): Boolean
    /** Stops; the take, or null when it holds nothing. */
    fun stop(): File?
    val mime: String
    suspend fun upload(take: File, mime: String, liveError: String?): String
    /** Warm the temporary key so the first 🎤 streams. */
    fun prefetch() {}
}

/** The app's engine: the same recorder, live key cache and upload as the study cards. */
class AppDictationEngine(private val app: LabApp, private val scope: CoroutineScope) : DictationEngine {
    private val recorder = VoiceRecorder(app, scope)
    private val keys = LiveSessionCache { app.repo.api.liveTranscriptionSession() }

    override fun open(languageHints: List<String>, onUpdate: (SonioxProtocol.Transcript) -> Unit): LiveStream? =
        keys.usable()?.let { s -> runCatching { SonioxStream(app.repo.api.http, s.copy(language_hints = languageHints), onUpdate) }.getOrNull() }

    override fun start(live: LiveStream?): Boolean {
        if (live != null && recorder.startLive { buf, n -> live.send(buf, n) }) return true
        live?.abort()
        return recorder.start()
    }

    override fun stop(): File? = recorder.stop()
    override val mime: String get() = recorder.mime
    override suspend fun upload(take: File, mime: String, liveError: String?): String = app.repo.api.transcribe(take, mime, liveError).text
    override fun prefetch() = keys.prefetch(scope)

    /** A refused key: mint a fresh one for the next take. */
    fun invalidateKey() = keys.invalidate()
    fun release() = recorder.release()
}

/**
 * A voice-first box's controller (the web's `useVoiceDictation`, rules in core [VoiceDictation]):
 * 🎤 Say it → ⏹ Stop → the review (🔁 Retry · ✏️ Edit · ✓ Submit), the live transcript as it is said,
 * the upload when live gives nothing, "Couldn't transcribe — tap to retry" with the same take.
 * Voice is always the default; typing one tap away; offline / no microphone → typing with a reason.
 * `voice_input.used` records each settled take / typed answer (enums + durations only).
 */
class VoiceDictationController(
    private val scope: CoroutineScope,
    private val engine: DictationEngine,
    private val surface: String,
    private val lang: String = "zh",
    private val defaultMode: String? = null,
    private val online: () -> Boolean,
    private val track: (String, Map<String, Any?>) -> Unit = { _, _ -> },
    private val autoSubmit: Boolean = false,
    private val onLiveError: (String) -> Unit = {},
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _ui = MutableStateFlow(VoiceDictationUi(mode = VoiceDictation.initialMode(defaultMode, null)))
    val ui: StateFlow<VoiceDictationUi> = _ui

    /** The answer, when submitted. */
    var onSubmit: (DictatedAnswer) -> Unit = {}
    /** ✏️ Edit: the transcript goes into the caller's box. */
    var onFill: (String) -> Unit = {}
    /** Released with the box (the app engine's recorder). */
    var onDispose: () -> Unit = {}

    private var generation = 0
    private var live: LiveStream? = null
    private var take: File? = null
    private var job: Job? = null
    private var startedAt = 0L
    private var speechMs = 0L
    private var pending: Triple<TakeTranscription.Outcome?, Long, Boolean>? = null
    /** What ✏️ Edit put in the box (null: nothing spoken). */
    private var filled: String? = null
    /** Text typed before going back to 🎤: the take is joined onto it. */
    private var prefix = ""
    private var micBlock: String? = null

    init {
        refreshBlocked()
        if (online()) engine.prefetch()
    }

    /** The connection changed (or a permission answer came back): re-derive why speaking is off. */
    fun refreshBlocked() {
        val blocked = if (!online()) "offline" else micBlock
        if (blocked == "offline" && (_ui.value.phase == "listening" || _ui.value.phase == "review")) cancel()
        _ui.update { it.copy(blocked = blocked) }
        if (blocked == null && online()) engine.prefetch()
    }

    /** RECORD_AUDIO refused (or the microphone wouldn't open): typing, with why. */
    fun micUnavailable(kind: String) {
        micBlock = VoiceDictation.micErrorBlock(kind)
        refreshBlocked()
    }

    /** 🎤 Say it (from idle, a failed take, the review's Retry or the typing box's 🎤 with [typed] kept as a prefix). */
    fun say(typed: String = "") {
        val cur = _ui.value
        if (cur.busy) return
        micBlock = null
        if (!online()) return refreshBlocked()
        if (cur.state.mode == VoiceDictation.TYPE) {
            prefix = typed.trim()
            filled = null
        }
        if (cur.phase == "review") report("retaken", pending)
        pending = null
        drop()
        val gen = generation
        val stream = engine.open(VoiceDictation.languageHints(lang)) { t ->
            scope.launch {
                if (gen == generation && _ui.value.phase == "listening") _ui.update { it.copy(finalText = VoiceDictation.join(prefix, t.finalText), partialText = t.partialText) }
            }
        }
        if (!engine.start(stream)) {
            stream?.abort()
            micBlock = "mic_error"
            _ui.update { it.copy(mode = VoiceDictation.VOICE, phase = "idle", finalText = "", partialText = "", failure = null) }
            return refreshBlocked()
        }
        live = stream
        startedAt = now()
        speechMs = 0
        _ui.update { it.copy(mode = VoiceDictation.VOICE, phase = "listening", finalText = prefix, partialText = "", failure = null, blocked = null) }
    }

    /** 🔁 Retry: a new take replaces this one. */
    fun retake() = say()

    /** ⏹: stop; the transcript goes to the review. */
    fun stop() {
        if (_ui.value.phase != "listening") return
        val gen = generation
        val stoppedAt = now()
        speechMs = stoppedAt - startedAt
        val file = engine.stop()
        val stream = live
        live = null
        if (file == null) {
            stream?.abort()
            return land(null, 0, streamed = false, empty = true)
        }
        take = file
        val mime = engine.mime
        _ui.update { it.copy(phase = "finishing") }
        val liveText = stream?.let { s -> scope.async { s.finish() } }
        job = scope.launch {
            val outcome = TakeTranscription.outcome(liveText, online, ::plain) { e -> engine.upload(file, mime, e) }
            if (gen != generation) return@launch
            outcome.liveError?.let(onLiveError)
            land(outcome, now() - stoppedAt, streamed = liveText != null)
        }
    }

    /** "Couldn't transcribe — tap to retry": the same take, upload only. */
    fun retryUpload() {
        val cur = _ui.value
        val file = take ?: return
        if (cur.phase != "failed" || cur.failure == "empty") return
        val gen = ++generation
        val mime = engine.mime
        val startedRetry = now()
        _ui.update { it.copy(phase = "finishing", failure = null) }
        job = scope.launch {
            val outcome = TakeTranscription.outcome(null, online, ::plain) { e -> engine.upload(file, mime, e) }
            if (gen == generation) land(outcome, now() - startedRetry, streamed = false)
        }
    }

    /** ✕ while listening / finishing (or on the review): nothing is kept. */
    fun cancel() {
        val cur = _ui.value
        if (cur.phase == "idle") return
        if (cur.phase == "listening") {
            speechMs = now() - startedAt
            engine.stop()?.delete()
        }
        if (cur.busy) report("cancelled", null) else if (cur.phase == "review") report("cancelled", pending)
        drop()
        prefix = ""
        _ui.update { it.copy(phase = "idle", finalText = "", partialText = "", failure = null) }
    }

    /** ✓ Submit: the transcript on review, or [typed] in the box. */
    fun submit(typed: String) {
        val cur = _ui.value
        val answer = VoiceDictation.answer(cur.state, cur.finalText, typed, filled) ?: return
        if (cur.state.mode == VoiceDictation.VOICE) {
            report("submitted", pending)
            drop()
            prefix = ""
            _ui.update { it.copy(phase = "idle", finalText = "", partialText = "") }
            onSubmit(DictatedAnswer(answer.text, "spoken", answer.text))
            return
        }
        report(VoiceDictation.typedOutcome(answer.source), null)
        val transcript = filled
        filled = null
        onSubmit(DictatedAnswer(answer.text, answer.source, transcript))
    }

    /** ✏️ Edit on the review: into the box (still "spoken" until changed). */
    fun edit() {
        val cur = _ui.value
        if (cur.phase != "review") return
        report("edit", pending)
        drop()
        prefix = ""
        filled = cur.finalText
        onFill(cur.finalText)
        _ui.update { it.copy(mode = VoiceDictation.TYPE, phase = "idle", finalText = "", partialText = "") }
    }

    /** ✏️ Type: the keyboard (a take under way is thrown away). */
    fun type() {
        if (_ui.value.phase != "idle") cancel()
        _ui.update { it.copy(mode = VoiceDictation.TYPE) }
    }

    /** The next answer: voice again, nothing pending. */
    fun reset() {
        cancel()
        filled = null
        _ui.update { it.copy(mode = VoiceDictation.initialMode(defaultMode, null), phase = "idle") }
    }

    fun dispose() {
        if (_ui.value.phase == "listening") engine.stop()?.delete()
        drop()
    }

    private fun plain(text: String) = TranscriptionComparison(text.trim(), "", isMatch = false, containsExpected = false)

    private fun drop() {
        generation++
        job?.cancel()
        job = null
        live?.abort()
        live = null
        take?.delete()
        take = null
    }

    private fun land(outcome: TakeTranscription.Outcome?, ms: Long, streamed: Boolean, empty: Boolean = false) {
        val text = (outcome?.ui as? TranscriptionUi.Done)?.result?.transcribedHanzi?.trim().orEmpty()
        if (!empty && text.isNotEmpty()) {
            val joined = VoiceDictation.join(prefix, text)
            pending = Triple(outcome, ms, streamed)
            if (autoSubmit) {
                _ui.update { it.copy(phase = "review", finalText = joined, partialText = "") }
                return submit("")
            }
            _ui.update { it.copy(phase = "review", finalText = joined, partialText = "", failure = null) }
            return
        }
        val failure = when {
            empty || outcome?.ui is TranscriptionUi.Done -> "empty"
            outcome?.ui == TranscriptionUi.Offline -> "offline"
            else -> "failed"
        }
        report(if (failure == "empty") "empty" else "failed", Triple(outcome, ms, streamed))
        if (failure == "empty") { take?.delete(); take = null }
        _ui.update { it.copy(phase = "failed", failure = failure, finalText = "", partialText = "") }
    }

    /** `voice_input.used` — enums, durations only. */
    private fun report(outcome: String, t: Triple<TakeTranscription.Outcome?, Long, Boolean>?) {
        val o = t?.first
        track("voice_input.used", mapOf(
            "surface" to surface,
            "outcome" to outcome,
            "via" to (o?.via ?: "none"),
            "live_error" to if (t?.third == true) SonioxProtocol.errorKind(o?.liveError) else "none",
            "speech_ms" to speechMs.coerceAtLeast(0),
            "ms" to (t?.second ?: 0L),
            "blocked" to (_ui.value.blocked ?: "none"),
        ))
    }
}
