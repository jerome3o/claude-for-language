package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.connections.factory
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * `/connections/:relId/chat/:convId` (immersive) — `?new=1` or `chat/new` opens a fresh untitled
 * conversation first (web: ChatPage `wantsNew`). Package E.
 */
fun NavGraphBuilder.chatGraph(nav: LabNav) {
    composable(
        Routes.route("/connections/{relId}/chat/{convId}?new={new}"),
        arguments = listOf(navArgument("new") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val convId = entry.arguments?.getString("convId").orEmpty()
        val wantsNew = convId == "new" || entry.arguments?.getString("new") == "1"
        if (wantsNew) NewConversation(nav, relId) else ChatRoute(nav, relId, convId)
    }
}

@Composable
private fun NewConversation(nav: LabNav, relId: String) {
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(relId) {
        runCatching { ChatViewModel.newConversation(nav.app, relId) }
            .onSuccess { id -> nav.back(); nav.open(Routes.chat(relId, id)) }
            .onFailure { error = "Couldn't start a new conversation. ${it.userMessage()}" }
    }
    LabScreen("New conversation", onBack = nav::back) {
        item { if (error != null) ErrorState(error!!) else LoadingState(text = "Starting a new conversation...") }
    }
}

@Composable
private fun ChatRoute(nav: LabNav, relId: String, convId: String) {
    val vm: ChatViewModel = viewModel(key = "chat-$convId", factory = factory { ChatViewModel(nav.app, relId, convId) })
    val ui by vm.ui.collectAsStateWithLifecycle()
    // No notification for the chat on screen (data/chat/ChatPresence.kt).
    DisposableEffect(convId) {
        dev.jeromeswannack.chineselearning.lab.data.chat.ChatPresence.chatOpened(convId)
        onDispose { dev.jeromeswannack.chineselearning.lab.data.chat.ChatPresence.chatClosed(convId) }
    }
    val context = androidx.compose.ui.platform.LocalContext.current
    // +: the photo picker (several at once, round 2 PR 3; no permission) or the camera into a FileProvider uri (cache/shared/).
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia(dev.jeromeswannack.chineselearning.lab.data.chat.ChatPhoto.MAX_PHOTOS),
    ) { uris -> if (uris.isNotEmpty()) vm.preparePhotos(context, uris) }
    // A video clip from the same picker; a document from the system file picker (the server's types).
    val videoPicker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.sendVideo(context, uri)
    }
    val filePicker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.sendFile(context, uri)
    }
    // Opens a downloaded file in another app (ACTION_VIEW through the FileProvider); none → Share / Save a copy.
    fun openFile(f: java.io.File, mime: String) {
        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", f)
        val view = android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { context.startActivity(view) } catch (e: android.content.ActivityNotFoundException) { vm.openSheet(ChatSheet.FileFallback(f.absolutePath, f.name, mime)) }
    }
    var saving by remember { mutableStateOf<String?>(null) }
    val saveCopy = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("*/*")) { dest ->
        val src = saving
        saving = null
        if (dest != null && src != null) runCatching {
            context.contentResolver.openOutputStream(dest)?.use { out -> java.io.File(src).inputStream().use { it.copyTo(out) } }
        }.onSuccess { nav.app.haptics.tick() }
    }
    var cameraUri by remember { mutableStateOf<android.net.Uri?>(null) }
    val camera = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.TakePicture()) { ok ->
        cameraUri?.let { if (ok) vm.preparePhoto(context, it) }
    }
    fun launchCamera() {
        val dir = java.io.File(context.cacheDir, "shared").apply { mkdirs() }
        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", java.io.File(dir, "chat-camera-${System.currentTimeMillis()}.jpg"))
        cameraUri = uri
        vm.openSheet(null)
        runCatching { camera.launch(uri) }
    }
    val cameraPermission = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { granted -> if (granted) launchCamera() }
    // Granted: the next press records (a recording never starts by itself).
    val micPermission = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    fun has(p: String) = androidx.core.content.ContextCompat.checkSelfPermission(context, p) == android.content.pm.PackageManager.PERMISSION_GRANTED
    val call = dev.jeromeswannack.chineselearning.lab.ui.calls.relationshipCallBanner(nav, relId, Routes.chat(relId, convId))
    val wordActions = rememberChatWordActions(nav.app)
    ChatScreen(
        ui,
        ChatActions(
            onBack = nav::back,
            onDraft = vm::setDraft,
            onSend = vm::send,
            onReply = vm::reply,
            onPlay = vm::play,
            onOpenSheet = vm::openSheet,
            onReact = vm::react,
            onViewCheck = vm::viewCheck,
            onWord = vm::openWord,
            onDismissNotice = vm::dismissNotice,
            onJoinCall = { nav.open(Routes.call(it)) },
            onRetry = { nav.back(); nav.open(Routes.chat(relId, convId)) },
            onRetryPending = vm::retryPending,
            onDiscardPending = vm::discardPending,
            onCancelEdit = vm::cancelEdit,
            onOpenSearch = vm::openSearch,
            onSearchQuery = vm::setSearchQuery,
            onSearchStep = vm::searchStep,
            onCloseSearch = vm::closeSearch,
            onJumpTo = vm::jumpTo,
            onAtBottom = vm::setAtBottom,
            onScrollToEnd = vm::scrollToEnd,
            onRecordStart = { locked ->
                if (has(android.Manifest.permission.RECORD_AUDIO)) { vm.startRecording(locked); true }
                else { micPermission.launch(android.Manifest.permission.RECORD_AUDIO); false }
            },
            onRecordLock = vm::lockRecording,
            onRecordCancel = vm::cancelRecording,
            onRecordFinish = vm::finishRecording,
            onRecordSend = vm::sendRecording,
            onToggleVoice = vm::toggleVoice,
            onToggleTranslation = vm::toggleTranslation,
            loadImage = vm::image,
            loadLocalImage = vm::localImage,
            onRequestWords = vm::requestWords,
            onChip = vm::openChip,
            onTogglePinyin = vm::togglePinyin,
            onStartSelecting = { vm.startSelecting() },
            onCancelSelecting = vm::cancelSelecting,
            onToggleSelect = vm::toggleSelect,
            onSelectToday = vm::selectToday,
            onSelectLast = vm::selectLast,
            onPropose = vm::proposeSelected,
            onCorrectionCard = vm::proposeCorrection,
            onCheckDraft = vm::checkDraft,
            onUseCheck = vm::useCheck,
            onSendAsIs = vm::sendAsIs,
            onDismissCheck = vm::dismissCheck,
            onRecordSendNow = vm::sendRecordingNow,
            onToggleTime = vm::toggleTime,
            onVideoCall = { vm.videoCall { id -> nav.open(Routes.call(id)) } },
            onOpenLink = { url -> runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) } },
            onRequestLinkPreview = vm::requestLinkPreview,
            loadLinkImage = vm::linkImage,
            onRequestWaveform = vm::requestWaveform,
            onCycleSpeed = vm::cycleSpeed,
            onCopySelection = vm::copySelection,
            onForwardSelection = vm::forwardSelection,
            onOpenFile = { m -> vm.openFile(m, ::openFile) },
            onOpenPendingFile = { p -> vm.openPendingFile(p, ::openFile) },
            onToggleVideo = vm::toggleVideo,
            loadVideo = vm::videoFile,
            loadPoster = vm::poster,
            onListen = vm.listening::tap,
            onReveal = vm.listening::reveal,
            onListeningSlow = vm.listening::toggleSlow,
        ),
        callBanner = call?.let { b ->
            {
                dev.jeromeswannack.chineselearning.lab.ui.calls.InlineCallBanner(b.callId, b.title, b.kind == dev.jeromeswannack.chineselearning.lab.core.calls.CallAlerts.Kind.INCOMING) {
                    nav.app.callAlerts.stopRinging(); nav.open(b.url)
                }
            }
        },
    ) {
        ChatSheetHost(
            ui,
            ChatSheetActions(
                onDismiss = { vm.openSheet(null) },
                onReact = vm::react,
                onSaveCards = { cards, deck, new -> vm.saveCards(cards, deck, new) },
                onHelpMeSayIt = vm::helpMeSayIt,
                onToggleOption = vm::toggleOption,
                onRename = vm::rename,
                onVoice = { vm.setVoice(voiceId = it) },
                onSpeed = { vm.setVoice(speed = it) },
                onNewConversation = { vm.openSheet(null); nav.open(Routes.chat(relId, "new")) },
                onOpenRename = { vm.openSheet(ChatSheet.Rename) },
                onOpenVoice = { vm.openSheet(ChatSheet.Voice) },
                onAllConversations = { vm.openSheet(null); nav.back() },
                onAsk = vm::ask,
                onToggleDiscussCard = vm::toggleDiscussCard,
                onSaveDiscussCards = vm::saveDiscussCards,
                define = vm::define,
                deckHolding = vm::deckHolding,
                onEdit = vm::startEdit,
                onAskDelete = vm::askDelete,
                onDelete = vm::delete,
                onPin = vm::setPinned,
                onCamera = {
                    // CAMERA is declared (video calls), so TakePicture needs it granted.
                    if (has(android.Manifest.permission.CAMERA)) launchCamera() else cameraPermission.launch(android.Manifest.permission.CAMERA)
                },
                onGallery = { vm.openSheet(null); picker.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                onVideo = { vm.openSheet(null); videoPicker.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.VideoOnly)) },
                onFile = {
                    vm.openSheet(null)
                    runCatching { filePicker.launch(dev.jeromeswannack.chineselearning.lab.core.ChatFiles.FILE_TYPES.values.distinct().toTypedArray()) }
                },
                onRemovePhoto = vm::removePhoto,
                onForwardTo = vm::forwardTo,
                onCloseForward = vm::closeForward,
                onShareFile = { path, name, mime ->
                    vm.openSheet(null)
                    val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", java.io.File(path))
                    val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType(mime).putExtra(android.content.Intent.EXTRA_STREAM, uri).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    runCatching { context.startActivity(android.content.Intent.createChooser(send, name)) }
                },
                onSaveFile = { path, name, _ -> vm.openSheet(null); saving = path; runCatching { saveCopy.launch(name) } },
                onSendPhoto = vm::sendPhoto,
                onDiscardPhoto = vm::discardPhoto,
                onJump = vm::jumpTo,
                loadLocalImage = vm::localImage,
                wordActions = wordActions,
                onWordAdded = vm::wordAdded,
                onMakeFlashcards = { vm.startSelecting() },
                onPinyinAll = vm::setPinyinAll,
                onTranslationAll = vm::setTranslationAll,
                review = ReviewActions(
                    onClose = vm::closeReview,
                    onToggle = vm::reviewToggle,
                    onEdit = vm::reviewEdit,
                    onOpenEdit = vm::reviewOpenEdit,
                    onPickDeck = vm::reviewPickDeck,
                    onNewDeck = vm::reviewNewDeck,
                    onSave = vm::saveReview,
                ),
                onSaveCorrection = vm::saveCorrection,
                onRemoveCorrection = vm::removeCorrection,
                onMenuAction = vm::onMenuAction,
                cards = rememberChatCardActions(nav.app),
                onRetryExplain = vm::retryExplain,
                onCloseExplain = vm::closeExplain,
                onOpenSearch = vm::openSearch,
                onOpenHelp = { vm.openSheet(ChatSheet.HelpMeSayIt) },
                onToggleListening = vm.listening::toggle,
                onHideAll = vm.listening::hideAll,
            ),
        )
    }
}

