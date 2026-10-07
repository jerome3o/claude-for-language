package dev.jeromeswannack.chineselearning.lab.ui.cards

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.api.GenerateRecordingBody
import dev.jeromeswannack.chineselearning.lab.data.api.MINIMAX_VOICES
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.NoteAudioRecordingDto
import dev.jeromeswannack.chineselearning.lab.data.api.generateNoteAudioRecording
import dev.jeromeswannack.chineselearning.lab.data.api.studyNote
import dev.jeromeswannack.chineselearning.lab.data.api.upload
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceList
import dev.jeromeswannack.chineselearning.lab.ui.study.VoiceRecorder
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `DEFAULT_TTS_SPEED` (frontend/src/types.ts). */
const val DEFAULT_TTS_SPEED = 0.6

/** The card editor's audio recordings panel (web: CardEditModal.tsx "Audio Recordings"). */
data class NoteAudioUi(
    val recordings: List<NoteAudioRecordingDto> = emptyList(),
    val loading: Boolean = true,
    val online: Boolean = true,
    /** A Google TTS / MiniMax take or an upload is on its way. */
    val generating: Boolean = false,
    val recording: Boolean = false,
    val error: String? = null,
)

data class NoteAudioActions(
    val onPlay: (NoteAudioRecordingDto) -> Unit = {},
    val onSetPrimary: (String) -> Unit = {},
    val onDelete: (String) -> Unit = {},
    val onRecord: () -> Unit = {},
    val onStopRecording: () -> Unit = {},
    /** Google TTS; the MiniMax slider's speed only goes into the label (as the web). */
    val onGoogleTts: (Double) -> Unit = {},
    /** MiniMax: voice id (null = Random) and speed. */
    val onMiniMax: (String?, Double) -> Unit = { _, _ -> },
)

/**
 * The note's recordings + sentence set for the open editor: loads `GET /api/notes/:id/audio`,
 * records / generates / sets primary / deletes, and keeps the Room note's audio_url on the
 * primary clip (the server moves notes.audio_url with it) so the card plays it offline.
 */
class NoteMediaController(private val app: LabApp, private val noteId: String, private val scope: CoroutineScope) {
    private val tools = CardTools(app)
    private val _audio = MutableStateFlow(NoteAudioUi(online = app.online.value))
    val audio: StateFlow<NoteAudioUi> = _audio
    private val _note = MutableStateFlow<NoteEntity?>(null)
    val note: StateFlow<NoteEntity?> = _note
    private val _sentences = MutableStateFlow<List<SentenceEntity>>(emptyList())
    val sentences: StateFlow<List<SentenceEntity>> = _sentences
    private var recorder: VoiceRecorder? = null

    fun load() {
        scope.launch {
            val (n, s) = withContext(Dispatchers.IO) { app.repo.dao.note(noteId) to app.repo.dao.sentencesFor(noteId) }
            _note.value = n
            _sentences.value = s
            if (s.isEmpty() && app.online.value) runCatching { tools.fetchSetIfMissing(noteId) }.getOrNull()?.let { _sentences.value = it }
        }
        refreshRecordings()
    }

    private fun refreshRecordings() {
        val online = app.online.value
        _audio.update { it.copy(online = online) }
        if (!online) return _audio.update { it.copy(loading = false) }
        scope.launch {
            runCatching { tools.recordings(noteId) }
                .onSuccess { recs -> _audio.update { it.copy(recordings = recs, loading = false, error = null) } }
                .onFailure { e -> _audio.update { it.copy(loading = false, error = e.userMessage()) } }
        }
    }

    /** Pick up the note's (maybe new primary) audio_url on this phone. */
    private suspend fun mirrorNote() {
        runCatching { tools.mirror(app.repo.api.studyNote(noteId)) }.getOrNull()?.let { _note.value = it }
        app.repo.notifyLocalChange()
    }

    private fun act(block: suspend () -> Unit) {
        _audio.update { it.copy(generating = true, error = null) }
        scope.launch {
            runCatching { block() }
                .onSuccess { app.haptics.correct() }
                .onFailure { e -> app.haptics.wrong(); _audio.update { it.copy(error = e.userMessage()) } }
            _audio.update { it.copy(generating = false) }
            refreshRecordings()
        }
    }

    fun play(rec: NoteAudioRecordingDto) = app.audio.play(rec.audio_url, _note.value?.hanzi.orEmpty(), app.online.value)

    fun setPrimary(recordingId: String) = act { tools.setPrimaryRecording(noteId, recordingId); mirrorNote() }

    fun delete(recordingId: String) = act { tools.deleteRecording(noteId, recordingId); mirrorNote() }

