package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import dev.jeromeswannack.chineselearning.lab.core.PresentedMaterial
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText
import dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.core.calls.ShownStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.ShownText
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.materials.MaterialsSamples
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import org.junit.Test
import org.robolectric.annotation.Config

/** Calls round 4 PR 5: a lesson material presented in the call (the material tile) and ⋯ → 📑 Present material. */
class CallMaterialScreenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        LaunchedEffect(handle) { if (handle == "them") onFrameSize(1280, 720) else onFrameSize(720, 1280) }
        val colors = if (handle == "them") listOf(Color(0xFF7C9A92), Color(0xFF34495E)) else listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            Text(if (handle == "them") "👩‍🏫" else "🧑", fontSize = if (handle == "them") 96.sp else 40.sp)
        }
    }

    private val t0 = CallsSamples.T0
    private val nowMs = t0 + 18 * 60_000 + 5_000
    private val now = { nowMs }
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "王老师", null, PeerMediaState(mic = true, cam = true))
    private val info = CallScreenInfo(otherName = "王老师", myName = "Jerome Swannack", relationshipId = "r1", materialSource = MaterialsSamples.source)
    private val presenting = PresentedMaterial("m1", "第五课 把字句 — slides", 1, 3, CallsSamples.TUTOR, "王老师")

    private fun ellipse(cx: Double, cy: Double, rx: Double, ry: Double) = (0..40).map { i ->
        val a = i * Math.PI * 2 / 40
        (cx + rx * Math.cos(a)) to (cy + ry * Math.sin(a))
    }
    private val drawn = Annotations(
        strokes = mapOf(
            "c-a:s1" to ShownStroke(AnnotStroke("s1", CallAnnotate.SHARER_ANNOT_COLOR, CallAnnotate.ANNOT_WIDTH, ellipse(0.2, 0.33, 0.06, 0.06), true), "c-a", nowMs - 20_000),
            "me:s2" to ShownStroke(AnnotStroke("s2", CallAnnotate.VIEWER_ANNOT_COLOR, CallAnnotate.ANNOT_WIDTH, (0..12).map { i -> (0.25 + 0.3 * i / 12) to 0.62 }, true), "me", nowMs - 5_000),
        ),
        texts = mapOf("t1" to ShownText(AnnotText("t1", CallAnnotate.VIEWER_ANNOT_COLOR, 0.62, 0.74, "打破 = break", done = true), "me", nowMs - 4_000)),
        persist = true,
    )
    private val live = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME, screenShareSupported = true,
        remote = RemoteParticipant(tutor, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
        presenting = presenting, materialAnnotations = drawn,
    )

    private fun onStage() = CallLayoutHolder().apply { setPresenting("m1") }

    @Test fun materialOnStagePhone() = shoot("lab-calls-r4-30-material-phone") {
        CallScreen(live, info, CallActions(), fakeVideo, now, layout = onStage())
    }

    @Test fun materialDrawingPhone() = shoot("lab-calls-r4-31-material-drawing-phone") {
        CallScreen(live, info, CallActions(), fakeVideo, now, layout = onStage(), initialMaterial = MaterialUiSeed(drawing = true, tool = AnnotTool.TEXT))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun materialDrawingUnfolded() = shoot("lab-calls-r4-32-material-drawing-unfolded") {
        CallScreen(live, info, CallActions(), fakeVideo, now, layout = onStage(), initialMaterial = MaterialUiSeed(drawing = true))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun materialBesideBoardUnfolded() = shoot("lab-calls-r4-33-material-beside-board-unfolded") {
        val h = onStage().apply { applySplit(ScreenBoardSplit.Choice.BESIDE, CallLayout.TileId.TEXT, CallLayout.TileId.MATERIAL) }
        CallScreen(live, info, CallActions(), fakeVideo, now, layout = h)
    }

    @Test fun materialBelowBoardPhone() = shoot("lab-calls-r4-34-material-board-split-phone") {
        val h = onStage().apply { applySplit(ScreenBoardSplit.Choice.BELOW, CallLayout.TileId.TEXT, CallLayout.TileId.MATERIAL) }
        CallScreen(live, info, CallActions(), fakeVideo, now, layout = h)
    }

    private val sheet = PresentSheetUi(materials = MaterialsSamples.list.filter { it.status == "ready" })

    @Test fun presentSheetPhone() = shoot("lab-calls-r4-35-present-sheet-phone") {
        CallScreen(live.copy(presenting = null, materialAnnotations = Annotations()), info.copy(presentSheet = sheet), CallActions(), fakeVideo, now, initialPresentSheet = true)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun presentSheetUnfolded() = shoot("lab-calls-r4-36-present-sheet-unfolded") {
        CallScreen(live.copy(presenting = null, materialAnnotations = Annotations()), info.copy(presentSheet = sheet.copy(stage = dev.jeromeswannack.chineselearning.lab.data.materials.UploadStage.Rendering(3, 12))), CallActions(), fakeVideo, now, initialPresentSheet = true)
    }

    // ---- round 6: the tutor's "Show for student" in the material's bar (never over Pen / Text), ☰ Contents
    private val student = CallPeer("c-s", CallsSamples.ME, "Jerome Swannack", null, PeerMediaState(mic = true, cam = true))
    private val tutorLive = live.copy(
        myUserId = CallsSamples.TUTOR, tutorId = CallsSamples.TUTOR,
        remote = RemoteParticipant(student, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
    )
    private val tutorInfo = info.copy(otherName = "Jerome Swannack", myName = "Minghui")

    @Test fun tutorMaterialDrawingPhone() = shoot("lab-calls-r6-01-tutor-material-drawing-phone") {
        CallScreen(tutorLive, tutorInfo, CallActions(), fakeVideo, now, layout = onStage(), initialMaterial = MaterialUiSeed(drawing = true))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun tutorMaterialDrawingUnfolded() = shoot("lab-calls-r6-02-tutor-material-drawing-unfolded") {
        CallScreen(tutorLive, tutorInfo, CallActions(), fakeVideo, now, layout = onStage(), initialMaterial = MaterialUiSeed(drawing = true))
    }

    @Test fun materialContentsPhone() = shoot("lab-calls-r6-03-material-contents-phone") {
        CallScreen(live, info, CallActions(), fakeVideo, now, layout = onStage(), initialMaterial = MaterialUiSeed(contentsOpen = true))
    }

    /** The ⋯ sheet's content (the sheet itself is a dialog window): 📑 Present material first. */
    @Test fun moreMenu() = shoot("lab-calls-r4-37-more-menu-present") {
        LabCard { Column { CallMoreMenu(live, info, CallActions(), close = {}) } }
    }
}
