package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.LinkEvent
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.LinkHealth
import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection.PcState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** Video calls round 2: CallConnection reproduces shared/calls/connection.ts exactly (parity/fixtures/calls-connection.ts). */
class CallsConnectionParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-connection.json").readText()).jsonObject
    }

    private fun JsonElement.longOrNull(): Long? = if (this is JsonNull) null else jsonPrimitive.long
    private fun JsonElement.stringOrNull(): String? = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.l(k: String) = this[k]!!.jsonPrimitive.long

    private fun health(o: JsonObject) = LinkHealth(
        PcState.of(o["pc"]!!.jsonPrimitive.content)!!, o.l("changedAt"), o["restarts"]!!.jsonPrimitive.int,
        o["lastRestartAt"]!!.longOrNull(), o["everConnected"]!!.jsonPrimitive.boolean,
    )

    @Test fun constantsMatch() {
        val c = root["constants"]!!.jsonObject
        assertEquals(c.l("DISCONNECT_GRACE_MS"), CallConnection.DISCONNECT_GRACE_MS)
        assertEquals(c.l("PEER_AWAY_GRACE_MS"), CallConnection.PEER_AWAY_GRACE_MS)
        assertEquals(c.l("MAX_RESTART_BACKOFF_MS"), CallConnection.MAX_RESTART_BACKOFF_MS)
        assertEquals(c.l("ROOM_PING_MS"), CallConnection.ROOM_PING_MS)
        assertEquals(c.l("ROOM_PONG_TIMEOUT_MS"), CallConnection.ROOM_PONG_TIMEOUT_MS)
        assertEquals(c.l("CAMERA_MAX_BITRATE"), CallConnection.CAMERA_MAX_BITRATE.toLong())
        assertEquals(c.l("SCREEN_MAX_BITRATE"), CallConnection.SCREEN_MAX_BITRATE.toLong())
        assertEquals(c["CAMERA_HALF_BELOW_BPS"]!!.jsonPrimitive.double, CallConnection.CAMERA_HALF_BELOW_BPS)
        assertEquals(c["CAMERA_QUARTER_BELOW_BPS"]!!.jsonPrimitive.double, CallConnection.CAMERA_QUARTER_BELOW_BPS)
        assertEquals(c.l("MAX_DIAG_EVENTS_PER_MESSAGE"), CallConnection.MAX_DIAG_EVENTS_PER_MESSAGE.toLong())
        assertEquals(c.l("MAX_DIAG_EVENTS"), CallConnection.MAX_DIAG_EVENTS.toLong())
        assertEquals(c.l("MAX_COMPOSE_CHARS"), CallConnection.MAX_COMPOSE_CHARS.toLong())
    }

    @Test fun linkHealthRestartsAndTileStatusMatch() {
        val seqs = root["sequences"]!!.jsonArray
        assertTrue(seqs.size > 100)
        for ((i, s) in seqs.withIndex()) {
            val o = s.jsonObject
            var h = CallConnection.initialLinkHealth(o.l("start"))
            assertEquals(health(o["initial"]!!.jsonObject), h, "seq $i initial")
            for ((k, step) in o["steps"]!!.jsonArray.withIndex()) {
                val st = step.jsonObject
                val e = st["event"]!!.jsonObject
                val ev = if (e["type"]!!.jsonPrimitive.content == "restarted") LinkEvent.Restarted(e.l("at"))
                else LinkEvent.Pc(PcState.of(e["state"]!!.jsonPrimitive.content)!!, e.l("at"))
                h = CallConnection.linkHealthOn(h, ev)
                val label = "seq $i step $k ($ev)"
                assertEquals(health(st["health"]!!.jsonObject), h, "$label health")
                assertEquals(st["next_open"]!!.longOrNull(), CallConnection.nextIceRestartAt(h, true), "$label next (open)")
                assertEquals(st["next_closed"]!!.longOrNull(), CallConnection.nextIceRestartAt(h, false), "$label next (closed)")
                assertEquals(st["tile"]!!.jsonPrimitive.content, CallConnection.tileStatus(h, false).wire, "$label tile")
                assertEquals(st["tile_away"]!!.jsonPrimitive.content, CallConnection.tileStatus(h, true).wire, "$label tile away")
            }
        }
        for (b in root["backoff"]!!.jsonArray) {
            val o = b.jsonObject
            assertEquals(o.l("ms"), CallConnection.restartBackoffMs(o["n"]!!.jsonPrimitive.int), "backoff ${o["n"]}")
        }
    }

    @Test fun adoptAndInstancesMatch() {
        for (c in root["adopt"]!!.jsonArray) {
            val o = c.jsonObject
            val cur = o["current"]!!.let { if (it is JsonNull) null else it.jsonObject }
            val inc = o["incoming"]!!.jsonObject
            val got = CallConnection.shouldAdoptPeer(
                cur?.get("user_id")?.jsonPrimitive?.content, cur?.get("instance")?.jsonPrimitive?.content,
                inc["user_id"]!!.jsonPrimitive.content, inc["instance"]?.jsonPrimitive?.content,
            )
            assertEquals(o["adopt"]!!.jsonPrimitive.boolean, got, "adopt $o")
        }
        for (c in root["instances"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"]!!.stringOrNull(), CallConnection.sanitizeInstance(o["raw"]), "instance ${o["raw"]}")
        }
        // Ids made by either app pass the other's check.
        for (g in root["generated"]!!.jsonArray) assertNotNull(CallConnection.sanitizeInstance(g.jsonPrimitive.content))
        repeat(50) { val id = CallConnection.newInstanceId(); assertEquals(id, CallConnection.sanitizeInstance(id), id) }
    }

    @Test fun round4FailedLinksAreRenegotiatedAndLinkIdsDecide() {
        val adoptPc = root["adoptPc"]!!.jsonArray
        assertTrue(adoptPc.size > 100)
        for (c in adoptPc) {
            val o = c.jsonObject
            val cur = o["current"]!!.let { if (it is JsonNull) null else it.jsonObject }
            val inc = o["incoming"]!!.jsonObject
            val pc = PcState.of(o["pc"]!!.jsonPrimitive.content)!!
            val got = CallConnection.shouldAdoptPeer(
                cur?.get("user_id")?.jsonPrimitive?.content, cur?.get("instance")?.jsonPrimitive?.content,
                inc["user_id"]!!.jsonPrimitive.content, inc["instance"]?.jsonPrimitive?.content, pc,
            )
            assertEquals(o["adopt"]!!.jsonPrimitive.boolean, got, "adopt with pc $o")
        }
        for (c in root["worth"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["keep"]!!.jsonPrimitive.boolean, CallConnection.linkWorthKeeping(PcState.of(o["pc"]!!.jsonPrimitive.content)!!), "worth $o")
        }
        val actions = root["linkActions"]!!.jsonArray
        assertTrue(actions.size >= 60)
        for (c in actions) {
            val o = c.jsonObject
            val got = CallConnection.linkSignalAction(o["bound"]!!.stringOrNull(), o["retired"]!!.jsonArray.map { it.jsonPrimitive.content }, o["incoming"]!!.stringOrNull())
            assertEquals(o["action"]!!.jsonPrimitive.content, got.wire, "link action $o")
        }
        // Ids made by either app are short alphanumeric strings the other carries as is.
        val ok = Regex("^[a-z0-9]{1,8}$")
        for (g in root["linkGenerated"]!!.jsonArray) assertTrue(ok.matches(g.jsonPrimitive.content), g.toString())
        repeat(50) { val id = CallConnection.newLinkId(); assertTrue(ok.matches(id), id) }
    }

    @Test fun encodingsMatch() {
        val cases = root["encodings"]!!.jsonArray
        assertTrue(cases.size > 300)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val source = if (o["source"]!!.jsonPrimitive.content == "screen") CallConnection.VideoSource.SCREEN else CallConnection.VideoSource.CAMERA
            val bps = o["bps"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }
            val scale = o["scale"]!!.let { if (it is JsonNull) 1.0 else it.jsonPrimitive.double }
            val got = CallConnection.videoEncodingFor(source, bps, scale)
            val e = o["enc"]!!.jsonObject
            val label = "case $i: $source $bps × $scale"
            assertEquals(e.l("maxBitrate"), got.maxBitrate.toLong(), "$label bitrate")
            assertEquals(e.l("maxFramerate"), got.maxFramerate.toLong(), "$label framerate")
            assertEquals(e["scaleResolutionDownBy"]!!.jsonPrimitive.double, got.scaleResolutionDownBy, "$label scale")
            assertEquals(e["degradationPreference"]!!.jsonPrimitive.content, got.degradationPreference, "$label degradation")
        }
    }

    @Test fun diagnosticsAndComposeSanitiseAlike() {
        for ((i, c) in root["diag"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val expected = o["out"]!!.jsonArray.map { it.jsonObject.let { e -> CallConnection.DiagEvent(e.l("t"), e["kind"]!!.jsonPrimitive.content, e["detail"]!!.jsonPrimitive.content) } }
            assertEquals(expected, CallConnection.sanitizeDiagEvents(o["raw"]), "diag case $i")
        }
        for ((i, c) in root["append"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            fun entries(k: String) = o[k]!!.jsonArray.map { it.jsonObject.let { e -> CallConnection.DiagEntry(e.l("t"), e["kind"]!!.jsonPrimitive.content, e["detail"]!!.jsonPrimitive.content, e["user_id"]!!.jsonPrimitive.content, e["name"]!!.jsonPrimitive.content) } }
            assertEquals(entries("out"), CallConnection.appendDiag(entries("log"), entries("add")), "append case $i")
        }
        for (c in root["compose"]!!.jsonArray) {
            val o = c.jsonObject
            val raw = o["raw"]!!
            assertEquals(o["out"]!!.stringOrNull(), CallConnection.sanitizeCompose(raw), "compose $raw")
            if (raw is JsonPrimitive && raw.isString) assertEquals(o["out"]!!.stringOrNull(), CallConnection.sanitizeCompose(raw.content))
        }
    }
}
