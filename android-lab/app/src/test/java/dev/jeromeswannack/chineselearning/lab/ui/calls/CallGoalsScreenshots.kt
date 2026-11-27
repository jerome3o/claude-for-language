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
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallGoals
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/** 🎯 Structures to use in the call (core CallGoals): the chip, the student's sheet with a tick and a near miss, the tutor's sheet. */
class CallGoalsScreenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        val size = if (handle == "them") listOf(1280, 720) else listOf(720, 1280)
        LaunchedEffect(handle) { onFrameSize(size[0], size[1]) }
        val colors = if (handle == "them") listOf(Color(0xFF7C9A92), Color(0xFF34495E)) else listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            Text(if (handle == "them") "👩‍🏫" else "🧑", fontSize = if (handle == "them") 96.sp else 40.sp)
        }
    }

    private val t0 = CallsSamples.T0
    private val nowMs = t0 + 12 * 60_000
    private val now = { nowMs }
    private fun goal(id: String, name: String, line: String, meaning: String, example: String, fixed: List<String>, met: String) =
        CallGoals.Goal(id, name, line, meaning, example, fixed, "learned", met, CallGoals.Status.OPEN, null, null, null)
    private val goals = CallGoals.Goals(
        CallsSamples.ME, "Jerome Swannack",
        listOf(
            goal("g1", "除了…还…", "除了 + [Noun] + ， + [Subject] + 还 + [Verb]", "besides A, also B", "除了中文，我还学日语。", listOf("除了", "还"), "2026-11-25T10:00:00Z")
                .copy(status = CallGoals.Status.USED, used = CallGoals.Hit("除了中文，我还想学日语。", t0 + 3 * 60_000, "auto")),
            goal("g2", "本来…要…", "本来 + [Subject] + 要 + [Verb]", "originally meant to", "我本来要去，后来没去。", listOf("本来", "要"), "2026-11-23T10:00:00Z")
                .copy(status = CallGoals.Status.NEAR, near = CallGoals.Heard("本来我就是随便要说说", t0 + 5 * 60_000)),
            goal("g3", "从…的角度来看", "从 + [Noun] + 的角度来看", "from the point of view of", "从老师的角度来看，这样不好。", listOf("从", "的角度来看"), "2026-11-21T10:00:00Z"),
            goal("g4", "一…就…", "一 + [Verb] + 就 + [Verb]", "as soon as", "我一到家就睡觉了。", listOf("一", "就"), "2026-11-18T10:00:00Z"),
        ),
        4, 4,
    )
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "Minghui", null, PeerMediaState(mic = true, cam = true))
    private val studentView = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME, screenShareSupported = true,
        remote = RemoteParticipant(tutor, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        tutorId = CallsSamples.TUTOR, goals = goals, goalsListener = "listening",
    )
    private val info = CallScreenInfo(otherName = "Minghui", myName = "Jerome", relationshipId = "r1")
    private val actions = CallActions(timer = TimerActions(roomNow = now))

    @Test fun chip() = shoot("lab-calls-goals-01-chip") {
        CallScreen(studentView, info, actions, fakeVideo, now)
    }

    @Test fun studentSheet() = shoot("lab-calls-goals-02-student-sheet") {
        CallScreen(studentView.copy(goalsOpen = true), info, actions, fakeVideo, now)
    }

    @Test fun tutorSheet() = shoot("lab-calls-goals-03-tutor-sheet") {
        val student = CallPeer("c-s", CallsSamples.ME, "Jerome Swannack", null, PeerMediaState(mic = true, cam = true))
        CallScreen(
            studentView.copy(myUserId = CallsSamples.TUTOR, remote = studentView.remote!!.copy(peer = student), goalsOpen = true),
            info.copy(otherName = "Jerome Swannack", myName = "Minghui"), actions, fakeVideo, now,
        )
    }
}
