package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityAction
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityItem
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityKinds
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySpec
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession
import dev.jeromeswannack.chineselearning.lab.core.calls.CallActivities
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.ServerMessage
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** In-call activities in the call (web useCall's activity / actActivity): the room's session, actions, synced audio, dictation drafts. */
@OptIn(ExperimentalCoroutinesApi::class)
class CallActivitiesControllerTest {
    private class Rig(scope: TestScope) {
        val room = CallControllerTest.FakeRoom()
        val spoken = ArrayList<String>()
        val clips = ArrayList<Pair<String, String>>()
        val controller = CallController(
            "call1", "me",
            CallDeps(
                openRoom = { h, _ -> room.handlers = h; room },
                media = CallControllerTest.FakeMedia(), recorder = CallControllerTest.FakeRecorder(),
                endCall = {}, drainUploads = {}, closeOrphans = {}, keepAlive = {}, prepareScreenShare = {},
                uploadEveryMs = 60_000, now = { scope.testScheduler.currentTime }, log = {},
                devicePrefs = MemoryCallDevicePrefs(), speak = { spoken += it }, playClip = { k, t -> clips += k to t },
            ),
            scope.backgroundScope,
        )
        fun actions(): List<JsonObject> = room.sent.filter { it["type"]!!.jsonPrimitive.content == "activity_action" }
        fun on(msg: ServerMessage) = room.handlers.onMessage(msg)
        val s get() = controller.state.value
    }

    private val names = mapOf("tutor" to "王老师", "me" to "Jerome")
    private fun start(id: String, sid: String = "sess-1") =
        CallActivities.start(CallActivities.find(id)!!, CallActivities.StartOptions(sid, "tutor", "tutor", listOf("tutor", "me"), names, 1_000))
    private fun ActivitySession.by(actor: String, a: ActivityAction) = CallActivities.reduce(this, a, actor, 2_000) ?: error("refused $a")
    private fun welcome(activity: ActivitySession? = null) = ServerMessage.Welcome("c-me", 1, 1, emptyList(), emptyList(), emptyList(), activity = activity)

    private fun TestScope.live(): Rig {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        return rig
    }

    @Test fun startActAndCloseSendTheRoomMessages() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        rig.on(welcome()); runCurrent()
        assertNull(rig.s.activity)
        rig.controller.startActivity("describe-food-1")
        assertEquals("describe-food-1", rig.room.sent.single { it["type"]!!.jsonPrimitive.content == "activity_start" }["activity_id"]!!.jsonPrimitive.content)
        // No session yet: an action has nowhere to go.
        rig.controller.act(ActivityAction.Next)
        assertTrue(rig.actions().isEmpty())
        val s = start("describe-food-1")
        rig.on(ServerMessage.Activity(s, "c-t", "王老师")); runCurrent()
        assertEquals(s, rig.s.activity)
        assertEquals(s, rig.controller.activity.value)
        val pick = s.data.options!!.first()
        rig.controller.act(ActivityAction.Pick(pick))
        val sent = rig.actions().single()
        assertEquals("sess-1", sent["session_id"]!!.jsonPrimitive.content)
        assertEquals(mapOf("type" to "pick", "option" to pick), sent["action"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content })
        rig.controller.closeActivity()
        assertEquals("sess-1", rig.room.sent.last()["session_id"]!!.jsonPrimitive.content)
        assertEquals("activity_close", rig.room.sent.last()["type"]!!.jsonPrimitive.content)
        rig.on(ServerMessage.Activity(null)); runCurrent()
        assertNull(rig.s.activity)
    }

    @Test fun anOlderVersionOfTheSameSessionIsIgnored() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        val s1 = start("build-sentences-1")
        val s2 = s1.by("me", ActivityAction.Place(0))
        val s3 = s2.by("tutor", ActivityAction.Place(1))
        rig.on(welcome(s1)); runCurrent()
        rig.on(ServerMessage.Activity(s3)); runCurrent()
        rig.on(ServerMessage.Activity(s2)); runCurrent() // late
        assertEquals(s3, rig.s.activity)
        // A new session replaces it whatever its v; a welcome is the truth.
        val other = start("quiz-tones-1", "sess-2")
        rig.on(ServerMessage.Activity(other)); runCurrent()
        assertEquals(other, rig.s.activity)
        rig.on(welcome(s1)); runCurrent()
        assertEquals(s1, rig.s.activity)
    }

    @Test fun audioPlaysWhenPlayGoesUpNeverOnFirstSight() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        val ready = start("quiz-tones-1")
        val asked = ready.by("tutor", ActivityAction.Ask) // play 1 (the question has audio)
        // Joining mid-question: the welcome's play count is not a new play.
        rig.on(welcome(asked)); runCurrent()
        assertTrue(rig.spoken.isEmpty())
        val again = asked.by("tutor", ActivityAction.PlayAudio)
        rig.on(ServerMessage.Activity(again)); runCurrent()
        assertEquals(listOf("买"), rig.spoken)
        // The same session again (a resync) or another change without a play: nothing.
        rig.on(ServerMessage.Activity(again)); runCurrent()
        rig.on(ServerMessage.Activity(again.by("me", ActivityAction.Pick("0")))); runCurrent()
        assertEquals(1, rig.spoken.size)

        // From ready → asked in front of me: plays.
        val rig2 = live()
        rig2.on(welcome(ready)); runCurrent()
        rig2.on(ServerMessage.Activity(asked)); runCurrent()
        assertEquals(listOf("买"), rig2.spoken)

        // Dictation: the word; a new round resets the count (0 again, nothing played).
        val d0 = start("dictation-everyday-1", "sess-d").by("tutor", ActivityAction.Ask)
        rig2.on(ServerMessage.Activity(d0)); runCurrent()
        assertEquals(1, rig2.spoken.size) // another session: never on first sight
        rig2.on(ServerMessage.Activity(d0.by("tutor", ActivityAction.PlayAudio))); runCurrent()
        assertEquals(listOf("买", "你好"), rig2.spoken)
        assertEquals("你好", rig2.controller.activityAudio(d0))
    }

    @Test fun dictationDraftsAreThrottledWithATrailingSend() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        val s = start("dictation-everyday-1").by("tutor", ActivityAction.Ask)
        rig.on(ServerMessage.Activity(s)); runCurrent()
        fun drafts() = rig.actions().map { it["action"]!!.jsonObject }.filter { it["type"]!!.jsonPrimitive.content == "draft" }.map { it["text"]!!.jsonPrimitive.content }
        rig.controller.act(ActivityAction.Draft("你"))
        assertEquals(listOf("你"), drafts())
        rig.controller.act(ActivityAction.Draft("你h"))
        advanceTimeBy(20)
        rig.controller.act(ActivityAction.Draft("你ha"))
        rig.controller.act(ActivityAction.Draft("你好"))
        assertEquals(listOf("你"), drafts())
        advanceTimeBy(CallController.DRAFT_EVERY_MS); runCurrent()
        assertEquals(listOf("你", "你好"), drafts())
        // Submit right after a keystroke: the keystroke goes first.
        advanceTimeBy(10)
        rig.controller.act(ActivityAction.Draft("你好！"))
        rig.controller.act(ActivityAction.Submit)
        val types = rig.actions().map { it["action"]!!.jsonObject["type"]!!.jsonPrimitive.content }
        assertEquals(listOf("draft", "draft", "draft", "submit"), types)
        assertEquals("你好！", drafts().last())
        // Never more than ~6 a second while typing steadily.
        val before = drafts().size
        repeat(60) { i -> rig.controller.act(ActivityAction.Draft("字".repeat(i + 1))); advanceTimeBy(16) }
        advanceTimeBy(CallController.DRAFT_EVERY_MS); runCurrent()
        val sent = drafts().size - before
        assertTrue("sent $sent drafts in ~1 s", sent in 5..8)
        assertEquals("字".repeat(60), drafts().last())
    }

    /** `call.activity_start`'s role: tutor / student when both are here with a relationship, else solo. */
    @Test fun theStarterRoleForAnalytics() {
        val peer = dev.jeromeswannack.chineselearning.lab.core.calls.CallPeer("c-t", "tutor", "王老师", null, dev.jeromeswannack.chineselearning.lab.core.calls.PeerMediaState(mic = true, cam = true))
        val remote = RemoteParticipant(peer, video = null, connection = "connected", tile = dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.TileStatus.LIVE)
        assertEquals("student", activityStarterRole(CallState(myUserId = "me", tutorId = "tutor", remote = remote), "me"))
        assertEquals("tutor", activityStarterRole(CallState(myUserId = "tutor", tutorId = "tutor", remote = remote), "tutor"))
        assertEquals("solo", activityStarterRole(CallState(myUserId = "me", tutorId = "tutor", remote = null), "me"))
        assertEquals("solo", activityStarterRole(CallState(myUserId = "me", tutorId = null, remote = remote), "me"))
    }

    /** Either person may start (the room decides roles); word adds need a running activity. */
    @Test fun theStudentStartsAndAddsAWord() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        rig.on(welcome()); runCurrent()
        rig.controller.activityWordAdded("target", "round") // no activity: nothing to report, no crash
        rig.controller.startActivity("describe-food-1")
        assertEquals(1, rig.room.sent.count { it["type"]!!.jsonPrimitive.content == "activity_start" })
        // The student (role A, describer) may press Next after the guesser's pick: the controller sends it.
        val s = start("describe-food-1")
        val picked = s.by("tutor", ActivityAction.Pick(s.data.options!!.first()))
        rig.on(ServerMessage.Activity(picked, "c-t", "王老师")); runCurrent()
        assertTrue(CallActivities.mayAct(picked, "me", "next"))
        rig.controller.act(ActivityAction.Next)
        assertEquals("next", rig.actions().last()["action"]!!.jsonObject["type"]!!.jsonPrimitive.content)
        rig.controller.activityWordAdded("hint", "summary")
    }

    @Test fun nextPressersNamesWhoMayMoveOn() {
        val s = start("describe-food-1") // tutor = host + guesser (B), me = describer (A)
        val picked = s.by("tutor", ActivityAction.Pick(s.data.options!!.first()))
        assertEquals("Jerome", nextPressers(picked, "tutor"))
        assertEquals("王老师", nextPressers(picked, "me"))
        val quiz = start("quiz-measure-words-1").by("tutor", ActivityAction.Ask).by("me", ActivityAction.Pick("0")).by("tutor", ActivityAction.Reveal)
        assertEquals("王老师", nextPressers(quiz, "me"))
    }

    @Test fun aNewSessionComesOntoTheStage() {
        val h = CallLayoutHolder()
        h.setActivity("sess-1")
        assertEquals(CallLayout.TileId.ACTIVITY, h.layout.value.main)
        h.dispatch(CallLayout.Action.Focus(CallLayout.TileId.TEXT))
        h.setActivity("sess-1") // a new round: nothing moves
        assertEquals(CallLayout.TileId.TEXT, h.layout.value.main)
        h.setActivity("sess-2")
        assertEquals(CallLayout.TileId.ACTIVITY, h.layout.value.main)
        h.setActivity(null)
        val av = CallLayout.Availability(screen = false)
        // Gone: the stage falls back to the camera.
        assertEquals(listOf(CallLayout.TileId.REMOTE), CallLayout.arrangeTiles(h.layout.value, av, 412.0).stage)
    }

    /** Review together (web ActivityTile): one counter for the whole list — a rise plays the selected item's R2 clip, a select never does. */
    @Test fun reviewPlaysTheClipWhenPlayGoesUpAcrossSelects() = runTest(UnconfinedTestDispatcher()) {
        val spec = ActivitySpec(
            id = CallActivities.REVIEW_ACTIVITY_ID, kind = ActivityKinds.REVIEW, title = "Review together",
            items = listOf(
                ActivityItem(id = "e1", source = "recording", hanzi = "银行", recordingKey = "recordings/e1.webm", referenceKey = "generated/n1.mp3", labels = emptyList()),
                ActivityItem(id = "f1", source = "flag", hanzi = "已经", referenceKey = "generated/n2.mp3", labels = emptyList()),
            ),
        )
        val s0 = CallActivities.start(spec, CallActivities.StartOptions("rv", "tutor", "tutor", listOf("tutor", "me"), names, 1_000))
        val played = s0.by("me", ActivityAction.PlayClip("recording"))
        val rig = live()
        // First sight (a welcome after a reload, play already 1): nothing plays.
        rig.on(welcome(played)); runCurrent()
        assertTrue(rig.clips.isEmpty())
        // Selecting keeps the counter: nothing plays.
        val selected = played.by("tutor", ActivityAction.Select(1))
        rig.on(ServerMessage.Activity(selected)); runCurrent()
        assertTrue(rig.clips.isEmpty())
        // A rise after the select (another round than when the counter last rose): plays here, the reference with the word as fallback.
        val ref = selected.by("me", ActivityAction.PlayClip("reference"))
        rig.on(ServerMessage.Activity(ref)); runCurrent()
        assertEquals(listOf("generated/n2.mp3" to "已经"), rig.clips)
        // The tutor's mark and a resync: nothing.
        rig.on(ServerMessage.Activity(ref)); runCurrent()
        rig.on(ServerMessage.Activity(ref.by("tutor", ActivityAction.MarkReview("listened")))); runCurrent()
        assertEquals(1, rig.clips.size)
        // Back to item 0, their recording: no device-voice fallback for a take.
        val rec = ref.by("tutor", ActivityAction.Select(0)).by("tutor", ActivityAction.PlayClip("recording"))
        rig.on(ServerMessage.Activity(rec)); runCurrent()
        assertEquals("recordings/e1.webm" to "", rig.clips.last())
        assertTrue(rig.spoken.isEmpty())
        // Another session: never on first sight.
        rig.on(ServerMessage.Activity(CallActivities.start(spec, CallActivities.StartOptions("rv2", "tutor", "tutor", listOf("tutor", "me"), names, 1_000)).by("me", ActivityAction.PlayClip("recording")))); runCurrent()
        assertEquals(2, rig.clips.size)
        assertEquals("recordings/e1.webm" to "", rig.controller.reviewClip(rec))
    }
}
