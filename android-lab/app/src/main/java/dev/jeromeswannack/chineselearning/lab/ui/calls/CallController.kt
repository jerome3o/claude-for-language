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
import dev.jeromeswannack.chineselearning.lab.core.calls.CallDevices
import dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** An opaque video to show (an org.webrtc.VideoTrack on the phone; anything in tests and screenshots). */
typealias VideoHandle = Any

/** LEFT = I left; the call goes on for the other person ([CallController.rejoin] brings me back). */
enum class CallPhase { PREJOIN, JOINING, LIVE, LEFT, ENDED, ERROR }

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
    /**
     * Bumped when the field must be rewritten to [field] (the other person's edits shown, a load, a
     * catch-up). The screen applies it when no composition is open — or at once when [field] carries
     * the composition (a catch-up splices it back in).
     */
    val rewrite: Int = 0,
    val field: dev.jeromeswannack.chineselearning.lab.core.calls.BoardField? = null,
    /** While I compose: where the composition starts in [text] (character index) — their carets past it move along. */
    val compIndex: Int? = null,
)

/**
 * The mic muted when I last left a call, remembered per device (web DevicePrefs micOff): a rejoin
 * comes back muted. The camera is never remembered — it always starts ON (round 5, core CallDevices:
 * a camera switched off at the end of one lesson used to start every later call dark).
 */
interface CallDevicePrefs {
    var micOff: Boolean
}

/** In memory (tests, screenshots); the app uses the SharedPreferences one (data/calls/CallDevicePrefsStore). */
class MemoryCallDevicePrefs(override var micOff: Boolean = false) : CallDevicePrefs

/** A short notice over the call ("Minghui brought you to page 3"); [id] makes the same text show again. */
data class BoardNotice(val id: Long, val text: String)

/**
 * Drawings on a shared screen (shared/calls/annotate.ts, web AnnotationStore): mine ("me") and theirs,
 * strokes and (round 4) text boxes — kept until Clear while [persist] ("Keep", `annot_mode`, one setting
 * for both people; ON by default since round 4), else fading after the pen lifts / the text is finished.
 */
