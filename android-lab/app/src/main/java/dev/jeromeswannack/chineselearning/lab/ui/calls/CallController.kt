package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPages
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPagesState
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPages
import dev.jeromeswannack.chineselearning.lab.core.calls.PageEffect
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardOp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallBoard
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChatMessage
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.LinkEvent
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.PcState
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.TileStatus
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

/**
 * The other person. [connection] = the PeerConnection state; [tile] = the badge on their tile
 * (core CallConnection.tileStatus); [away] = their socket dropped and we are keeping the link (and
 * their last frame) for PEER_AWAY_GRACE_MS in case they come back.
 */
data class RemoteParticipant(
    val peer: CallPeer,
    /** Their camera. */
    val video: VideoHandle? = null,
    /** Their shared screen (its own transceiver; only shown while their state says `screen`). */
    val screen: VideoHandle? = null,
    /** False with an older app: their screen arrives on the camera stream instead ([video]). */
    val screenChannel: Boolean = true,
    val connection: String = "new",
    val tile: TileStatus = TileStatus.CONNECTING,
    val away: Boolean = false,
) {
    /** They are sharing their screen right now. */
    val sharing: Boolean get() = peer.state.screen
    /** An older app sends its screen on the camera stream. */
    val legacyShare: Boolean get() = sharing && !screenChannel
    /** What the screen tile shows (null while they don't share). */
    val screenVideo: VideoHandle? get() = if (!sharing) null else if (legacyShare) video else screen
    /** Their camera is live (not replaced by a legacy share). */
    val cameraOn: Boolean get() = video != null && peer.state.cam && !legacyShare
}

/** Why a device isn't in the call. BLOCKED = the permission is missing. */
enum class MediaProblem { BLOCKED, IN_USE, NO_DEVICE, FAILED }

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
    /** The board page this text is (null from an older room): a new page resets the field. */
    val page: String? = null,
)

/** A short notice over the call ("Minghui brought you to page 3"); [id] makes the same text show again. */
data class BoardNotice(val id: Long, val text: String)

/**
 * Drawings on a shared screen (shared/calls/annotate.ts, web AnnotationStore): mine ("me") and theirs,
 * fading after the pen lifts — or kept while [persist] ("Keep", `annot_mode`, one setting for both people).
 */
data class Annotations(
    val strokes: Map<String, dev.jeromeswannack.chineselearning.lab.core.calls.ShownStroke> = emptyMap(),
    val pings: List<dev.jeromeswannack.chineselearning.lab.core.calls.AnnotPing> = emptyList(),
    /** When the other person last drew or pinged, and their name ("… is drawing on your screen"). */
    val lastRemoteAt: Long = 0,
    val lastRemoteName: String = "",
    /** Keep finished strokes instead of fading them (shared by both people). */
    val persist: Boolean = false,
) {
    /**
     * Port of AnnotationStore.setPersist: keep / fade. Switching back to fading starts every finished
     * stroke's fade at [now].
     */
    fun withPersist(persist: Boolean, now: Long): Annotations {
        if (persist == this.persist) return this
        return copy(
            persist = persist,
            strokes = if (persist) strokes else strokes.mapValues { (_, s) -> if (s.doneAt != null) s.copy(doneAt = now) else s },
        )
    }
}

/** Everything the call screen shows (web: the return value of useCall). */
data class CallState(
    val phase: CallPhase = CallPhase.PREJOIN,
    val error: String? = null,
    val mediaError: String? = null,
    /** The devices were opened (whatever is allowed) — the preview shows. Join never waits for a device. */
    val mediaReady: Boolean = false,
    val micOn: Boolean = true,
    val camOn: Boolean = true,
    /** A microphone track exists (the permission is granted and it opened). */
    val hasMic: Boolean = false,
    val hasCamera: Boolean = false,
    val micProblem: MediaProblem? = null,
    val camProblem: MediaProblem? = null,
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
    /** Board pages: the strip, where the other person is, following (core BoardPages). */
    val pages: BoardPagesState = BoardPagesState(),
    val boardNotice: BoardNotice? = null,
    val annotations: Annotations = Annotations(),
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
    /** I share and they don't (web `iShare`): the screen tile shows MY screen and my pen defaults to the sharer's colour. */
    val iShareScreen: Boolean get() = sharingScreen && remote?.sharing != true
}

/**
 * Result of opening the devices: whatever is allowed opens, the rest says why not. Opening again
 * only adds what is missing (a permission granted mid-call).
 */
data class MediaOpen(val mic: Boolean, val camera: Boolean, val micProblem: MediaProblem? = null, val cameraProblem: MediaProblem? = null) {
    companion object {
        val Ok = MediaOpen(mic = true, camera = true)
    }
}

