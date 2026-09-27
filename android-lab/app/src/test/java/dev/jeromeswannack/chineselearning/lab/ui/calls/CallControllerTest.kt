package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.BoardItem
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardOp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPoint
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChatMessage
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
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
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
        var closed = false
        override val clockOffset = 1_234L
        override fun connect() { connects++ }
        override fun send(text: String): Boolean { if (!open) return false; sent += Json.parseToJsonElement(text).jsonObject; return true }
        override fun close() { closed = true }
        fun types() = sent.map { it["type"]!!.jsonPrimitive.content }
    }

    class FakePeer(val polite: Boolean, val listener: PeerListener) : PeerSession {
        val signals = ArrayList<CallSignal>()
        var sending: VideoHandle? = "camera"
        var closed = false
        override fun handleSignal(signal: CallSignal) { signals += signal }
        override fun setVideo(video: VideoHandle?) { sending = video }
        override fun close() { closed = true }
    }

    class FakeMedia(var result: MediaOpen = MediaOpen.Ok) : CallMedia {
        val peers = ArrayList<FakePeer>()
        var mic = true
        var cam = true
        var released = false
        var screenStopped: (() -> Unit)? = null
        override val hasCamera get() = result == MediaOpen.Ok
        override var frontCamera = true
        override val cameraVideo: VideoHandle? get() = if (hasCamera) "camera" else null
        override var screenVideo: VideoHandle? = null
        override val screenShareSupported = true
        override suspend fun open() = result
        override fun setMicEnabled(on: Boolean) { mic = on }
        override fun setCameraEnabled(on: Boolean) { cam = on }
        override suspend fun flipCamera(): Boolean { frontCamera = !frontCamera; return true }
        override fun startScreenShare(permission: Any, onStopped: () -> Unit): VideoHandle? { screenStopped = onStopped; screenVideo = "screen"; return "screen" }
        override fun stopScreenShare() { screenVideo = null }
        override fun createPeer(iceServers: List<IceServerDto>, polite: Boolean, listener: PeerListener) = FakePeer(polite, listener).also { peers += it }
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
        val controller = CallController(
            "call1", "me",
            CallDeps(
                openRoom = { h -> room.handlers = h; room },
                media = media, recorder = recorder,
                endCall = { endCalls++ },
                drainUploads = { drains++ },
                closeOrphans = { orphans++ },
                keepAlive = { alive += it },
                prepareScreenShare = { screenPrepared++ },
                uploadEveryMs = 60_000,
            ),
            scope.backgroundScope,
        )
    }

    private fun peer(id: String, user: String = "u2", state: PeerMediaState = PeerMediaState(mic = true, cam = true)) = CallPeer(id, user, "王老师", null, state)

    private fun welcome(peers: List<CallPeer> = emptyList(), board: List<BoardItem> = emptyList()) =
        ServerMessage.Welcome("c-me", 1_790_000_000_500, 1_790_000_000_000, peers, board, listOf(CallChatMessage("m1", "u2", "王老师", "你好", 1)))

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

    @Test fun micBlockedKeepsYouOnThePreJoinScreen() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this, media = FakeMedia(MediaOpen.Failed("The microphone is blocked.")))
        rig.controller.join(record = true)
        runCurrent()
        assertEquals(CallPhase.PREJOIN, rig.controller.state.value.phase)
        assertEquals("The microphone is blocked.", rig.controller.state.value.mediaError)
        assertEquals(0, rig.room.connects)
        // Allowed in Settings → "Allow" opens the media again.
        rig.media.result = MediaOpen.Ok
        rig.controller.startPreview()
        runCurrent()
        assertTrue(rig.controller.state.value.mediaReady)
        assertNull(rig.controller.state.value.mediaError)
    }

    @Test fun audioOnlyWhenThereIsNoCamera() = runTest(UnconfinedTestDispatcher()) {
        val rig = Rig(this, media = FakeMedia(MediaOpen.AudioOnly("No camera — joining with audio only.")))
        rig.controller.startPreview()
        runCurrent()
        val s = rig.controller.state.value
        assertTrue(s.mediaReady)
        assertFalse(s.hasCamera)
        assertFalse(s.camOn)
        assertEquals("No camera — joining with audio only.", s.mediaError)
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
        // They leave → link closed; a new peer with a larger id → we are polite.
        rig.room.handlers.onMessage(ServerMessage.PeerLeft("c-a"))
        runCurrent()
        assertTrue(first.closed)
        assertNull(rig.controller.state.value.remote)
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
        assertEquals("screen", rig.media.peers.single().sending)
        assertTrue(rig.controller.state.value.sharingScreen)
        assertEquals("true", rig.room.sent.last()["state"]!!.jsonObject["screen"]!!.jsonPrimitive.content)
        // The system's "stop sharing" ends it too.
        rig.media.screenStopped!!()
        runCurrent()
        assertFalse(rig.controller.state.value.sharingScreen)
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
}
