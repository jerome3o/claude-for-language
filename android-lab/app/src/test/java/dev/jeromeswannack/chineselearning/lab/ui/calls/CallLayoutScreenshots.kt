package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChatMessage
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.PresetId
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config

/** Video calls round 2 (PR B) + round 3 (faces together): the tile layouts (core CallLayout) folded (412 dp: phone rules) and unfolded (840 dp: split / rail). */
class CallLayoutScreenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        val who = handle.substringBefore('@')
        val size = handle.substringAfter('@', "").split('x').mapNotNull { it.toIntOrNull() }.takeIf { it.size == 2 }
            ?: when (who) { "them" -> listOf(1280, 720); "screen" -> listOf(1920, 1080); else -> listOf(720, 1280) }
        LaunchedEffect(handle) { onFrameSize(size[0], size[1]) }
        val colors = when (who) {
            "them" -> listOf(Color(0xFF7C9A92), Color(0xFF34495E))
            "screen" -> listOf(Color(0xFFF8FAFC), Color(0xFFE2E8F0))
            else -> listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        }
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            if (who == "screen") Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("第五课 · 点菜", color = Color(0xFF0F172A), fontSize = 28.sp)
                Text("我想要一杯咖啡。", color = Color(0xFF334155), fontSize = 20.sp)
                Text("wǒ xiǎng yào yì bēi kāfēi", color = Color(0xFF64748B), fontSize = 14.sp)
            } else Text(if (who == "them") "👩‍🏫" else "🧑", fontSize = if (who == "them") 96.sp else 40.sp)
        }
    }

    private val t0 = CallsSamples.T0
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "王老师", null, PeerMediaState(mic = true, cam = true))
    private val info = CallScreenInfo(otherName = "王老师", myName = "Jerome Swannack", relationshipId = "r1")
    private val board = TextBoardUi(
        text = "第五课 · 点菜\n\n我想要一杯咖啡。\n微辣 wēi là = a little spicy\n服务员，买单！\n\n不要放香菜。",
        version = 3,
        remote = listOf(dev.jeromeswannack.chineselearning.lab.core.calls.RemoteCaret("c-a", CallsSamples.TUTOR, "王老师", "#e11d48", 13, 15, 15)),
    )
    private val live = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME, screenShareSupported = true,
        remote = RemoteParticipant(tutor, video = "them", screen = "screen", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        textBoard = board,
        board = CallsSamples.board,
        chat = listOf(
            CallChatMessage("m1", CallsSamples.TUTOR, "王老师", "微辣 wēi là = a little spicy", t0 + 20_000),
            CallChatMessage("m2", CallsSamples.ME, "Jerome", "谢谢！我想要微辣的。", t0 + 31_000),
        ),
    )
    private val sharing = live.copy(remote = live.remote!!.copy(peer = tutor.copy(state = tutor.state.copy(screen = true))))
    private val now = { t0 + 12 * 60_000 + 34_000 }

    private fun layout(vararg actions: Action) = CallLayoutHolder(initial = actions.fold(CallLayout.DEFAULT_LAYOUT) { l, a -> CallLayout.reduce(l, a) })

    @Composable
    private fun Call(s: CallState, vararg actions: Action) = CallScreen(s, info, CallActions(), fakeVideo, now, layout = layout(*actions))

    // ---- folded (412 × 915 dp): focus only, the cameras float, swipe between tiles

    @Test fun speakerFolded() = shoot("calls-40-layout-speaker-folded") { Call(live) }

    @Test fun boardFocusFolded() = shoot("calls-41-layout-board-folded") { Call(live, Action.Preset(PresetId.BOARD)) }

    @Test fun screenFolded() = shoot("calls-42-layout-screen-folded") { Call(sharing) }

    @Test fun layoutSheet() = shoot("calls-43-layout-sheet") {
        Column(Modifier.background(Lab.colors.card).padding(vertical = 8.dp)) {
            CallLayoutMenu(CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Preset(PresetId.BOARD)), CallLayout.Availability(screen = true), "王老师", onAction = {}, close = {})
        }
    }

    // ---- unfolded (840 × 900 dp): split with a divider, the rail along the bottom

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun speakerUnfolded() = shoot("calls-44-layout-speaker-unfolded") { Call(live) }

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun boardSplitUnfolded() = shoot("calls-45-layout-board-split-unfolded") { Call(live, Action.Preset(PresetId.BOARD)) }

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun screenUnfolded() = shoot("calls-46-layout-screen-unfolded") { Call(sharing) }

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun sideBySideUnfolded() = shoot("calls-47-layout-side-by-side-unfolded") { Call(live, Action.Preset(PresetId.SIDE)) }

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun gridUnfolded() = shoot("calls-48-layout-grid-unfolded") {
        // My screen shared (their share would switch to Screen + camera): every open tile at once.
        Call(live.copy(screenVideo = "screen"), Action.Open(TileId.TEXT), Action.Open(TileId.CHAT), Action.Preset(PresetId.GRID))
    }

    /** Their camera not floating: it goes in the rail (a strip along the bottom below 1024 dp), tap to focus. */
    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun railUnfolded() = shoot("calls-49-layout-rail-unfolded") { Call(live, Action.Open(TileId.CHAT), Action.RemoteFloat(false), Action.Focus(TileId.TEXT)) }

    /** Board ⇄ Draw in place, stacked panes. */
    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun drawStackedUnfolded() = shoot("calls-50-layout-draw-stacked-unfolded") {
        Call(live, Action.Preset(PresetId.BOARD), Action.Swap(TileId.TEXT, TileId.DRAW), Action.SetDir(CallLayout.Dir.COLUMN), Action.Ratio(0.6))
    }

    // ---- round 3: faces together — both cameras in one box over the content

    @Test fun facesBoardFolded() = shoot("calls-51-faces-board-folded") { Call(live, Action.Focus(TileId.TEXT)) }

    @Test fun facesDrawFolded() = shoot("calls-52-faces-draw-folded") { Call(live, Action.Focus(TileId.DRAW)) }

    /** Cameras off: the initials / "You" placeholders, still side by side. */
    @Test fun facesCamerasOffFolded() = shoot("calls-53-faces-cameras-off-folded") {
        val off = live.copy(camOn = false, remote = live.remote!!.copy(peer = tutor.copy(state = tutor.state.copy(cam = false))))
        Call(off, Action.Focus(TileId.TEXT))
    }

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun facesBoardUnfolded() = shoot("calls-54-faces-board-unfolded") { Call(live, Action.Focus(TileId.TEXT)) }

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun facesDraggedUnfolded() = shoot("calls-55-faces-bottom-right-unfolded") { Call(live, Action.Focus(TileId.TEXT), Action.PairCorner(CallLayout.Corner.BR), Action.PairScale(1.4)) }

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun camerasSeparateUnfolded() = shoot("calls-56-cameras-separate-unfolded") { Call(live, Action.SetPip(CallLayout.Pip.SEPARATE), Action.Focus(TileId.TEXT)) }

    @Config(qualifiers = UNFOLDED_TALL)
    @Test fun facesTapSpeakerUnfolded() = shoot("calls-57-faces-tap-speaker-unfolded") { Call(live, Action.Focus(TileId.TEXT), Action.PairTap) }

    companion object {
        /** The Fold unfolded, portrait-ish (~840 × 900 dp). */
        const val UNFOLDED_TALL = "w840dp-h900dp-xxhdpi"
    }
}
