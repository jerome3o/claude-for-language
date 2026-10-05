package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import dev.jeromeswannack.chineselearning.lab.core.calls.CallView.SharedView
import dev.jeromeswannack.chineselearning.lab.core.calls.CallView.StageView
import dev.jeromeswannack.chineselearning.lab.core.calls.CallView.ViewMode
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
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

/** "Same view": CallView reproduces shared/calls/view.ts exactly (parity/fixtures/calls-view.ts). */
class CallsViewParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-view.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun JsonObject.b(k: String) = this[k]!!.jsonPrimitive.boolean
    private fun JsonObject.d(k: String) = this[k]!!.jsonPrimitive.content.toDouble()
    private fun tiles(e: JsonElement?) = e!!.jsonArray.map { TileId.of(str(it))!! }

    private fun stage(e: JsonElement?): StageView? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return StageView(
            CallLayout.Mode.of(str(o["mode"]))!!, TileId.of(str(o["main"]))!!, TileId.of(str(o["second"]))!!, o.d("ratio"),
            CallLayout.Dir.of(str(o["dir"]))!!, tiles(o["open"]), str(o["page"]),
        )
    }

    private fun shared(e: JsonElement?): SharedView? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return SharedView(
            stage(o)!!, o["seq"]!!.jsonPrimitive.int, str(o["by"])!!, str(o["name"])!!, str(o["cid"])!!, o["at"]!!.jsonPrimitive.long,
            bring = o["bring"]?.jsonPrimitive?.booleanOrNull == true,
        )
    }

    private fun layout(o: JsonObject): CallLayout.Layout {
        fun t(k: String) = TileId.of(str(o[k]))!!
        fun c(k: String) = CallLayout.Corner.of(str(o[k])!!)!!
        return CallLayout.Layout(
            mode = CallLayout.Mode.of(str(o["mode"])!!)!!, main = t("main"), second = t("second"), ratio = o.d("ratio"),
            dir = CallLayout.Dir.of(str(o["dir"])!!)!!, selfCorner = c("selfCorner"), selfScale = o.d("selfScale"),
            remoteFloat = o.b("remoteFloat"), remoteCorner = c("remoteCorner"), open = tiles(o["open"]),
            pip = CallLayout.Pip.of(str(o["pip"])!!)!!, pairCorner = c("pairCorner"), pairScale = o.d("pairScale"),
        )
    }

    @Test fun labels() {
        val l = root["labels"]!!.jsonObject
        assertEquals(str(l["same"]), CallView.SAME_VIEW_LABEL)
        assertEquals(str(l["own"]), CallView.OWN_VIEW_LABEL)
        assertEquals(str(l["chip_same"]), CallView.viewChipLabel(ViewMode.SAME))
        assertEquals(str(l["chip_own"]), CallView.viewChipLabel(ViewMode.OWN))
        for (c in root["words"]!!.jsonArray) {
            val o = c.jsonObject
            val name = str(o["name"])!!
            assertEquals(str(o["same_hint"]), CallView.sameViewHint(name), "same $name")
            assertEquals(str(o["own_hint"]), CallView.ownViewHint(name), "own $name")
            assertEquals(str(o["bring"]), CallView.bringLabel(name), "bring $name")
            assertEquals(str(o["invite"]), CallView.inviteText(name), "invite $name")
            assertEquals(str(o["around"]), CallView.theyLookAroundText(name), "around $name")
        }
    }

    @Test fun viewOfAndApplyView() {
        val views = root["views"]!!.jsonArray
        assertTrue(views.size >= 400)
        for ((i, c) in views.withIndex()) {
            val o = c.jsonObject
            val got = CallView.viewOf(layout(o["layout"]!!.jsonObject), str(o["page"]))
            assertEquals(stage(o["result"]), got, "viewOf $i")
            // The wire form is the same JSON.
            assertEquals(o["result"]!!.jsonObject, got.toJson(), "json $i")
        }
        for ((i, c) in root["applies"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(layout(o["result"]!!.jsonObject), CallView.applyView(layout(o["layout"]!!.jsonObject), stage(o["view"])!!), "applyView $i")
        }
    }

    @Test fun sameStageAndShouldSend() {
        var same = 0
        for ((i, c) in root["sames"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val want = o.b("result")
            if (want) same++
            assertEquals(want, CallView.sameStage(stage(o["a"])!!, stage(o["b"])!!), "sameStage $i")
        }
        assertTrue(same > 50, "enough equal stages ($same)")
        for ((i, c) in root["sends"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(o.b("result"), CallView.shouldSendView(ViewMode.of(str(o["mode"])), stage(o["known"]), stage(o["mine"])!!), "send $i")
        }
    }

    @Test fun sanitizeStageView() {
        for ((i, c) in root["sanitize"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val got = CallView.sanitizeStageView(o["raw"])
            assertEquals(stage(o["result"]), got, "sanitize $i ${o["raw"]}")
            if (got != null) assertEquals(o["result"]!!.jsonObject, got.toJson(), "json $i")
        }
    }

    @Test fun nextSharedViewAndTheWire() {
        for ((i, c) in root["nexts"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val got = CallView.nextSharedView(shared(o["cur"]), stage(o["view"])!!, str(o["by"])!!, str(o["name"])!!, str(o["cid"])!!, o.b("bring"), o["now"]!!.jsonPrimitive.long)
            assertEquals(shared(o["result"]), got, "next $i")
            assertEquals(o["result"]!!.jsonObject, got.toJson(), "json $i")
            // The room's message parses back to the same view.
            assertEquals(got, CallView.parseShared(got.toJson()), "parse $i")
        }
    }

    @Test fun viewForAnOlderAppsShow() {
        for ((i, c) in root["shows"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val s = o["show"]!!.jsonObject
            val show = CallFollow.ShowView(CallFollow.ShowKind.of(str(s["kind"]))!!, str(s["page"]))
            assertEquals(stage(o["result"]), CallView.viewForShow(stage(o["cur"]), show), "show $i")
        }
    }

    /** The 📝 / 💬 guard (keepJustShared / stageTilesOf / theirLastView). Needs the view.ts that has it. */
    @Test fun aTileTheyJustSharedIsKept() {
        val ms = root["just_shared_ms"]
        if (ms == null || ms is JsonNull) fail("shared/calls/view.ts has no keepJustShared — the 📝 / 💬 guard must be in the TypeScript too")
        assertEquals(ms.jsonPrimitive.long, CallView.JUST_SHARED_MS)
        for ((i, c) in root["tiles_of"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(tiles(o["result"]), CallView.stageTilesOf(stage(o["view"])!!), "stageTilesOf $i")
        }
        for ((i, c) in root["last_views"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val r = o["result"]!!.jsonObject
            assertEquals(CallView.TheirLastView(r["at"]!!.jsonPrimitive.long, tiles(r["tiles"])), CallView.theirLastView(stage(o["before"])!!, stage(o["after"])!!, o["now"]!!.jsonPrimitive.long), "theirLastView $i")
        }
        var kept = 0
        for ((i, c) in root["keeps"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val t = o["theirs"]
            val theirs = if (t == null || t is JsonNull) null else CallView.TheirLastView(t.jsonObject["at"]!!.jsonPrimitive.long, tiles(t.jsonObject["tiles"]))
            val want = o.b("result")
            if (want) kept++
            assertEquals(want, CallView.keepJustShared(theirs, TileId.of(str(o["tile"]))!!, o["now"]!!.jsonPrimitive.long), "keep $i")
        }
        assertTrue(kept > 20, "enough kept ($kept)")
    }

    @Test fun viewStepMatches() {
        val counts = HashMap<String, Int>()
        for ((i, c) in root["steps"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val want = str(o["result"])!!
            counts[want] = (counts[want] ?: 0) + 1
            val got = CallView.viewStep(shared(o["view"]), str(o["my_id"])!!, str(o["last_sent_cid"]), ViewMode.of(str(o["mode"])), o["applied_seq"]!!.jsonPrimitive.int)
            assertEquals(want, got.name.lowercase(), "step $i")
        }
        assertTrue((counts["apply"] ?: 0) > 50 && (counts["invite"] ?: 0) > 10, "enough of each ($counts)")
    }
}
