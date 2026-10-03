package dev.jeromeswannack.chineselearning.lab.ui.calls

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.provider.Settings
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.CallDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.endCall
import dev.jeromeswannack.chineselearning.lab.data.api.getCall
import dev.jeromeswannack.chineselearning.lab.data.api.joinCall
import dev.jeromeswannack.chineselearning.lab.data.api.explainSentenceText
import dev.jeromeswannack.chineselearning.lab.data.calls.AudioRoute
import dev.jeromeswannack.chineselearning.lab.data.calls.CallAudio
import dev.jeromeswannack.chineselearning.lab.data.calls.CallRoomSocket
import dev.jeromeswannack.chineselearning.lab.data.calls.CallService
import dev.jeromeswannack.chineselearning.lab.data.calls.CallUploads
import dev.jeromeswannack.chineselearning.lab.data.calls.MicRecorder
import dev.jeromeswannack.chineselearning.lab.data.calls.rtc.WebRtcMedia
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import org.webrtc.VideoTrack

/**
 * Owns one call for as long as its screen is on the back stack: the WebRTC media, the room, the
 * recorder, the audio routing and the foreground service. A ViewModel, so rotating or unfolding the
 * Fold keeps the call going (only the video views are rebuilt).
 */
class CallViewModel(private val app: LabApp, val callId: String) : ViewModel() {
    val detail: CachedResource<CallDetailDto> = app.cachedResource(viewModelScope, CallsKeys.detail(callId), CallsKeys.KIND, maxAgeMs = 30_000) { getCall(callId) }
    val media = WebRtcMedia(app)
    private val uploads = CallUploads(app.outbox, app.cache)
    val audio = CallAudio(app)
    private val _myId = MutableStateFlow("")
    val myId: StateFlow<String> = _myId.asStateFlow()
    /** The tile layout, remembered per user on this phone (web localStorage `call-layout-v1:<userId>`). */
    val layout = CallLayoutHolder(PrefsCallLayoutStore(app.getSharedPreferences("lab-calls", Context.MODE_PRIVATE)))
    /** In-call activities: Chinese said on this phone (cache-first `/api/practice/tts`, the device voice offline). */
    val speaker = dev.jeromeswannack.chineselearning.lab.ui.editor.LessonSpeaker(app, viewModelScope)

    val controller: CallController = CallController(
        callId, "",
        CallDeps(
            openRoom = { handlers, instance -> CallRoomSocket({ app.repo.api.joinCall(callId) }, app.repo.api.http, app.repo.api.baseUrl, handlers, viewModelScope, instance = instance) },
            media = media,
            recorder = MicRecorder(callId, uploads, media.mic),
            endCall = { app.repo.api.endCall(callId) },
            drainUploads = { if (app.online.value) uploads.drain() },
            closeOrphans = { uploads.closeOrphans(callId) },
            keepAlive = { on ->
                if (on) { CallUploads.activeCallId = callId; CallService.onAppRemoved = { controller.leaveNow() }; CallService.start(app, callId); audio.start() }
                else { audio.stop(); CallService.onAppRemoved = null; CallService.stop(app); if (CallUploads.activeCallId == callId) CallUploads.activeCallId = null; app.scheduleBackgroundUpload() }
            },
            prepareScreenShare = { CallService.prepareScreenShare(app, callId) },
            teardown = app.scope,
            userId = { _myId.value },
            devicePrefs = dev.jeromeswannack.chineselearning.lab.data.calls.CallDevicePrefsStore(app.getSharedPreferences("lab-calls", Context.MODE_PRIVATE)),
            device = "Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL}; Lab app",
            speak = { text -> speaker.speak(text) },
        ),
        viewModelScope,
    )

