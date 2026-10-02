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
    // 📎: the photo picker (no permission) or the camera into a FileProvider uri (cache/shared/).
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.preparePhoto(context, uri)
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
            onGenerateCard = vm::generateCard,
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
                onTool = vm::onTool,
                onReact = vm::react,
                onSaveCards = { cards, deck, new -> vm.saveCards(cards, deck, new) },
                onTogglePin = vm::togglePin,
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
                onSendPhoto = vm::sendPhoto,
                onDiscardPhoto = vm::discardPhoto,
                onJump = vm::jumpTo,
                loadLocalImage = vm::localImage,
            ),
        )
    }
}
