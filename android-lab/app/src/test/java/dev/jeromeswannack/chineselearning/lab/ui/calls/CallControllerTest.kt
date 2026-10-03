package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardOp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPoint
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChatMessage
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.CallSignal
import dev.jeromeswannack.chineselearning.lab.core.calls.LiveStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.core.calls.ServerMessage
import dev.jeromeswannack.chineselearning.lab.data.api.CallJoinDto
import dev.jeromeswannack.chineselearning.lab.data.api.IceServerDto
import dev.jeromeswannack.chineselearning.lab.data.calls.CallRoom
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomHandlers
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The live call's logic (port of useCall.ts) with a fake room, fake media and a fake recorder — no WebRTC needed. */
@OptIn(ExperimentalCoroutinesApi::class)
class CallControllerTest {
    class FakeRoom : CallRoom {
        lateinit var handlers: RoomHandlers
        val sent = ArrayList<JsonObject>()
        var open = true
        var connects = 0
        var reconnects = 0
        var closed = false
        var instance: String? = null
        override val clockOffset = 1_234L
        override fun connect() { connects++ }
        override fun reconnectNow() { reconnects++ }
        override fun send(text: String): Boolean { if (!open) return false; sent += Json.parseToJsonElement(text).jsonObject; return true }
        override fun close() { closed = true }
        fun types() = sent.map { it["type"]!!.jsonPrimitive.content }
    }

    class FakePeer(val polite: Boolean, val listener: PeerListener, var sending: VideoHandle? = "camera", var sendingAudio: VideoHandle? = "mic", override var screenChannel: Boolean = true) : PeerSession {
        var sendingScreen: VideoHandle? = null
        var offerResends = 0
        override fun resendPendingOffer() { offerResends++ }
        val signals = ArrayList<CallSignal>()
        var closed = false
        var restarts = 0
        val encodings = ArrayList<CallConnection.VideoEncoding>()
        var stats: PeerStats? = null
        override fun handleSignal(signal: CallSignal) { signals += signal }
        override fun setVideo(video: VideoHandle?) { sending = video }
        override fun setScreen(video: VideoHandle?) { sendingScreen = video }
        override fun setAudio(audio: VideoHandle?) { sendingAudio = audio }
        override fun restartIce() { restarts++ }
        override suspend fun stats() = stats
        override fun setVideoEncoding(encoding: CallConnection.VideoEncoding) { encodings += encoding }
        override fun close() { closed = true }
    }

    class FakeMedia(var result: MediaOpen = MediaOpen.Ok) : CallMedia {
        val peers = ArrayList<FakePeer>()
        var mic = true
        var cam = true
        var released = false
        var opens = 0
        var screenStopped: (() -> Unit)? = null
        override var hasMic = false
        override var hasCamera = false
        override var frontCamera = true
        override val micAudio: VideoHandle? get() = if (hasMic) "mic" else null
        override val cameraVideo: VideoHandle? get() = if (hasCamera) "camera" else null
        override var screenVideo: VideoHandle? = null
        override val screenShareSupported = true
        var openDelayMs = 0L
        override suspend fun open(): MediaOpen {
            opens++
            if (openDelayMs > 0) kotlinx.coroutines.delay(openDelayMs)
            if (result.mic) hasMic = true
            if (result.camera) hasCamera = true
            return result
        }
        override fun setMicEnabled(on: Boolean) { mic = on }
        override fun setCameraEnabled(on: Boolean) { cam = on }
        override suspend fun flipCamera(): Boolean { frontCamera = !frontCamera; return true }
        override fun startScreenShare(permission: Any, onStopped: () -> Unit): VideoHandle? { screenStopped = onStopped; screenVideo = "screen"; return "screen" }
        override fun stopScreenShare() { screenVideo = null }
        override fun createPeer(iceServers: List<IceServerDto>, polite: Boolean, listener: PeerListener) = FakePeer(polite, listener, cameraVideo, micAudio).also { peers += it }
        override fun release() { released = true }
        var stops = 0
        override fun stopDevices() { stops++; hasMic = false; hasCamera = false; screenVideo = null }
    }

    class FakeRecorder(override val supported: Boolean = true) : CallRecorderControl {
        override var recording = false
        override var muted = false
        var offset: (() -> Long)? = null
        var starts = 0
        var stops = 0
        override suspend fun start(clockOffset: () -> Long) { recording = true; starts++; offset = clockOffset }
        override suspend fun stop() { if (recording) stops++; recording = false }
    }

    private class Rig(scope: TestScope, media: FakeMedia = FakeMedia(), recorder: FakeRecorder = FakeRecorder(), val prefs: MemoryCallDevicePrefs = MemoryCallDevicePrefs(), val layout: CallLayoutHolder? = null) {
        val room = FakeRoom()
        val media = media
        val recorder = recorder
        var endCalls = 0
        var drains = 0
        var orphans = 0
        val alive = ArrayList<Boolean>()
        var screenPrepared = 0
        val instances = ArrayList<String>()
        val controller = CallController(
            "call1", "me",
            CallDeps(
                openRoom = { h, instance -> room.handlers = h; room.instance = instance; instances += instance; room },
                media = media, recorder = recorder,
                endCall = { endCalls++ },
                drainUploads = { drains++ },
                closeOrphans = { orphans++ },
                keepAlive = { alive += it },
                prepareScreenShare = { screenPrepared++ },
                uploadEveryMs = 60_000,
                now = { scope.testScheduler.currentTime },
                log = {},
                devicePrefs = prefs,
                layout = layout,
            ),
            scope.backgroundScope,
        )
    }

    private fun peer(id: String, user: String = "u2", state: PeerMediaState = PeerMediaState(mic = true, cam = true), instance: String? = null) = CallPeer(id, user, "王老师", null, state, instance)

    private fun welcome(peers: List<CallPeer> = emptyList(), board: List<BoardItem> = emptyList(), me: String = "c-me") =
        ServerMessage.Welcome(me, 1_790_000_000_500, 1_790_000_000_000, peers, board, listOf(CallChatMessage("m1", "u2", "王老师", "你好", 1)))