    // Wi-Fi ↔ mobile: the room socket is reconnected at once instead of waiting for the pong watchdog.
    private val connectivity = app.getSystemService(ConnectivityManager::class.java)
    private var network: Network? = null
    private var networkKnown = false
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: Network) {
            viewModelScope.launch {
                if (networkKnown && n != network) controller.networkChanged(if (network == null) "back online" else "switched network")
                network = n
                networkKnown = true
            }
        }

        override fun onLost(n: Network) {
            viewModelScope.launch { if (n == network) network = null }
        }
    }

    init {
        viewModelScope.launch {
            _myId.value = Connections.myId(app.cache) ?: runCatching { app.repo.api.me().id }.getOrNull().orEmpty()
            layout.bind(_myId.value)
        }
        viewModelScope.launch { uploads.pending(callId).collect { controller.setPendingUploads(it) } }
        runCatching { connectivity?.registerDefaultNetworkCallback(networkCallback) }
    }

    fun selectRoute(r: AudioRoute) = audio.choose(r)

    /** Round 4 PR 5: lesson materials in the call — the material tile's pages and the "📑 Present material" sheet. */
    val materials = dev.jeromeswannack.chineselearning.lab.ui.materials.CallMaterials(app, viewModelScope)

    /**
     * While I share my screen: the drawings on it (theirs and my own, kept or fading) over every other
     * app. Driven from here, not the composition, so it keeps updating while another app is in front;
     * hidden while the call screen is in the foreground (its screen tile shows them there).
     */
    val overlay = dev.jeromeswannack.chineselearning.lab.data.calls.ScreenAnnotationOverlay(app)
    val overlayWanted = MutableStateFlow(true)
    val foreground = MutableStateFlow(true)

    init {
        viewModelScope.launch {
            kotlinx.coroutines.flow.combine(controller.state, overlayWanted, foreground) { s, want, fg ->
                if (want && !fg && s.sharingScreen) s.annotations else null
            }.distinctUntilChanged().collect { a ->
                if (a == null || !overlay.permitted()) overlay.hide() else { overlay.show(); overlay.update(a) }
            }
        }
    }

    override fun onCleared() {
        overlay.hide()
        runCatching { connectivity?.unregisterNetworkCallback(networkCallback) }
        controller.dispose()
        speaker.stop()
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CallViewModel(app, id) as T
    }
}

