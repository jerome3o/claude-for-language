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
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.data.api.CallLessonCallDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallListItemDto
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config

/** Calls round 4 — PR 2: Leave vs End, "You left", one lesson of several calls (list + review). */
class CallLessonsScreenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(who: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        LaunchedEffect(who) { if (who == "them") onFrameSize(1280, 720) else onFrameSize(720, 1280) }
        val colors = if (who == "them") listOf(Color(0xFF7C9A92), Color(0xFF34495E)) else listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            Text(if (who == "them") "👩‍🏫" else "🧑", fontSize = if (who == "them") 120.sp else 48.sp)
        }
    }

    private val t0 = CallsSamples.T0
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "王老师", null, PeerMediaState(mic = true, cam = true, recording = true))
    private val info = CallScreenInfo(otherName = "王老师 Wang", myName = "Jerome Swannack", relationshipId = "r1")
    private val live = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true, recording = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME, screenShareSupported = true,
        remote = RemoteParticipant(tutor, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
    )
    private val now = { t0 + 22 * 60_000 + 5_000 }

    /** End asks first: "Just leave" keeps the call going for the other person. */
    @Test fun endConfirm() = shoot("calls-40-end-confirm") {
        CallScreen(live, info, CallActions(), fakeVideo, now, initialEndConfirm = true)
    }

    /** Unfolded: 🚪 Leave sits next to the red End. */
    @Config(qualifiers = UNFOLDED)
    @Test fun leaveNextToEndUnfolded() = shoot("calls-41-leave-and-end-unfolded") {
        CallScreen(live, info, CallActions(), fakeVideo, now)
    }

    @Test fun left() = shoot("calls-42-left-rejoin") {
        CallScreen(CallState(phase = CallPhase.LEFT), info, CallActions(), fakeVideo)
    }

    // 2 Oct 2026: one lesson became four calls (switching device, a freeze, a 4-second accident).
    private val day = 1_790_944_260_000L // 2026-10-02 12:31:00 UTC
    private fun min(m: Int) = day + m * 60_000L
    private fun sql(ms: Long) = java.time.Instant.ofEpochMilli(ms).toString().replace('T', ' ').take(19)
    private fun lessonCall(id: String, start: Long, end: Long?, summary: Boolean = false) = CallListItemDto(
        id, relationship_id = "r1", created_by = CallsSamples.TUTOR, status = if (end == null) "live" else "ended",
        processing_status = if (summary) "done" else "none", started_at = start, ended_at = end, created_at = sql(start),
        lesson_id = "a", other_user_name = "王老师", has_summary = summary,
    )

    private val lessonList = listOf(
        lessonCall("d", min(61), min(61) + 4_000),
        lessonCall("c", min(41), min(57)),
        lessonCall("b", min(23), min(40)),
        lessonCall("a", min(0), min(22), summary = true),
    ) + CallsSamples.list.drop(1).map { it.copy(created_at = sql(it.started_at ?: 0L)) }

    @Test fun pastCallsOneLesson() = shoot("calls-43-past-calls-lesson") {
        CallsListScreen(CallsListUi(calls = Loadable(lessonList), people = CallsSamples.people), CallsListActions(onBack = {}))
    }

    private val lesson = CallLessonDto(
        id = "a", started_at = min(0), last_ended_at = min(61) + 4_000, processing_status = "done",
        calls = listOf(
            CallLessonCallDto("a", "ended", CallsSamples.TUTOR, min(0), min(22), sql(min(0))),
            CallLessonCallDto("b", "ended", CallsSamples.TUTOR, min(23), min(40), sql(min(23))),
            CallLessonCallDto("c", "ended", CallsSamples.TUTOR, min(41), min(57), sql(min(41))),
            CallLessonCallDto("d", "ended", CallsSamples.TUTOR, min(61), min(61) + 4_000, sql(min(61))),
        ),
    )

    @Test fun reviewLessonBox() = shoot("calls-44-review-lesson") {
        val d = CallsSamples.detail.copy(
            call = CallsSamples.detail.call.copy(id = "c", started_at = min(41), ended_at = min(57)),
            lesson = lesson,
        )
        CallReviewScreen(
            CallsSamples.reviewUi(d, homework = CallHomeworkUi("r1", "李明", jobs = listOf(CallsSamples.homeworkJob.copy(status = "done", progress = null)))),
            CallReviewActions(),
        )
    }
}
