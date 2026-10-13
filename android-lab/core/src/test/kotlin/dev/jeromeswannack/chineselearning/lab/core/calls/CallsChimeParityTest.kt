package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallChime.Event
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChime.Kind
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChime.PeerRef
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Calls: CallChime reproduces shared/calls/chime.ts (parity/fixtures/calls-chime.ts). */
class CallsChimeParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-chime.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun ref(o: JsonObject) = PeerRef(str(o["client_id"])!!, str(o["user_id"])!!, str(o["name"])!!)

    private fun event(o: JsonObject): Event = when (str(o["type"])) {
        "welcome" -> Event.Welcome(o["peers"]!!.jsonArray.map { ref(it.jsonObject) })
        "joined" -> Event.Joined(ref(o["peer"]!!.jsonObject))
        "left" -> Event.Left(str(o["client_id"])!!)
        "tick" -> Event.Tick
        else -> fail("unknown event $o")
    }

    private fun state(o: JsonObject): CallChime.State = CallChime.State(
        o["peers"]!!.jsonObject.entries.associateTo(linkedMapOf()) { (userId, pe) ->
            val p = pe.jsonObject
            userId to CallChime.Peer(str(p["client_id"])!!, str(p["name"])!!, p["here"]!!.jsonPrimitive.boolean, (p["left_at"] as? JsonElement)?.takeIf { it !is JsonNull }?.jsonPrimitive?.longOrNull, p["announced_left"]!!.jsonPrimitive.boolean)
        },
    )

    @Test fun constants() {
        val c = root["constants"]!!.jsonObject
        assertEquals(c["PEER_LEAVE_GRACE_MS"]!!.jsonPrimitive.long, CallChime.PEER_LEAVE_GRACE_MS)
        assertEquals(c["CHIME_ATTACK_MS"]!!.jsonPrimitive.int, CallChime.CHIME_ATTACK_MS)
        assertEquals(str(c["CALL_SOUNDS_KEY"]), CallChime.CALL_SOUNDS_KEY)
        val tones = c["CHIME_TONES"]!!.jsonObject
        for (kind in Kind.entries) {
            val ts = tones[kind.wire]!!.jsonArray.map { it.jsonObject }
            assertEquals(ts.map { CallChime.Tone(it["freq"]!!.jsonPrimitive.double, it["at"]!!.jsonPrimitive.int, it["ms"]!!.jsonPrimitive.int, it["gain"]!!.jsonPrimitive.double) }, CallChime.CHIME_TONES[kind])
        }
    }

    @Test fun runs() {
        var alerts = 0
        for (run in root["runs"]!!.jsonArray) {
            var s = CallChime.EMPTY
            for (step in run.jsonObject["steps"]!!.jsonArray) {
                val o = step.jsonObject
                val r = CallChime.chimeStep(s, event(o["event"]!!.jsonObject), "me", o["now"]!!.jsonPrimitive.long)
                s = r.state
                assertEquals(state(o["state"]!!.jsonObject), s, "state $o")
                assertEquals(state(o["state"]!!.jsonObject).peers.keys.toList(), s.peers.keys.toList(), "order $o")
                val want = o["alerts"]!!.jsonArray.map { it.jsonObject }.map { CallChime.Alert(Kind.entries.first { k -> k.wire == str(it["kind"]) }, str(it["user_id"])!!, str(it["name"])!!, str(it["text"])!!) }
                assertEquals(want, r.alerts, "alerts $o")
                assertEquals(o["needs_tick"]!!.jsonPrimitive.boolean, CallChime.chimeNeedsTick(s))
                alerts += want.size
            }
        }
        assertTrue(alerts > 20, "only $alerts alerts")
    }

    @Test fun samples() {
        for (e in root["samples"]!!.jsonArray) {
            val o = e.jsonObject
            val kind = Kind.entries.first { it.wire == str(o["kind"]) }
            assertEquals(o["length"]!!.jsonPrimitive.int, CallChime.chimeLengthMs(kind))
            for (se in o["at"]!!.jsonArray) {
                val s = se.jsonObject
                val want = s["v"]!!.jsonPrimitive.double
                val got = CallChime.chimeSample(kind, s["t"]!!.jsonPrimitive.double)
                // sin / exp may differ in the last bit between V8 and the JVM.
                assertTrue(abs(want - got) < 1e-12, "$kind at ${s["t"]}: $want vs $got")
            }
        }
        val pcm = CallChime.chimePcm(Kind.JOIN, 8_000)
        assertEquals(CallChime.chimeLengthMs(Kind.JOIN) * 8, pcm.size)
    }

    @Test fun words() {
        for (e in root["sounds"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(o["on"]!!.jsonPrimitive.boolean, CallChime.callSoundsOn(str(o["stored"])), "$o")
        }
        for (e in root["labels"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(str(o["label"]), CallChime.callSoundsLabel(o["on"]!!.jsonPrimitive.boolean))
        }
        for (e in root["texts"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(str(o["joined"]), CallChime.joinedText(str(o["name"])!!), "$o")
            assertEquals(str(o["left"]), CallChime.leftText(str(o["name"])!!), "$o")
        }
    }
}
