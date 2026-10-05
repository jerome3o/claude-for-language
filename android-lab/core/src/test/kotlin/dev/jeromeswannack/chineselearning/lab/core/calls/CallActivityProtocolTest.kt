package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** In-call activities over the room protocol (shared/calls/protocol.ts: activity_start / activity_action / activity_close, `activity`, welcome.activity). */
class CallActivityProtocolTest {
    private val spec = CallActivities.find("describe-food-1")!!
    private val session = CallActivities.start(spec, CallActivities.StartOptions("sess-1", "t", "t", listOf("t", "s"), mapOf("t" to "Minghui", "s" to "Jerome"), 1000))
    private fun obj(s: String) = Json.parseToJsonElement(s).jsonObject

    @Test fun clientMessagesHaveTheTsShape() {
        assertEquals(obj("""{"type":"activity_start","activity_id":"quiz-tones-1"}"""), obj(CallProtocol.activityStart("quiz-tones-1")))
        assertEquals(obj("""{"type":"activity_action","session_id":"sess-1","action":{"type":"pick","option":"苹果"}}"""), obj(CallProtocol.activityAction("sess-1", ActivityAction.Pick("苹果"))))
        assertEquals(obj("""{"type":"activity_action","session_id":"x","action":{"type":"fill","cell":"0:1","value":null}}"""), obj(CallProtocol.activityAction("x", ActivityAction.Fill("0:1", null))))
        assertEquals(obj("""{"type":"activity_action","session_id":"x","action":{"type":"mark","correct":false}}"""), obj(CallProtocol.activityAction("x", ActivityAction.Mark(false))))
        assertEquals(obj("""{"type":"activity_action","session_id":"x","action":{"type":"place","tile":2}}"""), obj(CallProtocol.activityAction("x", ActivityAction.Place(2))))
        assertEquals(obj("""{"type":"activity_action","session_id":"x","action":{"type":"swap_roles"}}"""), obj(CallProtocol.activityAction("x", ActivityAction.SwapRoles)))
        assertEquals(obj("""{"type":"activity_close","session_id":"sess-1"}"""), obj(CallProtocol.activityClose("sess-1")))
        assertEquals(obj("""{"type":"activity_close"}"""), obj(CallProtocol.activityClose()))
        // Every action reads back as itself.
        for (a in listOf(ActivityAction.Next, ActivityAction.Draft("你好"), ActivityAction.Unplace(0), ActivityAction.Fill("1:0", "看电影"), ActivityAction.LineBack))
            assertEquals(a, ActivityAction.parse(a.toJson()))
    }

    @Test fun serverActivityAndWelcomeParse() {
        val json = CallActivities.toJson(session).toString()
        val m = CallProtocol.parseServer("""{"type":"activity","session":$json,"from":"c-1","name":"Minghui"}""")
        assertIs<ServerMessage.Activity>(m)
        assertEquals(session, m.session)
        assertEquals("c-1", m.from)
        val closed = CallProtocol.parseServer("""{"type":"activity","session":null}""")
        assertIs<ServerMessage.Activity>(closed)
        assertNull(closed.session)
        // A session that doesn't parse (or no session key) is ignored, never "closed".
        assertNull(CallProtocol.parseServer("""{"type":"activity","session":{"spec":5}}"""))
        assertNull(CallProtocol.parseServer("""{"type":"activity"}"""))
        val w = CallProtocol.parseServer("""{"type":"welcome","client_id":"c-me","server_time":1,"started_at":1,"peers":[],"board":[],"chat":[],"activity":$json}""")
        assertIs<ServerMessage.Welcome>(w)
        assertEquals(session, w.activity)
        val none = CallProtocol.parseServer("""{"type":"welcome","client_id":"c-me","server_time":1,"started_at":1,"peers":[],"board":[],"chat":[],"activity":null}""")
        assertNull((none as ServerMessage.Welcome).activity)
    }