    @Test fun previewThenJoinThenWelcomeGoesLiveAndRecords() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.startPreview()
        runCurrent()
        assertTrue(rig.controller.state.value.mediaReady)
        assertEquals(1, rig.orphans)
        rig.controller.join(record = true)
        runCurrent()
        assertEquals(CallPhase.JOINING, rig.controller.state.value.phase)
        assertEquals(1, rig.room.connects)
        assertEquals(listOf(true), rig.alive)
        rig.room.handlers.onJoinInfo(CallJoinDto("t", "/ws", turn = false))
        rig.room.handlers.onMessage(welcome())
        runCurrent()
        val s = rig.controller.state.value
        assertEquals(CallPhase.LIVE, s.phase)
        assertEquals(1_790_000_000_000, s.startedAt)
        assertFalse(s.turn)
        assertEquals("你好", s.chat.single().text)
        assertNull(s.remote)
        assertTrue(s.recording)
        assertEquals(1_234L, rig.recorder.offset!!())
        // Media state first, then recording: true — like the web.
        assertEquals(listOf("state", "state"), rig.room.types())
        assertEquals(true, rig.room.sent.last()["state"]!!.jsonObject["recording"]!!.jsonPrimitive.content.toBoolean())
    }

    @Test fun noRecordingWhenTurnedOffOrUnsupported() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onMessage(welcome())
        runCurrent()
        assertFalse(rig.controller.state.value.recording)
        val rig2 = Rig(this, recorder = FakeRecorder(supported = false))
        rig2.controller.join(record = true)
        runCurrent()
        rig2.room.handlers.onMessage(welcome())
        runCurrent()
        assertFalse(rig2.controller.state.value.recording)
        assertFalse(rig2.controller.state.value.recordSupported)
    }

    @Test fun blockedDevicesNeverStopTheJoinAndCanBeAddedMidCall() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this, media = FakeMedia(MediaOpen(mic = false, camera = false, micProblem = MediaProblem.BLOCKED, cameraProblem = MediaProblem.BLOCKED)))
        rig.controller.startPreview()
        runCurrent()
        var s = rig.controller.state.value
        assertTrue(s.mediaReady)
        assertFalse(s.hasMic)
        assertEquals(MediaProblem.BLOCKED, s.micProblem)
        assertEquals(MediaProblem.BLOCKED, s.camProblem)
        assertEquals("Join without camera & mic", joinLabel(s))
        // Listen & watch only: the call is joined, nothing is recorded yet.
        rig.controller.join(record = true)
        runCurrent()
        assertEquals(1, rig.room.connects)
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))))
        runCurrent()
        s = rig.controller.state.value
        assertEquals(CallPhase.LIVE, s.phase)
        assertFalse(s.recording)
        val link = rig.media.peers.single()
        assertNull(link.sendingAudio)
        assertNull(link.sending)
        assertEquals("false", rig.room.sent.first { it["type"]!!.jsonPrimitive.content == "state" }["state"]!!.jsonObject["mic"]!!.jsonPrimitive.content)
        // Allowed mid-call (the mic button asked): both go onto the SAME link, recording starts, the other side is told.
        rig.media.result = MediaOpen.Ok
        rig.controller.toggleMic()
        runCurrent()
        s = rig.controller.state.value
        assertTrue(s.hasMic && s.hasCamera && s.micOn && s.camOn)
        assertEquals(1, rig.media.peers.size)
        assertEquals("mic", link.sendingAudio)
        assertEquals("camera", link.sending)
        assertTrue(s.recording)
        val last = rig.room.sent.last { it["type"]!!.jsonPrimitive.content == "state" }["state"]!!.jsonObject
        assertEquals("true", last["mic"]!!.jsonPrimitive.content)
        assertEquals("true", last["cam"]!!.jsonPrimitive.content)
        assertEquals(listOf(true, true), rig.alive) // the service is re-promoted with the new device types
    }

    @Test fun audioOnlyWhenThereIsNoCamera() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this, media = FakeMedia(MediaOpen(mic = true, camera = false, cameraProblem = MediaProblem.IN_USE)))
        rig.controller.startPreview()
        runCurrent()
        val s = rig.controller.state.value
        assertTrue(s.mediaReady)
        assertTrue(s.hasMic)
        assertFalse(s.hasCamera)
        assertFalse(s.camOn)
        assertEquals(MediaProblem.IN_USE, s.camProblem)
        assertEquals("Join with audio only", joinLabel(s))
        assertEquals("Join without microphone", joinLabel(s.copy(hasMic = false, hasCamera = true)))
        assertEquals("Join call", joinLabel(s.copy(hasCamera = true)))
    }

    @Test fun peerLinkPolitenessSignalsAndLeaving() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        // Our client id "c-me" > "c-a": we are the impolite side → we make the offer.
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))))
        runCurrent()
        val first = rig.media.peers.single()
        assertFalse(first.polite)
        assertEquals("c-a", rig.controller.state.value.remote!!.peer.clientId)
        // Our signals go to that peer through the room.
        first.listener.sendSignal(CallSignal.Candidate("candidate:1", "0", 0))
        runCurrent()
        val sig = rig.room.sent.last()
        assertEquals("signal", sig["type"]!!.jsonPrimitive.content)
        assertEquals("c-a", sig["to"]!!.jsonPrimitive.content)
        // Signals from them reach the link; from anyone else they're dropped.
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", CallSignal.Description("answer", "v=0").toJson()))
        rig.room.handlers.onMessage(ServerMessage.Signal("c-zzz", CallSignal.Description("answer", "v=0").toJson()))
        runCurrent()
        assertEquals(listOf<CallSignal>(CallSignal.Description("answer", "v=0")), first.signals)
        first.listener.onRemoteVideo("their-camera")
        first.listener.onConnectionState("connected")
        rig.room.handlers.onMessage(ServerMessage.PeerState("c-a", PeerMediaState(mic = false, cam = true)))
        runCurrent()
        val r = rig.controller.state.value.remote!!
        assertEquals("their-camera", r.video)
        assertEquals("connected", r.connection)
        assertFalse(r.peer.state.mic)
        // They leave → kept (frozen, "Reconnecting…") for the grace period, then the link is closed.
        rig.room.handlers.onMessage(ServerMessage.PeerLeft("c-a"))
        runCurrent()
        assertFalse(first.closed)
        val away = rig.controller.state.value.remote!!
        assertTrue(away.away)
        assertEquals("their-camera", away.video)
        // The media link itself is still up (shared tileStatus: connected = live); it'd say Reconnecting once it drops.
        assertEquals(CallConnection.TileStatus.LIVE, away.tile)
        first.listener.onConnectionState("disconnected")
        runCurrent()
        assertEquals(CallConnection.TileStatus.RECONNECTING, rig.controller.state.value.remote!!.tile)
        advanceTimeBy(CallConnection.PEER_AWAY_GRACE_MS + 1)
        runCurrent()
        assertTrue(first.closed)
        assertNull(rig.controller.state.value.remote)
        // A new peer with a larger id → we are polite.
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-z")))
        runCurrent()
        assertTrue(rig.media.peers.last().polite)
    }

    @Test fun boardLiveStrokesAndChat() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onMessage(welcome(board = listOf(BoardItem.Text("t1", "u2", "#1f2937", 0.1, 0.1, 80.0, "你好"))))
        runCurrent()
        val live = LiveStroke("s9", "#dc2626", 10.0, listOf(BoardPoint(0.1, 0.1)))
        rig.room.handlers.onMessage(ServerMessage.BoardLive("u2", live))
        runCurrent()
        assertEquals(live, rig.controller.state.value.liveStrokes["u2"])
        // Their committed stroke replaces the live one.
        rig.room.handlers.onMessage(ServerMessage.Board(BoardItem.Stroke("s9", "u2", "#dc2626", 10.0, live.points)))
        runCurrent()
        assertTrue(rig.controller.state.value.liveStrokes.isEmpty())
        assertEquals(listOf("t1", "s9"), rig.controller.state.value.board.map { it.id })
        // Mine: applied locally at once and sent.
        rig.controller.commitBoard(BoardOp.Delete("t1", "me"))
        assertEquals(listOf("s9"), rig.controller.state.value.board.map { it.id })
        assertEquals("board", rig.room.types().last())
        rig.controller.sendLiveStroke(null)
        assertEquals("board_live", rig.room.types().last())
        // Chat: echoes dedupe by id; blanks are never sent.
        assertFalse(rig.controller.sendChat("   "))
        assertTrue(rig.controller.sendChat(" 谢谢 "))
        assertEquals("谢谢", rig.room.sent.last()["text"]!!.jsonPrimitive.content)
        val m = CallChatMessage("m2", "me", "Jerome", "谢谢", 2)
        rig.room.handlers.onMessage(ServerMessage.Chat(m))
        rig.room.handlers.onMessage(ServerMessage.Chat(m))
        runCurrent()
        assertEquals(listOf("m1", "m2"), rig.controller.state.value.chat.map { it.id })
    }

    @Test fun controlsBroadcastStateAndMuteTheRecording() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = true)
        runCurrent()
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))))
        runCurrent()
        rig.controller.toggleMic()
        assertFalse(rig.media.mic)
        assertTrue(rig.recorder.muted)
        assertEquals("false", rig.room.sent.last()["state"]!!.jsonObject["mic"]!!.jsonPrimitive.content)
        rig.controller.toggleCam()
        assertFalse(rig.media.cam)
        rig.controller.flipCamera()
        runCurrent()
        assertFalse(rig.controller.state.value.frontCamera)
        rig.controller.startScreenShare("consent")
        runCurrent()
        assertEquals(1, rig.screenPrepared)
        // The screen has its own transceiver: the camera keeps going.
        assertEquals("screen", rig.media.peers.single().sendingScreen)
        assertEquals("camera", rig.media.peers.single().sending)
        assertTrue(rig.controller.state.value.sharingScreen)
        assertEquals("true", rig.room.sent.last()["state"]!!.jsonObject["screen"]!!.jsonPrimitive.content)
        // The system's "stop sharing" ends it too.
        rig.media.screenStopped!!()
        runCurrent()
        assertFalse(rig.controller.state.value.sharingScreen)
        assertNull(rig.media.peers.single().sendingScreen)
        assertEquals("camera", rig.media.peers.single().sending)
        rig.controller.stopRecording()
        runCurrent()
        assertFalse(rig.controller.state.value.recording)
        assertEquals(1, rig.recorder.stops)
    }

    @Test fun endForEveryoneThroughTheRoomElseTheApi() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = true)
        runCurrent()
        rig.room.handlers.onMessage(welcome())
        runCurrent()
        rig.controller.endForEveryone()
        runCurrent()
        assertEquals("end", rig.room.types().last())
        assertEquals(0, rig.endCalls)
        val s = rig.controller.state.value
        assertEquals(CallPhase.ENDED, s.phase)
        assertFalse(s.recording)
        assertTrue(rig.room.closed)
        assertTrue(rig.media.released)
        assertEquals(listOf(true, false), rig.alive)
        assertTrue(rig.drains >= 1)

        val rig2 = Rig(this)
        rig2.controller.join(record = false)
        runCurrent()
        rig2.room.open = false
        rig2.controller.endForEveryone()
        runCurrent()
        assertEquals(1, rig2.endCalls)
    }

    // ------------------------------------------------------------ round 4: Leave (the call goes on) vs End (for everyone)

    @Test fun leaveKeepsTheCallForThemAndRejoinComesBackWithTheCameraOn() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = true)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))))
        runCurrent()
        rig.controller.toggleCam() // camera off before leaving: it comes back ON (round 5, core CallDevices)
        val firstInstance = rig.room.instance
        rig.controller.leave()
        runCurrent()
        var s = rig.controller.state.value
        assertEquals(CallPhase.LEFT, s.phase)
        // Never "end": the room only hears the socket close (CallRoomSocket.close sends `leave` first).
        assertFalse(rig.room.types().contains("end"))
        assertEquals(0, rig.endCalls)
        assertTrue(rig.room.closed)
        assertNull(s.remote)
        assertFalse(s.recording)
        assertEquals(1, rig.recorder.stops)
        // The devices close but the engine stays, so a rejoin can open them again.
        assertEquals(1, rig.media.stops)
        assertFalse(rig.media.released)
        assertEquals(listOf(true, false), rig.alive)
        assertTrue(rig.drains >= 1)
        // Anything the old socket still delivers is ignored.
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-b")))
        runCurrent()
        assertNull(rig.controller.state.value.remote)

        rig.room.closed = false
        val opensBefore = rig.media.opens
        rig.controller.rejoin()
        runCurrent()
        s = rig.controller.state.value
        assertEquals(CallPhase.JOINING, s.phase)
        assertEquals(2, rig.room.connects)
        assertTrue(rig.room.instance != firstInstance) // a new join = a new session id
        assertEquals(opensBefore + 1, rig.media.opens)
        assertTrue(s.hasMic && s.hasCamera)
        assertTrue(s.micOn)
        assertTrue(s.camOn) // round 5: the camera always starts on (Minghui's "camera off" every join)
        assertEquals(listOf(true, false, true), rig.alive)
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))))
        runCurrent()
        s = rig.controller.state.value
        assertEquals(CallPhase.LIVE, s.phase)
        assertTrue(s.recording) // recording was on: it resumes
        assertNotNull(s.remote)
    }

    @Test fun leaveFromTheAppBeingRemovedAndRejoinOnlyAfterLeaving() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        rig.controller.leaveNow()
        runCurrent()
        assertEquals(CallPhase.LEFT, rig.controller.state.value.phase)
        assertTrue(rig.room.closed)

        // Ended for everyone: nothing to rejoin.
        val ended = liveRig(emptyList())
        ended.controller.endForEveryone()
        runCurrent()
        assertEquals("end", ended.room.types().last())
        assertTrue(ended.media.released)
        assertEquals(0, ended.media.stops)
        ended.controller.rejoin()
        runCurrent()
        assertEquals(CallPhase.ENDED, ended.controller.state.value.phase)
        assertEquals(1, ended.room.connects)
    }

    @Test fun endedByTheOtherSideOrReplaced() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = true)
        runCurrent()
        rig.room.handlers.onMessage(welcome())
        rig.room.handlers.onMessage(ServerMessage.Ended("u2"))
        runCurrent()
        assertEquals(CallPhase.ENDED, rig.controller.state.value.phase)
        assertEquals(1, rig.recorder.stops)
        // Anything after the end is ignored.
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-b")))
        runCurrent()
        assertNull(rig.controller.state.value.remote)

        val rig2 = Rig(this)
        rig2.controller.join(record = false)
        runCurrent()
        rig2.room.handlers.onMessage(ServerMessage.Replaced)
        runCurrent()
        assertEquals(CallPhase.ERROR, rig2.controller.state.value.phase)
        assertEquals("You joined this call from another tab or device.", rig2.controller.state.value.error)

        val rig3 = Rig(this)
        rig3.controller.join(record = false)
        runCurrent()
        rig3.room.handlers.onStatus(RoomStatus.RECONNECTING)
        runCurrent()
        assertEquals(RoomStatus.RECONNECTING, rig3.controller.state.value.roomStatus)
        rig3.room.handlers.onFatal("Could not join the call: This call has ended")
        runCurrent()
        assertEquals(CallPhase.ERROR, rig3.controller.state.value.phase)
        assertNotNull(rig3.controller.state.value.error)
    }

    // ------------------------------------------------------------ round 2: keeping the call through dropouts

    private fun TestScope.liveRig(peers: List<CallPeer>): Rig {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(welcome(peers = peers))
        runCurrent()
        return rig
    }

    private fun Rig.sentOf(type: String) = room.sent.filter { it["type"]!!.jsonPrimitive.content == type }

    @Test fun theSameSessionComingBackKeepsTheLinkAndItsPicture() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a", instance = "tutortab1")))
        val link = rig.media.peers.single()
        link.listener.onRemoteVideo("their-camera")
        link.listener.onConnectionState("connected")
        runCurrent()
        // Their socket drops (a signalling blip): the link and their last frame stay.
        rig.room.handlers.onMessage(ServerMessage.PeerLeft("c-a"))
        runCurrent()
        assertTrue(rig.controller.state.value.remote!!.away)
        advanceTimeBy(10_000)
        // …and they come back on a new socket from the same page load.
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-b", instance = "tutortab1")))
        runCurrent()
        assertEquals(1, rig.media.peers.size)
        assertFalse(link.closed)
        val r = rig.controller.state.value.remote!!
        assertFalse(r.away)
        assertEquals("c-b", r.peer.clientId)
        assertEquals("their-camera", r.video)
        assertEquals(CallConnection.TileStatus.LIVE, r.tile)
        // Signals now go to (and are accepted from) the new client id only.
        link.listener.sendSignal(CallSignal.Candidate("candidate:9", "0", 0))
        runCurrent()
        assertEquals("c-b", rig.sentOf("signal").last()["to"]!!.jsonPrimitive.content)
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", CallSignal.Description("answer", "old").toJson()))
        rig.room.handlers.onMessage(ServerMessage.Signal("c-b", CallSignal.Description("answer", "new").toJson()))
        runCurrent()
        assertEquals(listOf<CallSignal>(CallSignal.Description("answer", "new")), link.signals)
        // The grace timer was cancelled: nothing closes later.
        advanceTimeBy(CallConnection.PEER_AWAY_GRACE_MS * 2)
        runCurrent()
        assertFalse(link.closed)
        // The connection log says what happened.
        val details = rig.sentOf("diag").flatMap { it["events"]!!.jsonArray.map { e -> e.jsonObject["kind"]!!.jsonPrimitive.content + ":" + e.jsonObject["detail"]!!.jsonPrimitive.content } }
        assertTrue(details.toString(), details.any { it.startsWith("peer:") && "left the room" in it })
        assertTrue(details.toString(), details.any { it.startsWith("peer:") && "came back" in it })
    }

    @Test fun aNewSessionOrNoInstanceGetsANewLink() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a", instance = "tab1")))
        rig.room.handlers.onMessage(ServerMessage.PeerLeft("c-a"))
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-b", instance = "tab2")))
        runCurrent()
        assertEquals(2, rig.media.peers.size)
        assertTrue(rig.media.peers[0].closed)
        // An older client without an instance is never adopted.
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-c")))
        runCurrent()
        assertEquals(3, rig.media.peers.size)
        assertTrue(rig.media.peers[1].closed)
    }

    @Test fun ourOwnReconnectAdoptsTheLinkAndANewJoinGetsANewInstance() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a", instance = "tab1")))
        val link = rig.media.peers.single()
        link.listener.onConnectionState("connecting") // a link still `new` is never kept (round 4)
        runCurrent()
        val instance = rig.room.instance!!
        assertEquals(instance, CallConnection.sanitizeInstance(instance))
        // Our socket drops and comes back: a new welcome (new client id for us), they're still there.
        rig.room.handlers.onStatus(RoomStatus.RECONNECTING)
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a", instance = "tab1")), me = "c-zz"))
        runCurrent()
        assertEquals(1, rig.media.peers.size)
        assertFalse(link.closed)
        assertFalse(link.polite) // politeness stays as the link was created
        assertEquals(1, rig.instances.size)
        // They were gone while we were away: keep the link for the grace period.
        rig.room.handlers.onMessage(welcome(peers = emptyList(), me = "c-zz2"))
        runCurrent()
        assertTrue(rig.controller.state.value.remote!!.away)
        assertFalse(link.closed)
    }

    @Test fun iceRestartsFollowTheLinkHealthOnlyWhileTheSocketIsOpen() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a", instance = "tab1")))
        val link = rig.media.peers.single()
        link.listener.onConnectionState("connected")
        runCurrent()
        link.listener.onConnectionState("disconnected")
        runCurrent()
        assertEquals(CallConnection.TileStatus.RECONNECTING, rig.controller.state.value.remote!!.tile)
        advanceTimeBy(CallConnection.DISCONNECT_GRACE_MS - 1)
        runCurrent()
        assertEquals(0, link.restarts) // it may heal by itself
        advanceTimeBy(2)
        runCurrent()
        assertEquals(1, link.restarts)
        advanceTimeBy(CallConnection.restartBackoffMs(1) + 1)
        runCurrent()
        assertEquals(2, link.restarts)
        // The socket goes down: no restarts (the offer couldn't reach them)…
        rig.room.handlers.onStatus(RoomStatus.RECONNECTING)
        runCurrent()
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(2, link.restarts)
        // …until it is back: the overdue restart happens at once.
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        runCurrent()
        assertEquals(3, link.restarts)
        // Connected again resets it; failed restarts at once.
        link.listener.onConnectionState("connected")
        link.listener.onConnectionState("failed")
        runCurrent()
        assertEquals(4, link.restarts)
        val kinds = rig.sentOf("diag").flatMap { it["events"]!!.jsonArray.map { e -> e.jsonObject["kind"]!!.jsonPrimitive.content } }
        assertTrue(kinds.toString(), "restart" in kinds && "pc" in kinds && "room" in kinds)
    }

    @Test fun diagnosticsAreBufferedWhileTheSocketIsDownAndBatched() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.room.open = false
        rig.controller.join(record = false)
        runCurrent()
        repeat(70) { rig.controller.diag("media", "event $it") }
        assertTrue(rig.sentOf("diag").isEmpty())
        rig.room.open = true
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        runCurrent()
        val batches = rig.sentOf("diag").map { it["events"]!!.jsonArray.size }
        assertTrue(batches.toString(), batches.all { it <= CallConnection.MAX_DIAG_EVENTS_PER_MESSAGE })
        assertEquals(73, batches.sum()) // "camera opened" + join + 70 + "room open"
    }

    @Test fun routeAndEncodingFollowTheStats() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a", instance = "tab1")))
        val link = rig.media.peers.single()
        assertEquals(CallConnection.videoEncodingFor(CallConnection.VideoSource.CAMERA, null), link.encodings.single())
        link.stats = PeerStats(200_000.0, "relay/udp via turn")
        link.listener.onConnectionState("connected")
        runCurrent()
        assertEquals(2.0, link.encodings.last().scaleResolutionDownBy, 0.0)
        val routes = rig.sentOf("diag").flatMap { it["events"]!!.jsonArray }.filter { it.jsonObject["kind"]!!.jsonPrimitive.content == "route" }
        assertEquals("relay/udp via turn", routes.single().jsonObject["detail"]!!.jsonPrimitive.content)
        // The screen has its own sender (PeerLink encodes it): the camera's encoding stays a camera's.
        rig.controller.startScreenShare("consent")
        runCurrent()
        assertEquals("maintain-framerate", link.encodings.last().degradationPreference)
        // An older app (one video m-line): the share goes out on the camera sender, which then keeps its resolution.
        link.screenChannel = false
        advanceTimeBy(CallController.STATS_EVERY_MS + 1)
        runCurrent()
        assertEquals("maintain-resolution", link.encodings.last().degradationPreference)
        // The next poll (every 5 s) with a better estimate goes back to full size… for the camera.
        rig.controller.stopScreenShare()
        link.stats = PeerStats(2_000_000.0, "relay/udp via turn")
        advanceTimeBy(CallController.STATS_EVERY_MS + 1)
        runCurrent()
        assertEquals(1.0, link.encodings.last().scaleResolutionDownBy, 0.0)
        assertEquals(1, rig.sentOf("diag").flatMap { it["events"]!!.jsonArray }.count { it.jsonObject["kind"]!!.jsonPrimitive.content == "route" })
    }

    @Test fun composingSendsAThrottledPreviewAndEndsIt() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        rig.controller.textChanged("我", 1, 1, composing = false)
        rig.room.sent.clear()
        rig.controller.textChanged("我n", 2, 2, composing = true, compose = "n")
        rig.controller.textChanged("我ni", 3, 3, composing = true, compose = "ni")
        rig.controller.textChanged("我nih", 4, 4, composing = true, compose = "nih")
        runCurrent()
        // The first at once, the rest waits for the gap: no text ops while composing.
        assertEquals(listOf("n"), rig.sentOf("text_cursor").map { it["compose"]!!.jsonPrimitive.content })
        assertTrue(rig.sentOf("text").isEmpty())
        advanceTimeBy(CallController.COMPOSE_MIN_GAP_MS + 1)
        runCurrent()
        assertEquals(listOf("n", "nih"), rig.sentOf("text_cursor").map { it["compose"]!!.jsonPrimitive.content })
        // Committed: the text goes out and the cursor message carries no preview any more.
        rig.controller.textChanged("我你", 2, 2, composing = false)
        runCurrent()
        assertEquals(1, rig.sentOf("text").size)
        assertNull(rig.sentOf("text_cursor").last()["compose"])
        assertEquals("我你", rig.controller.state.value.textBoard.text)
        // Their preview arrives with their cursor and never enters the text.
        rig.room.handlers.onMessage(ServerMessage.TextCursorMsg(dev.jeromeswannack.chineselearning.lab.core.calls.TextCursor("c-a", "u2", "王老师", null, compose = "hao")))
        runCurrent()
        assertEquals("我你", rig.controller.state.value.textBoard.text)
    }

    @Test fun aNetworkChangeReconnectsTheRoomAtOnce() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        rig.controller.networkChanged("switched network")
        assertEquals(1, rig.room.reconnects)
    }

    // ---- round 2 (PR B): the screen has its own channel

    @Test fun theirScreenArrivesOnItsOwnStreamAndTheCameraStays() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a")))
        val link = rig.media.peers.single()
        link.listener.onRemoteVideo("their-camera")
        link.listener.onRemoteScreen("their-screen")
        runCurrent()
        var r = rig.controller.state.value.remote!!
        assertEquals("their-camera", r.video)
        assertEquals("their-screen", r.screen)
        assertTrue(r.screenChannel)
        // Not sharing yet: no screen tile.
        assertNull(r.screenVideo)
        assertTrue(r.cameraOn)
        rig.room.handlers.onMessage(ServerMessage.PeerState("c-a", PeerMediaState(mic = true, cam = true, screen = true)))
        runCurrent()
        r = rig.controller.state.value.remote!!
        assertEquals("their-screen", r.screenVideo)
        assertTrue("their camera keeps going while they share", r.cameraOn)
    }

    @Test fun anOlderAppSendsItsScreenOnTheCameraStream() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a")))
        val link = rig.media.peers.single()
        link.screenChannel = false
        link.listener.onRemoteVideo("their-video")
        runCurrent()
        rig.room.handlers.onMessage(ServerMessage.PeerState("c-a", PeerMediaState(mic = true, cam = true, screen = true)))
        runCurrent()
        val r = rig.controller.state.value.remote!!
        assertFalse(r.screenChannel)
        assertTrue(r.legacyShare)
        assertEquals("their-video", r.screenVideo)
        assertFalse("the camera stream carries the screen", r.cameraOn)
    }

    @Test fun aNewLinkWhileSharingPutsTheScreenOnItsTransceiver() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        rig.controller.startScreenShare("consent")
        runCurrent()
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-z")))
        runCurrent()
        val link = rig.media.peers.single()
        assertEquals("screen", link.sendingScreen)
        assertEquals("camera", link.sending)
    }

    // ------------------------------------------------------------ round 2 C: the sharer draws too; Keep drawings

    private fun annot(id: String, color: String, done: Boolean = true) =
        dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke(id, color, 0.006, listOf(0.2 to 0.3, 0.4 to 0.5), done)

    @Test fun keepDrawingsComesWithTheWelcomeAndTheirSwitch() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))).copy(annotPersist = true))
        runCurrent()
        assertTrue("the room says drawings are kept", rig.controller.state.value.annotations.persist)
        // Their stroke, finished; a minute later it is still there (kept), and survives the next stroke's pruning.
        rig.room.handlers.onMessage(ServerMessage.Annot("c-a", "王老师", annot("s1", "#38bdf8")))
        runCurrent()
        advanceTimeBy(60_000)
        rig.room.handlers.onMessage(ServerMessage.Annot("c-a", "王老师", annot("s2", "#38bdf8")))
        runCurrent()
        assertEquals(setOf("c-a:s1", "c-a:s2"), rig.controller.state.value.annotations.strokes.keys)
        // They switch Keep off: every finished stroke starts its fade now, nothing vanishes at once.
        val offAt = testScheduler.currentTime
        rig.room.handlers.onMessage(ServerMessage.AnnotMode("c-a", "王老师", false))
        runCurrent()
        val a = rig.controller.state.value.annotations
        assertFalse(a.persist)
        assertEquals(listOf(offAt, offAt), a.strokes.values.map { it.doneAt })
        // …and once faded, the next stroke prunes them.
        advanceTimeBy(dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.ANNOT_HOLD_MS + dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.ANNOT_FADE_MS + 1)
        rig.room.handlers.onMessage(ServerMessage.Annot("c-a", "王老师", annot("s3", "#38bdf8", done = false)))
        runCurrent()
        assertEquals(setOf("c-a:s3"), rig.controller.state.value.annotations.strokes.keys)
        // Round 4: a welcome without annot_persist (an older room) = kept — Keep is the default.
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))))
        runCurrent()
        assertTrue(rig.controller.state.value.annotations.persist)
    }

    @Test fun myKeepSwitchIsSentToTheRoom() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a")))
        rig.controller.setAnnotationsKept(true)
        assertTrue(rig.controller.state.value.annotations.persist)
        rig.controller.setAnnotationsKept(false)
        assertFalse(rig.controller.state.value.annotations.persist)
        assertEquals(listOf("true", "false"), rig.sentOf("annot_mode").map { it["persist"]!!.jsonPrimitive.content })
    }

    @Test fun theSharerDrawsOnTheirOwnScreenInBlueAndSeesTheViewersRed() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a")))
        // Watching: my pen starts red.
        assertFalse(rig.controller.state.value.iShareScreen)
        assertEquals(dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.VIEWER_ANNOT_COLOR, annotPen(null, rig.controller.state.value))
        rig.controller.startScreenShare("consent")
        runCurrent()
        val s = rig.controller.state.value
        assertTrue(s.iShareScreen)
        assertEquals("#38bdf8", annotPen(null, s))
        assertEquals("a picked colour wins", "#22c55e", annotPen("#22c55e", s))
        // My stroke on my own screen goes to the room and shows here; theirs arrives in their colour.
        rig.controller.sendAnnotation(annot("m1", annotPen(null, s), done = false))
        rig.controller.sendAnnotation(annot("m1", annotPen(null, s)))
        rig.controller.sendPing(0.5, 0.5)
        rig.room.handlers.onMessage(ServerMessage.Annot("c-a", "王老师", annot("t1", "#f43f5e")))
        runCurrent()
        val sent = rig.sentOf("annot")
        assertEquals(2, sent.size)
        assertEquals("#38bdf8", sent.last()["stroke"]!!.jsonObject["color"]!!.jsonPrimitive.content)
        assertEquals("true", sent.last()["stroke"]!!.jsonObject["done"]!!.jsonPrimitive.content)
        assertEquals(1, rig.sentOf("annot_ping").size)
        val a = rig.controller.state.value.annotations
        assertEquals(mapOf("me:m1" to "#38bdf8", "c-a:t1" to "#f43f5e"), a.strokes.mapValues { it.value.stroke.color })
        assertEquals("王老师", a.lastRemoteName)
        // Clear clears both sides.
        rig.controller.clearAnnotations()
        assertTrue(rig.controller.state.value.annotations.strokes.isEmpty())
        assertEquals(1, rig.sentOf("annot_clear").size)
        // Both sharing: their screen is the one shown, so my pen is the viewer's again.
        rig.room.handlers.onMessage(ServerMessage.PeerState("c-a", PeerMediaState(mic = true, cam = true, screen = true)))
        runCurrent()
        assertFalse(rig.controller.state.value.iShareScreen)
        assertEquals("#f43f5e", annotPen(null, rig.controller.state.value))
    }

    // ------------------------------------------------------------ round 4: typing on a shared screen, Keep by default

    private fun atext(id: String, text: String, done: Boolean = true, x: Double = 0.3, color: String = "#f43f5e") =
        dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText(id, color, x, 0.4, text, dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.ANNOT_TEXT_SIZE, done)

    @Test fun keepIsOnBeforeTheRoomSaysAnything() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        assertTrue("Keep starts on", rig.controller.state.value.annotations.persist)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))))
        runCurrent()
        assertTrue(rig.controller.state.value.annotations.persist)
        // A room someone switched to fading says so.
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))).copy(annotPersist = false))
        runCurrent()
        assertFalse(rig.controller.state.value.annotations.persist)
    }

    @Test fun textsGoToTheRoomAsTypedAndCanBeDeleted() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a")))
        // Typing: live updates (not done), then finished.
        rig.controller.sendAnnotText(atext("t1", "这个", done = false))
        assertNull("still being written: not fading", rig.controller.state.value.annotations.texts["t1"]!!.doneAt)
        rig.controller.sendAnnotText(atext("t1", "这个字读什么？"))
        val finishedAt = rig.controller.state.value.annotations.texts["t1"]!!.doneAt
        assertEquals(testScheduler.currentTime, finishedAt)
        // Moved later: the same text, the moment it was first finished is kept.
        advanceTimeBy(5_000)
        rig.controller.sendAnnotText(atext("t1", "这个字读什么？", x = 0.6))
        val t = rig.controller.state.value.annotations.texts["t1"]!!
        assertEquals(0.6, t.text.x, 0.0)
        assertEquals(finishedAt, t.doneAt)
        assertEquals("me", t.from)
        val sent = rig.sentOf("annot_text")
        assertEquals(3, sent.size)
        assertEquals(listOf("false", "true", "true"), sent.map { it["text"]!!.jsonObject["done"]!!.jsonPrimitive.content })
        assertEquals("这个字读什么？", sent.last()["text"]!!.jsonObject["text"]!!.jsonPrimitive.content)
        // ✕: gone here and for them.
        rig.controller.deleteAnnotText("t1")
        assertTrue(rig.controller.state.value.annotations.texts.isEmpty())
        assertEquals(listOf("t1"), rig.sentOf("annot_text_delete").map { it["id"]!!.jsonPrimitive.content })
    }

    @Test fun theirTextsArriveMoveAndGo() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a")))
        rig.room.handlers.onMessage(ServerMessage.AnnotTextMsg("c-a", "王老师", atext("t9", "看这里", color = "#38bdf8")))
        runCurrent()
        val a = rig.controller.state.value.annotations
        assertEquals("看这里", a.texts["t9"]!!.text.text)
        assertEquals("c-a", a.texts["t9"]!!.from)
        assertEquals("王老师", a.lastRemoteName)
        // Kept (the default): a minute later it is still there.
        advanceTimeBy(60_000)
        rig.room.handlers.onMessage(ServerMessage.AnnotTextMsg("c-a", "王老师", atext("t10", "好")))
        runCurrent()
        assertEquals(setOf("t9", "t10"), rig.controller.state.value.annotations.texts.keys)
        rig.room.handlers.onMessage(ServerMessage.AnnotTextDelete("c-a", "t9"))
        runCurrent()
        assertEquals(setOf("t10"), rig.controller.state.value.annotations.texts.keys)
        // Keep off: finished texts start fading now, and once faded the next text prunes them.
        rig.room.handlers.onMessage(ServerMessage.AnnotMode("c-a", "王老师", false))
        runCurrent()
        assertEquals(testScheduler.currentTime, rig.controller.state.value.annotations.texts["t10"]!!.doneAt)
        advanceTimeBy(dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.ANNOT_HOLD_MS + dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate.ANNOT_FADE_MS + 1)
        rig.room.handlers.onMessage(ServerMessage.AnnotTextMsg("c-a", "王老师", atext("t11", "再", done = false)))
        runCurrent()
        assertEquals(setOf("t11"), rig.controller.state.value.annotations.texts.keys)
        // Clear clears texts too (theirs and mine).
        rig.room.handlers.onMessage(ServerMessage.AnnotClear("c-a"))
        runCurrent()
        assertTrue(rig.controller.state.value.annotations.texts.isEmpty())
        rig.controller.sendAnnotText(atext("m1", "我的"))
        rig.controller.clearAnnotations()
        assertTrue(rig.controller.state.value.annotations.texts.isEmpty())
    }

    @Test fun aRejoinShowsWhatTheRoomKept() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        val kept = dev.jeromeswannack.chineselearning.lab.core.calls.KeptAnnotations(
            strokes = listOf(dev.jeromeswannack.chineselearning.lab.core.calls.KeptAnnotations.KeptStroke("c-a:s1", "c-a", "王老师", annot("s1", "#38bdf8"))),
            texts = listOf(dev.jeromeswannack.chineselearning.lab.core.calls.KeptAnnotations.KeptText("c-a", "王老师", atext("t1", "第五课"))),
        )
        rig.room.handlers.onMessage(welcome(peers = listOf(peer("c-a"))).copy(annots = kept))
        runCurrent()
        val a = rig.controller.state.value.annotations
        assertTrue(a.persist)
        assertEquals(setOf("c-a:s1"), a.strokes.keys)
        assertEquals("第五课", a.texts["t1"]!!.text.text)
        // Drawn at once, as finished.
        assertEquals(testScheduler.currentTime, a.texts["t1"]!!.doneAt)
        assertEquals(testScheduler.currentTime, a.strokes["c-a:s1"]!!.doneAt)
    }

    // ------------------------------------------------------------ board pages (round 3)

    private val pagesAbc = listOf(
        dev.jeromeswannack.chineselearning.lab.core.calls.BoardPageMeta("pa"),
        dev.jeromeswannack.chineselearning.lab.core.calls.BoardPageMeta("pb"),
        dev.jeromeswannack.chineselearning.lab.core.calls.BoardPageMeta("pc"),
    )

    private fun pagedWelcome(page: String = "pa", views: Map<String, String> = mapOf("c-a" to "pa"), me: String = "c-me", text: String = "") =
        welcome(peers = listOf(peer("c-a", instance = "tab1")), me = me).copy(
            pages = pagesAbc, page = page, pageViews = views,
            text = if (text.isEmpty()) emptyList() else listOf(dev.jeromeswannack.chineselearning.lab.core.calls.TextRun(1, "u2:x", text, false)),
        )

    private fun doc(page: String, text: String) = ServerMessage.PageDoc(page, listOf(dev.jeromeswannack.chineselearning.lab.core.calls.TextRun(1, "u2:x", text, false)), emptyList())

    private fun TestScope.pagedRig(): Rig {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(pagedWelcome(text = "第一页"))
        runCurrent()
        return rig
    }

    @Test fun pagesTagTextAndIgnoreOtherPages() = runTest(UnconfinedTestDispatcher()) {
        val rig = pagedRig()
        val s = rig.controller.state.value
        assertEquals("pa", s.pages.current)
        assertEquals("pa", s.textBoard.page)
        assertEquals("第一页", s.textBoard.text)
        rig.controller.textChanged("第一页。", 4, 4, composing = false)
        assertEquals("pa", rig.sentOf("text").last()["page"]!!.jsonPrimitive.content)
        assertEquals("pa", rig.sentOf("text_cursor").last()["page"]!!.jsonPrimitive.content)
        // Text for another page is not mine to apply.
        val other = dev.jeromeswannack.chineselearning.lab.core.calls.TextOp.Ins(dev.jeromeswannack.chineselearning.lab.core.calls.CharId(9, "u2:x"), null, "X")
        rig.room.handlers.onMessage(ServerMessage.Text("c-a", listOf(other), page = "pb"))
        runCurrent()
        assertEquals("第一页。", rig.controller.state.value.textBoard.text)
    }

    @Test fun turningAPageAsksTheRoomAndLoadsItsDoc() = runTest(UnconfinedTestDispatcher()) {
        val rig = pagedRig()
        rig.controller.openPage("pb")
        assertEquals("pb", rig.sentOf("page_open").last()["page"]!!.jsonPrimitive.content)
        assertEquals("pb", rig.controller.state.value.pages.shown)
        rig.room.handlers.onMessage(doc("pb", "第二页"))
        runCurrent()
        val s = rig.controller.state.value
        assertEquals("pb", s.pages.current)
        assertEquals("第二页", s.textBoard.text)
        assertEquals("pb", s.textBoard.page)
        rig.controller.newPage()
        assertEquals(1, rig.sentOf("page_new").size)
        rig.controller.duplicatePage("pb")
        assertEquals("pb", rig.sentOf("page_duplicate").single()["page"]!!.jsonPrimitive.content)
        rig.controller.renamePage("pb", "  Tones \n drill ")
        assertEquals("Tones drill", rig.sentOf("page_rename").single()["title"]!!.jsonPrimitive.content)
        rig.controller.renamePage("pb", "   ")
        assertEquals(kotlinx.serialization.json.JsonNull, rig.sentOf("page_rename").last()["title"])
    }

    @Test fun followingJumpsWithThemAndTurningStopsIt() = runTest(UnconfinedTestDispatcher()) {
        val rig = pagedRig()
        rig.room.handlers.onMessage(ServerMessage.PageView("c-a", "pc"))
        runCurrent()
        assertEquals("pc", rig.controller.state.value.pages.otherPage)
        assertTrue(rig.sentOf("page_open").isEmpty())
        rig.controller.setFollowing(true)
        assertEquals("pc", rig.sentOf("page_open").last()["page"]!!.jsonPrimitive.content)
        rig.room.handlers.onMessage(doc("pc", "三"))
        rig.room.handlers.onMessage(ServerMessage.PageView("c-a", "pb"))
        runCurrent()
        assertEquals("pb", rig.sentOf("page_open").last()["page"]!!.jsonPrimitive.content)
        rig.controller.openPage("pa")
        assertFalse(rig.controller.state.value.pages.following)
        rig.controller.bringHere()
        assertEquals("pa", rig.sentOf("page_summon").single()["page"]!!.jsonPrimitive.content)
    }

    @Test fun summonAndDeleteMoveMeWithANotice() = runTest(UnconfinedTestDispatcher()) {
        val rig = pagedRig()
        rig.room.handlers.onMessage(ServerMessage.PageSummon("c-a", "王老师", "pc"))
        runCurrent()
        assertEquals("pc", rig.sentOf("page_open").last()["page"]!!.jsonPrimitive.content)
        assertEquals("王老师 brought you to page 3", rig.controller.state.value.boardNotice?.text)
        rig.room.handlers.onMessage(doc("pc", "三"))
        rig.room.handlers.onMessage(ServerMessage.Pages(pagesAbc.take(2)))
        rig.room.handlers.onMessage(ServerMessage.PageDeleted("pc", "pb", "王老师"))
        runCurrent()
        assertEquals("pb", rig.sentOf("page_open").last()["page"]!!.jsonPrimitive.content)
        assertEquals("王老师 deleted page 3", rig.controller.state.value.boardNotice?.text)
        rig.controller.dismissBoardNotice()
        // My own delete: moved, no notice.
        rig.room.handlers.onMessage(doc("pb", "二"))
        rig.controller.deletePage("pb")
        rig.room.handlers.onMessage(ServerMessage.Pages(pagesAbc.take(1)))
        rig.room.handlers.onMessage(ServerMessage.PageDeleted("pb", "pa", "Jerome"))
        runCurrent()
        assertEquals("pa", rig.sentOf("page_open").last()["page"]!!.jsonPrimitive.content)
        assertNull(rig.controller.state.value.boardNotice)
        // The room refuses deleting the last page: its reason shows.
        rig.controller.deletePage("pa")
        rig.room.handlers.onMessage(ServerMessage.Error("The board's last page can't be deleted"))
        runCurrent()
        assertEquals("The board's last page can't be deleted", rig.controller.state.value.boardNotice?.text)
    }

    @Test fun theirCaretLeavesWithThem() = runTest(UnconfinedTestDispatcher()) {
        val rig = pagedRig()
        val sel = dev.jeromeswannack.chineselearning.lab.core.calls.TextSelection(null, null)
        rig.room.handlers.onMessage(ServerMessage.TextCursorMsg(dev.jeromeswannack.chineselearning.lab.core.calls.TextCursor("c-a", "u2", "王老师", sel), page = "pa"))
        runCurrent()
        assertEquals(1, rig.controller.state.value.textBoard.remote.size)
        rig.room.handlers.onMessage(ServerMessage.PageView("c-a", "pb"))
        runCurrent()
        assertTrue(rig.controller.state.value.textBoard.remote.isEmpty())
        // A late caret for another page is dropped.
        rig.room.handlers.onMessage(ServerMessage.TextCursorMsg(dev.jeromeswannack.chineselearning.lab.core.calls.TextCursor("c-a", "u2", "王老师", sel), page = "pb"))
        runCurrent()
        assertTrue(rig.controller.state.value.textBoard.remote.isEmpty())
    }

    @Test fun aRejoinGoesBackToMyPageAndResendsWhatWasLost() = runTest(UnconfinedTestDispatcher()) {
        val rig = pagedRig()
        rig.controller.openPage("pb")
        rig.room.handlers.onMessage(doc("pb", "二"))
        runCurrent()
        rig.room.open = false
        rig.controller.textChanged("二三", 2, 2, composing = false) // lost with the socket
        rig.room.open = true
        rig.room.sent.clear()
        // The room welcomes me back on the opening page.
        rig.room.handlers.onMessage(pagedWelcome(page = "pa", me = "c-me2", text = "第一页"))
        runCurrent()
        assertEquals(listOf("pb"), rig.sentOf("text").map { it["page"]!!.jsonPrimitive.content })
        assertEquals("pb", rig.sentOf("page_open").single()["page"]!!.jsonPrimitive.content)
        assertEquals("二三", rig.controller.state.value.textBoard.text) // still my page, not the welcome's
        // Its doc (without my op yet): my op is applied again on top.
        rig.room.handlers.onMessage(doc("pb", "二"))
        runCurrent()
        assertEquals("pb", rig.controller.state.value.pages.current)
        assertEquals("二三", rig.controller.state.value.textBoard.text)
    }

    @Test fun anOlderRoomWithoutPagesStillWorks() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        assertNull(rig.controller.state.value.pages.current)
        rig.controller.textChanged("你好", 2, 2, composing = false)
        assertNull(rig.sentOf("text").last()["page"])
        val op = dev.jeromeswannack.chineselearning.lab.core.calls.TextOp.Ins(dev.jeromeswannack.chineselearning.lab.core.calls.CharId(9, "u2:x"), null, "X")
        rig.room.handlers.onMessage(ServerMessage.Text("c-a", listOf(op)))
        runCurrent()
        assertTrue(rig.controller.state.value.textBoard.text.contains("X"))
    }

    // ---- round 4: a fresh link after a failed one (shared/calls/connection.ts linkSignalAction)

    private fun Rig.signalsTo(): List<JsonObject> = sentOf("signal").map { it["data"]!!.jsonObject }

    @Test fun everyLinkSaysHelloAndTagsItsSignals() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a", instance = "tab1")))
        val link = rig.media.peers.single()
        val hello = rig.signalsTo().single()
        assertEquals("true", hello["hello"]!!.jsonPrimitive.content)
        val mine = hello["link"]!!.jsonPrimitive.content
        link.listener.sendSignal(CallSignal.Candidate("candidate:1", "0", 0))
        runCurrent()
        assertEquals(mine, rig.signalsTo().last()["link"]!!.jsonPrimitive.content)
        // Their hello reaches the link (it re-sends an unanswered offer); signals with odd extra fields never trip anything.
        val theirs = Json.parseToJsonElement("""{"hello":true,"link":"T1"}""")
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", theirs))
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", Json.parseToJsonElement("""{"link":"T1","what":[1]}""")))
        runCurrent()
        assertEquals(listOf<CallSignal>(CallSignal.Hello), link.signals)
    }

    @Test fun aSignalFromTheirNewLinkMakesMineStartOverAndLeftoversAreIgnored() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a", instance = "tab1")))
        val first = rig.media.peers.single()
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", CallSignal.Description("offer", "v=1").toJson("T1")))
        runCurrent()
        assertEquals(1, rig.media.peers.size)
        // Their old link failed and they started over: T2.
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", CallSignal.Hello.toJson("T2")))
        runCurrent()
        assertEquals(2, rig.media.peers.size)
        assertTrue(first.closed)
        val second = rig.media.peers.last()
        assertEquals(listOf<CallSignal>(CallSignal.Hello), second.signals)
        // My new link said hello with a new id.
        val ids = rig.signalsTo().filter { it["hello"] != null }.map { it["link"]!!.jsonPrimitive.content }
        assertEquals(2, ids.toSet().size)
        // A late candidate from T1 is dropped; T2's go through; an older app (no id) still applies.
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", CallSignal.Candidate("candidate:old", "0", 0).toJson("T1")))
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", CallSignal.Candidate("candidate:new", "0", 0).toJson("T2")))
        rig.room.handlers.onMessage(ServerMessage.Signal("c-a", CallSignal.Candidate("candidate:legacy", "0", 0).toJson()))
        runCurrent()
        assertEquals(2, rig.media.peers.size)
        assertEquals(listOf("candidate:new", "candidate:legacy"), second.signals.filterIsInstance<CallSignal.Candidate>().map { it.candidate })
        val details = rig.sentOf("diag").flatMap { it["events"]!!.jsonArray.map { e -> e.jsonObject["detail"]!!.jsonPrimitive.content } }
        assertTrue(details.toString(), details.any { "started a new link" in it })
    }

    @Test fun aFailedOrNeverStartedLinkIsRenegotiatedNotAdopted() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(listOf(peer("c-a", instance = "tab1")))
        val first = rig.media.peers.single()
        first.listener.onConnectionState("connected")
        first.listener.onConnectionState("failed")
        runCurrent()
        rig.room.handlers.onMessage(ServerMessage.PeerLeft("c-a"))
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-b", instance = "tab1")))
        runCurrent()
        assertEquals(2, rig.media.peers.size)
        assertTrue(first.closed)
        val details = rig.sentOf("diag").flatMap { it["events"]!!.jsonArray.map { e -> e.jsonObject["detail"]!!.jsonPrimitive.content } }
        assertTrue(details.toString(), details.any { "link was failed, renegotiating" in it })
        // A link that is kept (connected) says hello again and re-sends an unanswered offer.
        val second = rig.media.peers.last()
        second.listener.onConnectionState("connected")
        runCurrent()
        val hellos = rig.signalsTo().count { it["hello"] != null }
        rig.room.handlers.onMessage(ServerMessage.PeerLeft("c-b"))
        rig.room.handlers.onMessage(ServerMessage.PeerJoined(peer("c-c", instance = "tab1")))
        runCurrent()
        assertEquals(2, rig.media.peers.size)
        assertEquals(hellos + 1, rig.signalsTo().count { it["hello"] != null })
        assertEquals(1, second.offerResends)
    }

    // ---- round 4: the mic comes back as I left it; round 5: the camera always starts on

    @Test fun micAndCameraAreRememberedAndRestoredOnTheNextJoin() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        rig.controller.toggleMic()
        rig.controller.toggleCam()
        assertTrue(rig.prefs.micOff)
        assertFalse(rig.controller.state.value.camOn) // off for this call…
        // The next join on this phone (same prefs): the mic comes back muted, the camera ON (round 5: never remembered off).
        val again = Rig(this, prefs = rig.prefs)
        assertFalse(again.controller.state.value.micOn)
        assertTrue(again.controller.state.value.camOn)
        again.controller.join(record = false)
        runCurrent()
        var s = again.controller.state.value
        assertTrue(s.hasMic && s.hasCamera)
        assertFalse(s.micOn)
        assertTrue(s.camOn)
        assertFalse(again.media.mic) // the tracks themselves
        assertTrue(again.media.cam)
        again.room.handlers.onStatus(RoomStatus.OPEN)
        again.room.handlers.onMessage(welcome())
        runCurrent()
        val lines = again.sentOf("diag").flatMap { it["events"]!!.jsonArray }.map { it.jsonObject["detail"]!!.jsonPrimitive.content }
        assertTrue(lines.toString(), lines.any { it.startsWith("joining with mic muted, camera; instance ") })
        val state = again.sentOf("state").first()["state"]!!.jsonObject
        assertEquals("false", state["mic"]!!.jsonPrimitive.content)
        assertEquals("true", state["cam"]!!.jsonPrimitive.content)
        // Turned back on: remembered as on.
        again.controller.toggleMic()
        assertFalse(rig.prefs.micOff)
        s = again.controller.state.value
        assertTrue(s.micOn)
        // A phone with nothing remembered joins with both on, and says so.
        val fresh = Rig(this)
        fresh.controller.join(record = false)
        runCurrent()
        fresh.room.handlers.onStatus(RoomStatus.OPEN)
        runCurrent()
        val first = fresh.sentOf("diag").flatMap { it["events"]!!.jsonArray }.map { it.jsonObject["detail"]!!.jsonPrimitive.content }
        assertTrue(first.toString(), first.any { it.startsWith("joining with mic, camera; instance ") })
    }

    @Test fun cameraOffInTheLastCallStillStartsOnAfterLeaveAndRejoin() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        rig.controller.toggleCam()
        assertFalse(rig.controller.state.value.camOn)
        rig.controller.leave()
        runCurrent()
        rig.controller.rejoin()
        runCurrent()
        assertTrue(rig.controller.state.value.camOn)
        assertTrue(rig.media.cam)
    }

    /** Minghui's "camera off" (2–3 Oct 2026): a camera that opens while the room is still connecting must reach the room. */
    @Test fun aCameraOpeningWhileJoiningIsAnnouncedWithTheWelcome() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this, media = FakeMedia().apply { openDelayMs = 6_000 })
        rig.room.open = false // the socket is still connecting
        rig.controller.join(record = false)
        runCurrent()
        advanceTimeBy(CallController.JOIN_MEDIA_WAIT_MS + 1)
        runCurrent()
        assertEquals(1, rig.room.connects) // joined with nothing yet
        assertEquals(CallPhase.JOINING, rig.controller.state.value.phase)
        advanceTimeBy(3_000)
        runCurrent()
        assertTrue(rig.controller.state.value.hasCamera)
        assertTrue(rig.controller.state.value.camOn)
        // The socket opens and the room welcomes me: my state goes with cam = true.
        rig.room.open = true
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(welcome())
        runCurrent()
        val first = rig.sentOf("state").first()["state"]!!.jsonObject
        assertEquals("true", first["cam"]!!.jsonPrimitive.content)
        assertEquals("true", first["mic"]!!.jsonPrimitive.content)
        val lines = rig.sentOf("diag").flatMap { it["events"]!!.jsonArray }.map { it.jsonObject["detail"]!!.jsonPrimitive.content }
        assertTrue(lines.toString(), lines.any { it == "camera opened while joining" })
    }

    @Test fun aCameraOpeningWhileJoiningOnAnOpenSocketIsSentAtOnce() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this, media = FakeMedia().apply { openDelayMs = 6_000 })
        rig.controller.join(record = false)
        runCurrent()
        advanceTimeBy(CallController.JOIN_MEDIA_WAIT_MS + 1)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        advanceTimeBy(3_000)
        runCurrent()
        assertEquals(CallPhase.JOINING, rig.controller.state.value.phase)
        val cams = rig.sentOf("state").map { it["state"]!!.jsonObject["cam"]!!.jsonPrimitive.content }
        assertEquals("true", cams.last())
    }

    @Test fun joinWaitsAtMostFourSecondsForDevicesStillOpening() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this, media = FakeMedia().apply { openDelayMs = 10_000 })
        rig.controller.join(record = false)
        runCurrent()
        assertEquals(0, rig.room.connects)
        advanceTimeBy(CallController.JOIN_MEDIA_WAIT_MS + 1)
        runCurrent()
        assertEquals(1, rig.room.connects)
        assertFalse(rig.controller.state.value.hasMic) // joined with nothing yet…
        advanceTimeBy(10_000)
        runCurrent()
        assertTrue(rig.controller.state.value.hasMic) // …and the devices come in when they open
    }

    // ---- round 4: the board never waits on an open IME span for good

    @Test fun anIdleCompositionCatchesUpWithTheirEditsAndBlurEndsIt() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        rig.controller.textChanged("今天", 2, 2, composing = false)
        runCurrent()
        val other = dev.jeromeswannack.chineselearning.lab.core.calls.CallTextDoc("u2:zz", null)
        rig.sentOf("text").flatMap { it["ops"]!!.jsonArray }.forEach { other.apply(dev.jeromeswannack.chineselearning.lab.core.calls.CallTextDoc.sanitizeOp(it)!!) }
        rig.room.sent.clear()
        // Gboard: "hao" composing after 今天 — and the span never closes.
        rig.controller.textChanged("今天hao", 5, 5, composing = true, compose = "hao", compStart = 2, compEnd = 5)
        runCurrent()
        assertTrue(rig.sentOf("text").isEmpty())
        // They type meanwhile: into my document, not into my field yet.
        val op = other.localInsert(2, "天气")!!
        rig.room.handlers.onMessage(ServerMessage.Text("c-a", listOf(op)))
        runCurrent()
        var tb = rig.controller.state.value.textBoard
        assertEquals("今天", tb.text)
        val before = tb.rewrite
        advanceTimeBy(CallController.COMPOSE_IDLE_MS - 100)
        runCurrent()
        assertEquals(before, rig.controller.state.value.textBoard.rewrite)
        advanceTimeBy(200)
        runCurrent()
        tb = rig.controller.state.value.textBoard
        assertEquals(before + 1, tb.rewrite)
        val f = tb.field!!
        assertEquals("今天hao天气", f.text) // my composition is spliced back in at its anchor, theirs after it
        assertEquals(2 to 5, f.compStart to f.compEnd)
        assertTrue(rig.sentOf("text").isEmpty()) // the composition itself never went out
        // Then the board loses focus: what was composed counts as typed.
        rig.controller.textBlurred()
        runCurrent()
        assertEquals("今天hao天气", rig.controller.state.value.textBoard.text)
        assertEquals(1, rig.sentOf("text").size)
        // The field's own late "composition over" report of the old text is not an edit.
        rig.controller.textChanged("今天hao天气", 5, 5, composing = false)
        runCurrent()
        assertEquals(1, rig.sentOf("text").size)
    }

    @Test fun textCommittedOutsideTheCompositionGoesOutAtOnce() = runTest(UnconfinedTestDispatcher()) {
        val rig = liveRig(emptyList())
        rig.controller.textChanged("hello wor", 9, 9, composing = true, compose = "wor", compStart = 6, compEnd = 9)
        runCurrent()
        val ins = rig.sentOf("text").single()["ops"]!!.jsonArray.single().jsonObject
        assertEquals("hello ", ins["text"]!!.jsonPrimitive.content)
        assertEquals("wor", rig.sentOf("text_cursor").last()["compose"]!!.jsonPrimitive.content)
    }

    // ------------------------------------------------------------ round 5: the tutor leads (core CallFollow)

    private fun shownOf(id: String, view: dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShowView, v: Int = 1, by: String = "u2", name: String = "Minghui") =
        dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShownState(id, v, by, name, view, 1_790_000_001_000)

    private val draw = dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShowView.DRAW
    private fun textOn(page: String) = dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShowView.text(page)

    /** The student (me) with the tutor (u2, client c-a) in the room; the board has pages pa / pb / pc. */
    private fun TestScope.studentRig(shown: dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShownState? = null): Rig {
        val rig = Rig(this, layout = CallLayoutHolder())
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(pagedWelcome().copy(tutorId = "u2", shown = shown))
        runCurrent()
        return rig
    }

    /** I (me) am the tutor; the student (u2, client c-a) is in the room. */
    private fun TestScope.tutorRig(tutorId: String? = "me", studentState: PeerMediaState = PeerMediaState(mic = true, cam = true)): Rig {
        val rig = Rig(this, layout = CallLayoutHolder())
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(
            welcome(peers = listOf(peer("c-a", instance = "tab1", state = studentState))).copy(pages = pagesAbc, page = "pa", pageViews = mapOf("c-a" to "pa"), tutorId = tutorId),
        )
        runCurrent()
        return rig
    }

    private val Rig.main get() = layout!!.layout.value.main

    @Test fun aShowIsAppliedOnceThenTheStudentsOwnLayoutWins() = runTest(UnconfinedTestDispatcher()) {
        val rig = studentRig()
        assertEquals("u2", rig.controller.state.value.tutorId)
        assertEquals(CallLayout.TileId.REMOTE, rig.main)
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s1", draw)))
        runCurrent()
        assertEquals(CallLayout.TileId.DRAW, rig.main)
        assertEquals(CallLayout.Mode.FOCUS, rig.layout!!.layout.value.mode)
        assertTrue(rig.layout!!.layout.value.remoteFloat)
        assertEquals("Minghui is showing you this", rig.controller.state.value.showingBanner)
        // The student goes back to the camera: the banner goes with the drawing board…
        rig.layout!!.dispatch(CallLayout.Action.Focus(CallLayout.TileId.REMOTE))
        runCurrent()
        assertNull(rig.controller.state.value.showingBanner)
        // …and the same show again (a repeat, or a reconnect's welcome) never overrides that.
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s1", draw)))
        runCurrent()
        assertEquals(CallLayout.TileId.REMOTE, rig.main)
        rig.room.handlers.onStatus(RoomStatus.RECONNECTING)
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        rig.room.handlers.onMessage(pagedWelcome().copy(tutorId = "u2", shown = shownOf("s1", draw)))
        runCurrent()
        assertEquals(CallLayout.TileId.REMOTE, rig.main)
        assertNull(rig.controller.state.value.showingBanner)
        // Something NEW shown: applied again.
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s2", draw)))
        runCurrent()
        assertEquals(CallLayout.TileId.DRAW, rig.main)
        // ✕ on the banner hides it; the layout stays.
        rig.controller.dismissShowingBanner()
        assertNull(rig.controller.state.value.showingBanner)
        assertEquals(CallLayout.TileId.DRAW, rig.main)
        // Nothing shown any more.
        rig.room.handlers.onMessage(ServerMessage.Shown(null))
        runCurrent()
        assertNull(rig.controller.state.value.shown)
        assertEquals(CallLayout.TileId.DRAW, rig.main)
    }

    @Test fun aShowInTheWelcomeIsAppliedOnAFreshJoin() = runTest(UnconfinedTestDispatcher()) {
        val rig = studentRig(shown = shownOf("s1", textOn("pb")))
        assertEquals(CallLayout.TileId.TEXT, rig.main)
        assertEquals(listOf("pb"), rig.sentOf("page_open").map { it["page"]!!.jsonPrimitive.content })
        assertEquals("Minghui is showing you this", rig.controller.state.value.showingBanner)
    }

    @Test fun pageTurnsAreFollowedOnlyWhileOnTheBoard() = runTest(UnconfinedTestDispatcher()) {
        val rig = studentRig()
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s1", textOn("pb"))))
        runCurrent()
        assertEquals(CallLayout.TileId.TEXT, rig.main)
        rig.room.handlers.onMessage(doc("pb", "第二页"))
        runCurrent()
        assertEquals("pb", rig.controller.state.value.pages.current)
        // She turns to pc: I'm on the board, so I follow.
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s1", textOn("pc"), v = 2)))
        runCurrent()
        assertEquals(listOf("pb", "pc"), rig.sentOf("page_open").map { it["page"]!!.jsonPrimitive.content })
        rig.room.handlers.onMessage(doc("pc", "第三页"))
        runCurrent()
        // I go to the camera; her next page turn leaves me there.
        rig.layout!!.dispatch(CallLayout.Action.Focus(CallLayout.TileId.REMOTE))
        runCurrent()
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s1", textOn("pa"), v = 3)))
        runCurrent()
        assertEquals(listOf("pb", "pc"), rig.sentOf("page_open").map { it["page"]!!.jsonPrimitive.content })
        assertEquals(CallLayout.TileId.REMOTE, rig.main)
    }

    @Test fun aShowOfAMaterialIAmNotSeeingYetAppliesWhenItAppears() = runTest(UnconfinedTestDispatcher()) {
        val rig = studentRig()
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s1", dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShowView(dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShowKind.MATERIAL))))
        runCurrent()
        assertEquals(CallLayout.TileId.REMOTE, rig.main)
        assertNull(rig.controller.state.value.showingBanner)
        rig.room.handlers.onMessage(ServerMessage.Material(dev.jeromeswannack.chineselearning.lab.core.PresentedMaterial("m1", "第五课", 0, 3, "u2", "Minghui")))
        runCurrent()
        assertEquals(CallLayout.TileId.MATERIAL, rig.main)
        assertEquals("Minghui is showing you this", rig.controller.state.value.showingBanner)
    }

    @Test fun theTutorsOwnShowNeverMovesHerLayout() = runTest(UnconfinedTestDispatcher()) {
        val rig = tutorRig()
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s1", draw, by = "me")))
        runCurrent()
        assertEquals(CallLayout.TileId.REMOTE, rig.main)
        assertNull(rig.controller.state.value.showingBanner)
    }

    @Test fun theTutorOpeningTheBoardShowsItAndHerPageTurnsFollow() = runTest(UnconfinedTestDispatcher()) {
        val rig = tutorRig()
        assertTrue(rig.sentOf("show").isEmpty())
        rig.layout!!.dispatch(CallLayout.Action.Focus(CallLayout.TileId.TEXT))
        runCurrent()
        val show = rig.sentOf("show").single()
        assertEquals("text", show["view"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
        assertEquals("pa", show["view"]!!.jsonObject["page"]!!.jsonPrimitive.content)
        assertNull(show["follow"])
        // The room's answer; then she turns her page: the same show, follow = true.
        rig.room.handlers.onMessage(ServerMessage.Shown(shownOf("s1", textOn("pa"), by = "me", name = "Me")))
        runCurrent()
        rig.controller.openPage("pb")
        runCurrent()
        val turn = rig.sentOf("show").last()
        assertEquals("pb", turn["view"]!!.jsonObject["page"]!!.jsonPrimitive.content)
        assertEquals("true", turn["follow"]!!.jsonPrimitive.content)
        // The corner button on another tile: a new show, not a follow.
        assertTrue(rig.controller.showTile(CallLayout.TileId.DRAW))
        val pressed = rig.sentOf("show").last()
        assertEquals("draw", pressed["view"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
        assertNull(pressed["follow"])
        // Leaving the board and coming back shows it again.
        val before = rig.sentOf("show").size
        rig.layout!!.dispatch(CallLayout.Action.Focus(CallLayout.TileId.REMOTE))
        rig.layout!!.dispatch(CallLayout.Action.Focus(CallLayout.TileId.DRAW))
        runCurrent()
        assertEquals(before + 1, rig.sentOf("show").size)
    }

    @Test fun nobodyLeadsInASoloCallOrAsTheStudent() = runTest(UnconfinedTestDispatcher()) {
        val solo = tutorRig(tutorId = null)
        solo.layout!!.dispatch(CallLayout.Action.Focus(CallLayout.TileId.TEXT))
        runCurrent()
        assertFalse(solo.controller.showTile(CallLayout.TileId.TEXT))
        assertTrue(solo.sentOf("show").isEmpty())
        val student = studentRig()
        student.layout!!.dispatch(CallLayout.Action.Focus(CallLayout.TileId.TEXT))
        runCurrent()
        assertFalse(student.controller.showTile(CallLayout.TileId.TEXT))
        assertTrue(student.sentOf("show").isEmpty())
        // The tutor alone in the room (the student hasn't joined): nothing to show yet.
        val alone = Rig(this, layout = CallLayoutHolder())
        alone.controller.join(record = false)
        runCurrent()
        alone.room.handlers.onStatus(RoomStatus.OPEN)
        alone.room.handlers.onMessage(welcome().copy(tutorId = "me"))
        runCurrent()
        alone.layout!!.dispatch(CallLayout.Action.Focus(CallLayout.TileId.TEXT))
        runCurrent()
        assertTrue(alone.sentOf("show").isEmpty())
    }

    @Test fun stopTheirShareIsSentOnlyByTheTutorWhileTheStudentShares() = runTest(UnconfinedTestDispatcher()) {
        val tutor = tutorRig(studentState = PeerMediaState(mic = true, cam = true, screen = true))
        assertTrue(tutor.controller.stopTheirShare())
        assertEquals(1, tutor.sentOf("stop_share").size)
        val notSharing = tutorRig()
        assertFalse(notSharing.controller.stopTheirShare())
        assertTrue(notSharing.sentOf("stop_share").isEmpty())
        val student = studentRig()
        student.room.handlers.onMessage(ServerMessage.PeerState("c-a", PeerMediaState(mic = true, cam = true, screen = true)))
        runCurrent()
        assertFalse(student.controller.stopTheirShare())
        assertTrue(student.sentOf("stop_share").isEmpty())
    }

    @Test fun shareStoppedStopsMyCaptureAndSaysWhoDidIt() = runTest(UnconfinedTestDispatcher()) {
        val rig = studentRig()
        rig.controller.startScreenShare("consent")
        runCurrent()
        assertTrue(rig.controller.state.value.sharingScreen)
        rig.room.handlers.onMessage(ServerMessage.ShareStopped("u2", "Minghui"))
        runCurrent()
        val s = rig.controller.state.value
        assertFalse(s.sharingScreen)
        assertNull(rig.media.screenVideo)
        assertEquals("false", rig.sentOf("state").last()["state"]!!.jsonObject["screen"]!!.jsonPrimitive.content)
        assertEquals("Minghui stopped your screen share", s.shareStoppedNote?.text)
        rig.controller.dismissShareStopped()
        assertNull(rig.controller.state.value.shareStoppedNote)
    }
}
