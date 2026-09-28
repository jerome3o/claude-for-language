package dev.jeromeswannack.chineselearning.lab.ui.calls

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
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
import kotlinx.coroutines.launch
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
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

    val controller: CallController = CallController(
        callId, "",
        CallDeps(
            openRoom = { handlers -> CallRoomSocket({ app.repo.api.joinCall(callId) }, app.repo.api.http, app.repo.api.baseUrl, handlers, viewModelScope) },
            media = media,
            recorder = MicRecorder(callId, uploads, media.mic),
            endCall = { app.repo.api.endCall(callId) },
            drainUploads = { if (app.online.value) uploads.drain() },
            closeOrphans = { uploads.closeOrphans(callId) },
            keepAlive = { on ->
                if (on) { CallUploads.activeCallId = callId; CallService.start(app, callId); audio.start() }
                else { audio.stop(); CallService.stop(app); if (CallUploads.activeCallId == callId) CallUploads.activeCallId = null; app.scheduleBackgroundUpload() }
            },
            prepareScreenShare = { CallService.prepareScreenShare(app, callId) },
            teardown = app.scope,
            userId = { _myId.value },
        ),
        viewModelScope,
    )

    init {
        viewModelScope.launch {
            _myId.value = Connections.myId(app.cache) ?: runCatching { app.repo.api.me().id }.getOrNull().orEmpty()
        }
        viewModelScope.launch { uploads.pending(callId).collect { controller.setPendingUploads(it) } }
    }

    fun selectRoute(r: AudioRoute) = audio.select(r)

    override fun onCleared() {
        controller.dispose()
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = CallViewModel(app, id) as T
    }
}

private fun Context.granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

@Composable
fun CallRoute(nav: LabNav, id: String) {
    val vm: CallViewModel = viewModel(key = "call-$id", factory = CallViewModel.Factory(nav.app, id))
    val s by vm.controller.state.collectAsStateWithLifecycle()
    val detail by vm.detail.state.collectAsStateWithLifecycle()
    val myId by vm.myId.collectAsStateWithLifecycle()
    val route by vm.audio.route.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var askedOnce by remember { mutableStateOf(false) }
    var denied by remember { mutableStateOf(false) }

    val permissions = remember {
        buildList {
            add(Manifest.permission.RECORD_AUDIO); add(Manifest.permission.CAMERA)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(Manifest.permission.BLUETOOTH_CONNECT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }.toTypedArray()
    }
    val askMedia = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        askedOnce = true
        if (result[Manifest.permission.RECORD_AUDIO] == true || context.granted(Manifest.permission.RECORD_AUDIO)) { denied = false; vm.controller.startPreview() }
        else { denied = true; vm.controller.mediaBlocked("Camera and microphone are blocked. Allow the microphone for 学 Lab (Settings → Apps → 学 Lab → Permissions), then tap Allow.") }
    }
    val askScreen = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK && r.data != null) vm.controller.startScreenShare(r.data!!)
    }

    // Show the camera as soon as the page opens (asks once), like the web.
    val d = detail.data
    LaunchedEffect(d?.call?.status) {
        if (d?.call?.status == "live" && s.phase == CallPhase.PREJOIN && !s.mediaReady) {
            if (context.granted(Manifest.permission.RECORD_AUDIO) && context.granted(Manifest.permission.CAMERA)) vm.controller.startPreview()
            else if (!askedOnce) askMedia.launch(permissions)
            else if (context.granted(Manifest.permission.RECORD_AUDIO)) vm.controller.startPreview()
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
    // While I share my screen, the other person's drawings over every app (needs "Display over other apps").
    val overlay = remember { dev.jeromeswannack.chineselearning.lab.data.calls.ScreenAnnotationOverlay(context.applicationContext) }
    var overlayWanted by remember { mutableStateOf(true) }
    var resumes by remember { mutableStateOf(0) }
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) { resumes++; onPauseOrDispose { } } // back from the permission page
    val overlayOn = remember(resumes, overlayWanted, s.sharingScreen) { overlayWanted && s.sharingScreen && overlay.permitted() }
    LaunchedEffect(overlayOn) { if (overlayOn) overlay.show() else overlay.hide() }
    LaunchedEffect(s.annotations, overlayOn) { if (overlayOn) overlay.update(s.annotations) }
    DisposableEffect(Unit) { onDispose { overlay.hide() } }
    var confirmLeave by remember { mutableStateOf(false) }
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
            needsPermission = denied,
            audioRoute = route,
            audioRoutes = if (s.phase == CallPhase.LIVE) vm.audio.routes() else listOf(route),
            screenOverlayOn = overlayOn,
        ),
        CallActions(
            onBack = nav::back,
            onAllowMedia = { askMedia.launch(permissions) },
            onJoin = { record -> vm.controller.join(record); nav.app.haptics.tick() },
            onToggleMic = { vm.controller.toggleMic(); nav.app.haptics.tick() },
            onToggleCam = { vm.controller.toggleCam(); nav.app.haptics.tick() },
            onFlip = { vm.controller.flipCamera() },
            onShareScreen = {
                val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                askScreen.launch(mpm.createScreenCaptureIntent())
            },
            onStopShare = vm.controller::stopScreenShare,
            onToggleRecording = { if (s.recording) vm.controller.stopRecording() else vm.controller.startRecording() },
            onAudioRoute = vm::selectRoute,
            onEnd = { vm.controller.endForEveryone() },
            onLeave = { vm.controller.leave() },
            onCommitBoard = vm.controller::commitBoard,
            onLive = vm.controller::sendLiveStroke,
            onSendChat = vm.controller::sendChat,
            onTextChanged = vm.controller::textChanged,
            onAnnotate = vm.controller::sendAnnotation,
            onPing = vm.controller::sendPing,
            onClearAnnotations = vm.controller::clearAnnotations,
            onToggleScreenOverlay = {
                if (!overlay.permitted()) { overlayWanted = true; context.startActivity(overlay.permissionIntent()) }
                else overlayWanted = !overlayOn
            },
            onTextSelected = vm.controller::textSelected,
            onTextBlurred = vm.controller::textBlurred,
            explain = { hanzi ->
                nav.app.repo.api.explainSentenceText(dev.jeromeswannack.chineselearning.lab.data.api.ExplainTextBody(hanzi)).words
                    .joinToString(" · ") { "${it.hanzi} ${it.gloss}" }.ifBlank { null }
            },
            onReview = { nav.back(); nav.open(Routes.callReview(id)) },
            onAllCalls = { nav.back(); nav.open(Routes.calls()) },
        ),
        video = { handle, mirror, contain, overlay, onFrameSize, modifier -> RtcVideo(handle as? VideoTrack, eglContext, mirror, contain, overlay, onFrameSize, modifier) },
    )
    if (confirmLeave) dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog(
        "Leave the call?", "The call goes on for the other person — rejoin it from the calls page. To end it for both of you, use the red button.", "Leave",
        onConfirm = { confirmLeave = false; vm.controller.leave() }, onDismiss = { confirmLeave = false },
    )
}