    @Test fun aRoomSessionWithExtraFieldsStillParses() {
        val o = CallActivities.toJson(session).jsonObject
        val extra = JsonObject(o + ("future_field" to Json.parseToJsonElement("[1,2]")) + ("data" to Json.parseToJsonElement("""{"options":["苹果"],"pick":null,"new":true}""")))
        val s = CallActivities.parseSession(extra)!!
        assertEquals(listOf("苹果"), s.data.options)
        assertNull(s.data.pick)
        // An unknown kind parses (the tile says "update the app"); its engine refuses everything.
        val unknown = CallActivities.parseSession(JsonObject(o + ("spec" to Json.parseToJsonElement("""{"id":"x","kind":"karaoke","title":"New"}"""))))!!
        assertEquals("karaoke", unknown.spec.kind)
        assertNull(CallActivities.reduce(unknown, ActivityAction.Reveal, "t", 1))
        assertTrue(CallActivities.reduce(unknown, ActivityAction.Finish, "t", 1) != null)
    }

    /** Review together: the room's spec (built per call) and the new actions in the TS shape. */
    @Test fun reviewTogetherOverTheWire() {
        assertEquals(obj("""{"type":"activity_start","activity_id":"review-together"}"""), obj(CallProtocol.activityStart(CallActivities.REVIEW_ACTIVITY_ID)))
        assertEquals(obj("""{"type":"activity_action","session_id":"x","action":{"type":"select","index":2}}"""), obj(CallProtocol.activityAction("x", ActivityAction.Select(2))))
        assertEquals(obj("""{"type":"activity_action","session_id":"x","action":{"type":"play_clip","clip":"recording"}}"""), obj(CallProtocol.activityAction("x", ActivityAction.PlayClip("recording"))))
        assertEquals(obj("""{"type":"activity_action","session_id":"x","action":{"type":"review_mark","status":"needs_work","comment":"shí"}}"""), obj(CallProtocol.activityAction("x", ActivityAction.MarkReview("needs_work", "shí"))))
        assertEquals(obj("""{"type":"activity_action","session_id":"x","action":{"type":"review_mark","status":"listened"}}"""), obj(CallProtocol.activityAction("x", ActivityAction.MarkReview("listened"))))
        // A non-string comment reads as none; a bad index / clip / status is refused by the engine.
        assertEquals(ActivityAction.MarkReview("listened", null), ActivityAction.parse(obj("""{"type":"review_mark","status":"listened","comment":7}""")))
        assertIs<ActivityAction.Invalid>(ActivityAction.parse(obj("""{"type":"select","index":"1"}""")))
        assertIs<ActivityAction.Invalid>(ActivityAction.parse(obj("""{"type":"play_clip"}""")))

        val room = """{"type":"activity","session":{"session_id":"rv","spec":{"id":"review-together","kind":"review","title":"Review together","level":"beginner","topic":"pronunciation","summary":"s",
            "role_names":{"a":"Tutor","b":"Student"},"tutor_role":"a","items":[
            {"id":"e1","source":"recording","event_id":"e1","flag_id":null,"note_id":"n1","hanzi":"银行","pinyin":"yínháng","english":"bank","recording_key":"recordings/e1.webm","reference_key":"generated/n1.mp3",
             "labels":["Heard: 音行"],"transcript":"音行","weak":[{"char":"银","kind":"tone"}],"flag_message":null,"mark":{"status":"needs_work","comment":"yín"},"recorded_at":"2026-10-01T10:00:00Z"}]},
            "roles":{"a":"t","b":"s"},"host":"t","names":{"t":"Minghui","s":"Jerome"},"round":0,"phase":"play","data":{"play":3,"clip":"reference"},"results":[],"started_at":1,"updated_at":2,"v":4}}"""
        val m = CallProtocol.parseServer(room)
        assertIs<ServerMessage.Activity>(m)
        val s = m.session!!
        assertEquals(ActivityKinds.REVIEW, s.spec.kind)
        val it = s.spec.itemList.single()
        assertEquals("recordings/e1.webm", it.recordingKey)
        assertEquals("generated/n1.mp3", it.referenceKey)
        assertEquals(listOf(ReviewWeak("银", "tone")), it.weak)
        assertEquals(ReviewMark("needs_work", "yín"), it.mark)
        assertEquals(3, s.data.play)
        assertEquals("reference", s.data.clip)
        // The student plays; the tutor marks.
        val played = CallActivities.reduce(s, ActivityAction.PlayClip("recording"), "s", 5)!!
        assertEquals(4, played.data.play)
        assertNull(CallActivities.reduce(s, ActivityAction.MarkReview("listened"), "s", 5))
        assertEquals(ReviewMark("listened", null), CallActivities.reviewMarkOf(CallActivities.reduce(s, ActivityAction.MarkReview("listened"), "t", 5)!!, 0))
    }
}
