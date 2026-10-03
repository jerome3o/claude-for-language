package dev.jeromeswannack.chineselearning.lab.ui.picturehunt

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewPictureHuntBody
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto
import dev.jeromeswannack.chineselearning.lab.data.api.createPictureHunt
import dev.jeromeswannack.chineselearning.lab.data.api.pictureHunts
import dev.jeromeswannack.chineselearning.lab.data.api.retryPictureHunt
import dev.jeromeswannack.chineselearning.lab.data.api.uploadPictureHunt
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.picturehunt.PhotoPrep
import dev.jeromeswannack.chineselearning.lab.data.picturehunt.PictureHuntStore
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.core.HuntObject
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.quests.QuestSpeech
import dev.jeromeswannack.chineselearning.lab.ui.readers.AddWordActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.AddWordSheet
import dev.jeromeswannack.chineselearning.lab.ui.readers.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** `/picture-hunt` and `/picture-hunt/:id` (package H). Play is immersive (NavRules) — no tab bar. */
fun NavGraphBuilder.pictureHuntGraph(nav: LabNav) {
    composable(Routes.route("/picture-hunt")) {
        val vm: PictureHuntsViewModel = viewModel(factory = PictureHuntsViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val context = LocalContext.current
        val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.pickPhoto(context, uri) }
        var cameraUri by remember { mutableStateOf<Uri?>(null) }
        val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> cameraUri?.let { if (ok) vm.pickPhoto(context, it, "Camera photo") } }
        val launchCamera = {
            val uri = cameraFileUri(context)
            cameraUri = uri
            camera.launch(uri)
        }
        // The app declares CAMERA (video calls), so the capture intent needs it granted first.
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) launchCamera() }
        PictureHuntsScreen(
            ui,
            PictureHuntsActions(
                onBack = nav::back,
                onMode = vm::setMode,
                onPrompt = vm::setPrompt,
                onUseWords = vm::setUseWords,
                onPickPhoto = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                onTakePhoto = {
                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCamera()
                    else permission.launch(Manifest.permission.CAMERA)
                },
                onCaption = vm::setCaption,
                onStart = { vm.start(context) },
                onOpen = { nav.open(Routes.pictureHunt(it)) },
                onRetry = vm::retry,
                onDelete = vm::delete,
                onRefresh = vm::refresh,
            ),
        )
    }
    composable(Routes.route("/picture-hunt/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val app = nav.app
        val vm: PictureHuntPlayViewModel = viewModel(key = "picture-hunt-$id", factory = PictureHuntPlayViewModel.Factory(app, id))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val speech = remember { QuestSpeech(app) }
        DisposableEffect(Unit) { onDispose { speech.release() } }
        var adding by remember { mutableStateOf<HuntObject?>(null) }
        PictureHuntPlayScreen(
            ui,
            PictureHuntPlayActions(
                onClose = nav::back,
                onInput = vm::input,
                onSubmit = vm::submit,
                onHint = vm::hint,
                onGiveUp = vm::giveUp,
                onPlayAgain = vm::playAgain,
                onInspect = vm::inspect,
                onSpeak = { speech.speak(it) },
                onAddCard = { adding = it; vm.inspect(null) },
            ),
        )
        adding?.let { obj ->
            val tools = remember(app) { CardTools(app) }
            AddWordSheet(
                SentenceChunkDto(hanzi = obj.hanzi, pinyin = obj.pinyin, english = obj.english),
                AddWordActions(
                    decks = { app.repo.dao.decks().sortedBy { it.name.lowercase() }.map { DeckChoice(it.id, it.name, it.description) } },
                    isDuplicate = { deckId, hanzi -> tools.deckHas(deckId, hanzi) },
                    add = { deckId, _ -> tools.addNote(deckId, huntNoteBody(obj)) },
                ),
                onDismiss = { adding = null },
                onAdded = { app.haptics.correct() },
            )
        }
    }
}

/** The web's AddChunkModal body for an object: the card-standard fields it carries (clue fields only with a clue). */
fun huntNoteBody(obj: HuntObject): NewNoteBody {
    val clue = obj.sentenceClue?.takeIf { it.isNotEmpty() }
    return NewNoteBody(
        hanzi = obj.hanzi,
        pinyin = obj.pinyin,
        english = obj.english,
        fun_facts = obj.funFacts?.takeIf { it.isNotEmpty() },
        sentence_clue = clue,
        sentence_clue_pinyin = clue?.let { obj.sentenceCluePinyin },
        sentence_clue_translation = clue?.let { obj.sentenceClueTranslation },
    )
}