    /** Google TTS / MiniMax, the web's handleGenerateAudio (speaker name "Voice 1.2x"). */
    fun generate(provider: String, voiceId: String? = null, speed: Double = DEFAULT_TTS_SPEED) = act {
        val body = if (provider == "minimax") {
            val voice = voiceId?.let { id -> MINIMAX_VOICES.firstOrNull { it.first == id } ?: (id to id) } ?: MINIMAX_VOICES.random()
            val name = voice.second.replace(Regex("\\s*\\(.*\\)$"), "")
            GenerateRecordingBody(provider = "minimax", speed = speed, voiceId = voice.first, speakerName = name + speedLabel(speed))
        } else {
            // As the web: the speed only reaches MiniMax, but the label carries the slider's value.
            GenerateRecordingBody(provider = "gtts", speakerName = "Google TTS" + speedLabel(speed))
        }
        app.repo.api.generateNoteAudioRecording(noteId, body)
    }

    fun startRecording(context: android.content.Context) {
        val r = recorder ?: VoiceRecorder(context, scope).also { recorder = it }
        if (r.start()) { app.haptics.tick(); _audio.update { it.copy(recording = true, error = null) } }
        else _audio.update { it.copy(error = "Couldn't open the microphone.") }
    }

    /** Stop → upload as "My Recording" (multipart `file` + `speaker_name`, POST /api/notes/:id/audio). */
    fun stopRecording() {
        val r = recorder ?: return
        val take = r.stop()
        _audio.update { it.copy(recording = false) }
        if (take == null) return
        act {
            val res = app.repo.api.upload("/api/notes/${dev.jeromeswannack.chineselearning.lab.data.api.enc(noteId)}/audio", take, fileName = take.name, mime = r.mime, fields = mapOf("speaker_name" to "My Recording"))
            take.delete()
            if (!res.ok) throw dev.jeromeswannack.chineselearning.lab.data.HttpException(res.code, res.body.take(200), res.body)
        }
    }

    fun release() {
        recorder?.release()
        recorder = null
    }

    // ---------------- sentence set ----------------

    val sentenceActions = SentenceActions(
        generate = { count, keep, prompt -> _sentences.value = tools.generateSet(noteId, count, prompt, keep); app.haptics.correct() },
        clear = { tools.clearSet(noteId); _sentences.value = emptyList() },
        cachedExplanation = { r -> tools.cachedExplanation(r.sentenceId, r.hanzi) },
        explain = { r -> tools.explain(r.sentenceId, r.hanzi, r.pinyin, r.translation) },
        cachedTranslation = { r -> tools.cachedClueTranslation(r.hanzi) },
        translate = { r -> tools.clueTranslation(r.hanzi, r.pinyin) },
        decks = { withContext(Dispatchers.IO) { dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { it.id to it.name } } },
        deckHas = tools::deckHas,
        addCard = { deckId, c -> tools.addNote(deckId, NewNoteBody(c.hanzi, c.pinyin, c.english)) },
    )

    fun playSentence(key: String?, text: String) = app.audio.play(key, text, app.online.value)

    companion object {
        fun speedLabel(speed: Double): String = if (speed != 1.0) " ${String.format(java.util.Locale.US, "%.1f", speed)}x" else ""
    }
}

/** The editor's "Sentence Set" + "Audio Recordings" sections for [noteId] (hosted by NoteEditorSheets). */
@Composable
fun NoteMediaSections(app: LabApp, noteId: String, fields: dev.jeromeswannack.chineselearning.lab.data.decks.NoteFields) {
    val scope = rememberCoroutineScope()
    val controller = remember(noteId) { NoteMediaController(app, noteId, scope) }
    LaunchedEffect(noteId) { controller.load() }
    DisposableEffect(noteId) { onDispose { controller.release() } }
    val audio by controller.audio.collectAsState()
    val note by controller.note.collectAsState()
    val sentences by controller.sentences.collectAsState()
    val playing by app.audio.playingKey.collectAsState()
    val context = LocalContext.current
    val permission = rememberMicPermission { controller.startRecording(context) }
    note?.let { n ->
        SectionTitle("Sentence Set")
        // Row 1 is the card's sentence as currently typed in the form (the web passes cardSentence).
        val shown = n.copy(
            sentenceClue = fields.sentenceClue.trim().ifEmpty { null },
            sentenceCluePinyin = fields.sentenceCluePinyin.trim().ifEmpty { null },
            sentenceClueTranslation = fields.sentenceClueTranslation.trim().ifEmpty { null },
            sentenceClueAudioUrl = n.sentenceClueAudioUrl.takeIf { fields.sentenceClue.trim() == n.sentenceClue },
        )
        SentenceList(shown, sentences, presentation = 0, online = app.online.value, playingKey = playing, s = controller.sentenceActions, onPlay = controller::playSentence, startShowAll = false)
    }
    NoteAudioPanel(
        audio,
        playing,
        NoteAudioActions(
            onPlay = controller::play,
            onSetPrimary = controller::setPrimary,
            onDelete = controller::delete,
            onRecord = permission,
            onStopRecording = controller::stopRecording,
            onGoogleTts = { speed -> controller.generate("gtts", speed = speed) },
            onMiniMax = { voice, speed -> controller.generate("minimax", voice, speed) },
        ),
    )
}

