package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChime
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTimer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/** Video calls round 7: the call timer (pill, sheet, time's up) and the "… joined" toast. */
class CallRound7Screenshots : LabScreenshotTest() {
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
    private val nowMs = t0 + 22 * 60_000 + 5_000
    private val now = { nowMs }
    private val student = CallPeer("c-s", CallsSamples.ME, "Jerome Swannack", null, PeerMediaState(mic = true, cam = true))
    private val tutorView = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.TUTOR, screenShareSupported = true,
        remote = RemoteParticipant(student, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        tutorId = CallsSamples.TUTOR,
    )
    private val info = CallScreenInfo(otherName = "Jerome Swannack", myName = "Minghui", relationshipId = "r1")
    /** A 5-minute countdown started 61.4 s ago (room time = the screenshot's clock). */
    private val running = CallTimer.Timer("t1", CallTimer.Mode.COUNTDOWN, 300_000, true, nowMs - 61_400, 0, 1, 1, CallsSamples.TUTOR, "Minghui")
    private val actions = CallActions(timer = TimerActions(roomNow = now))

    @Test fun timerRunningWithJoinToast() = shoot("lab-calls-r7-01-timer-running-joined") {
        CallScreen(
            tutorView.copy(timer = running, presenceToasts = listOf(PresenceToast(1, CallChime.Kind.JOIN, CallChime.joinedText("Jerome Swannack")))),
            info, actions, fakeVideo, now,
        )
    }

    @Test fun timerSheetTutor() = shoot("lab-calls-r7-02-timer-sheet-tutor") {
        CallScreen(tutorView, info, actions, fakeVideo, now, initialTimerSheet = true)
    }

    @Test fun timerSheetStudent() = shoot("lab-calls-r7-03-timer-sheet-student") {
        val studentView = tutorView.copy(myUserId = CallsSamples.ME, remote = tutorView.remote!!.copy(peer = CallPeer("c-a", CallsSamples.TUTOR, "Minghui", null, PeerMediaState(mic = true, cam = true))), timer = running)
        CallScreen(studentView, info.copy(otherName = "Minghui"), actions, fakeVideo, now, initialTimerSheet = true)
    }

    @Test fun timeUp() = shoot("lab-calls-r7-04-time-up") {
        val done = running.copy(startedAt = nowMs - 300_500)
        CallScreen(tutorView.copy(timer = done, timeUp = BoardNotice(1, "⏱ ${CallTimer.TIMER_UP_LABEL}")), info, actions, fakeVideo, now)
    }
}
