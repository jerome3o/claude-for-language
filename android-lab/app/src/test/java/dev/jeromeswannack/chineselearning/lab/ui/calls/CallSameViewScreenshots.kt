package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.CallView
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * "Same view" (core CallView): the top bar's chip, its menu (Same view · My own view · Bring Jerome to my
 * view, and "Jerome is looking around on their own"), the invitation pill while I look around on my own,
 * and Leave / End set apart from the everyday controls.
 */
class CallSameViewScreenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        val size = if (handle == "them") listOf(1280, 720) else listOf(720, 1280)
        LaunchedEffect(handle) { onFrameSize(size[0], size[1]) }
        val colors = if (handle == "them") listOf(Color(0xFF7C9A92), Color(0xFF34495E)) else listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            Text(if (handle == "them") "🧑" else "👩‍🏫", fontSize = if (handle == "them") 96.sp else 40.sp)
        }
    }

    private val t0 = CallsSamples.T0
    private val now = { t0 + 18 * 60_000 + 5_000 }
    private val board = TextBoardUi(text = "第七课 · 点菜\n我要一碗牛肉面。\n服务员，买单！\n一共多少钱？", version = 2)

    // The tutor's phone (Minghui) with the student Jerome.
    private val student = CallPeer("c-s", CallsSamples.ME, "Jerome Swannack", null, PeerMediaState(mic = true, cam = true))
    private val tutorView = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.TUTOR, screenShareSupported = true,
        remote = RemoteParticipant(student, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        textBoard = board, board = CallsSamples.board, tutorId = CallsSamples.TUTOR,
    )
    private val tutorInfo = CallScreenInfo(otherName = "Jerome Swannack", myName = "Minghui", relationshipId = "r1")

    // The student's phone (Jerome) with the tutor Minghui.
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "Minghui", null, PeerMediaState(mic = true, cam = true))
    private val studentView = tutorView.copy(
        myUserId = CallsSamples.ME,
        remote = RemoteParticipant(tutor, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
    )
    private val studentInfo = CallScreenInfo(otherName = "Minghui", myName = "Jerome Swannack", relationshipId = "r1")

    private fun boardLayout() = CallLayoutHolder(initial = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Focus(TileId.TEXT)))

    /** Folded, the student on Same view: the board Minghui opened, "👥 Same view ✓" in the top bar, Leave / End apart. */
    @Test fun studentOnSameView() = shoot("lab-calls-view-01-student-same-view") {
        CallScreen(studentView, studentInfo, CallActions(), fakeVideo, now, layout = boardLayout())
    }

    /** The student looks around on their own and Minghui brings them: the invitation with Join. */
    @Test fun studentInvited() = shoot("lab-calls-view-02-student-invited") {
        CallScreen(
            studentView.copy(viewMode = CallView.ViewMode.OWN, viewInvite = "Minghui"), studentInfo, CallActions(), fakeVideo, now,
            layout = CallLayoutHolder(initial = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Focus(TileId.CHAT))),
        )
    }

    /** The tutor while the student looks around: the quiet line under the top bar. */
    @Test fun tutorSeesTheyLookAround() = shoot("lab-calls-view-03-tutor-they-look-around") {
        val own = tutorView.copy(remote = tutorView.remote!!.copy(peer = student.copy(state = student.state.copy(view = CallView.ViewMode.OWN))))
        CallScreen(own, tutorInfo, CallActions(), fakeVideo, now, layout = boardLayout())
    }

    /** The chip's menu (the sheet's content), the student on their own view. */
    @Test fun viewMenu() = shoot("lab-calls-view-04-menu") {
        MenuFrame { CallViewMenu(CallView.ViewMode.SAME, "Jerome Swannack", otherHere = true, theyLookAround = true, actions = ViewActions(), close = {}) }
    }

    @Test fun viewMenuOwn() = shoot("lab-calls-view-05-menu-own") {
        MenuFrame { CallViewMenu(CallView.ViewMode.OWN, "Minghui", otherHere = true, theyLookAround = false, actions = ViewActions(), close = {}) }
    }

    /** Unfolded: board + camera, the chip, and the controls with Leave / End set apart. */
    @Config(qualifiers = UNFOLDED)
    @Test fun tutorUnfolded() = shoot("lab-calls-view-06-tutor-unfolded") {
        CallScreen(tutorView, tutorInfo, CallActions(), fakeVideo, now, layout = CallLayoutHolder(initial = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Preset(CallLayout.PresetId.BOARD))))
    }

    @Composable
    private fun MenuFrame(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Color(0xFF111418)), contentAlignment = Alignment.BottomCenter) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)).background(Lab.colors.card).padding(top = 20.dp)) {
                Text("What you both see", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 20.dp, bottom = 12.dp))
                content()
            }
        }
    }
}