data class Annotations(
    val strokes: Map<String, dev.jeromeswannack.chineselearning.lab.core.calls.ShownStroke> = emptyMap(),
    /** Text boxes by id (anyone may move / edit / delete any of them). */
    val texts: Map<String, dev.jeromeswannack.chineselearning.lab.core.calls.ShownText> = emptyMap(),
    val pings: List<dev.jeromeswannack.chineselearning.lab.core.calls.AnnotPing> = emptyList(),
    /** When the other person last drew or pinged, and their name ("… is drawing on your screen"). */
    val lastRemoteAt: Long = 0,
    val lastRemoteName: String = "",
    /** Keep finished strokes and texts instead of fading them (shared by both people; on by default). */
    val persist: Boolean = dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.DEFAULT_ANNOT_PERSIST,
) {
    /**
     * Port of AnnotationStore.setPersist: keep / fade. Switching back to fading starts every finished
     * stroke's and text's fade at [now].
     */
    fun withPersist(persist: Boolean, now: Long): Annotations {
        if (persist == this.persist) return this
        return copy(
            persist = persist,
            strokes = if (persist) strokes else strokes.mapValues { (_, s) -> if (s.doneAt != null) s.copy(doneAt = now) else s },
            texts = if (persist) texts else texts.mapValues { (_, t) -> if (t.doneAt != null) t.copy(doneAt = now) else t },
        )
    }

    /** Port of AnnotationStore.loadKept: what the room kept (a rejoin), drawn at once, as finished. */
    fun withKept(k: dev.jeromeswannack.chineselearning.lab.core.calls.KeptAnnotations?, now: Long): Annotations {
        if (k == null) return this
        return copy(
            strokes = strokes + k.strokes.associate { "${it.from}:${it.stroke.id}" to dev.jeromeswannack.chineselearning.lab.core.calls.ShownStroke(it.stroke, it.from, now) },
            texts = texts + k.texts.associate { it.text.id to dev.jeromeswannack.chineselearning.lab.core.calls.ShownText(it.text, it.from, now) },
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
    /** A lesson material being presented (round 4 PR 5; either person opened it), and the drawings / text on its current page. */
    val presenting: dev.jeromeswannack.chineselearning.lab.core.PresentedMaterial? = null,
    val materialAnnotations: Annotations = Annotations(),
    /** The in-call activity being played (shared/call-activities; the room owns it), null = none. */
    val activity: dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession? = null,
    val recording: Boolean = false,
    val recordSupported: Boolean = false,
    val pendingUploads: Int = 0,
    val startedAt: Long? = null,
    /** A TURN relay is configured (the ⋯ menu warns when it isn't). */
    val turn: Boolean = true,
    val screenShareSupported: Boolean = false,
    val myUserId: String = "",
    /** Round 5: the relationship's tutor (null = a solo call / an older room) — she leads "Show for student" / "Stop their share". */
    val tutorId: String? = null,
    /** Round 5: what the tutor last showed (the room's record; core CallFollow). */
    val shown: CallFollow.ShownState? = null,
    /** Round 5, the student: "Minghui is showing you this" while the shown tile is on my stage (null = hidden). */
    val showingBanner: String? = null,
    /** Round 5, the student: "Minghui stopped your screen share" — a transient note. */
    val shareStoppedNote: BoardNotice? = null,
) {
    /** I am the relationship's tutor (never in a solo call). */
    val isTutor: Boolean get() = tutorId != null && myUserId.isNotEmpty() && tutorId == myUserId
    /** Round 5: the tutor's controls (Show for student, Stop their share) — she is the tutor and the student is here. */
    val leads: Boolean get() = isTutor && remote != null
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
    /** Their (new) link is listening, or mine was kept across a reconnect: an offer of mine still unanswered goes out again. */
    fun resendPendingOffer() {}
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
    /** Closes the camera, mic and screen but keeps the engine, so a rejoin can open them again (Leave). */
    fun stopDevices() = release()
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
    /** Mic / camera on or off as I last left them (restored on the next join). */
    val devicePrefs: CallDevicePrefs = MemoryCallDevicePrefs(),
    /** "Android 15; Google Pixel 9 Pro Fold" for the join line of the connection log. */
    val device: String = "",
    val now: () -> Long = System::currentTimeMillis,
    /** In-call activities: say [text] on this device (cache-first TTS, `/api/practice/tts`) — the quiz / dictation audio both hear. */
    val speak: (String) -> Unit = {},
    /**
     * Review together: play an R2 clip (a student's take / a card's reference clip) on this device —
     * [fallbackText] is said with the device voice when the clip can't be had ("" = nothing).
     */
    val playClip: (key: String, fallbackText: String) -> Unit = { _, _ -> },
    /** Every connection transition, for logcat (the connection log goes to the room too). */
    val log: (String) -> Unit = { runCatching { android.util.Log.i("CallController", it) } },
    /**
     * Round 5: the call's tile layout (the ViewModel's). The student's device puts what the tutor shows on
     * its stage through it; the tutor's opening the board shows it to the student. Null = no following.
     */
    val layout: CallLayoutHolder? = null,
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
    private val prefs = deps.devicePrefs
    // A muted mic stays muted (as I last left it); the camera always starts on (core CallDevices, round 5).
    private val _state = MutableStateFlow(CallState(myUserId = myUserId, recordSupported = deps.recorder.supported, screenShareSupported = deps.media.screenShareSupported, micOn = !prefs.micOff, camOn = CallDevices.CAMERA_ON_AT_START))
    val state: StateFlow<CallState> = _state.asStateFlow()
    private val _activity = MutableStateFlow<dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession?>(null)
    /** The in-call activity being played (also on [state]); the room's latest session. */
    val activity: StateFlow<dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession?> = _activity.asStateFlow()

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
    /** My link's id, on every signal it sends (core CallConnection.linkSignalAction). */
    private var myLinkId: String? = null
    /** Their link mine talks to (bound by the first signal that carries an id). */
    private var remoteLink: String? = null
    /** Their link ids already replaced: late signals from them are ignored. */
    private val retiredLinks = ArrayList<String>()
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

    // Round 5 (see "the tutor leads" below); declared before init, which starts watching the stage.
    /** The last show this device acted on — for the controller's lifetime, so a reconnect's welcome with the same show changes nothing. */
    private var applied: CallFollow.AppliedShow? = null
    /** My stage as last computed (the tutor's auto-show compares with it). */
    private var lastStage: List<CallLayout.TileId> = emptyList()
    /** The call screen's width in dp (the stage depends on it: phones focus one tile). */
    private var stageWidth = 412.0

    init {
        uploadsLoop = scope.launch {
            runCatching { deps.closeOrphans() }
            while (isActive) {
                runCatching { deps.drainUploads() }
                delay(deps.uploadEveryMs)
            }
        }
        media.onProblem { detail -> scope.launch { diag("media", detail) } }
        // Round 5: the stage changes (my layout, or a tile appearing / going) → the banner, auto-show, following.
        deps.layout?.let { holder ->
            scope.launch {
                combine(holder.layout, _state.map { availability(it) }.distinctUntilChanged()) { _, _ -> }.collect { stageChanged() }
            }
        }
        // The tutor turns her board page while she is showing the board: the student follows the page.
        scope.launch { _state.map { it.pages.shown }.distinctUntilChanged().collect { page -> myBoardPageTurned(page) } }
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

    /** Opens the camera + mic for the preview (whatever is allowed), on / off as I last left them. */
    fun startPreview(): Job {
        // A run in flight (or one that opened the media) is reused.
        opening?.let { if (it.isActive || _state.value.mediaReady) return it }
        return refreshDevices(restore = true)
    }

    /**
     * Opens whatever is allowed now and isn't open yet — after a permission is granted (on the
     * pre-join screen, or mid-call from the mic / camera button). A new mic or camera is put on the
     * existing link (no renegotiation), and a recording that was wanted starts once there is a mic.
     * [restore]: a device that opens comes on or off as I last left it (the preview, a rejoin); a
     * tap to turn a device on ([restore] false) always turns it on.
     */
    fun refreshDevices(restore: Boolean = true): Job = scope.launch {
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
                micOn = if (gotMic) CallDevices.deviceOnWhenOpened(CallDevices.Device.MIC, restore, prefs.micOff) else it.micOn,
                // Round 5: a camera that opens is ON — the preview, a rejoin, the next call (never remembered off).
                camOn = if (gotCam) CallDevices.deviceOnWhenOpened(CallDevices.Device.CAM, restore, prefs.micOff) else if (!media.hasCamera) false else it.camOn,
                localVideo = media.cameraVideo,
                frontCamera = media.frontCamera,
                mediaError = null,
            )
        }
        if (!restore && gotMic) prefs.micOff = false
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
            // Joined while the mic was still opening: the state the room has (or gets with the welcome) says so.
            if (announce()) broadcastState { it.copy(mic = _state.value.micOn) }
            if (_state.value.phase == CallPhase.LIVE && wantRecord && !deps.recorder.recording) startRecording()
        }
        if (gotCam) {
            link?.setVideo(media.cameraVideo) // a legacy share in progress keeps the screen (PeerLink)
            lastEncoding = null
            applyEncoding()
            // From Join on — a camera that opens while the room is still connecting included (core CallDevices.announceDevice).
            if (announce()) broadcastState { it.copy(cam = _state.value.camOn) }
            diag("media", "camera opened" + if (announce()) " while ${_state.value.phase.name.lowercase()}" else "")
        }
    }.also { opening = it }

    /** Must a device that opened now be told to the room (core CallDevices.announceDevice: joining or live)? */
    private fun announce(): Boolean = CallDevices.announceDevice(_state.value.phase.name.lowercase())

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

    /**
     * A new link to [peer]. [fresh] = their new link's id when their side started over (their old
     * link failed): mine is bound to it at once. Every link announces itself with `hello`.
     */
    private fun openLink(peer: CallPeer, fresh: String? = null) {
        remoteLink?.let { old -> retiredLinks += old; while (retiredLinks.size > 20) retiredLinks.removeAt(0) }
        closeLink()
        val gen = ++linkGen
        val linkId = CallConnection.newLinkId()
        myLinkId = linkId
        remoteLink = fresh
        remoteId = peer.clientId
        linkPeer = peer
        health = CallConnection.initialLinkHealth(now())
        val polite = (selfId ?: "") < peer.clientId
        _state.update { it.copy(remote = RemoteParticipant(peer)) }
        link = media.createPeer(ice, polite = polite, listener = object : PeerListener {
            override fun sendSignal(signal: CallSignal) {
                val to = remoteId
                if (gen == linkGen && to != null) room?.send(CallProtocol.signal(to, signal.toJson(linkId)))
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
        // A fresh link announces itself: the other side's link, if it is an older one, starts over too.
        sendLinkSignal(CallSignal.Hello)
        if (_state.value.sharingScreen) link?.setScreen(media.screenVideo)
        applyEncoding()
        statsJob = scope.launch {
            while (isActive && gen == linkGen) {
                delay(STATS_EVERY_MS)
                pollStats()
            }
        }
    }

    private fun sendLinkSignal(signal: CallSignal) {
        val to = remoteId ?: return
        room?.send(CallProtocol.signal(to, signal.toJson(myLinkId)))
    }

    /**
     * A signal from the person my link talks to, sorted by its link id: their new link makes mine
     * start over; leftovers of a replaced link are dropped; no id (an older app) applies as before.
     */
    private fun onSignal(data: kotlinx.serialization.json.JsonElement) {
        val incoming = CallSignal.linkOf(data)
        when (CallConnection.linkSignalAction(remoteLink, retiredLinks, incoming)) {
            CallConnection.LinkSignalAction.IGNORE -> return
            CallConnection.LinkSignalAction.REPLACE -> {
                val p = linkPeer ?: return
                diag("peer", "${p.name.ifBlank { "They" }} started a new link — renegotiating")
                openLink(p, fresh = incoming)
            }
            CallConnection.LinkSignalAction.APPLY -> if (remoteLink == null && incoming != null) remoteLink = incoming
        }
        val signal = CallSignal.parse(data) ?: return
        link?.handleSignal(signal)
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
        // A link that failed / closed / never got going is never kept: both sides start over.
        if (link != null && CallConnection.shouldAdoptPeer(linkPeer, peer, health.pc)) {
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
            // Say hello again (they re-send an offer of theirs I may have missed) and re-send mine if unanswered.
            sendLinkSignal(CallSignal.Hello)
            link?.resendPendingOffer()
        } else {
            val prev = linkPeer
            if (link != null) {
                if (prev?.instance != null && prev.instance == peer.instance && prev.userId == peer.userId) diag("peer", "${peer.name.ifBlank { "They" }} back — link was ${health.pc.wire}, renegotiating")
                else diag("peer", "${peer.name.ifBlank { "They" }} joined from a new session — new link")
            }
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
        // Left: the devices close, the engine stays for a rejoin (released when the screen goes).
        if (next == CallPhase.LEFT) media.stopDevices() else media.release()
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
                _state.update {
                    it.copy(
                        startedAt = msg.startedAt, board = msg.board, chat = msg.chat, liveStrokes = emptyMap(),
                        annotations = it.annotations.withPersist(msg.annotPersist, now()).withKept(msg.annots, now()),
                        // Round 4 PR 5: what is presented, and its page's kept drawings (a fresh store each time).
                        presenting = msg.material,
                        materialAnnotations = Annotations(persist = msg.annotPersist).withKept(msg.materialAnnots?.annots, now()),
                    )
                }
                // The activity as the room has it (never plays its audio: only a play that happens while I'm here does).
                applyActivity(msg.activity, live = false, force = true)
                // Board pages: a first join shows the opening page; a rejoin goes back to mine (its text comes as a page_doc).
                val step = BoardPages.welcome(_state.value.pages, msg.pages, msg.page, msg.pageViews, rejoin, msg.peers.firstOrNull()?.clientId)
                if (step.loadWelcomeText) text().load(msg.text, msg.textCursors, msg.page, resendOthers = true)
                else { endCompose(); text().resendAll() }
                applyPages(step)
                publishText("load", rewrite = true)
                room?.send(CallProtocol.state(mediaState))
                if (rejoin) diag("room", "rejoined the room")
                val p = msg.peers.firstOrNull()
                if (p != null) peerAnnounced(p) else peerAway()
                _state.update { it.copy(phase = CallPhase.LIVE) }
                if (wantRecord && !deps.recorder.recording) startRecording()
                flushDiag()
                // Round 5: who leads, and what she last showed (a new show is applied once; the same one after a reconnect is not).
                _state.update { it.copy(tutorId = msg.tutorId, shown = msg.shown, showingBanner = if (msg.shown == null) null else it.showingBanner) }
                follow()
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
            // Always into the document; into the field now, or after my composition (or its idle catch-up).
            is ServerMessage.Text -> if (onMyPage(msg.page)) when (text().applyRemote(msg.ops)) {
                dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard.Remote.SHOWN -> publishText("remote", rewrite = true)
                dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard.Remote.HELD -> { publishText("held"); scheduleComposeIdle() }
                dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard.Remote.NONE -> Unit
            }
            is ServerMessage.TextCursorMsg -> if (onMyPage(msg.page)) { text().setCursor(msg.cursor); publishText("cursor") }
            is ServerMessage.Pages -> _state.update { it.copy(pages = BoardPages.pagesChanged(it.pages, msg.pages)) }
            is ServerMessage.PageDoc -> {
                val b = text()
                if (b.page != msg.page) endCompose() // a composition on the old page is dropped with it
                b.load(msg.text, msg.textCursors, msg.page, resendOthers = false)
                _state.update { it.copy(pages = BoardPages.docLoaded(it.pages, msg.page)) }
                publishText("load", rewrite = true)
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
            is ServerMessage.Error -> if (now() - pageActionAt < PAGE_ERROR_WINDOW_MS) notice(msg.message) else diag("room", "error: ${msg.message}")
            // Annotations go to the shared screen's store (no target), the current material page's, or nowhere (another page).
            is ServerMessage.Annot -> slotFor(msg.target)?.let { upsertAnnot(it, msg.stroke, msg.from, msg.name) }
            is ServerMessage.AnnotClear -> slotFor(msg.target)?.let { slot -> editSlot(slot) { it.copy(strokes = emptyMap(), texts = emptyMap(), pings = emptyList()) } }
            is ServerMessage.AnnotTextMsg -> slotFor(msg.target)?.let { upsertText(it, msg.text, msg.from, msg.name) }
            is ServerMessage.AnnotTextDelete -> slotFor(msg.target)?.let { slot -> editSlot(slot) { it.copy(texts = it.texts - msg.id) } }
            is ServerMessage.AnnotPingMsg -> slotFor(msg.target)?.let { addPing(it, msg.from, msg.x, msg.y, msg.name) }
            is ServerMessage.AnnotMode -> _state.update { it.copy(annotations = it.annotations.withPersist(msg.persist, now()), materialAnnotations = it.materialAnnotations.withPersist(msg.persist, now())) }
            is ServerMessage.Material -> _state.update { s ->
                val prev = s.presenting
                val next = msg.presenting
                // Another page (or material, or none): its own drawings follow in material_annots.
                val samePage = next != null && prev != null && prev.materialId == next.materialId && prev.page == next.page
                s.copy(presenting = next, materialAnnotations = if (samePage) s.materialAnnotations else Annotations(persist = s.materialAnnotations.persist))
            }
            is ServerMessage.Activity -> applyActivity(msg.session, live = true)
            is ServerMessage.MaterialAnnotsMsg -> _state.update { s ->
                if (s.presenting?.target != msg.target) s
                else s.copy(materialAnnotations = Annotations(persist = s.materialAnnotations.persist).withKept(msg.annots, now()))
            }
            is ServerMessage.PeerState -> _state.update { s -> if (remoteId == msg.clientId && s.remote != null) s.copy(remote = s.remote.copy(peer = s.remote.peer.copy(state = msg.state))) else s }
            is ServerMessage.Signal -> if (remoteId == msg.from) onSignal(msg.data)
            is ServerMessage.Board -> _state.update { s ->
                s.copy(board = CallBoard.apply(s.board, msg.op), liveStrokes = if (msg.op is BoardItem.Stroke) s.liveStrokes - msg.op.by else s.liveStrokes)
            }
            is ServerMessage.BoardLive -> _state.update { s ->
                val stroke = msg.stroke
                s.copy(liveStrokes = if (stroke == null) s.liveStrokes - msg.from else s.liveStrokes + (msg.from to stroke))
            }
            is ServerMessage.Chat -> _state.update { s -> if (s.chat.any { it.id == msg.message.id }) s else s.copy(chat = s.chat + msg.message) }
            is ServerMessage.Shown -> {
                _state.update { it.copy(shown = msg.shown, showingBanner = if (msg.shown == null) null else it.showingBanner) }
                follow()
            }
            is ServerMessage.ShareStopped -> {
                // The tutor stopped my screen share: stop capturing, exactly like my own Stop sharing.
                stopScreenShare()
                _state.update { it.copy(shareStoppedNote = BoardNotice(now(), CallFollow.shareStoppedNote(msg.name))) }
                diag("media", "${msg.name.ifBlank { "The tutor" }} stopped my screen share")
            }
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
        // Wait a little for a camera / mic still opening (never for good), so a rejoin doesn't come in with everything off.
        kotlinx.coroutines.withTimeoutOrNull(JOIN_MEDIA_WAIT_MS) { startPreview().join() }
        val s = _state.value
        mediaState = PeerMediaState(mic = s.micOn && s.hasMic, cam = s.camOn && s.hasCamera, screen = false, recording = false)
        instance = CallConnection.newInstanceId()
        diag("join", "joining with ${joinDevices(s)}; instance $instance${if (deps.device.isNotBlank()) "; ${deps.device}" else ""}")
        deps.keepAlive(true)
        room = deps.openRoom(handlers, instance).also { it.connect() }
        joinedAt = now()
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("call.join", mapOf("role" to "member"))
    }

    /** "mic muted, camera" — what I join with (web: the join line of the connection log). */
    private fun joinDevices(s: CallState): String {
        val mic = if (!s.hasMic) "no mic" + (s.micProblem?.let { " (${it.name.lowercase()})" } ?: "") else if (s.micOn) "mic" else "mic muted"
        val cam = if (!s.hasCamera) "no camera" + (s.camProblem?.let { " (${it.name.lowercase()})" } ?: "") else if (s.camOn) "camera" else "camera off"
        return "$mic, $cam"
    }

    /** End for everyone (web: endForEveryone). */
    fun endForEveryone() = scope.launch {
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("call.end", mapOf("duration_ms" to joinedAt?.let { now() - it }))
        val sent = room?.send(CallProtocol.end()) ?: false
        if (!sent) runCatching { deps.endCall() }
        finish(CallPhase.ENDED)
    }

    /**
     * Leave (web: leave): the room hears `leave`, the call goes on for the other person and the
     * screen offers Rejoin. A call nobody is in ends by itself after 10 minutes (the server).
     */
    fun leave() = scope.launch {
        if (_state.value.phase != CallPhase.LEFT) dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("call.leave", mapOf("duration_ms" to joinedAt?.let { now() - it }))
        finish(CallPhase.LEFT)
    }

    /** When I last joined (for call.leave / call.end durations). */
    private var joinedAt: Long? = null

    /** Back into a call I left (web: rejoin): a fresh room socket and link; mic / camera restored as I left them. */
    fun rejoin() = scope.launch {
        if (_state.value.phase != CallPhase.LEFT) return@launch
        finished = false
        opening = null
        join(wantRecord).join()
    }

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
        if (!media.hasMic) { refreshDevices(restore = false); return }
        val next = !_state.value.micOn
        media.setMicEnabled(next)
        deps.recorder.muted = !next
        prefs.micOff = !next
        _state.update { it.copy(micOn = next) }
        broadcastState { it.copy(mic = next) }
    }

    /** Camera on / off. Without a camera it tries to add one. */
    fun toggleCam() {
        if (!media.hasCamera) { refreshDevices(restore = false); return }
        val next = !_state.value.camOn
        media.setCameraEnabled(next)
        // For this call only: the next join starts with the camera on (core CallDevices).
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
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("call.screen_share", mapOf("on" to true))
        _state.update { it.copy(screenVideo = video) }
        applyEncoding()
        broadcastState { it.copy(screen = true) }
    }

    fun stopScreenShare() {
        if (!_state.value.sharingScreen) return
        media.stopScreenShare()
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("call.screen_share", mapOf("on" to false))
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

    /** Which annotation store a message or a gesture belongs to: the shared screen's, or the presented material page's. */
    private enum class AnnotSlot { SCREEN, MATERIAL }

    /** web `annotStoreFor`: no target = the screen; the current material page; anything else (another page) = none. */
    private fun slotFor(target: String?): AnnotSlot? = when {
        target.isNullOrEmpty() -> AnnotSlot.SCREEN
        target == _state.value.presenting?.target -> AnnotSlot.MATERIAL
        else -> null
    }

    private fun CallState.slot(slot: AnnotSlot) = if (slot == AnnotSlot.SCREEN) annotations else materialAnnotations
    private fun CallState.withSlot(slot: AnnotSlot, a: Annotations) = if (slot == AnnotSlot.SCREEN) copy(annotations = a) else copy(materialAnnotations = a)
    private fun editSlot(slot: AnnotSlot, f: (Annotations) -> Annotations) = _state.update { s -> s.withSlot(slot, f(s.slot(slot))) }

    private fun upsertAnnot(slot: AnnotSlot, stroke: dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke, from: String, name: String? = null) {
        val now = this.now()
        editSlot(slot) { a ->
            val key = "$from:${stroke.id}"
            val prev = a.strokes[key]
            val live = dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.pruneAnnotations(a.strokes, now, a.persist) { it.doneAt }
            val shown = dev.jeromeswannack.chineselearning.lab.core.calls.ShownStroke(stroke, from, if (stroke.done) prev?.doneAt ?: now else null)
            a.copy(
                strokes = live + (key to shown),
                lastRemoteAt = if (from != "me") now else a.lastRemoteAt,
                lastRemoteName = if (from != "me" && name != null) name else a.lastRemoteName,
            )
        }
    }

    private fun addPing(slot: AnnotSlot, from: String, x: Double, y: Double, name: String? = null) {
        val now = this.now()
        editSlot(slot) { a ->
            val pings = a.pings.filter { dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.pingProgress(it.at, now) != null } +
                dev.jeromeswannack.chineselearning.lab.core.calls.AnnotPing("$from:$now", from, x, y, now)
            a.copy(pings = pings, lastRemoteAt = if (from != "me") now else a.lastRemoteAt, lastRemoteName = if (from != "me" && name != null) name else a.lastRemoteName)
        }
    }

    fun sendAnnotation(stroke: dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke) {
        upsertAnnot(AnnotSlot.SCREEN, stroke, "me")
        room?.send(CallProtocol.annot(stroke))
    }

    fun sendPing(x: Double, y: Double) {
        addPing(AnnotSlot.SCREEN, "me", x, y)
        room?.send(CallProtocol.annotPing(x, y))
    }

    /** Port of AnnotationStore.upsertText: a finished text keeps the moment it was first finished. */
    private fun upsertText(slot: AnnotSlot, text: dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText, from: String, name: String? = null) {
        val now = this.now()
        editSlot(slot) { a ->
            val prev = a.texts[text.id]
            // What has faded away goes (web prune), never the one being written.
            val live = a.texts.filter { (k, t) -> k == text.id || dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.textAlpha(t.doneAt, now, a.persist) > 0 }
            val shown = dev.jeromeswannack.chineselearning.lab.core.calls.ShownText(text, from, if (text.done) prev?.doneAt ?: now else null)
            a.copy(
                texts = live + (text.id to shown),
                lastRemoteAt = if (from != "me") now else a.lastRemoteAt,
                lastRemoteName = if (from != "me" && name != null) name else a.lastRemoteName,
            )
        }
    }

    /** A text box on the shared screen: placed, typed into, moved (round 4, web sendAnnotText). */
    fun sendAnnotText(text: dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText) {
        upsertText(AnnotSlot.SCREEN, text, "me")
        room?.send(CallProtocol.annotText(text))
    }

    /** ✕ on a selected text, or a text left empty: gone for both people. */
    fun deleteAnnotText(id: String) {
        editSlot(AnnotSlot.SCREEN) { it.copy(texts = it.texts - id) }
        room?.send(CallProtocol.annotTextDelete(id))
    }

    fun clearAnnotations() {
        editSlot(AnnotSlot.SCREEN) { it.copy(strokes = emptyMap(), texts = emptyMap(), pings = emptyList()) }
        room?.send(CallProtocol.annotClear())
    }

    /** "Keep" on the drawing tools: keep drawings until cleared (true) or let them fade — for both people, screen and material alike (web setAnnotationsKept). */
    fun setAnnotationsKept(persist: Boolean) {
        _state.update { it.copy(annotations = it.annotations.withPersist(persist, now()), materialAnnotations = it.materialAnnotations.withPersist(persist, now())) }
        room?.send(CallProtocol.annotMode(persist))
    }

    // ------------------------------------------------------------ in-call activities

    /**
     * The room's latest session (it owns the state machine). One with the same session id and a lower
     * `v` is stale and ignored ([force]: a welcome, whatever it says). [live]: the quiz / dictation audio
     * plays here when `data.play` went up within the same session + round (never on first receipt).
     * Review together keeps one counter for the whole list (selecting keeps it): the key is the session
     * only, and a rise plays the selected item's R2 clip (`data.clip`) on this device (web ActivityTile).
     */
    private fun applyActivity(next: dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession?, live: Boolean, force: Boolean = false) {
        val cur = _state.value.activity
        if (!force && next != null && cur != null && next.sessionId == cur.sessionId && next.v < cur.v) return
        if (live && next != null && cur != null && next.sessionId == cur.sessionId && (next.data.play ?: 0) > (cur.data.play ?: 0)) {
            if (next.spec.kind == dev.jeromeswannack.chineselearning.lab.core.calls.ActivityKinds.REVIEW) {
                reviewClip(next)?.let { (key, fallback) -> runCatching { deps.playClip(key, fallback) } }
            } else if (next.round == cur.round) {
                activityAudio(next)?.let { runCatching { deps.speak(it) } }
            }
        }
        if (next == null || next.sessionId != cur?.sessionId || next.round != cur.round) {
            draftJob?.cancel()
            pendingDraft = null
        }
        _activity.value = next
        _state.update { it.copy(activity = next) }
    }

    /** What the quiz / dictation round says aloud: the question's `audio`, the dictation word. */
    fun activityAudio(s: dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession): String? = when (s.spec.kind) {
        dev.jeromeswannack.chineselearning.lab.core.calls.ActivityKinds.QUIZ -> s.spec.questionList.getOrNull(s.round)?.audio?.takeIf { it.isNotBlank() }
        dev.jeromeswannack.chineselearning.lab.core.calls.ActivityKinds.DICTATION -> s.spec.itemList.getOrNull(s.round)?.hanzi?.takeIf { it.isNotBlank() }
        else -> null
    }

    /** Review together: the clip the last "play for both" asked for (R2 key) + what the device voice says without it (the word, for the reference clip only). */
    fun reviewClip(s: dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession): Pair<String, String>? {
        val key = dev.jeromeswannack.chineselearning.lab.core.calls.CallActivities.reviewClipKey(s.spec, s.round, s.data.clip) ?: return null
        val word = s.spec.itemList.getOrNull(s.round)?.hanzi.orEmpty()
        return key to (if (s.data.clip == "reference") word else "")
    }

    /** ⋯ → 🎲 Activities: start one (replaces a running one); the room answers with `activity` to both. */
    fun startActivity(activityId: String) {
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("call.activity_start", mapOf("activity_kind" to (dev.jeromeswannack.chineselearning.lab.core.calls.CallActivities.find(activityId)?.kind ?: dev.jeromeswannack.chineselearning.lab.core.calls.ActivityKinds.REVIEW.takeIf { activityId == dev.jeromeswannack.chineselearning.lab.core.calls.CallActivities.REVIEW_ACTIVITY_ID })))
        room?.send(CallProtocol.activityStart(activityId))
    }

    /** Act in the running activity; the room runs the engine and sends the new session to both of us. */
    fun act(action: dev.jeromeswannack.chineselearning.lab.core.calls.ActivityAction) {
        val cur = _state.value.activity ?: return
        if (action is dev.jeromeswannack.chineselearning.lab.core.calls.ActivityAction.Draft) { draftActivity(action.text); return }
        // A draft still waiting goes first (Submit must carry the last keystroke).
        flushDraft()
        room?.send(CallProtocol.activityAction(cur.sessionId, action))
    }

    /** ✕ on the activity tile (anyone): its result is kept with the lesson. */
    fun closeActivity() {
        val cur = _state.value.activity ?: return
        room?.send(CallProtocol.activityClose(cur.sessionId))
    }

    private var pendingDraft: String? = null
    private var lastDraftAt = Long.MIN_VALUE / 2
    private var draftJob: Job? = null

    /** Dictation: what the writer types, at most every [DRAFT_EVERY_MS] (the last one always goes, trailing). */
    fun draftActivity(text: String) {
        pendingDraft = text
        val wait = lastDraftAt + DRAFT_EVERY_MS - now()
        if (wait <= 0) { flushDraft(); return }
        if (draftJob?.isActive == true) return
        draftJob = scope.launch { delay(wait); flushDraft() }
    }

    private fun flushDraft() {
        draftJob?.cancel()
        draftJob = null
        val text = pendingDraft ?: return
        pendingDraft = null
        val cur = _state.value.activity ?: return
        lastDraftAt = now()
        room?.send(CallProtocol.activityAction(cur.sessionId, dev.jeromeswannack.chineselearning.lab.core.calls.ActivityAction.Draft(text)))
    }

    // ------------------------------------------------------------ round 5: the tutor leads (core CallFollow)

    private fun myId(): String = deps.userId().ifEmpty { _state.value.myUserId }

    private fun availability(s: CallState) = CallLayout.Availability(screen = s.remote?.sharing == true || s.sharingScreen, material = s.presenting != null, activity = s.activity != null)

    private fun available(tile: CallLayout.TileId, s: CallState): Boolean {
        val a = availability(s)
        return when (tile) {
            CallLayout.TileId.SCREEN -> a.screen
            CallLayout.TileId.MATERIAL -> a.material
            CallLayout.TileId.ACTIVITY -> a.activity
            else -> true
        }
    }

    /** The tiles on my stage now (the screen's own arrangement: core CallLayout.arrangeTiles). */
    fun stage(): List<CallLayout.TileId> {
        val holder = deps.layout ?: return emptyList()
        return CallLayout.arrangeTiles(holder.layout.value, availability(_state.value), stageWidth).stage
    }

    /** The call screen's width (dp), so the stage here is the one on the screen. */
    fun setStageWidth(widthDp: Double) {
        if (widthDp <= 0 || widthDp == stageWidth) return
        stageWidth = widthDp
        stageChanged()
    }

    private val leads: Boolean get() = _state.value.let { it.tutorId != null && it.tutorId == myId() && it.remote != null }

    private fun stageChanged() {
        val stage = stage()
        val prev = lastStage
        lastStage = stage
        val s = _state.value
        // The banner goes once the shown tile is no longer on my stage.
        if (s.showingBanner != null) {
            val t = s.shown?.let { CallFollow.tileForShow(it.view) }
            if (t == null || t !in stage) _state.update { it.copy(showingBanner = null) }
        }
        // The tutor opening the board shows it to the student without the button.
        if (prev != stage && leads) CallFollow.autoShowBoard(prev, stage)?.let { kind -> show(viewOf(kind)) }
        // A tile that appeared (a material, their share, an activity): a show that waited for it applies now.
        follow()
    }

    /** What the tutor's button shows for [kind]: the board with the page she is on. */
    private fun viewOf(kind: CallFollow.ShowKind): CallFollow.ShowView =
        if (kind == CallFollow.ShowKind.TEXT) CallFollow.ShowView.text(_state.value.pages.shown) else CallFollow.ShowView(kind)

    /** The student's device: act on the room's latest show, once per new show (core CallFollow.followStep). */
    private fun follow() {
        val holder = deps.layout ?: return
        val s = _state.value
        val shown = s.shown ?: return
        val tile = CallFollow.tileForShow(shown.view)
        when (val step = CallFollow.followStep(applied, shown, myId(), available(tile, s), tile in stage())) {
            CallFollow.FollowStep.None -> Unit
            is CallFollow.FollowStep.Stage -> {
                applied = CallFollow.AppliedShow(shown.id, shown.v)
                holder.dispatch(CallLayout.Action.Shown(step.tile))
                step.page?.let { openShownPage(it) }
                _state.update { it.copy(showingBanner = CallFollow.showingBanner(shown.name)) }
                diag("follow", "${shown.name.ifBlank { "The tutor" }} showed ${shown.view.kind.wire}" + (step.page?.let { " (page $it)" } ?: ""))
            }
            is CallFollow.FollowStep.Page -> {
                applied = CallFollow.AppliedShow(shown.id, shown.v)
                openShownPage(step.page)
            }
        }
    }

    /** The board page the tutor shows (my following of her pages is left as it was). */
    private fun openShownPage(page: String) {
        val p = _state.value.pages
        if (p.shown == page || (p.pages.isNotEmpty() && p.pages.none { it.id == page })) return
        val step = BoardPages.turnTo(p, page)
        applyPages(step.copy(state = step.state.copy(following = p.following)))
    }

    /** The tutor's board page changed while she shows the board: the student's board follows (the same show, `follow`). */
    private fun myBoardPageTurned(page: String?) {
        val s = _state.value
        val shown = s.shown ?: return
        if (page == null || !leads || shown.by != myId() || shown.view.kind != CallFollow.ShowKind.TEXT || shown.view.page == page) return
        show(CallFollow.ShowView.text(page), follow = true)
    }

    /** The tutor's "Show for student" (the room refuses anyone else). [follow]: a page turn of what is shown. */
    fun show(view: CallFollow.ShowView?, follow: Boolean = false): Boolean {
        if (!leads) return false
        return room?.send(CallProtocol.show(view, follow)) ?: false
    }

    /** The corner button on a stage tile: show that tile (the board with my page). */
    fun showTile(tile: CallLayout.TileId): Boolean {
        val kind = CallFollow.ShowKind.of(tile.wire) ?: return false
        return show(viewOf(kind))
    }

    /** The tutor's "Stop their share" on the student's shared screen. */
    fun stopTheirShare(): Boolean {
        val s = _state.value
        if (!leads || s.remote?.sharing != true) return false
        return room?.send(CallProtocol.stopShare()) ?: false
    }

    /** ✕ on "Minghui is showing you this" (the layout stays). */
    fun dismissShowingBanner() = _state.update { it.copy(showingBanner = null) }

    fun dismissShareStopped() = _state.update { it.copy(shareStoppedNote = null) }

    // ------------------------------------------------------------ lesson materials (round 4 PR 5)

    /** Present a material (both see it; either can turn its pages, draw and type on it). The room answers with `material`. */
    fun presentMaterial(materialId: String, page: Int = 0) {
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("call.material_present")
        room?.send(CallProtocol.materialOpen(materialId, page))
    }

    /** Turn the presented material to [page] (kept inside it), for both. */
    fun turnMaterialPage(page: Int) {
        val cur = _state.value.presenting ?: return
        val next = dev.jeromeswannack.chineselearning.lab.core.Materials.turnPage(page, 0, cur.pageCount)
        if (next == cur.page) return
        room?.send(CallProtocol.materialPage(next))
    }

    /** ✕ on the material tile: stop presenting (for both). */
    fun stopPresenting() {
        room?.send(CallProtocol.materialClose())
    }

    /** Drawing / typing on the current material page (web `materialAnnot`): mine shown at once, sent with the page's target. */
    fun sendMaterialStroke(stroke: dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke) {
        val target = _state.value.presenting?.target ?: return
        upsertAnnot(AnnotSlot.MATERIAL, stroke, "me")
        room?.send(CallProtocol.annot(stroke, target))
    }

    fun sendMaterialPing(x: Double, y: Double) {
        val target = _state.value.presenting?.target ?: return
        addPing(AnnotSlot.MATERIAL, "me", x, y)
        room?.send(CallProtocol.annotPing(x, y, target))
    }

    fun sendMaterialText(text: dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText) {
        val target = _state.value.presenting?.target ?: return
        upsertText(AnnotSlot.MATERIAL, text, "me")
        room?.send(CallProtocol.annotText(text, target))
    }

    fun deleteMaterialText(id: String) {
        val target = _state.value.presenting?.target ?: return
        editSlot(AnnotSlot.MATERIAL) { it.copy(texts = it.texts - id) }
        room?.send(CallProtocol.annotTextDelete(id, target))
    }

    fun clearMaterialAnnotations() {
        val target = _state.value.presenting?.target ?: return
        editSlot(AnnotSlot.MATERIAL) { it.copy(strokes = emptyMap(), texts = emptyMap(), pings = emptyList()) }
        room?.send(CallProtocol.annotClear(target))
    }

    // ------------------------------------------------------------ shared text board

    private var textBoard: dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard? = null

    private fun text(): dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard =
        textBoard ?: dev.jeromeswannack.chineselearning.lab.core.calls.CallTextBoard(deps.userId(), { m -> room?.send(m) ?: false }).also { textBoard = it }

    private var textRewrite = 0

    /** [rewrite]: the field must show the board's text now (their edits, a load, a catch-up). */
    private fun publishText(change: String, rewrite: Boolean = false) {
        val b = textBoard ?: return
        if (rewrite) textRewrite++
        _state.update {
            it.copy(textBoard = TextBoardUi(b.text, b.version, b.remoteCarets, b.mySelection(), change, b.page, textRewrite, b.field(), b.compositionIndex()))
        }
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

    /** The field as last reported (blur ends a composition with it). */
    private var fieldText = ""
    private var fieldEnd = 0
    /** A field text I ended a composition with from our side: the field's own late "composition over" report of it is not an edit. */
    private var endedWith: String? = null
    private var lastComposeAt = Long.MIN_VALUE / 2
    private var idleJob: Job? = null

    /**
     * The field changed: [text] with the selection [start]..[end] (UTF-16); [composing] while an IME
     * composition is open, [compStart] ..< [compEnd] its range. While composing, the text OUTSIDE the
     * composition is committed and goes out at once (Gboard commits "hello " while the next word is
     * composing); the composition itself only goes out as a preview beside my name ([compose]). The
     * other person's edits meanwhile wait in the document until the composition ends or idles
     * ([COMPOSE_IDLE_MS]).
     */
    fun textChanged(text: String, start: Int, end: Int, composing: Boolean, compose: String? = null, compStart: Int = -1, compEnd: Int = -1) {
        val b = text()
        fieldText = text; fieldEnd = end
        if (composing) {
            endedWith = null
            lastComposeAt = now()
            var sentNow = false
            if (compStart in 0..compEnd && compEnd <= text.length) {
                sentNow = b.composingEdit(text, start, end, compStart, compEnd)
                b.select(compStart, compStart, notify = false) // the preview sits where the composition starts
            } else if (!b.composing) b.setComposing(true)
            sendCompose(compose)
            if (sentNow) publishText("local")
            scheduleComposeIdle()
            return
        }
        idleJob?.cancel(); idleJob = null
        if (b.composing) {
            endCompose()
            b.setComposing(false, text, end)
            b.select(start, end) // the cursor message without `compose` ends the preview on their side
            b.flushHeld()
            publishText(if (b.text == text) "local" else "remote", rewrite = b.text != text)
            return
        }
        val stale = endedWith
        endedWith = null
        // The field reporting the composition I already ended (blur) — the board was rewritten since: not an edit.
        if (stale != null && text == stale) { publishText("local"); return }
        if (text != b.text) b.localEdit(text, end)
        b.select(start, end)
        publishText("local")
    }

    /**
     * Their edits wait for my open composition: after [COMPOSE_IDLE_MS] without a composing keystroke
     * the field catches up — the document's text with my composition spliced back in (it stays open).
     */
    private fun scheduleComposeIdle() {
        idleJob?.cancel()
        idleJob = null
        val b = textBoard ?: return
        if (!b.hasHeld) return
        val wait = maxOf(0L, lastComposeAt + COMPOSE_IDLE_MS - now())
        idleJob = scope.launch {
            delay(wait)
            val bb = textBoard ?: return@launch
            if (!bb.hasHeld) return@launch
            if (now() - lastComposeAt < COMPOSE_IDLE_MS) { scheduleComposeIdle(); return@launch }
            if (bb.catchUp()) {
                bb.field().let { f -> fieldText = f.text; fieldEnd = f.selEnd }
                publishText("catchup", rewrite = true)
            }
        }
    }

    fun textSelected(start: Int, end: Int) {
        textBoard?.let { if (!it.composing) it.select(start, end) }
    }

    /** The board lost focus: a composing span left open must not hold the other person's edits back — what was composed counts as typed. */
    fun textBlurred() {
        idleJob?.cancel(); idleJob = null
        endCompose()
        val b = textBoard ?: return
        if (b.composing) {
            // The field as it stands: the board's view with my composition at its anchor (it may have
            // been rebuilt by a catch-up since the last report), else the last report.
            val f = b.field()
            val (t, e) = if (f.composing) f.text to f.selEnd else fieldText to fieldEnd
            b.endComposition(t, e)
            endedWith = t
            publishText("remote", rewrite = true)
        }
        b.clearSelection()
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
        /** In-call activities: a dictation draft goes out at most this often (≈ 6 a second). */
        const val DRAFT_EVERY_MS = 170L
        const val STATS_EVERY_MS = 5_000L
        /** ≤ ~12 composition previews a second. */
        const val COMPOSE_MIN_GAP_MS = 84L
        /** A room `error` this soon after a page action is shown as a notice. */
        const val PAGE_ERROR_WINDOW_MS = 5_000L
        /** Join waits this long at most for a camera / mic still opening (web JOIN_MEDIA_WAIT_MS). */
        const val JOIN_MEDIA_WAIT_MS = 4_000L
        /**
         * A composition with no update for this long, while the other person's edits wait, is caught
         * up (web COMPOSE_IDLE_MS — Gboard keeps a composing span on the last word until a space).
         */
        const val COMPOSE_IDLE_MS = 1_500L
    }
}
