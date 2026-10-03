package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityAction
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession
import dev.jeromeswannack.chineselearning.lab.core.calls.CallActivities
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer
import dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * In-call activities: every kind from both sides (tutor = 王老师, student = Jerome), the picker,
 * the done screen, a solo call and the unfolded Fold. Sessions are made by the real engine.
 */
class CallActivityScreenshots : LabScreenshotTest() {
    private val fakeVideo: VideoSlot = { handle, _, _, _, onFrameSize, modifier -> FakeVideo(handle as String, onFrameSize, modifier) }

    @Composable
    private fun FakeVideo(handle: String, onFrameSize: (Int, Int) -> Unit, modifier: Modifier) {
        LaunchedEffect(handle) { onFrameSize(720, 960) }
        val colors = if (handle == "tutor") listOf(Color(0xFF7C9A92), Color(0xFF34495E)) else listOf(Color(0xFFE0B089), Color(0xFF8E5A3C))
        Box(modifier.background(Brush.verticalGradient(colors)), contentAlignment = Alignment.Center) {
            Text(if (handle == "tutor") "👩‍🏫" else "🧑", fontSize = 40.sp)
        }
    }

    private val T = CallsSamples.TUTOR
    private val S = CallsSamples.ME
    private val t0 = CallsSamples.T0
    private val nowMs = t0 + 22 * 60_000
    private val now = { nowMs }
    private val names = mapOf(T to "王老师", S to "Jerome Swannack")

    private fun start(id: String, solo: Boolean = false): ActivitySession = CallActivities.start(
        CallActivities.find(id)!!,
        CallActivities.StartOptions("sess-$id", T, T, if (solo) listOf(T) else listOf(T, S), names, t0),
    )
    private fun ActivitySession.by(actor: String, a: ActivityAction) = CallActivities.reduce(this, a, actor, t0 + 1_000) ?: error("refused $a by $actor")
    private fun ActivitySession.byRole(role: String, a: ActivityAction) = by(roles.of(role), a)

    /** The call as [me] sees it, with [activity] on the stage. */
    private fun state(me: String, activity: ActivitySession, solo: Boolean = false): CallState {
        val other = if (me == T) S else T
        val peer = CallPeer("c-other", other, names.getValue(other), null, PeerMediaState(mic = true, cam = true))
        return CallState(
            phase = CallPhase.LIVE, mediaReady = true, hasMic = true, hasCamera = true, localVideo = if (me == T) "tutor" else "me", recordSupported = true,
            startedAt = t0, roomStatus = RoomStatus.OPEN, myUserId = me,
            remote = if (solo) null else RemoteParticipant(peer, video = if (other == T) "tutor" else "me", connection = "connected", tile = CallConnection.TileStatus.LIVE),
            activity = activity,
        )
    }

    private fun info(me: String, seed: ActivityUiSeed = ActivityUiSeed()) =
        CallScreenInfo(otherName = if (me == T) "Jerome Swannack" else "王老师", myName = names.getValue(me), relationshipId = "r1", activitySeed = seed)

    private fun shot(name: String, me: String, s: ActivitySession, solo: Boolean = false, seed: ActivityUiSeed = ActivityUiSeed()) = shoot(name) {
        CallScreen(state(me, s, solo), info(me, seed), CallActions(), fakeVideo, now, layout = CallLayoutHolder().apply { setActivity(s.sessionId) })
    }

    // ---- describe & guess (A = the student describes, B = the tutor guesses)
    private val describe = start("describe-food-1")
    private val describeWrong = describe.byRole("b", ActivityAction.Pick(describe.data.options!!.first { it != "苹果" }))

    @Test fun describeStudent() = shot("lab-act-01-describe-student", S, describe)
    @Test fun describeTutor() = shot("lab-act-02-describe-tutor", T, describe)
    @Test fun describeReveal() = shot("lab-act-03-describe-reveal-student", S, describeWrong)

    // ---- information gap (tutor A, student B)
    private val gap = start("info-gap-weekend-1")
        .byRole("a", ActivityAction.Fill("0:1", "去超市"))
        .byRole("a", ActivityAction.Fill("1:0", "游泳"))
        .byRole("b", ActivityAction.Fill("0:0", "打篮球"))
    private val gapReveal = gap.byRole("b", ActivityAction.Fill("1:1", "学中文")).by(T, ActivityAction.Reveal)