private fun Context.granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is android.content.ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
fun CallRoute(nav: LabNav, id: String) {
    val vm: CallViewModel = viewModel(key = "call-$id", factory = CallViewModel.Factory(nav.app, id))
    val s by vm.controller.state.collectAsStateWithLifecycle()
    val detail by vm.detail.state.collectAsStateWithLifecycle()
    val myId by vm.myId.collectAsStateWithLifecycle()
    val route by vm.audio.route.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    var askedOnce by rememberSaveable { mutableStateOf(false) }
    // The next permission result comes from a tap (Allow / the mic or camera button): those devices come on.
    var tappedAsk by remember { mutableStateOf(false) }
    var askedMic by rememberSaveable { mutableStateOf(false) }
    var askedCam by rememberSaveable { mutableStateOf(false) }
    // Bumped on every resume (back from Settings / the permission page) so permissions are re-read.
    var resumes by remember { mutableStateOf(0) }
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) { resumes++; vm.foreground.value = true; onPauseOrDispose { vm.foreground.value = false } }

    fun access(p: String, asked: Boolean): DeviceAccess = when {
        context.granted(p) -> DeviceAccess.GRANTED
        // Refused before and Android won't show the dialog again ("Don't allow" twice / "don't ask again").
        asked && activity != null && !ActivityCompat.shouldShowRequestPermissionRationale(activity, p) -> DeviceAccess.SETTINGS
        else -> DeviceAccess.ASK
    }
    val micAccess = remember(resumes, askedMic, s.hasMic, s.micProblem) { access(Manifest.permission.RECORD_AUDIO, askedMic) }
    val camAccess = remember(resumes, askedCam, s.hasCamera, s.camProblem) { access(Manifest.permission.CAMERA, askedCam) }

    val permissions = remember {
        buildList {
            add(Manifest.permission.RECORD_AUDIO); add(Manifest.permission.CAMERA)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(Manifest.permission.BLUETOOTH_CONNECT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }.toTypedArray()
    }
    val askMedia = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        askedOnce = true
        if (Manifest.permission.RECORD_AUDIO in result) askedMic = true
        if (Manifest.permission.CAMERA in result) askedCam = true
        // Whatever was allowed opens now; the rest is explained on the screen (and can be added later).
        // The first ask (the page opening) restores mic / camera as I last left them; a tap turns them on.
        vm.controller.refreshDevices(restore = !tappedAsk)
        tappedAsk = false
    }
    fun openAppSettings() {
        runCatching {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
    /** Ask for the devices that are missing (or send the person to Settings when Android won't ask again). */
    fun askFor(vararg wanted: String) {
        val missing = wanted.filter { !context.granted(it) }
        if (missing.isEmpty()) { vm.controller.refreshDevices(restore = false); return }
        tappedAsk = true
        val settingsOnly = missing.all { access(it, if (it == Manifest.permission.RECORD_AUDIO) askedMic else askedCam) == DeviceAccess.SETTINGS }
        if (settingsOnly) openAppSettings() else askMedia.launch(missing.toTypedArray())
    }
    // Back from Settings with a permission granted → add the device (pre-join and mid-call).
    LaunchedEffect(resumes) {
        if (!s.mediaReady) return@LaunchedEffect
        val micNow = context.granted(Manifest.permission.RECORD_AUDIO) && !s.hasMic
        val camNow = context.granted(Manifest.permission.CAMERA) && !s.hasCamera && s.camProblem == MediaProblem.BLOCKED
        if (micNow || camNow) vm.controller.refreshDevices(restore = false)
    }
    // ⋯ → 📑 Present material → "+ Add": the system file picker (PDF, PowerPoint, pictures); rendered here, uploaded, presented.
    val pickMaterial = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.materials.add(context, uri) { mid -> vm.controller.presentMaterial(mid) }
    }
    val presentSheet by vm.materials.sheet.collectAsStateWithLifecycle()
    val askScreen = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK && r.data != null) vm.controller.startScreenShare(r.data!!)
    }

    // Show the camera as soon as the page opens (asks once), like the web.
    val d = detail.data
    LaunchedEffect(d?.call?.status) {
        if (d?.call?.status == "live" && s.phase == CallPhase.PREJOIN && !s.mediaReady) {
            if (context.granted(Manifest.permission.RECORD_AUDIO) && context.granted(Manifest.permission.CAMERA)) vm.controller.startPreview()
            else if (!askedOnce) askMedia.launch(permissions)
            else vm.controller.startPreview()
        }
    }
    // An ended call opens its review instead (web: <Navigate to review>).
    LaunchedEffect(d?.call?.status, s.phase) {
        if (d?.call?.status == "ended" && s.phase == CallPhase.PREJOIN) { nav.back(); nav.open(Routes.callReview(id)) }
    }
    // Keep the screen on while the call is on screen.
    val view = LocalView.current
    DisposableEffect(s.phase) {
        view.keepScreenOn = s.phase == CallPhase.LIVE || s.phase == CallPhase.JOINING
        onDispose { view.keepScreenOn = false }
    }
    // While I share my screen, the drawings on it (theirs and mine) over every other app (needs "Display over other apps").
    // The ViewModel shows it while the call screen is in the background (see CallViewModel.overlay).
    val overlay = vm.overlay
    val overlayWanted by vm.overlayWanted.collectAsStateWithLifecycle()
    val overlayOn = remember(resumes, overlayWanted, s.sharingScreen) { overlayWanted && s.sharingScreen && overlay.permitted() }
    var confirmLeave by remember { mutableStateOf(false) }
    // Tab-complete on the text board: on by default, remembered per user on this phone (web: localStorage).
    val glossPrefs = remember { context.getSharedPreferences("lab-calls", Context.MODE_PRIVATE) }
    var glossOn by remember(myId) { mutableStateOf(glossPrefs.getBoolean("board-gloss:$myId", true)) }
    BackHandler(enabled = s.phase == CallPhase.LIVE) { confirmLeave = true }

    val other = d?.participants?.firstOrNull { it.id != myId }
    val eglContext = vm.media.egl.eglBaseContext
    CallScreen(
        s.copy(myUserId = myId.ifEmpty { s.myUserId }),
        CallScreenInfo(
            title = d?.call?.title,
            otherName = other?.displayName,
            myName = nav.app.prefs.userName ?: "You",
            relationshipId = d?.call?.relationship_id,
            loading = d == null && detail.loading,
            notFound = d == null && !detail.loading,
            micAccess = micAccess,
            camAccess = camAccess,
            audioRoute = route,
            audioRoutes = if (s.phase == CallPhase.LIVE) vm.audio.routes() else listOf(route),
            screenOverlayOn = overlayOn,
            boardGlossOn = glossOn,
            materialSource = vm.materials,
            presentSheet = presentSheet,
        ),
        CallActions(
            onBack = nav::back,
            onAllowMedia = { askFor(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) },
            onOpenSettings = ::openAppSettings,
            onJoin = { record -> vm.controller.join(record); nav.app.haptics.tick() },
            onToggleMic = { if (s.hasMic) vm.controller.toggleMic() else askFor(Manifest.permission.RECORD_AUDIO); nav.app.haptics.tick() },
            onToggleCam = { if (s.hasCamera) vm.controller.toggleCam() else askFor(Manifest.permission.CAMERA); nav.app.haptics.tick() },
            onFlip = { vm.controller.flipCamera() },
            onFrontCamera = vm.controller::useFrontCamera,
            onShareScreen = {
                val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                askScreen.launch(mpm.createScreenCaptureIntent())
            },
            onStopShare = vm.controller::stopScreenShare,
            onToggleRecording = { if (s.recording) vm.controller.stopRecording() else vm.controller.startRecording() },
            onAudioRoute = vm::selectRoute,
            onEnd = { vm.controller.endForEveryone() },
            onLeave = { vm.controller.leave(); nav.app.haptics.tick() },
            onRejoin = { vm.controller.rejoin(); nav.app.haptics.tick() },
            onCommitBoard = vm.controller::commitBoard,
            onLive = vm.controller::sendLiveStroke,
            onSendChat = vm.controller::sendChat,
            onTextChanged = { t, a, b, comp ->
                vm.controller.textChanged(t, a, b, comp != null, comp?.let { t.substring(it.min.coerceIn(0, t.length), it.max.coerceIn(0, t.length)) }, comp?.min ?: -1, comp?.max ?: -1)
            },
            onAnnotate = vm.controller::sendAnnotation,
            onPing = vm.controller::sendPing,
            onClearAnnotations = vm.controller::clearAnnotations,
            onAnnotText = vm.controller::sendAnnotText,
            onAnnotTextDelete = vm.controller::deleteAnnotText,
            onAnnotationsKept = { keep -> vm.controller.setAnnotationsKept(keep); nav.app.haptics.tick() },
            onToggleScreenOverlay = {
                if (!overlay.permitted()) { vm.overlayWanted.value = true; context.startActivity(overlay.permissionIntent()) }
                else vm.overlayWanted.value = !overlayOn
            },
            onTextSelected = vm.controller::textSelected,
            onTextBlurred = vm.controller::textBlurred,
            explain = { hanzi ->
                nav.app.repo.api.explainSentenceText(dev.jeromeswannack.chineselearning.lab.data.api.ExplainTextBody(hanzi)).words
                    .joinToString(" · ") { "${it.hanzi} ${it.gloss}" }.ifBlank { null }
            },
            gloss = { text -> BoardGlossFetcher.fetch(nav.app.repo.api, id, text) },
            onBoardGlossOn = { on -> glossOn = on; glossPrefs.edit().putBoolean("board-gloss:$myId", on).apply() },
            pages = BoardPageActions(
                onOpen = vm.controller::openPage,
                onNew = vm.controller::newPage,
                onDuplicate = vm.controller::duplicatePage,
                onRename = vm.controller::renamePage,
                onDelete = { page -> vm.controller.deletePage(page); nav.app.haptics.tick() },
                onGoThere = vm.controller::goToTheirPage,
                onFollow = vm.controller::setFollowing,
                onBringHere = vm.controller::bringHere,
                onDismissNotice = vm.controller::dismissBoardNotice,
            ),
            onReview = { nav.back(); nav.open(Routes.callReview(id)) },
            onAllCalls = { nav.back(); nav.open(Routes.calls()) },
            onTick = { nav.app.haptics.tick() },
            onSnap = { nav.app.haptics.flip() },
            material = MaterialActions(
                onTurn = vm.controller::turnMaterialPage,
                onStop = { vm.controller.stopPresenting(); nav.app.haptics.tick() },
                onStroke = vm.controller::sendMaterialStroke,
                onPing = vm.controller::sendMaterialPing,
                onText = vm.controller::sendMaterialText,
                onTextDelete = vm.controller::deleteMaterialText,
                onClear = vm.controller::clearMaterialAnnotations,
            ),
            onOpenPresent = { vm.materials.openSheet() },
            onPresent = { mid -> vm.controller.presentMaterial(mid) },
            onAddMaterial = { runCatching { pickMaterial.launch(dev.jeromeswannack.chineselearning.lab.data.materials.MaterialUploader.ACCEPT) } },
            onStartActivity = vm.controller::startActivity,
            activity = ActivityActions(
                act = vm.controller::act,
                close = vm.controller::closeActivity,
                speak = { text -> vm.speaker.speak(text) },
                feel = { f ->
                    when (f) {
                        ActivityFeel.TICK -> nav.app.haptics.tick()
                        ActivityFeel.CORRECT -> { nav.app.haptics.correct(); nav.app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.CORRECT) }
                        ActivityFeel.WRONG -> { nav.app.haptics.wrong(); nav.app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.WRONG) }
                        ActivityFeel.DONE -> { nav.app.haptics.celebrate(); nav.app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.FANFARE) }
                    }
                },
            ),
        ),
        video = { handle, mirror, contain, overlay, onFrameSize, modifier -> RtcVideo(handle as? VideoTrack, eglContext, mirror, contain, overlay, onFrameSize, modifier) },
        layout = vm.layout,
    )
    if (confirmLeave) dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog(
        "Leave the call?", "The call goes on for the other person — rejoin from here or from another device. To end it for both of you, use the red button.", "Leave",
        onConfirm = { confirmLeave = false; vm.controller.leave() }, onDismiss = { confirmLeave = false },
    )
}

