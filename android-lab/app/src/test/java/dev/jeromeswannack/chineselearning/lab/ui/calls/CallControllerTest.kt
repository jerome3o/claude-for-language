package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardOp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPoint
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChatMessage
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
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
        override suspend fun open(): MediaOpen {
            opens++
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

    private class Rig(scope: TestScope, media: FakeMedia = FakeMedia(), recorder: FakeRecorder = FakeRecorder()) {
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
        assertEquals(72, batches.sum()) // join + 70 + "room open"
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
}
