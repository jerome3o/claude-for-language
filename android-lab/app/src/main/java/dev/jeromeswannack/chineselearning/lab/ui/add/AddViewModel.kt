package dev.jeromeswannack.chineselearning.lab.ui.add

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.add.AddTab
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.add.DeviceOcr
import dev.jeromeswannack.chineselearning.lab.data.add.PhotoReader
import dev.jeromeswannack.chineselearning.lab.data.api.ChineseCandidateDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.GenerateReaderBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewAudioLessonBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewPictureHuntBody
import dev.jeromeswannack.chineselearning.lab.data.api.createAudioLesson
import dev.jeromeswannack.chineselearning.lab.data.api.createPictureHunt
import dev.jeromeswannack.chineselearning.lab.data.api.englishWords
import dev.jeromeswannack.chineselearning.lab.data.api.generateClips
import dev.jeromeswannack.chineselearning.lab.data.api.generateDeck
import dev.jeromeswannack.chineselearning.lab.data.api.generateReader
import dev.jeromeswannack.chineselearning.lab.data.api.lessonRequest
import dev.jeromeswannack.chineselearning.lab.data.api.readPhotoWords
import dev.jeromeswannack.chineselearning.lab.data.api.requestLesson
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.data.picturehunt.PhotoPrep
import dev.jeromeswannack.chineselearning.lab.ui.claude.claudeThread
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** "Add a word"'s input methods (analytics `add.word_input` method). */
object AddMethod {
    const val PHOTO = "photo"
    const val TYPE = "type"
    const val SAY_ZH = "say_zh"
    const val SAY_EN = "say_en"
}

/** The photo being read: shown at once, then its Chinese lines (core AddTab order). */
data class PhotoUi(
    val image: ImageBitmap? = null,
    /** reading · done · failed · offline (waiting for a connection). */
    val status: String = "reading",
    val lines: List<AddTab.Line> = emptyList(),
    /** The line moved to the top (a tap on its box in the photo). */
    val focus: Int = 0,
    val error: String? = null,
)

/** "✓ Making your reader… Open ›" (kept while the tab lives). */
data class AddResult(
    val id: String,
    val kind: String,
    val topic: String,
    /** making · ready · failed */
    val status: String,
    val path: String,
    val lessonRequestId: String? = null,
)

/** The content tile's box. */
data class ContentSheetUi(
    val kind: String,
    val text: String = "",
    val format: String = "dialogue",
    val level: String = "beginner",
    val busy: Boolean = false,
    val error: String? = null,
)

data class AddUi(
    val method: String? = null,
    val photo: PhotoUi? = null,
    /** A typed / spoken Chinese line longer than a word: its words to pick from. */
    val typedLine: String? = null,
    val candidates: List<ChineseCandidateDto>? = null,
    val lookupBusy: Boolean = false,
    val lookupError: String? = null,
    val sheet: ContentSheetUi? = null,
    val results: List<AddResult> = emptyList(),
    val offline: Boolean = false,
    /** Each new value: the word box starts over (a different method). */
    val boxKey: Int = 0,
    /**
     * The word box that starts listening as it opens: set ONLY by a tap on 🎤 Say it / 🗣 In English (that tap WAS
     * "say it"), consumed by the box ([AddViewModel.listened]). Opening the tab — or coming back to it with a method
     * still picked — never records: the box waits for a tap on its 🎤 (Jerome, Nov 2026).
     */
    val listenBox: Int? = null,
)

/**
 * The ＋ Add tab (docs/ADD_TAB.md; web pages/AddPage.tsx). A photo is read on the phone first
 * ([DeviceOcr], instant and offline) and by the server when the phone can't or finds no Chinese;
 * typed / spoken Chinese goes to the explorer, English to `POST /api/ai/english-words`; a tile's
 * box creates the thing through its existing endpoint.
 */
