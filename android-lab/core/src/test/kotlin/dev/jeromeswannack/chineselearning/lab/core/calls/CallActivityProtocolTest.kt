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
}
