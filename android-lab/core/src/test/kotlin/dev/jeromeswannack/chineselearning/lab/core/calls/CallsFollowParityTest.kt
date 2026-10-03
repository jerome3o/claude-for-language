package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.AppliedShow
import dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.FollowStep
import dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShowKind
import dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShowView
import dev.jeromeswannack.chineselearning.lab.core.calls.CallFollow.ShownState
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Calls round 5: CallFollow, CallDevices and the layout's `shown` action reproduce shared/calls/follow.ts, devices.ts, layout.ts exactly (parity/fixtures/calls-follow.ts). */
class CallsFollowParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-follow.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun JsonObject.b(k: String) = this[k]!!.jsonPrimitive.boolean

    private fun view(e: JsonElement?): ShowView? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return ShowView(ShowKind.of(str(o["kind"]))!!, str(o["page"]))
    }

    private fun shown(e: JsonElement?): ShownState? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return ShownState(str(o["id"])!!, o["v"]!!.jsonPrimitive.int, str(o["by"])!!, str(o["name"])!!, view(o["view"])!!, o["at"]!!.jsonPrimitive.long)
    }

    private fun applied(e: JsonElement?): AppliedShow? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return AppliedShow(str(o["id"])!!, o["v"]!!.jsonPrimitive.int)
    }

    private fun step(o: JsonObject): FollowStep = when (str(o["kind"])) {
        "none" -> FollowStep.None
        "stage" -> FollowStep.Stage(TileId.of(str(o["tile"]))!!, str(o["page"]))
        "page" -> FollowStep.Page(str(o["page"])!!)
        else -> fail("step $o")
    }

    @Test fun labelsAndKinds() {
        val l = root["labels"]!!.jsonObject
        assertEquals(str(l["show"]), CallFollow.SHOW_BUTTON_LABEL)
        assertEquals(str(l["shown"]), CallFollow.SHOWN_BUTTON_LABEL)
        assertEquals(str(l["stop"]), CallFollow.STOP_THEIR_SHARE_LABEL)
        assertEquals(root["kinds"]!!.jsonArray.map { str(it) }, CallFollow.SHOW_KINDS.map { it.wire })
        for (t in root["tile_for"]!!.jsonArray) {
            val o = t.jsonObject
            assertEquals(TileId.of(str(o["tile"])), CallFollow.tileForShow(ShowView(ShowKind.of(str(o["kind"]))!!)))
        }
    }

    @Test fun sanitizeShowView() {
        for ((i, c) in root["sanitize"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val got = CallFollow.sanitizeShowView(o["raw"])
            assertEquals(view(o["result"]), got, "sanitize $i ${o["raw"]}")
            // And the wire form the room would see is the same JSON.
            if (got != null) assertEquals(o["result"]!!.jsonObject, got.toJson(), "json $i")
        }
    }

    @Test fun nextShownAndPermissions() {
        for ((i, c) in root["nexts"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val got = CallFollow.nextShown(shown(o["cur"]), view(o["view"])!!, str(o["by"])!!, str(o["name"])!!, o.b("follow"), o["now"]!!.jsonPrimitive.long) { str(o["next_id"])!! }
            assertEquals(shown(o["result"]), got, "next $i")
            // The room's message parses back to the same state.
            assertEquals(got, CallFollow.parseShown(got.toJson()))
        }
        for ((i, c) in root["permissions"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val sender = str(o["sender"])!!
            val tutor = str(o["tutor"])
            assertEquals(o.b("can_show"), CallFollow.canShow(sender, tutor), "canShow $i")
            assertEquals(o.b("can_stop"), CallFollow.canStopShare(sender, tutor, str(o["target"])!!), "canStop $i")
        }
    }

    @Test fun followStepMatches() {
        val cases = root["follows"]!!.jsonArray
        assertTrue(cases.size >= 800)
        var pages = 0
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val want = step(o["result"]!!.jsonObject)
            if (want is FollowStep.Page) pages++
            assertEquals(want, CallFollow.followStep(applied(o["applied"]), shown(o["shown"]), str(o["my_id"])!!, o.b("available"), o.b("on_tile")), "follow $i")
        }
        assertTrue(pages > 10, "enough page turns ($pages)")
    }

    @Test fun bannersShowingAndAutoShow() {
        for (c in root["banners"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(str(o["banner"]), CallFollow.showingBanner(str(o["name"])!!))
            assertEquals(str(o["note"]), CallFollow.shareStoppedNote(str(o["name"])!!))
        }
        for ((i, c) in root["showings"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(o.b("result"), CallFollow.isShowing(shown(o["shown"]), str(o["my_id"])!!, view(o["view"])!!), "isShowing $i")
        }
        for ((i, c) in root["autos"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val was = o["was"]!!.jsonArray.map { TileId.of(str(it))!! }
            val now = o["now"]!!.jsonArray.map { TileId.of(str(it))!! }
            assertEquals(str(o["result"]), CallFollow.autoShowBoard(was, now)?.wire, "auto $i")
        }
    }

    @Test fun devicesAtTheStartOfACall() {
        assertEquals(root.b("camera_on_at_start"), CallDevices.CAMERA_ON_AT_START)
        for (c in root["devices"]!!.jsonArray) {
            val o = c.jsonObject
            val d = if (str(o["device"]) == "mic") CallDevices.Device.MIC else CallDevices.Device.CAM
            assertEquals(o.b("result"), CallDevices.deviceOnWhenOpened(d, o.b("restore"), o.b("mic_off")), "$o")
        }
        for (c in root["phases"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.b("result"), CallDevices.announceDevice(str(o["phase"])!!), "$o")
        }
    }

    @Test fun layoutShownAction() {
        val seqs = root["shown_layouts"]!!.jsonArray
        assertTrue(seqs.size >= 50)
        var shownSteps = 0
        for ((s, seq) in seqs.withIndex()) {
            var l = CallLayout.DEFAULT_LAYOUT
            for ((i, st) in seq.jsonObject["steps"]!!.jsonArray.withIndex()) {
                val o = st.jsonObject
                val a = o["action"]!!.jsonObject
                val action = when (str(a["type"])) {
                    "shown" -> { shownSteps++; CallLayout.Action.Shown(TileId.of(str(a["tile"]))!!) }
                    else -> layoutAction(a)
                }
                l = CallLayout.reduce(l, action)
                assertEquals(layout(o["layout"]!!.jsonObject), l, "seq $s step $i ${a}")
            }
        }
        assertTrue(shownSteps > 50, "enough shown steps ($shownSteps)")
    }

    private fun layout(o: JsonObject): CallLayout.Layout {
        fun t(k: String) = TileId.of(str(o[k]))!!
        fun c(k: String) = CallLayout.Corner.of(str(o[k])!!)!!
        fun d(k: String) = o[k]!!.jsonPrimitive.content.toDouble()
        return CallLayout.Layout(
            mode = CallLayout.Mode.of(str(o["mode"])!!)!!, main = t("main"), second = t("second"), ratio = d("ratio"),
            dir = CallLayout.Dir.of(str(o["dir"])!!)!!, selfCorner = c("selfCorner"), selfScale = d("selfScale"),
            remoteFloat = o.b("remoteFloat"), remoteCorner = c("remoteCorner"),
            open = o["open"]!!.jsonArray.map { TileId.of(str(it))!! },
            pip = CallLayout.Pip.of(str(o["pip"])!!)!!, pairCorner = c("pairCorner"), pairScale = d("pairScale"),
        )
    }

    private fun layoutAction(a: JsonObject): CallLayout.Action {
        fun tile(k: String) = TileId.of(str(a[k]))!!
        return when (str(a["type"])) {
            "focus" -> CallLayout.Action.Focus(tile("tile"))
            "preset" -> CallLayout.Action.Preset(CallLayout.PresetId.of(str(a["preset"])!!)!!)
            "split" -> CallLayout.Action.Split(tile("a"), tile("b"))
            "close" -> CallLayout.Action.Close(tile("tile"))
            "open" -> CallLayout.Action.Open(tile("tile"))
            "remoteFloat" -> CallLayout.Action.RemoteFloat(a.b("on"))
            "pairCorner" -> CallLayout.Action.PairCorner(CallLayout.Corner.of(str(a["corner"])!!)!!)
            "shareStarted" -> CallLayout.Action.ShareStarted
            "materialStarted" -> CallLayout.Action.MaterialStarted
            "activityStarted" -> CallLayout.Action.ActivityStarted
            else -> fail("action $a")
        }
    }
}