@Composable
private fun SectionTitle(text: String) =
    Text(text, style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, modifier = Modifier.padding(top = 10.dp))

/** The recordings list + Record / Google TTS / MiniMax ▾ (stateless; screenshot-tested). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NoteAudioPanel(ui: NoteAudioUi, playingKey: String?, actions: NoteAudioActions, startMiniMaxOpen: Boolean = false) {
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    var minimax by remember { mutableStateOf(startMiniMaxOpen) }
    var voice by remember { mutableStateOf<String?>(null) }
    var speed by remember { mutableStateOf(DEFAULT_TTS_SPEED) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionTitle("Audio Recordings")
        ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        when {
            !ui.online -> InlineNotice("You're offline — recordings load and change when you're back online.", kind = NoticeKind.Offline)
            ui.loading -> Text("Loading recordings...", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            ui.recordings.isEmpty() -> Text("No audio recordings yet.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            else -> Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint.copy(alpha = 0.5f))) {
                ui.recordings.forEach { rec ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val isPlaying = playingKey == rec.audio_url
                        Text(
                            if (isPlaying) "🔊" else "▶",
                            color = Lab.colors.accent, fontSize = 18.sp,
                            modifier = Modifier.size(44.dp).clip(CircleShape).background(Lab.colors.card).clickable { actions.onPlay(rec) }.padding(top = 10.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                        Column(Modifier.weight(1f)) {
                            Text(rec.speaker_name ?: rec.provider ?: "Recording", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                            if (rec.is_primary) Text("Primary", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = Palette.Good)
                        }
                        if (confirmDelete == rec.id) {
                            SmallAction("Confirm", danger = true, enabled = !ui.generating) { confirmDelete = null; actions.onDelete(rec.id) }
                            SmallAction("Cancel") { confirmDelete = null }
                        } else {
                            if (!rec.is_primary) SmallAction("Set Primary", enabled = !ui.generating) { actions.onSetPrimary(rec.id) }
                            SmallAction("Delete", enabled = !ui.generating) { confirmDelete = rec.id }
                        }
                    }
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (ui.recording) SecondaryPill("■ Stop", danger = true) { actions.onStopRecording() }
            else SecondaryPill("🎙 Record", enabled = ui.online && !ui.generating) { actions.onRecord() }
            SecondaryPill(if (ui.generating) "…" else "Google TTS", enabled = ui.online && !ui.generating) { actions.onGoogleTts(speed) }
            SecondaryPill("MiniMax ${if (minimax) "▲" else "▼"}", enabled = ui.online) { minimax = !minimax }
        }
        AnimatedVisibility(minimax) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint.copy(alpha = 0.5f)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                var open by remember { mutableStateOf(false) }
                Text("Voice", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                Column {
                    Text(
                        (voice?.let { id -> MINIMAX_VOICES.firstOrNull { it.first == id }?.second } ?: "Random") + "  ▾",
                        color = Lab.colors.ink,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.card).clickable { open = true }.padding(horizontal = 12.dp, vertical = 12.dp),
                    )
                    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        DropdownMenuItem(text = { Text("Random") }, onClick = { voice = null; open = false })
                        MINIMAX_VOICES.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { voice = id; open = false }) }
                    }
                }
                Text("Speed: ${String.format(java.util.Locale.US, "%.1f", speed)}", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                Slider(
                    value = speed.toFloat(),
                    onValueChange = { speed = Math.round(it * 10) / 10.0 },
                    valueRange = 0.3f..1.5f,
                    steps = 11,
                    colors = SliderDefaults.colors(thumbColor = Lab.colors.accent, activeTrackColor = Lab.colors.accent),
                )
                SecondaryPill(if (ui.generating) "Generating..." else "Generate MiniMax", enabled = ui.online && !ui.generating) { actions.onMiniMax(voice, speed) }
            }
        }
    }
}

@Composable
private fun SmallAction(label: String, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = if (!enabled) Lab.colors.muted else if (danger) Palette.Again else Lab.colors.accent,
        modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 8.dp, vertical = 12.dp),
    )
}

/** Asks for the microphone once, then runs [onGranted]. */
@Composable
private fun rememberMicPermission(onGranted: () -> Unit): () -> Unit {
    val context = LocalContext.current
    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { ok -> if (ok) onGranted() }
    return {
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (granted) onGranted() else launcher.launch(android.Manifest.permission.RECORD_AUDIO)
    }
}
