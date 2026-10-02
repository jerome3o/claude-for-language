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
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText
import dev.jeromeswannack.chineselearning.lab.core.calls.ShownText
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.PresetId
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.core.calls.ShownStroke
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * Video calls round 4, PR 4: typing on a shared screen. ✏️ Pen / T Text in the drawing tools with
 * Keep on by default; a text field on the picture; a selected text with its ✕; the sharer sees the
 * texts with both people's strokes.
 */
class CallAnnotateTextScreenshots : LabScreenshotTest() {
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
                Text("第五课 · 点菜", color = Color(0xFF0F172A), fontSize = 26.sp)
                Text("我想要一杯咖啡。", color = Color(0xFF334155), fontSize = 20.sp)
                Text("wǒ xiǎng yào yì bēi kāfēi", color = Color(0xFF64748B), fontSize = 13.sp)
                Text("不要放香菜。", color = Color(0xFF334155), fontSize = 20.sp, modifier = Modifier.padding(top = 12.dp))
            } else Text(if (who == "them") "👩‍🏫" else "🧑", fontSize = if (who == "them") 96.sp else 40.sp)
        }
    }

    private val t0 = CallsSamples.T0
    private val nowMs = t0 + 12 * 60_000 + 34_000
    private val now = { nowMs }
    private val tutor = CallPeer("c-a", CallsSamples.TUTOR, "王老师", null, PeerMediaState(mic = true, cam = true))
    private val info = CallScreenInfo(otherName = "王老师", myName = "Jerome Swannack", relationshipId = "r1")
    private val live = CallState(
        phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = "me", recordSupported = true,
        startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = CallsSamples.ME, screenShareSupported = true,
        remote = RemoteParticipant(tutor, video = "them", connection = "connected", tile = CallConnection.TileStatus.LIVE),
    )

    private fun ellipse(cx: Double, cy: Double, rx: Double, ry: Double) = (0..40).map { i ->
        val a = i * Math.PI * 2 / 40
        (cx + rx * Math.cos(a)) to (cy + ry * Math.sin(a))
    }
    private fun underline(x0: Double, x1: Double, y: Double) = (0..12).map { i -> (x0 + (x1 - x0) * i / 12) to (y + 0.004 * Math.sin(i.toDouble())) }
    private fun stroke(key: String, from: String, color: String, points: List<Pair<Double, Double>>, doneAgoMs: Long?) =
        key to ShownStroke(AnnotStroke(key, color, CallAnnotate.ANNOT_WIDTH, points, doneAgoMs != null), from, doneAgoMs?.let { nowMs - it })

    private fun layout(vararg actions: Action) = CallLayoutHolder(initial = actions.fold(CallLayout.DEFAULT_LAYOUT) { l, a -> CallLayout.reduce(l, a) })

    private fun text(id: String, from: String, color: String, x: Double, y: Double, s: String, doneAgoMs: Long? = 20_000) =
        id to ShownText(AnnotText(id, color, x, y, s, CallAnnotate.ANNOT_TEXT_SIZE, doneAgoMs != null), from, doneAgoMs?.let { nowMs - it })

    // ---- the viewer: the tutor's laptop screen; my red circle + note, their blue underline + note; Keep on (the default)

    private val viewer = live.copy(
        remote = live.remote!!.copy(screen = "screen@1920x1080", peer = tutor.copy(state = tutor.state.copy(screen = true))),
        annotations = Annotations(
            strokes = mapOf(
                stroke("v1", "me", CallAnnotate.VIEWER_ANNOT_COLOR, ellipse(0.5, 0.455, 0.14, 0.05), 45_000),
                stroke("s1", "c-a", CallAnnotate.SHARER_ANNOT_COLOR, underline(0.4, 0.6, 0.64), 30_000),
            ),
            texts = mapOf(
                text("t1", "me", CallAnnotate.VIEWER_ANNOT_COLOR, 0.66, 0.36, "要 = want?"),
                text("t2", "c-a", CallAnnotate.SHARER_ANNOT_COLOR, 0.08, 0.7, "香菜 xiāngcài\ncoriander"),
            ),
        ),
    )

    @Test fun toolsPenTextKeepOn() = shoot("calls-70-tools-pen-text-keep") {
        CallScreen(viewer, info, CallActions(), fakeVideo, now, initialAnnotating = true, initialAnnot = AnnotUiSeed(tool = AnnotTool.TEXT))
    }

    @Test fun typingATextOnTheirScreen() = shoot("calls-71-typing-text-on-shared-screen") {
        CallScreen(
            viewer, info, CallActions(), fakeVideo, now, initialAnnotating = true,
            initialAnnot = AnnotUiSeed(AnnotTool.TEXT, editor = AnnotTextEditor("t3", 0.56, 0.2, TextFieldValue("这个字读什么？", TextRange(7)), null)),
        )
    }

    @Test fun aSelectedTextWithItsDelete() = shoot("calls-72-selected-text-delete") {
        CallScreen(viewer, info, CallActions(), fakeVideo, now, initialAnnotating = true, initialAnnot = AnnotUiSeed(AnnotTool.TEXT, selected = "t1"))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun typingUnfolded() = shoot("calls-73-typing-text-unfolded") {
        CallScreen(
            viewer, info, CallActions(), fakeVideo, now, initialAnnotating = true, layout = layout(Action.Preset(PresetId.SCREEN)),
            initialAnnot = AnnotUiSeed(AnnotTool.TEXT, editor = AnnotTextEditor("t3", 0.56, 0.2, TextFieldValue("这个字读什么？", TextRange(7)), null)),
        )
    }

    // ---- the sharer: my phone's screen; the tutor's text and circle, my own note and underline

    private val sharer = live.copy(
        screenVideo = "screen@1080x2400",
        annotations = Annotations(
            strokes = mapOf(
                stroke("t1s", "c-a", CallAnnotate.VIEWER_ANNOT_COLOR, ellipse(0.5, 0.485, 0.3, 0.035), 4_000),
                stroke("m1", "me", CallAnnotate.SHARER_ANNOT_COLOR, underline(0.3, 0.7, 0.535), 9_000),
            ),
            texts = mapOf(
                text("tt", "c-a", CallAnnotate.VIEWER_ANNOT_COLOR, 0.18, 0.4, "一杯 = one cup"),
                text("mt", "me", CallAnnotate.SHARER_ANNOT_COLOR, 0.2, 0.56, "不要 = don’t"),
            ),
            lastRemoteAt = nowMs - 1_500,
            lastRemoteName = "王老师",
        ),
    )

    @Test fun sharerSeesTextAndStrokes() = shoot("calls-74-sharer-sees-text-and-strokes") {
        CallScreen(sharer, info.copy(screenOverlayOn = true), CallActions(), fakeVideo, now, layout = layout(Action.Preset(PresetId.SCREEN)))
    }
}
