package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardOp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallBoard
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChatMessage
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.CallProtocol
import dev.jeromeswannack.chineselearning.lab.core.calls.CallSignal
import dev.jeromeswannack.chineselearning.lab.core.calls.LiveStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.core.calls.ServerMessage
import dev.jeromeswannack.chineselearning.lab.data.api.CallJoinDto
import dev.jeromeswannack.chineselearning.lab.data.api.IceServerDto
import dev.jeromeswannack.chineselearning.lab.data.calls.CallRoom
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomHandlers
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** An opaque video to show (an org.webrtc.VideoTrack on the phone; anything in tests and screenshots). */
typealias VideoHandle = Any

enum class CallPhase { PREJOIN, JOINING, LIVE, ENDED, ERROR }

data class RemoteParticipant(val peer: CallPeer, val video: VideoHandle? = null, val connection: String = "new")

/** The shared text board as the screen draws it (core CallTextBoard, web TextBoard.tsx). */
data class TextBoardUi(
    val text: String = "",
    /** Bumped on every change; a remote edit carries my selection moved along with it. */
    val version: Int = 0,
    val remote: List<dev.jeromeswannack.chineselearning.lab.core.calls.RemoteCaret> = emptyList(),
    /** My selection (UTF-16 offsets) after the last remote change. */
    val mySelection: Pair<Int, Int> = 0 to 0,
    /** What changed last: "remote" rewrites the field (keeping my caret), "local" doesn't. */
    val lastChange: String = "load",
)

/** Everything the call screen shows (web: the return value of useCall). */
data class CallState(
    val phase: CallPhase = CallPhase.PREJOIN,
    val error: String? = null,
    val mediaError: String? = null,
    /** Mic (and camera, if any) are open — the preview shows and Join is possible. */
    val mediaReady: Boolean = false,
    val micOn: Boolean = true,
    val camOn: Boolean = true,
    val hasCamera: Boolean = false,
    val frontCamera: Boolean = true,
    val localVideo: VideoHandle? = null,
    val screenVideo: VideoHandle? = null,
    val remote: RemoteParticipant? = null,
    val roomStatus: RoomStatus = RoomStatus.CONNECTING,
    val board: List<BoardItem> = emptyList(),
    /** Strokes other people are drawing right now, by user id. */
    val liveStrokes: Map<String, LiveStroke> = emptyMap(),
    val chat: List<CallChatMessage> = emptyList(),
    val textBoard: TextBoardUi = TextBoardUi(),
    val recording: Boolean = false,
    val recordSupported: Boolean = false,
    val pendingUploads: Int = 0,
    val startedAt: Long? = null,
    /** A TURN relay is configured (the ⋯ menu warns when it isn't). */
    val turn: Boolean = true,
    val screenShareSupported: Boolean = false,
    val myUserId: String = "",
) {
    val sharingScreen: Boolean get() = screenVideo != null
}

/** Result of opening the mic + camera. */
sealed interface MediaOpen {
    data object Ok : MediaOpen
    data class AudioOnly(val message: String) : MediaOpen
    data class Failed(val message: String) : MediaOpen
}

/** What a peer link reports back. */
interface PeerListener {
    fun sendSignal(signal: CallSignal)
    fun onRemoteVideo(video: VideoHandle?)
    fun onConnectionState(state: String)
}

/** One WebRTC connection to the other participant (data/calls/rtc/PeerLink.kt; a fake in tests). */
interface PeerSession {
    fun handleSignal(signal: CallSignal)
    /** Sends [video] instead of the current video (camera ↔ screen); null sends nothing. */
    fun setVideo(video: VideoHandle?)
    fun close()
}

/** Camera, mic and the WebRTC factory (data/calls/rtc/WebRtcMedia.kt; a fake in tests). */
interface CallMedia {
    val hasCamera: Boolean
    val frontCamera: Boolean
    val cameraVideo: VideoHandle?
    val screenVideo: VideoHandle?
    val screenShareSupported: Boolean
    suspend fun open(): MediaOpen
    fun setMicEnabled(on: Boolean)
    fun setCameraEnabled(on: Boolean)
    suspend fun flipCamera(): Boolean
    /** [permission] = the MediaProjection consent result. Returns the screen video, or null when it could not start. */
    fun startScreenShare(permission: Any, onStopped: () -> Unit): VideoHandle?
    fun stopScreenShare()
    fun createPeer(iceServers: List<IceServerDto>, polite: Boolean, listener: PeerListener): PeerSession
    fun release()
}

/** Records this participant's mic into the upload queue (data/calls/MicRecorder.kt; a fake in tests). */
interface CallRecorderControl {
    val supported: Boolean
    val recording: Boolean
    var muted: Boolean
    suspend fun start(clockOffset: () -> Long)
    suspend fun stop()
}

