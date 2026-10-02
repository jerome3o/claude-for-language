package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * Video calls round 4 (PR 3): the shared screen and the board together — stacked when folded, side by
 * side unfolded — the long-press menu that arranges them, and the board's room for the faces box.
 */
class CallLayoutRound4Screenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        val size = when (handle) { "them" -> listOf(1280, 720); "screen" -> listOf(1920, 1080); else -> listOf(720, 1280) }
        LaunchedEffect(handle) { onFrameSize(size[0], size[1]) }
        val colors = when (handle) {
            "them" -> listOf(Color(0xFF7C9A92), Color(0xFF34495E))
            "screen" -> listOf(Color(0xFFF8FAFC), Color(0xFFE2E8F0))
            else -> listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        }
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            if (handle == "screen") Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("第五课 · 点菜", color = Color(0xFF0F172A), fontSize = 28.sp)
                Text("我想要一杯咖啡。", color = Color(0xFF334155), fontSize = 20.sp)
                Text("wǒ xiǎng yào yì bēi kāfēi", color = Color(0xFF64748B), fontSize = 14.sp)
            } else Text(if (handle == "them") "👩‍🏫" else "🧑", fontSize = if (handle == "them") 96.sp else 40.sp)
        }
    }

    private val t0 = CallsSamples.T0
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "王老师", null, PeerMediaState(mic = true, cam = true))
    private val info = CallScreenInfo(otherName = "王老师", myName = "Jerome Swannack", relationshipId = "r1")
    private val board = TextBoardUi(
        text = "第五课 · 点菜\n我想要一杯咖啡。\n微辣 wēi là = a little spicy\n服务员，买单！\n不要放香菜。\n一杯 yì bēi = one cup",
        version = 3,
    )
    private val live = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME, screenShareSupported = true,
        remote = RemoteParticipant(tutor, video = "them", screen = "screen", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        textBoard = board,
        board = CallsSamples.board,
    )
    private val sharing = live.copy(remote = live.remote!!.copy(peer = tutor.copy(state = tutor.state.copy(screen = true))))
    private val now = { t0 + 18 * 60_000 + 5_000 }

    /** The learner had the board open, then 王老师 started sharing (the screen on the stage), then [split]. */
    private fun sharingLayout(split: ScreenBoardSplit.Choice?, vararg more: Action) = CallLayoutHolder().apply {
        dispatch(Action.Focus(TileId.TEXT))
        setRemoteSharing(true)
        split?.let { applySplit(it, TileId.TEXT) }
        more.forEach { dispatch(it) }
    }

    @Composable
    private fun Call(s: CallState, holder: CallLayoutHolder, menu: TileId? = null) =
        CallScreen(s, info, CallActions(), fakeVideo, now, layout = holder, initialSplitMenu = menu)

    /** Folded: the screen on top, the board below, the faces floating over the screen; the divider has a grip. */
    @Test fun screenAboveBoardFolded() = shoot("lab-calls-r4-10-screen-above-board-folded") { Call(sharing, sharingLayout(ScreenBoardSplit.Choice.BELOW)) }

    /** Unfolded: side by side. */
    @Config(qualifiers = UNFOLDED)
    @Test fun screenBesideBoardUnfolded() = shoot("lab-calls-r4-11-screen-beside-board-unfolded") { Call(sharing, sharingLayout(ScreenBoardSplit.Choice.BESIDE)) }

    /** Long-press on their screen (folded): below / above, board only, screen only. */
    @Test fun longPressMenuFolded() = shoot("lab-calls-r4-12-long-press-menu-folded") { Call(sharing, sharingLayout(null), menu = TileId.SCREEN) }

    /** Unfolded, already split: "beside" is ticked. */
    @Config(qualifiers = UNFOLDED)
    @Test fun longPressMenuUnfolded() = shoot("lab-calls-r4-13-long-press-menu-unfolded") { Call(sharing, sharingLayout(ScreenBoardSplit.Choice.BESIDE), menu = TileId.TEXT) }

    /** Their screen alone with the board open: the "📝 + 🖥️" chip. */
    @Test fun splitChipFolded() = shoot("lab-calls-r4-14-split-chip-folded") { Call(sharing, sharingLayout(null)) }

    /** The board with the faces box in its top corner: the text starts below the box. */
    @Test fun boardRoomForFacesFolded() = shoot("lab-calls-r4-15-board-room-for-faces-folded") {
        Call(live, CallLayoutHolder(initial = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Focus(TileId.TEXT))))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun boardRoomForFacesUnfolded() = shoot("lab-calls-r4-16-board-room-for-faces-unfolded") {
        Call(live, CallLayoutHolder(initial = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Focus(TileId.TEXT))))
    }
}