    @Test fun infoGapTutor() = shot("lab-act-04-info-gap-tutor", T, gap)
    @Test fun infoGapStudent() = shot("lab-act-05-info-gap-student", S, gap)
    @Test fun infoGapReveal() = shot("lab-act-06-info-gap-reveal-student", S, gapReveal)

    // ---- role-play (tutor = 服务员 A)
    private val roleplay = start("roleplay-restaurant-1").let { s -> (0 until 3).fold(s) { acc, i -> acc.byRole(acc.spec.lineList[i].speaker, ActivityAction.LineDone) } }

    @Test fun roleplayStudent() = shot("lab-act-07-roleplay-student", S, roleplay)
    @Test fun roleplayTutor() = shot("lab-act-08-roleplay-tutor", T, roleplay.byRole("b", ActivityAction.LineDone))

    // ---- sentence building
    private val build = start("build-sentences-1").let { s -> s.by(S, ActivityAction.Place(0)).by(T, ActivityAction.Place(1)) }
    private val buildReveal = build.by(S, ActivityAction.Place(3)).by(S, ActivityAction.Place(2)).by(S, ActivityAction.Place(4)).by(T, ActivityAction.Reveal).by(T, ActivityAction.Said)

    @Test fun buildStudent() = shot("lab-act-09-build-student", S, build)
    @Test fun buildTutor() = shot("lab-act-10-build-tutor", T, build)
    @Test fun buildReveal() = shot("lab-act-11-build-reveal-student", S, buildReveal)

    // ---- quick quiz (tutor asks)
    private val quizMw = start("quiz-measure-words-1").by(T, ActivityAction.Ask).by(S, ActivityAction.Pick("1"))
    private val tones = start("quiz-tones-1")

    @Test fun quizTutorLivePick() = shot("lab-act-12-quiz-tutor", T, quizMw)
    @Test fun quizStudent() = shot("lab-act-13-quiz-student", S, quizMw)
    @Test fun quizTonesReadyTutor() = shot("lab-act-14-quiz-ready-tutor", T, tones)
    @Test fun quizTonesListenStudent() = shot("lab-act-15-quiz-listen-student", S, tones.by(T, ActivityAction.Ask))
    @Test fun quizRevealTutor() = shot("lab-act-16-quiz-reveal-tutor", T, quizMw.by(T, ActivityAction.Reveal))

    // ---- dictation (tutor reads, student writes)
    private val dictation = start("dictation-everyday-1").by(T, ActivityAction.Ask).by(S, ActivityAction.Draft("你号"))

    @Test fun dictationTutor() = shot("lab-act-17-dictation-tutor", T, dictation)
    @Test fun dictationStudent() = shot("lab-act-18-dictation-student", S, dictation)
    @Test fun dictationReadyTutor() = shot("lab-act-19-dictation-ready-tutor", T, start("dictation-everyday-1"))
    @Test fun dictationReveal() = shot("lab-act-20-dictation-reveal-student", S, dictation.by(T, ActivityAction.Reveal))

    // ---- done, solo, unfolded, picker
    private val done = (0 until 5).fold(start("quiz-measure-words-1")) { acc, i ->
        acc.by(T, ActivityAction.Ask).by(S, ActivityAction.Pick(if (i % 2 == 0) acc.spec.questionList[acc.round].answer.toString() else "3")).by(T, ActivityAction.Reveal).by(T, ActivityAction.Next)
    }.by(S, ActivityAction.Finish)

    @Test fun doneTutor() = shot("lab-act-21-done-tutor", T, done)
    @Test fun doneStudent() = shot("lab-act-22-done-student", S, done)
    @Test fun soloViewingAsB() = shot("lab-act-23-solo-viewing-as-b", T, start("describe-animals-1", solo = true), solo = true, seed = ActivityUiSeed(viewAs = "b"))

    @Config(qualifiers = UNFOLDED)
    @Test fun infoGapUnfolded() = shot("lab-act-24-info-gap-unfolded-tutor", T, gap)

    @Config(qualifiers = UNFOLDED)
    @Test fun describeUnfolded() = shot("lab-act-25-describe-unfolded-tutor", T, describe)

    /** ⋯ → 🎲 Activities (the sheet's content; the sheet itself is a dialog window). */
    @Test fun picker() = shoot("lab-act-26-picker") {
        LabCard { Column(Modifier.verticalScroll(rememberScrollState())) { ActivityPickerSheet(roleplay) {} } }
    }

    @Test fun moreMenu() = shoot("lab-act-27-more-menu") {
        LabCard { Column { CallMoreMenu(state(S, describe), info(S), CallActions(), close = {}) } }
    }
}
