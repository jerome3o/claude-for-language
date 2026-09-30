package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Availability
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Corner
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Dir
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Layout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Mode
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.PresetId
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
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
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Video calls round 2 (PR B): CallLayout reproduces shared/calls/layout.ts exactly (parity/fixtures/calls-layout.ts). */
class CallsLayoutParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-layout.json").readText()).jsonObject
    }

    private fun JsonElement.str() = jsonPrimitive.content
    private fun JsonObject.s(k: String) = this[k]!!.str()
    private fun JsonObject.d(k: String) = this[k]!!.jsonPrimitive.double
    private fun tile(e: JsonElement) = TileId.of(e.str()) ?: fail("tile ${e.str()}")
    private fun corner(e: JsonElement) = Corner.of(e.str()) ?: fail("corner ${e.str()}")

    private fun layout(o: JsonObject) = Layout(
        mode = Mode.of(o.s("mode"))!!, main = tile(o["main"]!!), second = tile(o["second"]!!), ratio = o.d("ratio"),
        dir = Dir.of(o.s("dir"))!!, selfCorner = corner(o["selfCorner"]!!), selfScale = o.d("selfScale"),
        remoteFloat = o["remoteFloat"]!!.jsonPrimitive.boolean, remoteCorner = corner(o["remoteCorner"]!!),
        open = o["open"]!!.jsonArray.map(::tile),
    )

    private fun action(o: JsonObject): Action = when (o.s("type")) {
        "focus" -> Action.Focus(tile(o["tile"]!!))
        "preset" -> Action.Preset(PresetId.of(o.s("preset"))!!)
        "split" -> Action.Split(tile(o["a"]!!), tile(o["b"]!!))
        "swap" -> Action.Swap(tile(o["from"]!!), tile(o["to"]!!))
        "ratio" -> Action.Ratio(o.d("ratio"))
        "dir" -> Action.SetDir(Dir.of(o.s("dir"))!!)
        "selfCorner" -> Action.SelfCorner(corner(o["corner"]!!))
        "selfScale" -> Action.SelfScale(o.d("scale"))
        "remoteCorner" -> Action.RemoteCorner(corner(o["corner"]!!))
        "remoteFloat" -> Action.RemoteFloat(o["on"]!!.jsonPrimitive.boolean)
        "open" -> Action.Open(tile(o["tile"]!!))
        "close" -> Action.Close(tile(o["tile"]!!))
        else -> fail("action $o")
    }

    private fun arrangement(o: JsonObject) = CallLayout.Arrangement(
        stage = o["stage"]!!.jsonArray.map(::tile),
        rail = o["rail"]!!.jsonArray.map(::tile),
        floating = o["floating"]!!.jsonArray.map { val f = it.jsonObject; CallLayout.Floating(tile(f["tile"]!!), corner(f["corner"]!!)) },
        mode = Mode.of(o.s("mode"))!!,
    )

    private fun rects(o: JsonObject): CallLayout.Rects {
        val tiles = o["tiles"]!!.jsonObject.entries.associate { (k, v) ->
            val r = v.jsonObject
            TileId.of(k)!! to CallLayout.Rect(r.d("x"), r.d("y"), r.d("w"), r.d("h"), CallLayout.Role.entries.first { it.wire == r.s("role") }, r["z"]!!.jsonPrimitive.int)
        }
        val div = o["divider"]!!.let { if (it is JsonNull) null else it.jsonObject }
        val st = o["stage"]!!.jsonObject
        return CallLayout.Rects(
            tiles,
            div?.let { CallLayout.Divider(it.d("x"), it.d("y"), it.d("w"), it.d("h"), Dir.of(it.s("dir"))!!) },
            CallLayout.Box(st.d("x"), st.d("y"), st.d("w"), st.d("h")),
        )
    }

    private val aspectSets = listOf(
        emptyMap(),
        mapOf(TileId.REMOTE to 16.0 / 9, TileId.SELF to 3.0 / 4),
        mapOf(TileId.REMOTE to 9.0 / 16, TileId.SELF to 4.0 / 3),
        mapOf(TileId.REMOTE to 1.0, TileId.SELF to 0.0),
    )

    @Test fun constantsMatch() {
        assertEquals(layout(root["default"]!!.jsonObject), CallLayout.DEFAULT_LAYOUT)
        assertEquals(root["all_tiles"]!!.jsonArray.map(::tile), CallLayout.ALL_TILES)
        val presets = root["presets"]!!.jsonArray.map { val p = it.jsonObject; CallLayout.PresetInfo(PresetId.of(p.s("id"))!!, p.s("label"), p.s("key")) }
        assertEquals(presets, CallLayout.PRESETS)
    }

    @Test fun reducerArrangementsAndRectsMatch() {
        val seqs = root["sequences"]!!.jsonArray
        assertTrue(seqs.size > 30)
        var checkedRects = 0
        for ((i, seq) in seqs.withIndex()) {
            var l = CallLayout.DEFAULT_LAYOUT
            for ((k, stepEl) in seq.jsonObject["steps"]!!.jsonArray.withIndex()) {
                val step = stepEl.jsonObject
                val a = step["action"]!!.jsonObject
                l = if (a.s("type") == "swipe") CallLayout.swipeFocus(l, Availability(a["screen"]!!.jsonPrimitive.boolean), a["delta"]!!.jsonPrimitive.int)
                else CallLayout.reduce(l, action(a))
                val label = "seq $i step $k ($a)"
                assertEquals(layout(step["layout"]!!.jsonObject), l, "$label layout")
                val orders = step["swipe_order"]!!.jsonArray
                assertEquals(orders[0].jsonArray.map(::tile), CallLayout.swipeOrder(l, Availability(false)), "$label swipe order")
                assertEquals(orders[1].jsonArray.map(::tile), CallLayout.swipeOrder(l, Availability(true)), "$label swipe order (screen)")
                for (arrEl in step["arrangements"]!!.jsonArray) {
                    val o = arrEl.jsonObject
                    val av = Availability(o["screen"]!!.jsonPrimitive.boolean)
                    val w = o.d("width")
                    assertEquals(arrangement(o["arr"]!!.jsonObject), CallLayout.arrangeTiles(l, av, w), "$label arrangement w=$w screen=${av.screen}")
                }
                for (rEl in step["rects"]!!.jsonArray) {
                    val o = rEl.jsonObject
                    val av = Availability(o["screen"]!!.jsonPrimitive.boolean)
                    val w = o.d("w")
                    val h = o.d("h")
                    val aspects = aspectSets[o["aspects"]!!.jsonPrimitive.int]
                    val got = CallLayout.layoutRects(l, CallLayout.arrangeTiles(l, av, w), w, h, aspects)
                    assertEquals(rects(o["rects"]!!.jsonObject), got, "$label rects ${w}x$h screen=${av.screen} aspects=$aspects")
                    checkedRects++
                }
            }
        }
        assertTrue(checkedRects > 1000)
    }

    @Test fun helpersMatch() {
        for (f in root["floating"]!!.jsonArray) {
            val o = f.jsonObject
            val st = o["stage"]!!.jsonObject
            val stage = CallLayout.Box(st.d("x"), st.d("y"), st.d("w"), st.d("h"))
            val aspect = o["aspect"]!!.jsonPrimitive.let { if (it.isString) Double.NaN else it.double }
            val size = o["size"]!!.jsonObject
            assertEquals(size.d("w") to size.d("h"), CallLayout.floatingSize(stage, aspect, o.d("scale"), o["narrow"]!!.jsonPrimitive.boolean), "floating $o")
        }
        for (g in root["grid"]!!.jsonArray) {
            val o = g.jsonObject
            assertEquals(o["cols"]!!.jsonPrimitive.int, CallLayout.gridColumns(o["n"]!!.jsonPrimitive.int, o.d("w"), o.d("h")), "grid $o")
        }
        for (s in root["snaps"]!!.jsonArray) {
            val o = s.jsonObject
            assertEquals(corner(o["corner"]!!), CallLayout.snapCorner(o.d("cx"), o.d("cy")), "snap $o")
        }
        for (s in root["others"]!!.jsonArray) {
            val o = s.jsonObject
            assertEquals(corner(o["other"]!!), CallLayout.otherCorner(corner(o["corner"]!!)))
        }
        for (s in root["shortcuts"]!!.jsonArray) {
            val o = s.jsonObject
            val want = o["action"]!!.let { if (it is JsonNull) null else action(it.jsonObject) }
            assertEquals(want, CallLayout.layoutShortcut(o.s("key")), "shortcut ${o.s("key")}")
        }
    }

    @Test fun sanitizeMatches() {
        for (s in root["sanitized"]!!.jsonArray) {
            val o = s.jsonObject
            val raw = o["raw"]!!
            assertEquals(layout(o["layout"]!!.jsonObject), CallLayout.sanitize(raw), "sanitize $raw")
        }
        // What we store reads back the same.
        val l = CallLayout.reduce(CallLayout.DEFAULT_LAYOUT, Action.Preset(PresetId.BOARD))
        val back = CallLayout.sanitize(Json.parseToJsonElement(l.toJson().toString()))
        assertEquals(l.copy(open = emptyList()), back.copy(open = emptyList()))
        assertEquals(l.open.toSet(), back.open.toSet())
    }
}