/**
 * One WebRTC video in a [TextureVideoView]: composes with the tiles around it (no SurfaceView
 * z-order), survives the tile moving / resizing, keeps its last frame through a dropout. The track
 * outlives the view. Reports each new frame size (rotation applied) so [FittedVideo] can pick
 * cover / contain.
 */
@Composable
fun RtcVideo(track: VideoTrack?, egl: org.webrtc.EglBase.Context, mirror: Boolean, contain: Boolean, @Suppress("UNUSED_PARAMETER") overlay: Boolean, onFrameSize: (Int, Int) -> Unit, modifier: Modifier = Modifier) {
    if (track == null) return
    val sizeCallback = rememberUpdatedState(onFrameSize)
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextureVideoView(ctx).apply {
                init(egl)
                this.onFrameSize = { w, h -> sizeCallback.value(w, h) }
            }
        },
        update = { v ->
            v.setMirror(mirror)
            v.setContain(contain)
            val bound = v.tag as? VideoTrack
            if (bound !== track) {
                bound?.let { runCatching { it.removeSink(v) } }
                runCatching { track.addSink(v) }
                v.tag = track
            }
        },
        onRelease = { v ->
            (v.tag as? VideoTrack)?.let { runCatching { it.removeSink(v) } }
            v.release()
        },
    )
}