private fun cameraFileUri(context: Context): Uri {
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    val file = File(dir, "picture-hunt-camera.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

/** A small, downsampled bitmap of a picture file (list thumbnails, the play screen). */
internal fun decodeScaled(file: File, maxSide: Int): ImageBitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}.getOrNull()

class PictureHuntsViewModel(private val app: LabApp) : ViewModel() {
    private val store = PictureHuntStore(app.cache, app.outbox, app.repo.api, app.filesDir)
    private val list = app.cachedResource<List<PictureHuntDto>>(viewModelScope, PictureHuntStore.LIST_KEY, PictureHuntStore.KIND) {
        val hunts = pictureHunts()
        store.storeList(hunts)
        hunts.map { it.copy(objects = null) }
    }
    private val form = MutableStateFlow(PictureHuntsUi())
    private var photoUri: Uri? = null
    private val thumbs = MutableStateFlow<Map<String, ImageBitmap>>(emptyMap())
    private val thumbJobs = HashSet<String>()

    val ui: StateFlow<PictureHuntsUi> = combine(list.state, form, thumbs, app.online) { l, f, t, online -> f.copy(hunts = l, thumbs = t, online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, PictureHuntsUi())

    init {
        // Hunts are built in the background; keep the list moving while any are.
        viewModelScope.launch {
            while (isActive) {
                delay(4000)
                if (list.state.value.data.orEmpty().any { it.status == "generating" } && app.online.value) list.refresh()
            }
        }
        // Thumbnails (and the offline copy of each ready hunt) as the list arrives.
        viewModelScope.launch {
            list.state.collect { l -> l.data?.let { loadThumbs(it) } }
        }
    }

    private fun loadThumbs(hunts: List<PictureHuntDto>) {
        for (h in hunts) {
            if (h.id in thumbs.value || h.id in thumbJobs) continue
            if (h.status != "ready" && h.source != "upload") continue
            thumbJobs += h.id
            viewModelScope.launch {
                val file = store.image(h.id, app.online.value)
                val bmp = file?.let { withContext(Dispatchers.IO) { decodeScaled(it, 192) } }
                if (bmp != null) thumbs.update { it + (h.id to bmp) } else thumbJobs -= h.id
                // Cache the objects too, so it plays offline without opening it first.
                if (h.status == "ready" && store.cachedHunt(h.id)?.objects == null && app.online.value) runCatching { store.load(h.id, online = true) }
            }
        }
    }

    fun refresh() { list.refresh() }
    fun setMode(m: HuntSourceMode) = form.update { it.copy(mode = m, error = null) }
    fun setPrompt(p: String) = form.update { it.copy(prompt = p) }
    fun setUseWords(v: Boolean) = form.update { it.copy(useWords = v) }
    fun setCaption(c: String) = form.update { it.copy(caption = c) }

    fun pickPhoto(context: Context, uri: Uri, name: String? = null) {
        photoUri = uri
        form.update { it.copy(photo = PickedPhoto(name ?: displayName(context, uri) ?: "Photo"), error = null) }
        viewModelScope.launch {
            val preview = withContext(Dispatchers.IO) {
                runCatching {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 160) sample *= 2
                    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }?.asImageBitmap()
                }.getOrNull()
            }
            form.update { f -> if (f.photo != null) f.copy(photo = f.photo.copy(preview = preview)) else f }
        }
    }

    private fun displayName(context: Context, uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull()

    fun start(context: Context) {
        val f = form.value
        if (!f.canStart) return
        form.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val hunt = if (f.mode == HuntSourceMode.GENERATE) {
                    app.repo.api.createPictureHunt(NewPictureHuntBody(f.prompt.trim(), use_learning_words = f.useWords))
                } else {
                    val uri = photoUri ?: throw IllegalStateException("Choose a photo first")
                    val jpeg = withContext(Dispatchers.Default) { PhotoPrep.prepare(context, uri) }
                    app.repo.api.uploadPictureHunt(jpeg, f.caption)
                }
                store.upsertSummary(hunt)
                app.analytics.track("picture_hunt.create", mapOf("source" to if (f.mode == HuntSourceMode.GENERATE) "generated" else "upload"))
                app.haptics.tick()
                photoUri = null
                form.update { it.copy(busy = false, prompt = "", photo = null, caption = "") }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                form.update { it.copy(busy = false, error = if (e is IllegalArgumentException || e is IllegalStateException) e.message else e.userMessage()) }
            }
        }
    }

    fun retry(id: String) = busy(id) {
        val hunt = app.repo.api.retryPictureHunt(id)
        store.upsertSummary(hunt)
        list.refresh()
    }

    fun delete(id: String) = busy(id) {
        store.delete(id)
        thumbs.update { it - id }
    }

    private fun busy(id: String, block: suspend () -> Unit) {
        form.update { it.copy(busyId = id, error = null) }
        viewModelScope.launch {
            try {
                block()
                form.update { it.copy(busyId = null) }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                form.update { it.copy(busyId = null, error = e.userMessage()) }
            }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = PictureHuntsViewModel(app) as T
    }
}

class PictureHuntPlayViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val store = PictureHuntStore(app.cache, app.outbox, app.repo.api, app.filesDir)
    private val screen = MutableStateFlow(PictureHuntPlayUi(loading = true))
    private var game: PictureHuntGame? = null
    private var gameJob: Job? = null

    val ui: StateFlow<PictureHuntPlayUi> = combine(screen, app.online) { s, online -> s.copy(online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, PictureHuntPlayUi(loading = true))

    init {
        viewModelScope.launch { load() }
        viewModelScope.launch {
            while (isActive) {
                delay(500)
                game?.tick()
            }
        }
    }

    private suspend fun load() {
        val online = app.online.value
        val hunt = try {
            store.load(id, online)
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            screen.update { it.copy(loading = false, loadError = e.userMessage()) }
            return
        }
        val objects = hunt?.objects
        if (hunt == null || hunt.status != "ready" || objects.isNullOrEmpty()) {
            screen.update {
                it.copy(loading = false, loadError = if (online) "This hunt isn't ready yet." else "This hunt isn't on this device yet — open it once while online.")
            }
            return
        }
        val aspect = if ((hunt.image_width ?: 0) > 0 && (hunt.image_height ?: 0) > 0) hunt.image_width!!.toFloat() / hunt.image_height!! else 4f / 3f
        screen.update { it.copy(loading = false, title = hunt.title, objects = objects, aspect = aspect) }
        startGame(hunt.id, objects, hunt.best_found)
        val file = store.image(id, online)
        val bmp = file?.let { withContext(Dispatchers.IO) { decodeScaled(it, 2048) } }
        if (bmp != null) {
            screen.update { s -> s.copy(image = bmp, aspect = if (hunt.image_width == null) bmp.width.toFloat() / bmp.height else s.aspect) }
        }
    }

    private fun startGame(huntId: String, objects: List<HuntObject>, best: Int?) {
        val g = PictureHuntGame(
            huntId,
            objects,
            best,
            fx = object : HuntFx {
                override fun found() { app.haptics.correct(); app.sounds.play(Sounds.Sfx.CORRECT) }
                override fun miss() { app.haptics.wrong() }
                override fun hint() { app.haptics.tick(); app.sounds.play(Sounds.Sfx.POP, 0.5f) }
                override fun allFound() { app.haptics.celebrate(); app.sounds.play(Sounds.Sfx.FANFARE) }
            },
            schedule = { ms, block -> viewModelScope.launch { delay(ms); block() } },
            onPlay = { play -> app.scope.launch { recordPlay(play) } },
        )
        game = g
        gameJob?.cancel()
        gameJob = viewModelScope.launch { g.state.collect { s -> screen.update { it.copy(state = s) } } }
    }

    private suspend fun recordPlay(play: dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntPlayDto) {
        app.analytics.track("picture_hunt.play_done", mapOf("found" to play.found_ids.size, "total" to play.total, "gave_up" to play.gave_up))
        runCatching { store.recordPlay(play) }
        app.scheduleBackgroundUpload()
        if (app.online.value) runCatching { app.outbox.drain() }
    }

    fun input(v: TextFieldValue) {
        // Every committed value is checked (not while the IME is still composing).
        if (v.composition == null && game?.autoCheck(v.text) == true) {
            screen.update { it.copy(input = TextFieldValue("")) }
            return
        }
        screen.update { it.copy(input = v) }
    }

    fun submit() {
        val g = game ?: return
        val text = screen.value.input.text
        when (g.submit(text)) {
            InputAfter.CLEAR -> screen.update { it.copy(input = TextFieldValue("")) }
            InputAfter.SELECT -> screen.update { it.copy(input = TextFieldValue(text, TextRange(0, text.length))) }
            InputAfter.KEEP -> {}
        }
    }

    fun hint() { game?.hint() }
    fun giveUp() { game?.giveUp() }

    fun playAgain() {
        val g = game ?: return
        g.playAgain(g.state.value.best.takeIf { it > 0 } ?: g.state.value.bestBefore)
        screen.update { it.copy(input = TextFieldValue(""), inspect = null) }
    }

    fun inspect(obj: HuntObject?) = screen.update { it.copy(inspect = obj) }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = PictureHuntPlayViewModel(app, id) as T
    }
}