/** Everything else the controller needs from the app. */
class CallDeps(
    val openRoom: (RoomHandlers) -> CallRoom,
    val media: CallMedia,
    val recorder: CallRecorderControl,
    /** `POST /api/calls/:id/end` when the room can't take the message. */
    val endCall: suspend () -> Unit,
    /** Push queued recording uploads (the Outbox). */
    val drainUploads: suspend () -> Unit,
    /** Close pieces left open by an earlier, killed session of the app. */
    val closeOrphans: suspend () -> Unit,
    /** Keep the call alive in the background (foreground service) / let it go. */
    val keepAlive: (Boolean) -> Unit = {},
    /** Before a screen capture starts (Android 14: the foreground service must carry the mediaProjection type first). */
    val prepareScreenShare: suspend () -> Unit = {},
    /** Outlives the screen: where the last recording piece is closed when the screen goes away. */
    val teardown: CoroutineScope? = null,
    val uploadEveryMs: Long = 5_000,
    /** My user id: the text board's site prefix, which the room checks. */
    val userId: () -> String = { "" },
)

/**
 * The live call (port of frontend/src/hooks/useCall.ts): camera / mic, the room socket, the WebRTC
 * link to the other participant, the whiteboard and chat state, the recorder and its upload queue.
 * The screen is only layout. [scope] must be single-threaded (Main): room callbacks are hopped onto it.
 */
