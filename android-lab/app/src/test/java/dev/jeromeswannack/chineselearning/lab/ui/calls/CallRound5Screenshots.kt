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
import dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow
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
 * Video calls round 5: the tutor leads. Her "Show for student" corner button on the board (and
 * "Showing ✓" once the student sees it), "Stop their share" on the student's shared screen, and on the
 * student's side the quiet "Minghui is showing you this" pill and the "Minghui stopped your screen share" note.
 */
class CallRound5Screenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        val size = when (handle) { "them" -> listOf(1280, 720); "screen" -> listOf(1080, 2400); else -> listOf(720, 1280) }
        LaunchedEffect(handle) { onFrameSize(size[0], size[1]) }
        val colors = when (handle) {
            "them" -> listOf(Color(0xFF7C9A92), Color(0xFF34495E))
            "screen" -> listOf(Color(0xFFF8FAFC), Color(0xFFE2E8F0))
            else -> listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        }
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            if (handle == "screen") Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("微信 · 王老师", color = Color(0xFF0F172A), fontSize = 22.sp)
                Text("我明天下午有空。", color = Color(0xFF334155), fontSize = 20.sp)
                Text("wǒ míngtiān xiàwǔ yǒu kòng", color = Color(0xFF64748B), fontSize = 14.sp)
            } else Text(if (handle == "them") "🧑" else "👩‍🏫", fontSize = if (handle == "them") 96.sp else 40.sp)
        }
    }

    private val t0 = CallsSamples.T0
    private val now = { t0 + 22 * 60_000 + 5_000 }
    private val board = TextBoardUi(
        text = "第六课 · 约时间\n你明天有空吗？\n有空 yǒu kòng = to be free\n下午三点怎么样？\n不见不散！",
        version = 3,
    )

    // ---- the tutor's phone: Minghui (me) with the student Jerome
    private val student = CallPeer("c-s", CallsSamples.ME, "Jerome Swannack", null, PeerMediaState(mic = true, cam = true))
    private val tutorView = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.TUTOR, screenShareSupported = true,
        remote = RemoteParticipant(student, video = "them", screen = "screen", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        textBoard = board, board = CallsSamples.board, tutorId = CallsSamples.TUTOR,
    )
    private val tutorInfo = CallScreenInfo(otherName = "Jerome Swannack", myName = "Minghui", relationshipId = "r1")
    private fun boardLayout() = CallLayoutHolder(initial = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Focus(TileId.TEXT)))

    /** Folded, the tutor on the board: "👀 Show for student" in the board's top corner. */
    @Test fun tutorShowButtonOnTheBoard() = shoot("lab-calls-r5-01-tutor-show-for-student") {
        CallScreen(tutorView, tutorInfo, CallActions(), fakeVideo, now, layout = boardLayout())
    }

    /** After the press (or opening the board): "Showing ✓" while the student sees this page. */
    @Test fun tutorShowingTheBoard() = shoot("lab-calls-r5-02-tutor-showing") {
        val shown = CallFollow.ShownState("s1", 1, CallsSamples.TUTOR, "Minghui", CallFollow.ShowView.text(null), t0)
        CallScreen(tutorView.copy(shown = shown), tutorInfo, CallActions(), fakeVideo, now, layout = boardLayout())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun tutorShowButtonUnfolded() = shoot("lab-calls-r5-03-tutor-show-for-student-unfolded") {
        CallScreen(tutorView, tutorInfo, CallActions(), fakeVideo, now, layout = CallLayoutHolder(initial = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Preset(CallLayout.PresetId.BOARD))))
    }

    /** The student shares their screen: the tutor gets "⏹ Stop their share" on it. */
    @Test fun tutorStopTheirShare() = shoot("lab-calls-r5-04-tutor-stop-their-share") {
        val sharing = tutorView.copy(remote = tutorView.remote!!.copy(peer = student.copy(state = student.state.copy(screen = true))))
        CallScreen(sharing, tutorInfo, CallActions(), fakeVideo, now, layout = CallLayoutHolder().apply { setRemoteSharing(true) })
    }

    // ---- the student's phone: Jerome (me) with the tutor Minghui
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "Minghui", null, PeerMediaState(mic = true, cam = true))
    private val studentView = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME, screenShareSupported = true,
        remote = RemoteParticipant(tutor, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        textBoard = board, board = CallsSamples.board, tutorId = CallsSamples.TUTOR,
        shown = CallFollow.ShownState("s1", 1, CallsSamples.TUTOR, "Minghui", CallFollow.ShowView.text(null), t0),
    )
    private val studentInfo = CallScreenInfo(otherName = "Minghui", myName = "Jerome Swannack", relationshipId = "r1")

    /** What she showed is on my stage, with the quiet pill (✕ hides it). */
    @Test fun studentShowingBanner() = shoot("lab-calls-r5-05-student-showing-banner") {
        CallScreen(studentView.copy(showingBanner = CallFollow.showingBanner("Minghui")), studentInfo, CallActions(), fakeVideo, now, layout = CallLayoutHolder(initial = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Shown(TileId.TEXT))))
    }

    /** She stopped my screen share: the note says so (my share is already gone). */
    @Test fun studentShareStoppedNote() = shoot("lab-calls-r5-06-student-share-stopped") {
        CallScreen(studentView.copy(shareStoppedNote = BoardNotice(1, CallFollow.shareStoppedNote("Minghui"))), studentInfo, CallActions(), fakeVideo, now, layout = CallLayoutHolder())
    }
}