/** What a peer link reports back. */
interface PeerListener {
    fun sendSignal(signal: CallSignal)
    fun onRemoteVideo(video: VideoHandle?)
    /** Their shared screen (the second video transceiver). */
    fun onRemoteScreen(video: VideoHandle?) {}
    fun onConnectionState(state: String)
    fun onIceState(state: String) {}
}

/** From the link's stats: the estimated outgoing bitrate and the route in use ("relay/udp via turn", "host"…). */
data class PeerStats(val availableOutgoingBps: Double?, val route: String?)

/** One WebRTC connection to the other participant (data/calls/rtc/PeerLink.kt; a fake in tests). */
interface PeerSession {
    fun handleSignal(signal: CallSignal)
    /** Sends [video] as my camera; null sends nothing. */
    fun setVideo(video: VideoHandle?)
    /** Sends my shared screen on the screen transceiver (null stops it); the camera keeps going. */
    fun setScreen(video: VideoHandle?) {}
    /** Both sides have a screen transceiver (false with an older app: a share replaces the camera). */
    val screenChannel: Boolean get() = true
    /** Sends [audio] (a mic that appeared mid-call) on the existing transceiver — no renegotiation. */
    fun setAudio(audio: VideoHandle?) {}
    fun restartIce() {}
    suspend fun stats(): PeerStats? = null
    fun setVideoEncoding(encoding: CallConnection.VideoEncoding) {}
    fun close()
}

/** Camera, mic and the WebRTC factory (data/calls/rtc/WebRtcMedia.kt; a fake in tests). */
interface CallMedia {
    val hasMic: Boolean
    val hasCamera: Boolean
    val frontCamera: Boolean
    /** The mic track (an org.webrtc.AudioTrack on the phone). */
    val micAudio: VideoHandle?
    val cameraVideo: VideoHandle?
    val screenVideo: VideoHandle?
    val screenShareSupported: Boolean
    /** Opens what is allowed and not open yet. */
    suspend fun open(): MediaOpen
    /** Camera errors after it started (another app took it…), for the connection log. */
    fun onProblem(listener: (String) -> Unit) {}
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
    /** Opens the room socket; the second argument is this join's instance id (`&instance=` on the socket URL). */
    val openRoom: (RoomHandlers, String) -> CallRoom,
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
    val now: () -> Long = System::currentTimeMillis,
    /** Every connection transition, for logcat (the connection log goes to the room too). */
    val log: (String) -> Unit = { runCatching { android.util.Log.i("CallController", it) } },
)