class CallController(
    private val callId: String,
    myUserId: String,
    private val deps: CallDeps,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(CallState(myUserId = myUserId, recordSupported = deps.recorder.supported, screenShareSupported = deps.media.screenShareSupported))
    val state: StateFlow<CallState> = _state.asStateFlow()

    private val media = deps.media
    private var room: CallRoom? = null
    private var link: PeerSession? = null
    private var remoteId: String? = null
    private var selfId: String? = null
    private var ice: List<IceServerDto> = emptyList()
    private var mediaState = PeerMediaState(mic = true, cam = true)
    private var wantRecord = true
    private var finished = false
    private var opening: Job? = null
    private var uploadsLoop: Job? = null

    init {
        uploadsLoop = scope.launch {
            runCatching { deps.closeOrphans() }
            while (isActive) {
                runCatching { deps.drainUploads() }
                delay(deps.uploadEveryMs)
            }
        }
    }

    fun setPendingUploads(n: Int) = _state.update { it.copy(pendingUploads = n) }

    // ---------------------------------------------------------------- media

    /** Opens the camera + mic for the preview (after the permissions are granted). */
    fun startPreview(): Job {
        // A run in flight (or one that opened the media) is reused; a failed one is retried (the
        // permission was granted after a refusal).
        opening?.let { if (it.isActive || _state.value.mediaReady) return it }
        return scope.launch {
            when (val r = media.open()) {
                MediaOpen.Ok -> _state.update { it.copy(mediaReady = true, mediaError = null, hasCamera = media.hasCamera, localVideo = media.cameraVideo, frontCamera = media.frontCamera) }
                is MediaOpen.AudioOnly -> _state.update { it.copy(mediaReady = true, mediaError = r.message, hasCamera = false, camOn = false, localVideo = null) }
                is MediaOpen.Failed -> _state.update { it.copy(mediaReady = false, mediaError = r.message) }
            }
            media.setMicEnabled(_state.value.micOn)
            if (media.hasCamera) media.setCameraEnabled(_state.value.camOn)
        }.also { opening = it }
    }

    /** The permissions were refused: say so (web: "Camera and microphone are blocked…"). */
    fun mediaBlocked(message: String) = _state.update { it.copy(mediaError = message, mediaReady = false) }

    private fun broadcastState(patch: (PeerMediaState) -> PeerMediaState) {
        mediaState = patch(mediaState)
        room?.send(CallProtocol.state(mediaState))
    }

    // ---------------------------------------------------------------- peer link

    private fun closeLink() {
        link?.close()
        link = null
        remoteId = null
    }

    private fun openLink(peer: CallPeer) {
        closeLink()
        remoteId = peer.clientId
        _state.update { it.copy(remote = RemoteParticipant(peer)) }
        val r = room
        link = media.createPeer(ice, polite = (selfId ?: "") < peer.clientId, listener = object : PeerListener {
            override fun sendSignal(signal: CallSignal) {
                r?.send(CallProtocol.signal(peer.clientId, signal.toJson()))
            }

            override fun onRemoteVideo(video: VideoHandle?) {
                scope.launch { _state.update { s -> if (s.remote?.peer?.clientId == peer.clientId) s.copy(remote = s.remote.copy(video = video)) else s } }
            }

            override fun onConnectionState(state: String) {
                scope.launch { _state.update { s -> if (s.remote?.peer?.clientId == peer.clientId) s.copy(remote = s.remote.copy(connection = state)) else s } }
            }
        })
        if (_state.value.sharingScreen) link?.setVideo(media.screenVideo)
    }

    // ---------------------------------------------------------------- recording

    fun startRecording() = scope.launch {
        if (!deps.recorder.supported || deps.recorder.recording || !_state.value.mediaReady) return@launch
        deps.recorder.muted = !_state.value.micOn
        deps.recorder.start { room?.clockOffset ?: 0L }
        _state.update { it.copy(recording = true) }
        broadcastState { it.copy(recording = true) }
    }

    fun stopRecording() = scope.launch {
        deps.recorder.stop()
        _state.update { it.copy(recording = false) }
        broadcastState { it.copy(recording = false) }
        launch { runCatching { deps.drainUploads() } }
    }

    // ---------------------------------------------------------------- teardown

    private suspend fun finish(next: CallPhase, message: String? = null) {
        if (finished) return
        finished = true
        _state.update { it.copy(phase = next, error = message ?: it.error) }
        runCatching { deps.recorder.stop() }
        _state.update { it.copy(recording = false) }
        closeLink()
        room?.close()
        room = null
        media.release()
        deps.keepAlive(false)
        _state.update { it.copy(remote = null, localVideo = null, screenVideo = null, mediaReady = false) }
        runCatching { deps.drainUploads() }
    }

    // ---------------------------------------------------------------- room messages

    private val handlers = object : RoomHandlers {
        override fun onMessage(msg: ServerMessage) { scope.launch { handle(msg) } }
        override fun onStatus(status: RoomStatus) { scope.launch { _state.update { it.copy(roomStatus = status) } } }
        override fun onJoinInfo(info: CallJoinDto) {
            ice = info.ice_servers
            scope.launch { _state.update { it.copy(turn = info.turn) } }
        }
        override fun onFatal(message: String) { scope.launch { finish(CallPhase.ERROR, message) } }
    }

    internal suspend fun handle(msg: ServerMessage) {
        if (finished) return
        when (msg) {
            is ServerMessage.Welcome -> {
                selfId = msg.clientId
                _state.update { it.copy(startedAt = msg.startedAt, board = msg.board, chat = msg.chat, liveStrokes = emptyMap()) }
                text().load(msg.text, msg.textCursors)
                publishText("load")
                room?.send(CallProtocol.state(mediaState))
                if (msg.peers.isNotEmpty()) openLink(msg.peers.first())
                else { closeLink(); _state.update { it.copy(remote = null) } }
                _state.update { it.copy(phase = CallPhase.LIVE) }
                if (wantRecord && !deps.recorder.recording) startRecording()
            }
            is ServerMessage.PeerJoined -> openLink(msg.peer)
            is ServerMessage.PeerLeft -> {
                textBoard?.dropCursor(msg.clientId)
                publishText("cursor")
                if (remoteId == msg.clientId) { closeLink(); _state.update { it.copy(remote = null) } }
            }
            is ServerMessage.Text -> { text().applyRemote(msg.ops); publishText("remote") }
            is ServerMessage.TextCursorMsg -> { text().setCursor(msg.cursor); publishText("cursor") }
            is ServerMessage.PeerState -> _state.update { s -> if (s.remote?.peer?.clientId == msg.clientId) s.copy(remote = s.remote.copy(peer = s.remote.peer.copy(state = msg.state))) else s }
            is ServerMessage.Signal -> if (remoteId == msg.from) CallSignal.parse(msg.data)?.let { link?.handleSignal(it) }
            is ServerMessage.Board -> _state.update { s ->
                s.copy(board = CallBoard.apply(s.board, msg.op), liveStrokes = if (msg.op is BoardItem.Stroke) s.liveStrokes - msg.op.by else s.liveStrokes)
            }
            is ServerMessage.BoardLive -> _state.update { s ->
                val stroke = msg.stroke
                s.copy(liveStrokes = if (stroke == null) s.liveStrokes - msg.from else s.liveStrokes + (msg.from to stroke))
            }
            is ServerMessage.Chat -> _state.update { s -> if (s.chat.any { it.id == msg.message.id }) s else s.copy(chat = s.chat + msg.message) }
            is ServerMessage.Ended -> finish(CallPhase.ENDED)
            ServerMessage.Replaced -> finish(CallPhase.ERROR, "You joined this call from another tab or device.")
            else -> Unit
        }
    }

    // ---------------------------------------------------------------- join / leave

    fun join(record: Boolean) = scope.launch {
        wantRecord = record
        finished = false
        _state.update { it.copy(phase = CallPhase.JOINING) }
        startPreview().join()
        if (!_state.value.mediaReady) {
            _state.update { it.copy(phase = CallPhase.PREJOIN) }
            return@launch
        }
        val s = _state.value
        mediaState = PeerMediaState(mic = s.micOn, cam = s.camOn && s.hasCamera, screen = false, recording = false)
        deps.keepAlive(true)
        room = deps.openRoom(handlers).also { it.connect() }
    }

    /** End for everyone (web: endForEveryone). */
    fun endForEveryone() = scope.launch {
        val sent = room?.send(CallProtocol.end()) ?: false
        if (!sent) runCatching { deps.endCall() }
        finish(CallPhase.ENDED)
    }

    /** Leave without ending the call (the web's page unmount): the other person stays; you can rejoin. */
    fun leave() = scope.launch { finish(CallPhase.ENDED, "You left the call. It goes on for the other person — rejoin it from the calls page.") }

    // ---------------------------------------------------------------- controls

    fun toggleMic() {
        val next = !_state.value.micOn
        media.setMicEnabled(next)
        deps.recorder.muted = !next
        _state.update { it.copy(micOn = next) }
        broadcastState { it.copy(mic = next) }
    }

    fun toggleCam() {
        if (!_state.value.hasCamera) return
        val next = !_state.value.camOn
        media.setCameraEnabled(next)
        _state.update { it.copy(camOn = next) }
        broadcastState { it.copy(cam = next) }
    }

    fun flipCamera() = scope.launch {
        if (media.flipCamera()) _state.update { it.copy(frontCamera = media.frontCamera) }
    }

    fun startScreenShare(permission: Any) = scope.launch {
        if (_state.value.sharingScreen) return@launch
        runCatching { deps.prepareScreenShare() }
        val video = media.startScreenShare(permission) { scope.launch { stopScreenShare() } } ?: return@launch
        link?.setVideo(video)
        _state.update { it.copy(screenVideo = video) }
        broadcastState { it.copy(screen = true) }
    }

    fun stopScreenShare() {
        if (!_state.value.sharingScreen) return
        media.stopScreenShare()
        link?.setVideo(media.cameraVideo)
        _state.update { it.copy(screenVideo = null) }
        broadcastState { it.copy(screen = false) }
    }

    fun commitBoard(op: BoardOp) {
        _state.update { it.copy(board = CallBoard.apply(it.board, op)) }
        room?.send(CallProtocol.board(op))
    }

    fun sendLiveStroke(stroke: LiveStroke?) {
        room?.send(CallProtocol.boardLive(stroke))
    }

    // ------------------------------------------------------------ shared text board

    private var textBoard: dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard? = null

    private fun text(): dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard =
        textBoard ?: dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard(deps.userId(), { m -> room?.send(m) ?: false }).also { textBoard = it }

    private fun publishText(change: String) {
        val b = textBoard ?: return
        _state.update { it.copy(textBoard = TextBoardUi(b.text, b.version, b.remoteCarets, b.mySelection(), change)) }
    }

    /**
     * The field changed: [text] with the selection [start]..[end] (UTF-16); [composing] while an IME
     * composition is open — then nothing is sent and the other person's edits wait.
     */
    fun textChanged(text: String, start: Int, end: Int, composing: Boolean) {
        val b = text()
        if (composing) {
            if (!b.composing) b.setComposing(true)
            return
        }
        if (b.composing) {
            b.setComposing(false, text, end)
            b.select(start, end)
            b.flushHeld()
            publishText(if (b.text == text) "local" else "remote")
            return
        }
        if (text != b.text) b.localEdit(text, end)
        b.select(start, end)
        publishText("local")
    }

    fun textSelected(start: Int, end: Int) {
        textBoard?.let { if (!it.composing) it.select(start, end) }
    }

    fun textBlurred() {
        textBoard?.clearSelection()
    }

    fun sendChat(text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty()) return false
        return room?.send(CallProtocol.chat(t.take(CallProtocol.MAX_CHAT_LENGTH))) ?: false
    }

    /** The screen is gone for good (ViewModel cleared): stop everything. */
    fun dispose() {
        uploadsLoop?.cancel()
        if (!finished) {
            finished = true
            val recorder = deps.recorder
            val drain = deps.drainUploads
            (deps.teardown ?: scope).launch { runCatching { recorder.stop() }; runCatching { drain() } }
            closeLink()
            room?.close()
            media.release()
            deps.keepAlive(false)
        }
    }
}