class AddViewModel(
    private val app: LabApp,
    private val reader: PhotoReader = DeviceOcr,
) : ViewModel() {
    private val _ui = MutableStateFlow(AddUi(offline = !app.online.value))
    val ui: StateFlow<AddUi> = _ui.asStateFlow()
    private var pendingPhoto: Bitmap? = null
    private var counter = 0

    init {
        app.analytics.track("add.open", emptyMap())
        viewModelScope.launch {
            app.online.collect { online ->
                _ui.update { it.copy(offline = !online) }
                // A photo taken offline that the phone couldn't read: read it now.
                if (online && _ui.value.photo?.status == "offline") pendingPhoto?.let { readOnServer(it, System.currentTimeMillis()) }
            }
        }
    }

    // ---------------- word ----------------

    fun pickMethod(method: String) = _ui.update {
        val box = it.boxKey + 1
        val listen = if (method == AddMethod.SAY_ZH || method == AddMethod.SAY_EN) box else null
        it.copy(method = method, photo = null, typedLine = null, candidates = null, lookupError = null, boxKey = box, listenBox = listen)
    }

    /** The word box started listening for the tap that opened it: never again by itself. */
    fun listened() = _ui.update { it.copy(listenBox = null) }

    fun photo(context: Context, uri: Uri) {
        _ui.update { it.copy(method = AddMethod.PHOTO, photo = PhotoUi(), typedLine = null, candidates = null, lookupError = null, listenBox = null) }
        app.analytics.track("add.word_input", mapOf("method" to AddMethod.PHOTO, "kind" to AddTab.CHINESE))
        viewModelScope.launch {
            val bitmap = withContext(Dispatchers.Default) { runCatching { PhotoPrep.decodeForOcr(context, uri) }.getOrNull() }
            if (bitmap == null) {
                _ui.update { it.copy(photo = PhotoUi(status = "failed", error = "This photo couldn't be opened.")) }
                return@launch
            }
            read(bitmap)
        }
    }

    /** The photo on screen, read on the phone first, then (none found / no recognizer) by the server. */
    internal suspend fun read(bitmap: Bitmap) {
        pendingPhoto = bitmap
        _ui.update { it.copy(photo = PhotoUi(image = bitmap.asImageBitmap(), status = "reading")) }
        val started = System.currentTimeMillis()
        val device = reader.read(bitmap)
        if (!device.isNullOrEmpty()) {
            app.analytics.track("ocr.words", mapOf("found_count" to device.size, "via" to "device", "ms" to System.currentTimeMillis() - started, "ok" to true))
            done(device)
            return
        }
        if (!app.online.value) {
            _ui.update { it.copy(photo = it.photo?.copy(status = if (device == null) "offline" else "done", lines = emptyList())) }
            return
        }
        readOnServer(bitmap, started)
    }

    private suspend fun readOnServer(bitmap: Bitmap, started: Long) {
        _ui.update { it.copy(photo = it.photo?.copy(status = "reading", error = null)) }
        try {
            val jpeg = withContext(Dispatchers.Default) { PhotoPrep.encode(bitmap, AddTab.OCR_MAX_EDGE, AddTab.OCR_JPEG_QUALITY) }
            val res = app.repo.api.readPhotoWords(jpeg)
            val lines = AddTab.orderLines(res.lines.map { AddTab.Line(it.text, it.box, it.main) })
            app.analytics.track("ocr.words", mapOf("found_count" to lines.size, "via" to "server", "ms" to System.currentTimeMillis() - started, "ok" to true))
            done(lines)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            app.analytics.track("ocr.words", mapOf("found_count" to 0, "via" to "server", "ms" to System.currentTimeMillis() - started, "ok" to false))
            _ui.update { it.copy(photo = it.photo?.copy(status = "failed", error = errorText(e, "Couldn't read the photo."))) }
        }
    }

    private fun done(lines: List<AddTab.Line>) {
        pendingPhoto = null
        _ui.update { it.copy(photo = it.photo?.copy(status = "done", lines = lines, focus = 0)) }
    }

    fun retryPhoto() {
        val bitmap = pendingPhoto ?: return
        viewModelScope.launch { read(bitmap) }
    }

    fun focusLine(i: Int) = _ui.update { it.copy(photo = it.photo?.copy(focus = i)) }

    /** Typed / spoken: Chinese → [open] (a word) or its words (a sentence); English / pinyin → candidates. */
    fun submitWord(text: String, open: (String) -> Unit) {
        val t = text.trim()
        val kind = AddTab.classify(t)
        if (kind == AddTab.EMPTY) return
        app.analytics.track("add.word_input", mapOf("method" to (_ui.value.method ?: AddMethod.TYPE), "kind" to kind))
        _ui.update { it.copy(candidates = null, typedLine = null, lookupError = null) }
        if (kind == AddTab.CHINESE) {
            if (AddTab.hanCount(t) <= 4) open(t) else _ui.update { it.copy(typedLine = t) }
            return
        }
        if (!app.online.value) {
            _ui.update { it.copy(lookupError = "Finding the Chinese for English needs a connection.") }
            return
        }
        _ui.update { it.copy(lookupBusy = true) }
        viewModelScope.launch {
            try {
                val words = app.repo.api.englishWords(t)
                _ui.update { it.copy(lookupBusy = false, candidates = words) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(lookupBusy = false, lookupError = errorText(e, "No answer right now — try again.")) }
            }
        }
    }

    // ---------------- content ----------------

    fun openSheet(kind: String) = _ui.update { it.copy(sheet = ContentSheetUi(kind)) }
    fun closeSheet() = _ui.update { it.copy(sheet = null) }
    fun sheetText(text: String) = _ui.update { it.copy(sheet = it.sheet?.copy(text = text, error = null)) }
    fun sheetFormat(format: String) = _ui.update { it.copy(sheet = it.sheet?.copy(format = format)) }
    fun sheetLevel(level: String) = _ui.update { it.copy(sheet = it.sheet?.copy(level = level)) }

    /** Create the tile's thing; [openThread] = "Just ask" (a Claude thread, opened at once). */
    fun create(text: String, spoken: Boolean, openThread: (String) -> Unit) {
        val sheet = _ui.value.sheet ?: return
        val t = text.trim()
        if (!AddTab.ready(sheet.kind, t, sheet.format) || sheet.busy) return
        if (!app.online.value) {
            _ui.update { it.copy(sheet = it.sheet?.copy(error = "This needs a connection — try again when you’re online.")) }
            return
        }
        _ui.update { it.copy(sheet = it.sheet?.copy(busy = true, error = null, text = t)) }
        val props = buildMap<String, Any?> {
            put("kind", sheet.kind)
            put("spoken", spoken)
            if (sheet.kind == AddTab.AUDIO) put("format", sheet.format)
        }
        viewModelScope.launch {
            try {
                val api = app.repo.api
                var status = "making"
                var requestId: String? = null
                val path: String = when (sheet.kind) {
                    AddTab.READER -> {
                        val deckIds = withContext(Dispatchers.IO) { app.repo.dao.decks().map { it.id } }
                        Routes.reader(api.generateReader(GenerateReaderBody(deckIds = deckIds, topic = t, difficulty = sheet.level)).id)
                    }
                    AddTab.LESSON -> {
                        val req = api.requestLesson(t)
                        requestId = req.id
                        if (req.status == "ready") status = "ready"
                        req.lessonId?.let { Routes.lessonPlay(it) } ?: LESSONS
                    }
                    AddTab.AUDIO -> {
                        val body = if (sheet.format == "dialogue") NewAudioLessonBody(format = "dialogue", description = t) else NewAudioLessonBody(format = sheet.format, text = t)
                        Routes.audioLesson(api.createAudioLesson(body).lesson.id)
                    }
                    AddTab.CLIPS -> api.generateClips(t, 1).firstOrNull()?.let { Routes.clip(it.id) } ?: "/clips"
                    AddTab.PICTURE_HUNT -> Routes.pictureHunt(api.createPictureHunt(NewPictureHuntBody(prompt = t)).id)
                    AddTab.DECK -> {
                        status = "ready"
                        Routes.deck(api.generateDeck(t, null).deck.id)
                    }
                    else -> {
                        val language = app.prefs.askClaudeLanguage
                        val res = ClaudeThreads.of(app).start(ClaudeContextDto(ClaudeChats.GENERAL), t, "ask", language, true)
                        app.analytics.track("add.content_request", props + mapOf("ok" to true))
                        app.analytics.track("claude.message_send", mapOf("context_kind" to ClaudeChats.GENERAL, "intent" to "ask", "offline" to res.queued, "chip" to false, "spoken" to spoken))
                        _ui.update { it.copy(sheet = null) }
                        openThread(Routes.claudeThread(res.threadId) + "?source=add")
                        return@launch
                    }
                }
                app.analytics.track("add.content_request", props + mapOf("ok" to true))
                app.haptics.tick()
                val result = AddResult("r${++counter}-${System.currentTimeMillis()}", sheet.kind, t.take(60), status, path, requestId)
                _ui.update { it.copy(sheet = null, results = (listOf(result) + it.results).take(6)) }
                if (requestId != null && status == "making") pollLesson(result)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                app.analytics.track("add.content_request", props + mapOf("ok" to false))
                _ui.update { it.copy(sheet = it.sheet?.copy(busy = false, error = errorText(e, AddTab.resultLine(sheet.kind, "failed")))) }
            }
        }
    }

    /** A mini lesson is written in the background: ask every 3 s until it is ready (or failed). */
    private fun pollLesson(result: AddResult) {
        val id = result.lessonRequestId ?: return
        viewModelScope.launch {
            repeat(200) {
                delay(3_000)
                val req = runCatching { app.repo.api.lessonRequest(id) }.getOrNull() ?: return@repeat
                if (req.status == "generating") return@repeat
                _ui.update { s ->
                    s.copy(results = s.results.map { r ->
                        if (r.id != result.id) r else r.copy(status = if (req.status == "ready") "ready" else "failed", path = req.lessonId?.let { Routes.lessonPlay(it) } ?: LESSONS)
                    })
                }
                return@launch
            }
        }
    }

    companion object {
        const val LESSONS = "/lessons"

        fun errorText(e: Exception, fallback: String): String {
            val raw = (e as? HttpException)?.body ?: return fallback
            val msg = Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(raw)?.groupValues?.get(1)
            return msg?.takeIf { it.isNotBlank() } ?: fallback
        }
    }
}