/**
 * The live call (port of frontend/src/hooks/useCall.ts): camera / mic, the room socket, the WebRTC
 * link to the other participant, the whiteboard and chat state, the recorder and its upload queue.
 * The screen is only layout. [scope] must be single-threaded (Main): room callbacks are hopped onto it.
 *
 * Keeping the call through a bad connection (core CallConnection, parity-tested with
 * shared/calls/connection.ts): the room socket and the WebRTC link are independent. A peer whose
 * socket drops is kept "away" (their last frame frozen) for PEER_AWAY_GRACE_MS; the same person
 * from the same app session coming back adopts the existing link (signals just go to their new
 * client id). ICE restarts follow the link's health (grace, backoff, only while the socket is
 * open). Every transition goes to the call's connection log (`diag`).
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
    private val now = deps.now
    @Volatile private var room: CallRoom? = null
    private var link: PeerSession? = null
    /** Who the link is with (their latest announcement: client id, instance). */
    private var linkPeer: CallPeer? = null
    /** Where the link's signals go (their current client id). */
    @Volatile private var remoteId: String? = null
    /** Bumped for every new link: callbacks from a closed link are ignored. */
    @Volatile private var linkGen = 0
    private var health = CallConnection.initialLinkHealth(0)
    private var away = false
    private var awayJob: Job? = null
    private var restartJob: Job? = null
    private var statsJob: Job? = null
    private var lastRoute: String? = null
    private var lastBps: Double? = null
    private var lastEncoding: CallConnection.VideoEncoding? = null
    private var selfId: String? = null
    private var ice: List<IceServerDto> = emptyList()
    private var mediaState = PeerMediaState(mic = true, cam = true)
    private var wantRecord = true
    private var finished = false
    private var opening: Job? = null
    private var uploadsLoop: Job? = null
    /** This join's app-session id, sent on the socket URL: the other side keeps our link when we come back with it. */
    var instance: String = CallConnection.newInstanceId()
        private set

    init {
        uploadsLoop = scope.launch {
            runCatching { deps.closeOrphans() }
            while (isActive) {
                runCatching { deps.drainUploads() }
                delay(deps.uploadEveryMs)
            }
        }
        media.onProblem { detail -> scope.launch { diag("media", detail) } }
    }

    fun setPendingUploads(n: Int) = _state.update { it.copy(pendingUploads = n) }

    private val roomOpen: Boolean get() = _state.value.roomStatus == RoomStatus.OPEN

    // ---------------------------------------------------------------- diagnostics

    private val diagBuffer = ArrayList<CallConnection.DiagEvent>()

    /** One line of the call's connection log: to logcat now, to the room when the socket is open. */
    internal fun diag(kind: String, detail: String) {
        deps.log("[$kind] $detail")
        diagBuffer += CallConnection.DiagEvent(now(), kind, detail.replace(Regex("[\r\n]+"), " ").take(200))
        while (diagBuffer.size > CallConnection.MAX_DIAG_EVENTS) diagBuffer.removeAt(0)
        flushDiag()
    }

    private fun flushDiag() {
        val r = room ?: return
        if (!roomOpen) return
        while (diagBuffer.isNotEmpty()) {
            val batch = diagBuffer.take(CallConnection.MAX_DIAG_EVENTS_PER_MESSAGE)
            if (!r.send(CallProtocol.diag(batch))) return
            repeat(batch.size) { diagBuffer.removeAt(0) }
        }
    }

    // ---------------------------------------------------------------- media

    /** Opens the camera + mic for the preview (whatever is allowed). */
    fun startPreview(): Job {
        // A run in flight (or one that opened the media) is reused.
        opening?.let { if (it.isActive || _state.value.mediaReady) return it }
        return refreshDevices()
    }

    /**
     * Opens whatever is allowed now and isn't open yet — after a permission is granted (on the
     * pre-join screen, or mid-call from the mic / camera button). A new mic or camera is put on the
     * existing link (no renegotiation), and a recording that was wanted starts once there is a mic.
     */
    fun refreshDevices(): Job = scope.launch {
        val hadMic = media.hasMic
        val hadCam = media.hasCamera
        val r = media.open()
        val gotMic = media.hasMic && !hadMic
        val gotCam = media.hasCamera && !hadCam
        _state.update {
            it.copy(
                mediaReady = true,
                hasMic = media.hasMic,
                hasCamera = media.hasCamera,
                micProblem = if (media.hasMic) null else r.micProblem ?: MediaProblem.NO_DEVICE,
                camProblem = if (media.hasCamera) null else r.cameraProblem ?: MediaProblem.NO_DEVICE,
                micOn = if (gotMic) true else it.micOn,
                camOn = if (gotCam) true else if (!media.hasCamera) false else it.camOn,
                localVideo = media.cameraVideo,
                frontCamera = media.frontCamera,
                mediaError = null,
            )
        }
        if (!media.hasMic) diag("media", "microphone: ${(r.micProblem ?: MediaProblem.NO_DEVICE).name.lowercase()}")
        if (!media.hasCamera) diag("media", "camera: ${(r.cameraProblem ?: MediaProblem.NO_DEVICE).name.lowercase()}")
        if (gotMic && _state.value.phase == CallPhase.LIVE) diag("media", "microphone added mid-call")
        if (gotCam && _state.value.phase == CallPhase.LIVE) diag("media", "camera added mid-call")
        media.setMicEnabled(_state.value.micOn)
        if (media.hasCamera) media.setCameraEnabled(_state.value.camOn)
        if ((gotMic || gotCam) && _state.value.phase == CallPhase.LIVE) deps.keepAlive(true) // the foreground service takes the new device's type
        if (gotMic) {
            link?.setAudio(media.micAudio)
            deps.recorder.muted = !_state.value.micOn
            if (_state.value.phase == CallPhase.LIVE) {
                broadcastState { it.copy(mic = _state.value.micOn) }
                if (wantRecord && !deps.recorder.recording) startRecording()
            }
        }
        if (gotCam) {
            link?.setVideo(media.cameraVideo) // a legacy share in progress keeps the screen (PeerLink)
            lastEncoding = null
            applyEncoding()
            if (_state.value.phase == CallPhase.LIVE) broadcastState { it.copy(cam = _state.value.camOn) }
        }
    }.also { opening = it }

    /** The permissions were refused (kept for older callers; the pre-join screen explains per device). */
    fun mediaBlocked(message: String) = _state.update { it.copy(mediaError = message, mediaReady = true) }

    private fun broadcastState(patch: (PeerMediaState) -> PeerMediaState) {
        mediaState = patch(mediaState)
        room?.send(CallProtocol.state(mediaState))
    }

    // ---------------------------------------------------------------- peer link

    private fun closeLink() {
        linkGen++
        link?.close()
        link = null
        linkPeer = null
        remoteId = null
        away = false
        awayJob?.cancel(); awayJob = null
        restartJob?.cancel(); restartJob = null
        statsJob?.cancel(); statsJob = null
        lastRoute = null
        lastEncoding = null
    }

    private fun openLink(peer: CallPeer) {
        closeLink()
        val gen = ++linkGen
        remoteId = peer.clientId
        linkPeer = peer
        health = CallConnection.initialLinkHealth(now())
        val polite = (selfId ?: "") < peer.clientId
        _state.update { it.copy(remote = RemoteParticipant(peer)) }
        link = media.createPeer(ice, polite = polite, listener = object : PeerListener {
            override fun sendSignal(signal: CallSignal) {
                val to = remoteId
                if (gen == linkGen && to != null) room?.send(CallProtocol.signal(to, signal.toJson()))
            }

            override fun onRemoteVideo(video: VideoHandle?) {
                scope.launch { if (gen == linkGen) _state.update { s -> s.remote?.let { s.copy(remote = it.copy(video = video, screenChannel = link?.screenChannel ?: true)) } ?: s } }
            }

            override fun onRemoteScreen(video: VideoHandle?) {
                scope.launch { if (gen == linkGen) _state.update { s -> s.remote?.let { s.copy(remote = it.copy(screen = video, screenChannel = true)) } ?: s } }
            }

            override fun onConnectionState(state: String) {
                scope.launch { if (gen == linkGen) onPcState(state) }
            }

            override fun onIceState(state: String) {
                scope.launch { if (gen == linkGen) diag("ice", state) }
            }
        })
        diag("peer", "link to ${peer.name.ifBlank { "the other person" }} (${if (polite) "answerer" else "offerer"})")
        if (_state.value.sharingScreen) link?.setScreen(media.screenVideo)
        applyEncoding()
        statsJob = scope.launch {
            while (isActive && gen == linkGen) {
                delay(STATS_EVERY_MS)
                pollStats()
            }
        }
    }

    private fun publishRemote() {
        _state.update { s ->
            val r = s.remote ?: return@update s
            s.copy(remote = r.copy(connection = health.pc.wire, tile = CallConnection.tileStatus(health, away), away = away))
        }
    }

    private fun onPcState(wire: String) {
        val st = PcState.of(wire) ?: return
        val before = health
        health = CallConnection.linkHealthOn(health, LinkEvent.Pc(st, now()))
        if (health != before) diag("pc", if (st == PcState.CONNECTED && before.everConnected) "connected again" else wire)
        if (st == PcState.CONNECTED) {
            lastRoute = null
            scope.launch { pollStats() }
        }
        publishRemote()
        scheduleRestart()
    }

    /** (Re)arms the next ICE restart from the link's health; nothing while the room socket is down. */
    private fun scheduleRestart() {
        restartJob?.cancel()
        restartJob = null
        val l = link ?: return
        val at = CallConnection.nextIceRestartAt(health, roomOpen) ?: return
        val gen = linkGen
        restartJob = scope.launch {
            val wait = at - now()
            if (wait > 0) delay(wait)
            if (gen != linkGen) return@launch
            l.restartIce()
            health = CallConnection.linkHealthOn(health, LinkEvent.Restarted(now()))
            diag("restart", "ICE restart #${health.restarts} (${health.pc.wire})")
            restartJob = null
            scheduleRestart()
        }
    }

    /** Their socket is gone: keep the link and their last frame for a while. */
    private fun peerAway() {
        if (link == null) { _state.update { it.copy(remote = null) }; return }
        if (away) return
        away = true
        val name = linkPeer?.name?.ifBlank { null } ?: "The other person"
        diag("peer", "$name left the room — keeping the link for ${CallConnection.PEER_AWAY_GRACE_MS / 1000} s")
        publishRemote()
        val gen = linkGen
        awayJob = scope.launch {
            delay(CallConnection.PEER_AWAY_GRACE_MS)
            if (gen != linkGen) return@launch
            diag("peer", "$name did not come back — link closed")
            closeLink()
            _state.update { it.copy(remote = null) }
        }
    }

    /** Someone is in the room (welcome / peer_joined): the same session keeps the link, anyone else gets a new one. */
    private fun peerAnnounced(peer: CallPeer) {
        if (link != null && CallConnection.shouldAdoptPeer(linkPeer, peer)) {
            awayJob?.cancel(); awayJob = null
            val wasAway = away
            away = false
            val movedFrom = remoteId
            remoteId = peer.clientId
            linkPeer = peer
            _state.update { s -> s.remote?.let { s.copy(remote = it.copy(peer = peer)) } ?: s.copy(remote = RemoteParticipant(peer)) }
            diag("peer", "${peer.name.ifBlank { "They" }} ${if (wasAway) "came back" else "reconnected"} (same session) — link kept" + if (movedFrom != peer.clientId) ", signals → new client" else "")
            publishRemote()
            scheduleRestart()
        } else {
            if (link != null) diag("peer", "${peer.name.ifBlank { "They" }} joined from a new session — new link")
            openLink(peer)
        }
    }

    // ---------------------------------------------------------------- stats → route + encodings

    private suspend fun pollStats() {
        val l = link ?: return
        val st = runCatching { l.stats() }.getOrNull() ?: return
        if (l !== link) return
        if (health.pc == PcState.CONNECTED && st.route != null && st.route != lastRoute) {
            lastRoute = st.route
            diag("route", st.route)
        }
        if (st.availableOutgoingBps != null) lastBps = st.availableOutgoingBps
        applyEncoding()
    }

    /**
     * The camera sender's encoding and the estimated bandwidth. The screen has its own sender (PeerLink
     * gives it the screen encoding); only with an older app does a share go out on the camera sender.
     */
    private fun applyEncoding() {
        val l = link ?: return
        val source = if (_state.value.sharingScreen && !l.screenChannel) CallConnection.VideoSource.SCREEN else CallConnection.VideoSource.CAMERA
        val current = lastEncoding
        val enc = CallConnection.videoEncodingFor(source, lastBps, if (current != null && source == CallConnection.VideoSource.CAMERA) current.scaleResolutionDownBy else 1.0)
        if (enc == current) return
        l.setVideoEncoding(enc)
        if (current != null && current.scaleResolutionDownBy != enc.scaleResolutionDownBy) {
            diag("media", "video scale 1/${enc.scaleResolutionDownBy.toInt()} (estimate ${lastBps?.let { "${(it / 1000).toInt()} kbps" } ?: "unknown"})")
        }
        lastEncoding = enc
    }

    // ---------------------------------------------------------------- recording

    fun startRecording() = scope.launch {
        wantRecord = true
        if (!deps.recorder.supported || deps.recorder.recording || !_state.value.mediaReady || !media.hasMic) return@launch
        deps.recorder.muted = !_state.value.micOn
        deps.recorder.start { room?.clockOffset ?: 0L }
        _state.update { it.copy(recording = true) }
        broadcastState { it.copy(recording = true) }
    }

    fun stopRecording() = scope.launch {
        wantRecord = false
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
        _state.update { it.copy(remote = null, localVideo = null, screenVideo = null, mediaReady = false, pages = it.pages.copy(following = false)) }
        runCatching { deps.drainUploads() }
    }

    // ---------------------------------------------------------------- room messages

    private val handlers = object : RoomHandlers {
        override fun onMessage(msg: ServerMessage) { scope.launch { handle(msg) } }
        override fun onStatus(status: RoomStatus) { scope.launch { roomStatus(status) } }
        override fun onJoinInfo(info: CallJoinDto) {
            ice = info.ice_servers
            scope.launch { _state.update { it.copy(turn = info.turn) } }
        }
        override fun onFatal(message: String) { scope.launch { finish(CallPhase.ERROR, message) } }
    }

    internal fun roomStatus(status: RoomStatus) {
        if (finished) return
        val before = _state.value.roomStatus
        _state.update { it.copy(roomStatus = status) }
        if (before != status) diag("room", status.name.lowercase())
        if (status == RoomStatus.OPEN) flushDiag()
        // Restarts wait for the socket (the offer must reach them); re-check now it changed.
        scheduleRestart()
    }

    internal suspend fun handle(msg: ServerMessage) {
        if (finished) return
        when (msg) {
            is ServerMessage.Welcome -> {
                val rejoin = selfId != null
                selfId = msg.clientId
                _state.update { it.copy(startedAt = msg.startedAt, board = msg.board, chat = msg.chat, liveStrokes = emptyMap(), annotations = it.annotations.withPersist(msg.annotPersist, now())) }
                // Board pages: a first join shows the opening page; a rejoin goes back to mine (its text comes as a page_doc).
                val step = BoardPages.welcome(_state.value.pages, msg.pages, msg.page, msg.pageViews, rejoin, msg.peers.firstOrNull()?.clientId)
                if (step.loadWelcomeText) text().load(msg.text, msg.textCursors, msg.page, resendOthers = true)
                else { endCompose(); text().resendAll() }
                applyPages(step)
                publishText("load")
                room?.send(CallProtocol.state(mediaState))
                if (rejoin) diag("room", "rejoined the room")
                val p = msg.peers.firstOrNull()
                if (p != null) peerAnnounced(p) else peerAway()
                _state.update { it.copy(phase = CallPhase.LIVE) }
                if (wantRecord && !deps.recorder.recording) startRecording()
                flushDiag()
            }
            is ServerMessage.PeerJoined -> {
                _state.update { it.copy(pages = BoardPages.peerJoined(it.pages, msg.peer.clientId)) }
                peerAnnounced(msg.peer)
            }
            is ServerMessage.PeerLeft -> {
                _state.update { it.copy(pages = BoardPages.peerLeft(it.pages, msg.clientId)) }
                textBoard?.dropCursor(msg.clientId)
                publishText("cursor")
                if (remoteId == msg.clientId) peerAway()
            }
            // Only the page on my board (others come back whole in a page_doc when I open them).
            is ServerMessage.Text -> if (onMyPage(msg.page)) { text().applyRemote(msg.ops); publishText("remote") }
            is ServerMessage.TextCursorMsg -> if (onMyPage(msg.page)) { text().setCursor(msg.cursor); publishText("cursor") }
            is ServerMessage.Pages -> _state.update { it.copy(pages = BoardPages.pagesChanged(it.pages, msg.pages)) }
            is ServerMessage.PageDoc -> {
                val b = text()
                if (b.page != msg.page) endCompose() // a composition on the old page is dropped with it
                b.load(msg.text, msg.textCursors, msg.page, resendOthers = false)
                _state.update { it.copy(pages = BoardPages.docLoaded(it.pages, msg.page)) }
                publishText("load")
            }
            is ServerMessage.PageView -> {
                // Their caret leaves my board with them.
                if (msg.page != textBoard?.page && textBoard != null) { textBoard?.dropCursor(msg.clientId); publishText("cursor") }
                applyPages(BoardPages.pageView(_state.value.pages, msg.clientId, msg.page))
            }
            is ServerMessage.PagePreview -> _state.update { it.copy(pages = BoardPages.preview(it.pages, msg.page, msg.preview, msg.chars, msg.updatedAt)) }
            is ServerMessage.PageDeleted -> {
                val mine = pendingDelete == msg.page
                if (mine) pendingDelete = null
                applyPages(BoardPages.deleted(_state.value.pages, msg.page, msg.fallback, msg.by, mine))
            }
            is ServerMessage.PageSummon -> applyPages(BoardPages.summoned(_state.value.pages, msg.name, msg.page))
            // The room refuses a page action (the last page, too many pages): say why.
            is ServerMessage.Error -> if (now() - pageActionAt < PAGE_ERROR_WINDOW_MS) notice(msg.message)
            is ServerMessage.Annot -> upsertAnnot(msg.stroke, msg.from, msg.name)
            is ServerMessage.AnnotClear -> _state.update { it.copy(annotations = it.annotations.copy(strokes = emptyMap(), pings = emptyList())) }
            is ServerMessage.AnnotPingMsg -> addPing(msg.from, msg.x, msg.y, msg.name)
            is ServerMessage.AnnotMode -> _state.update { it.copy(annotations = it.annotations.withPersist(msg.persist, now())) }
            is ServerMessage.PeerState -> _state.update { s -> if (remoteId == msg.clientId && s.remote != null) s.copy(remote = s.remote.copy(peer = s.remote.peer.copy(state = msg.state))) else s }
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

    /** The phone switched networks (Wi-Fi ↔ mobile): the socket is likely dead — reconnect now, don't wait for the watchdog. */
    fun networkChanged(description: String) {
        if (finished || room == null) return
        diag("room", "network changed ($description) — reconnecting")
        room?.reconnectNow()
    }

    // ---------------------------------------------------------------- join / leave

    fun join(record: Boolean) = scope.launch {
        wantRecord = record
        finished = false
        _state.update { it.copy(phase = CallPhase.JOINING) }
        startPreview().join()
        val s = _state.value
        mediaState = PeerMediaState(mic = s.micOn && s.hasMic, cam = s.camOn && s.hasCamera, screen = false, recording = false)
        instance = CallConnection.newInstanceId()
        diag("join", "joining (mic ${if (s.hasMic) "on" else s.micProblem?.name?.lowercase() ?: "off"}, camera ${if (s.hasCamera) "on" else s.camProblem?.name?.lowercase() ?: "off"}, instance $instance)")
        deps.keepAlive(true)
        room = deps.openRoom(handlers, instance).also { it.connect() }
    }

    /** End for everyone (web: endForEveryone). */
    fun endForEveryone() = scope.launch {
        val sent = room?.send(CallProtocol.end()) ?: false
        if (!sent) runCatching { deps.endCall() }
        finish(CallPhase.ENDED)
    }

    /** Leave without ending the call (the web's page unmount): the other person stays; you can rejoin. */
    fun leave() = scope.launch { finish(CallPhase.ENDED, "You left the call. It goes on for the other person — rejoin it from the calls page.") }

    /**
     * The app is being removed (swiped away from recents): tell the room at once, before anything
     * that could suspend, then tidy up like [leave]. Best effort — the process may die right after.
     */
    fun leaveNow() {
        room?.close()
        leave()
    }

    // ---------------------------------------------------------------- controls

    /** Mute / unmute. Without a mic (not allowed yet / failed) it tries to add one (the screen asks for the permission first). */
    fun toggleMic() {
        if (!media.hasMic) { refreshDevices(); return }
        val next = !_state.value.micOn
        media.setMicEnabled(next)
        deps.recorder.muted = !next
        _state.update { it.copy(micOn = next) }
        broadcastState { it.copy(mic = next) }
    }

    /** Camera on / off. Without a camera it tries to add one. */
    fun toggleCam() {
        if (!media.hasCamera) { refreshDevices(); return }
        val next = !_state.value.camOn
        media.setCameraEnabled(next)
        _state.update { it.copy(camOn = next) }
        broadcastState { it.copy(cam = next) }
    }

    fun flipCamera() = scope.launch {
        if (media.flipCamera()) _state.update { it.copy(frontCamera = media.frontCamera) }
    }

    /** Front / back from the device picker. */
    fun useFrontCamera(front: Boolean) {
        if (media.hasCamera && media.frontCamera != front) flipCamera()
    }

    fun startScreenShare(permission: Any) = scope.launch {
        if (_state.value.sharingScreen) return@launch
        runCatching { deps.prepareScreenShare() }
        val video = media.startScreenShare(permission) { scope.launch { stopScreenShare() } } ?: return@launch
        link?.setScreen(video)
        _state.update { it.copy(screenVideo = video) }
        applyEncoding()
        broadcastState { it.copy(screen = true) }
    }

    fun stopScreenShare() {
        if (!_state.value.sharingScreen) return
        media.stopScreenShare()
        link?.setScreen(null)
        _state.update { it.copy(screenVideo = null) }
        applyEncoding()
        broadcastState { it.copy(screen = false) }
    }

    fun commitBoard(op: BoardOp) {
        _state.update { it.copy(board = CallBoard.apply(it.board, op)) }
        room?.send(CallProtocol.board(op))
    }

    fun sendLiveStroke(stroke: LiveStroke?) {
        room?.send(CallProtocol.boardLive(stroke))
    }

    // ------------------------------------------------------------ drawing on a shared screen

    private fun upsertAnnot(stroke: dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke, from: String, name: String? = null) {
        val now = this.now()
        _state.update { s ->
            val a = s.annotations
            val key = "$from:${stroke.id}"
            val prev = a.strokes[key]
            val live = dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.pruneAnnotations(a.strokes, now, a.persist) { it.doneAt }
            val shown = dev.jeromeswannack.chineselearning.lab.core.calls.ShownStroke(stroke, from, if (stroke.done) prev?.doneAt ?: now else null)
            s.copy(annotations = a.copy(
                strokes = live + (key to shown),
                lastRemoteAt = if (from != "me") now else a.lastRemoteAt,
                lastRemoteName = if (from != "me" && name != null) name else a.lastRemoteName,
            ))
        }
    }

    private fun addPing(from: String, x: Double, y: Double, name: String? = null) {
        val now = this.now()
        _state.update { s ->
            val a = s.annotations
            val pings = a.pings.filter { dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.pingProgress(it.at, now) != null } +
                dev.jeromeswannack.chineselearning.lab.core.calls.AnnotPing("$from:$now", from, x, y, now)
            s.copy(annotations = a.copy(pings = pings, lastRemoteAt = if (from != "me") now else a.lastRemoteAt, lastRemoteName = if (from != "me" && name != null) name else a.lastRemoteName))
        }
    }

    fun sendAnnotation(stroke: dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke) {
        upsertAnnot(stroke, "me")
        room?.send(CallProtocol.annot(stroke))
    }

    fun sendPing(x: Double, y: Double) {
        addPing("me", x, y)
        room?.send(CallProtocol.annotPing(x, y))
    }

    fun clearAnnotations() {
        _state.update { it.copy(annotations = it.annotations.copy(strokes = emptyMap(), pings = emptyList())) }
        room?.send(CallProtocol.annotClear())
    }

    /** "Keep" on the drawing tools: keep drawings until cleared (true) or let them fade — for both people (web setAnnotationsKept). */
    fun setAnnotationsKept(persist: Boolean) {
        _state.update { it.copy(annotations = it.annotations.withPersist(persist, now())) }
        room?.send(CallProtocol.annotMode(persist))
    }

    // ------------------------------------------------------------ shared text board

    private var textBoard: dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard? = null

    private fun text(): dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard =
        textBoard ?: dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard(deps.userId(), { m -> room?.send(m) ?: false }).also { textBoard = it }

    private fun publishText(change: String) {
        val b = textBoard ?: return
        _state.update { it.copy(textBoard = TextBoardUi(b.text, b.version, b.remoteCarets, b.mySelection(), change, b.page)) }
    }

    // IME composition preview (≤ ~12 messages a second, the latest wins).
    private var composeJob: Job? = null
    private var composeSentAt = Long.MIN_VALUE / 2
    private var composePending: String? = null
    private var composeSent: String? = null

    private fun sendCompose(raw: String?) {
        composePending = CallConnection.sanitizeCompose(raw)
        if (composeJob?.isActive == true) return
        val wait = composeSentAt + COMPOSE_MIN_GAP_MS - now()
        if (wait <= 0) flushCompose()
        else composeJob = scope.launch { delay(wait); flushCompose() }
    }

    private fun flushCompose() {
        val c = composePending
        if (c == composeSent) return
        composeSentAt = now()
        composeSent = c
        textBoard?.sendCompose(c)
    }

    private fun endCompose() {
        composeJob?.cancel()
        composeJob = null
        composePending = null
        composeSent = null
    }

    /**
     * The field changed: [text] with the selection [start]..[end] (UTF-16); [composing] while an IME
     * composition is open — then no edit is sent (the other person's edits wait) but [compose], the
     * text being composed, goes out as a preview in my name flag.
     */
    fun textChanged(text: String, start: Int, end: Int, composing: Boolean, compose: String? = null) {
        val b = text()
        if (composing) {
            if (!b.composing) b.setComposing(true)
            sendCompose(compose)
            return
        }
        if (b.composing) {
            endCompose()
            b.setComposing(false, text, end)
            b.select(start, end) // the cursor message without `compose` ends the preview on their side
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
        endCompose()
        textBoard?.clearSelection()
    }

    // ------------------------------------------------------------ board pages

    /** When I last asked the room for a page change (an `error` right after it is about that). */
    private var pageActionAt = Long.MIN_VALUE / 2
    /** The page I asked to delete (its `page_deleted` then needs no notice). */
    private var pendingDelete: String? = null

    /** [page] is the page on my board (or the room has no pages). */
    private fun onMyPage(page: String?): Boolean = page == null || textBoard?.page == null || page == textBoard?.page

    private fun notice(text: String) = _state.update { it.copy(boardNotice = BoardNotice(now(), text)) }

    private fun applyPages(step: BoardPages.Step) {
        _state.update { it.copy(pages = step.state) }
        for (e in step.effects) when (e) {
            is PageEffect.Open -> { pageActionAt = now(); room?.send(CallProtocol.pageOpen(e.page)) }
            is PageEffect.Notice -> notice(e.text)
        }
    }

    private fun sendPage(message: String) {
        pageActionAt = now()
        room?.send(message)
    }

    /** A thumbnail tapped: that page (following stops). */
    fun openPage(page: String) = applyPages(BoardPages.turnTo(_state.value.pages, page))

    /** "+": a new page at the end; the room opens it for me. */
    fun newPage() {
        _state.update { it.copy(pages = BoardPages.madePage(it.pages)) }
        sendPage(CallProtocol.pageNew())
    }

    fun duplicatePage(page: String) {
        _state.update { it.copy(pages = BoardPages.madePage(it.pages)) }
        sendPage(CallProtocol.pageDuplicate(page))
    }

    /** Blank = back to "Page N". */
    fun renamePage(page: String, title: String?) = sendPage(CallProtocol.pageRename(page, CallPages.sanitizePageTitle(title)))

    fun deletePage(page: String) {
        pendingDelete = page
        sendPage(CallProtocol.pageDelete(page))
    }

    /** "Go there": the other person's page. */
    fun goToTheirPage() = applyPages(BoardPages.goThere(_state.value.pages))

    fun setFollowing(on: Boolean) = applyPages(BoardPages.setFollowing(_state.value.pages, on))

    /** "Bring <name> here": the other person comes to my page. */
    fun bringHere() {
        val p = _state.value.pages.shown ?: return
        sendPage(CallProtocol.pageSummon(p))
    }

    fun dismissBoardNotice() = _state.update { it.copy(boardNotice = null) }

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

    companion object {
        const val STATS_EVERY_MS = 5_000L
        /** ≤ ~12 composition previews a second. */
        const val COMPOSE_MIN_GAP_MS = 84L
        /** A room `error` this soon after a page action is shown as a notice. */
        const val PAGE_ERROR_WINDOW_MS = 5_000L
    }
}
