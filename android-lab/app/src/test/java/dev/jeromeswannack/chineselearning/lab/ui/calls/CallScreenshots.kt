package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPoint
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChatMessage
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.LiveStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.data.calls.AudioRoute
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config
import kotlin.math.sin

/** The live call with stand-in video (real WebRTC can't render under Robolectric). */
class CallScreenshots : LabScreenshotTest() {
    /** A handle is "who" or "who@WxH" — the stand-in reports that frame size, like the real renderer. */
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        val who = handle.substringBefore('@')
        val size = handle.substringAfter('@', "").split('x').mapNotNull { it.toIntOrNull() }.takeIf { it.size == 2 }
            ?: when (who) { "them" -> listOf(1280, 720); "screen" -> listOf(1080, 2400); else -> listOf(720, 1280) }
        LaunchedEffect(handle) { onFrameSize(size[0], size[1]) }
        val colors = if (who == "them") listOf(Color(0xFF7C9A92), Color(0xFF34495E)) else listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            Text(if (who == "them") "👩‍🏫" else if (who == "screen") "🖥️" else "🧑", fontSize = if (who == "them") 120.sp else 48.sp)
            Text("${size[0]}×${size[1]}", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp, modifier = Modifier.align(Alignment.TopStart).padding(6.dp))
        }
    }

    private val t0 = CallsSamples.T0
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "王老师", null, PeerMediaState(mic = true, cam = true, recording = true))
    private val info = CallScreenInfo(otherName = "王老师", myName = "Jerome Swannack", relationshipId = "r1", audioRoutes = listOf(AudioRoute.SPEAKER, AudioRoute.EARPIECE, AudioRoute.BLUETOOTH))
    private val live = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true, recording = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME, screenShareSupported = true,
        remote = RemoteParticipant(tutor, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        board = CallsSamples.board,
        chat = listOf(
            CallChatMessage("m1", CallsSamples.TUTOR, "王老师", "微辣 wēi là = a little spicy", t0 + 20_000),
            CallChatMessage("m2", CallsSamples.ME, "Jerome", "谢谢！我想要微辣的。", t0 + 31_000),
            CallChatMessage("m3", CallsSamples.TUTOR, "王老师", "很好 👍", t0 + 40_000),
        ),
    )
    private val now = { t0 + 12 * 60_000 + 34_000 }

    @Test fun preJoin() = shoot("calls-11-prejoin") {
        CallScreen(CallState(mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true), info, CallActions(), fakeVideo)
    }

    /** Mic refused for good ("don't ask again" → Open settings), camera refused once (Try again): Join still works. */
    @Test fun preJoinBlocked() = shoot("calls-12-prejoin-blocked") {
        CallScreen(
            CallState(mediaReady = true, recordSupported = true, micProblem = MediaProblem.BLOCKED, camProblem = MediaProblem.BLOCKED),
            info.copy(micAccess = DeviceAccess.SETTINGS, camAccess = DeviceAccess.ASK), CallActions(), fakeVideo,
        )
    }

    @Test fun preJoinCameraInUse() = shoot("calls-31-prejoin-camera-in-use") {
        CallScreen(CallState(mediaReady = true, hasMic = true, recordSupported = true, camOn = false, camProblem = MediaProblem.IN_USE), info, CallActions(), fakeVideo)
    }

    @Test fun waitingAlone() = shoot("calls-13-live-waiting") {
        CallScreen(live.copy(remote = null, chat = emptyList(), board = emptyList()), info.copy(relationshipId = null, otherName = null), CallActions(), fakeVideo, now)
    }

    @Test fun inCall() = shoot("calls-14-live") { CallScreen(live, info, CallActions(), fakeVideo, now) }

    @Test fun whiteboard() = shoot("calls-15-live-whiteboard") {
        val drawing = LiveStroke("l1", "#2563eb", 10.0, List(24) { i -> BoardPoint(0.1 + i * 0.015, 0.75 + sin(i / 4.0) * 0.05) })
        CallScreen(live.copy(liveStrokes = mapOf(CallsSamples.TUTOR to drawing)), info, CallActions(), fakeVideo, now, initialPanel = CallPanel.BOARD)
    }

    @Test fun chat() = shoot("calls-16-live-chat") {
        CallScreen(live.copy(remote = live.remote!!.copy(peer = tutor.copy(state = tutor.state.copy(mic = false)))), info, CallActions(), fakeVideo, now, initialPanel = CallPanel.CHAT)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfoldedWhiteboard() = shoot("calls-17-live-unfolded-whiteboard") {
        CallScreen(live.copy(screenVideo = "screen"), info, CallActions(), fakeVideo, now, initialPanel = CallPanel.BOARD)
    }

    @Test fun reconnecting() = shoot("calls-18-live-reconnecting-camera-off") {
        CallScreen(live.copy(roomStatus = RoomStatus.RECONNECTING, camOn = false, micOn = false, recording = false, remote = live.remote!!.copy(connection = "connecting", tile = CallConnection.TileStatus.CONNECTING, peer = tutor.copy(state = PeerMediaState(mic = true)))), info, CallActions(), fakeVideo, now)
    }

    /** A dropout: their last frame stays up, frozen, with "Reconnecting…" in the corner — never a blank tile. */
    @Test fun reconnectingFrozenFrame() = shoot("calls-32-live-reconnecting-frozen") {
        CallScreen(live.copy(remote = live.remote!!.copy(connection = "disconnected", tile = CallConnection.TileStatus.RECONNECTING, away = true)), info, CallActions(), fakeVideo, now)
    }

    /** Joined without a mic (blocked): the mic button shows "!" and asks for it when tapped. */
    @Test fun liveWithoutMic() = shoot("calls-33-live-no-mic") {
        CallScreen(live.copy(hasMic = false, micProblem = MediaProblem.BLOCKED, recording = false), info, CallActions(), fakeVideo, now)
    }

    @Test fun ended() = shoot("calls-19-ended-uploading") {
        CallScreen(CallState(phase = CallPhase.ENDED, pendingUploads = 4), info, CallActions(), fakeVideo)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun preJoinUnfolded() = shoot("calls-20-prejoin-unfolded") {
        CallScreen(CallState(mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true), info, CallActions(), fakeVideo)
    }

    // ---- video fit (shared/calls/videoFit.ts): cropped only when the shapes nearly match

    @Test fun phonePortraitRemote() = shoot("calls-21-fit-phone-portrait-remote") {
        CallScreen(live.copy(remote = live.remote!!.copy(video = "them@720x1280")), info, CallActions(), fakeVideo, now)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfoldedPortraitRemote() = shoot("calls-22-fit-unfolded-portrait-remote") {
        CallScreen(live.copy(remote = live.remote!!.copy(video = "them@720x1280")), info, CallActions(), fakeVideo, now)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfoldedLandscapeRemote() = shoot("calls-23-fit-unfolded-landscape-remote") {
        CallScreen(live.copy(remote = live.remote!!.copy(video = "them@1280x720"), localVideo = "me@1280x720"), info, CallActions(), fakeVideo, now)
    }

    // ---- the shared text board (shared/calls/textDoc.ts): typed together, the other caret in colour

    private val notes = "第五课 · 点菜\n\n我想要一杯咖啡。\n微辣 wēi là = a little spicy\n服务员，买单！\n\n不要放香菜。"
    private val board = TextBoardUi(
        text = notes,
        version = 3,
        remote = listOf(dev.jeromeswannack.chineselearning.lab.core.calls.RemoteCaret("c-a", CallsSamples.TUTOR, "王老师", "#e11d48", 13, 15, 15)),
    )

    @Test fun textBoard() = shoot("calls-24-live-text-board") {
        CallScreen(live.copy(textBoard = board), info, CallActions(), fakeVideo, now, initialPanel = CallPanel.TEXT)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun textBoardUnfolded() = shoot("calls-25-live-text-board-unfolded") {
        CallScreen(live.copy(textBoard = board), info, CallActions(), fakeVideo, now, initialPanel = CallPanel.TEXT)
    }

    // ---- tab-complete on the text board (shared/calls/gloss.ts): the grey offer + the "⇥ …" chip under the caret

    private val glossNotes = "第五课 · 点菜\n服务员 - fúwùyuán - waiter\n菜单 - càidān - menu\n我想喝一杯咖啡"
    private val glossBoard = TextBoardUi(
        text = glossNotes,
        version = 4,
        remote = listOf(dev.jeromeswannack.chineselearning.lab.core.calls.RemoteCaret("c-a", CallsSamples.TUTOR, "王老师", "#e11d48", 9, 9, 9)),
    )
    private val glossOffer = GlossSuggestion("我想喝一杯咖啡", glossNotes.codePointCount(0, glossNotes.length), BoardGloss("wǒ xiǎng hē yì bēi kāfēi", "I want to drink a cup of coffee"))

    @Test fun textBoardGlossChip() = shoot("calls-28-live-text-board-gloss-chip") {
        CallScreen(live.copy(textBoard = glossBoard), info.copy(boardGlossPreview = glossOffer), CallActions(gloss = { null }), fakeVideo, now, initialPanel = CallPanel.TEXT)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun textBoardGlossChipUnfolded() = shoot("calls-29-live-text-board-gloss-chip-unfolded") {
        CallScreen(live.copy(textBoard = glossBoard), info.copy(boardGlossPreview = glossOffer), CallActions(gloss = { null }), fakeVideo, now, initialPanel = CallPanel.TEXT)
    }

    @Test fun textBoardGlossOff() = shoot("calls-30-live-text-board-gloss-off") {
        CallScreen(live.copy(textBoard = glossBoard), info.copy(boardGlossOn = false), CallActions(gloss = { null }), fakeVideo, now, initialPanel = CallPanel.TEXT)
    }

    // ---- drawing on a shared screen (shared/calls/annotate.ts)

    private fun circle(cx: Double, cy: Double, rx: Double, ry: Double) = (0..36).map { i ->
        val a = i * Math.PI * 2 / 36
        (cx + rx * Math.cos(a)) to (cy + ry * Math.sin(a))
    }
    private val drawings = Annotations(
        strokes = mapOf(
            "me:a1" to dev.jeromeswannack.chineselearning.lab.core.calls.ShownStroke(
                dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke("a1", "#f43f5e", 0.006, circle(0.5, 0.45, 0.18, 0.12), true), "me", t0 + 12 * 60_000 + 33_000,
            ),
        ),
        pings = listOf(dev.jeromeswannack.chineselearning.lab.core.calls.AnnotPing("p", "me", 0.3, 0.7, t0 + 12 * 60_000 + 33_800)),
    )

    @Config(qualifiers = UNFOLDED)
    @Test fun drawOnTheirScreen() = shoot("calls-26-draw-on-shared-screen") {
        CallScreen(
            live.copy(remote = live.remote!!.copy(video = "screen@1920x1080", peer = tutor.copy(state = tutor.state.copy(screen = true))), annotations = drawings),
            info, CallActions(), fakeVideo, now,
        )
    }

    @Test fun sharingWhileTheyDraw() = shoot("calls-27-sharing-they-draw") {
        val theirs = drawings.copy(strokes = drawings.strokes.mapValues { it.value.copy(from = "c-a") }, lastRemoteAt = t0 + 12 * 60_000 + 33_000, lastRemoteName = "王老师")
        CallScreen(live.copy(screenVideo = "screen@1080x2400", annotations = theirs), info.copy(screenOverlayOn = true), CallActions(), fakeVideo, now)
    }

    // ---- round 2: the board is always light paper; the other person's IME composition in their flag

    private val composeNotes = "第五课 · 点菜\n服务员 - fúwùyuán - waiter\n我想喝一杯咖啡"
    private val composeBoard = TextBoardUi(
        text = composeNotes,
        version = 5,
        remote = listOf(dev.jeromeswannack.chineselearning.lab.core.calls.RemoteCaret("c-a", CallsSamples.TUTOR, "王老师", "#e11d48", 9, 9, 9, compose = "菜单cai")),
    )
    private val composeOffer = GlossSuggestion("我想喝一杯咖啡", composeNotes.codePointCount(0, composeNotes.length), BoardGloss("wǒ xiǎng hē yì bēi kāfēi", "I want to drink a cup of coffee"))

    @Test fun textBoardComposeLight() = shoot("calls-34-text-board-compose-light") {
        CallScreen(live.copy(textBoard = composeBoard), info.copy(boardGlossPreview = composeOffer), CallActions(gloss = { null }), fakeVideo, now, initialPanel = CallPanel.TEXT)
    }

    @Test fun textBoardComposeDark() = shoot("calls-35-text-board-compose-dark", dark = true) {
        CallScreen(live.copy(textBoard = composeBoard), info.copy(boardGlossPreview = composeOffer), CallActions(gloss = { null }), fakeVideo, now, initialPanel = CallPanel.TEXT)
    }

    @Test fun drawBoardDark() = shoot("calls-36-draw-board-dark", dark = true) {
        CallScreen(live, info, CallActions(), fakeVideo, now, initialPanel = CallPanel.BOARD)
    }

    /** The ⋯ menu's device picker: camera front / back, where the sound goes. */
    @Test fun devicePicker() = shoot("calls-38-device-picker") {
        androidx.compose.foundation.layout.Column(Modifier.background(dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.background)) {
            CallMoreMenu(live, info.copy(audioRoute = AudioRoute.BLUETOOTH, audioRoutes = listOf(AudioRoute.SPEAKER, AudioRoute.EARPIECE, AudioRoute.HEADSET, AudioRoute.BLUETOOTH)), CallActions(), close = {})
        }
    }

    @Test fun connectionLog() = shoot("calls-39-review-connection-log") {
        val ev = listOf(
            Triple(0L, "join", "joining (mic on, camera on, instance k3j9x0ab12cd)") to "Jerome",
            Triple(900L, "room", "open") to "Jerome",
            Triple(2_100L, "pc", "connected") to "Jerome",
            Triple(2_600L, "route", "relay/udp via turn") to "Jerome",
            Triple(3_000L, "route", "srflx") to "王老师",
            Triple(754_000L, "pc", "disconnected") to "Jerome",
            Triple(754_300L, "room", "reconnecting") to "Jerome",
            Triple(756_600L, "restart", "ICE restart #1 (disconnected)") to "Jerome",
            Triple(757_100L, "peer", "王老师 came back (same session) — link kept, signals → new client") to "Jerome",
            Triple(758_000L, "pc", "connected again") to "Jerome",
        ).map { (e, who) -> dev.jeromeswannack.chineselearning.lab.data.api.CallDiagDto(t0 + e.first, e.second, e.third, if (who == "Jerome") CallsSamples.ME else CallsSamples.TUTOR, who) }
        androidx.compose.foundation.layout.Column(Modifier.background(dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.background).padding(16.dp)) {
            ConnectionLog(ev, initiallyOpen = true)
        }
    }
}