/**
 * The reader word sheet's actions for a chat word chip (docs/CHAT.md PR 3): ▶ through the shared
 * TTS, "More about this word" cache-first (`/api/reader-words/explain`), + Add as card with the
 * deck picker and duplicate warning.
 */
@Composable
private fun rememberChatWordActions(app: dev.jeromeswannack.chineselearning.lab.LabApp): dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordActions {
    val runtime = remember(app) { dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime.of(app) }
    val tools = remember(app) { dev.jeromeswannack.chineselearning.lab.ui.study.CardTools(app) }
    DisposableEffect(Unit) { onDispose { runtime.audio.stop() } }
    return remember(app) {
        dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordActions(
            online = { app.online.value },
            play = { text -> runtime.audio.speak(text) },
            cachedExplanation = { word, s -> runtime.readers.cachedExplanation(word.text, s) },
            explain = { word, s -> runtime.readers.explainWord(word.text, s, word.pinyin, word.gloss) },
            decks = {
                // Queue order: the top deck first and preselected (PickerDecks, = the web's decksInQueueOrder).
                dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { app.repo.dao.decks() }, { it.studyPriority }, { it.createdAt })
                    .map { dev.jeromeswannack.chineselearning.lab.ui.readers.DeckChoice(it.id, it.name, it.description) }
            },
            isDuplicate = { deckId, hanzi -> tools.deckHas(deckId, hanzi) },
            add = { deckId, word, ex -> tools.addNote(deckId, dev.jeromeswannack.chineselearning.lab.ui.readers.readerWordNote(word, ex)) },
        )
    }
}

/**
 * Explain / Save as flashcard add cards like the Coach's Explain: the same AddChunkSheet calls
 * (deck chips, duplicate warning, `POST /api/decks/:id/notes`).
 */
@Composable
private fun rememberChatCardActions(app: dev.jeromeswannack.chineselearning.lab.LabApp): dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions = remember(app) {
    val tools = dev.jeromeswannack.chineselearning.lab.ui.study.CardTools(app)
    dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions(
        decks = {
            // Queue order: the top deck first and preselected (nothing remembered between sheets).
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt })
                    .map { it.id to it.name }
            }
        },
        deckHas = tools::deckHas,
        addCard = { deckId, c -> tools.addNote(deckId, dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody(c.hanzi, c.pinyin, c.english, c.funFacts)) },
    )
}