/**
 * One WebRTC video in a SurfaceViewRenderer; rebuilt with the composition, the track outlives it.
 * Reports each new frame size (rotation applied) so [FittedVideo] can pick cover / contain.
 */
@Composable
fun RtcVideo(track: VideoTrack?, egl: org.webrtc.EglBase.Context, mirror: Boolean, contain: Boolean, overlay: Boolean, onFrameSize: (Int, Int) -> Unit, modifier: Modifier = Modifier) {
    if (track == null) return
    val sizeCallback = rememberUpdatedState(onFrameSize)
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                val main = android.os.Handler(android.os.Looper.getMainLooper())
                init(egl, object : RendererCommon.RendererEvents {
                    override fun onFirstFrameRendered() {}
                    override fun onFrameResolutionChanged(width: Int, height: Int, rotation: Int) {
                        val turned = rotation % 180 != 0
                        main.post { sizeCallback.value(if (turned) height else width, if (turned) width else height) }
                    }
                })
                setEnableHardwareScaler(true)
                if (overlay) setZOrderMediaOverlay(true)
            }
        },
        update = { r ->
            r.setMirror(mirror)
            r.setScalingType(if (contain) RendererCommon.ScalingType.SCALE_ASPECT_FIT else RendererCommon.ScalingType.SCALE_ASPECT_FILL)
            val bound = r.tag as? VideoTrack
            if (bound !== track) {
                bound?.let { runCatching { it.removeSink(r) } }
                runCatching { track.addSink(r) }
                r.tag = track
            }
        },
        onRelease = { r ->
            (r.tag as? VideoTrack)?.let { runCatching { it.removeSink(r) } }
            r.release()
        },
    )
}
