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

/** Video calls round 2 (PR B) + round 3 (faces together) + round 4 (drag and drop, phone split, text inset): CallLayout reproduces shared/calls/layout.ts exactly (parity/fixtures/calls-layout.ts). */
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
    private fun zone(e: JsonElement) = CallLayout.DropZone.of(e.str()) ?: fail("zone ${e.str()}")
    private fun box(o: JsonObject) = CallLayout.Box(o.d("x"), o.d("y"), o.d("w"), o.d("h"))

    private fun layout(o: JsonObject) = Layout(
        mode = Mode.of(o.s("mode"))!!, main = tile(o["main"]!!), second = tile(o["second"]!!), ratio = o.d("ratio"),
        dir = Dir.of(o.s("dir"))!!, selfCorner = corner(o["selfCorner"]!!), selfScale = o.d("selfScale"),
        remoteFloat = o["remoteFloat"]!!.jsonPrimitive.boolean, remoteCorner = corner(o["remoteCorner"]!!),
        open = o["open"]!!.jsonArray.map(::tile),
        pip = CallLayout.Pip.of(o.s("pip"))!!, pairCorner = corner(o["pairCorner"]!!), pairScale = o.d("pairScale"),
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
        "pip" -> Action.SetPip(CallLayout.Pip.of(o.s("pip"))!!)
        "pairCorner" -> Action.PairCorner(corner(o["corner"]!!))
        "pairScale" -> Action.PairScale(o.d("scale"))
        "pairTap" -> Action.PairTap
        "shareStarted" -> Action.ShareStarted
        "materialStarted" -> Action.MaterialStarted
        "drop" -> Action.Drop(tile(o["tile"]!!), zone(o["zone"]!!))
        else -> fail("action $o")
    }

    private fun arrangement(o: JsonObject) = CallLayout.Arrangement(
        stage = o["stage"]!!.jsonArray.map(::tile),
        rail = o["rail"]!!.jsonArray.map(::tile),
        floating = o["floating"]!!.jsonArray.map { val f = it.jsonObject; CallLayout.Floating(tile(f["tile"]!!), corner(f["corner"]!!)) },
        mode = Mode.of(o.s("mode"))!!,
        pair = o["pair"]!!.let { if (it is JsonNull) null else corner(it) },
    )

    private fun rects(o: JsonObject): CallLayout.Rects {
        val tiles = o["tiles"]!!.jsonObject.entries.associate { (k, v) ->
            val r = v.jsonObject
            TileId.of(k)!! to CallLayout.Rect(r.d("x"), r.d("y"), r.d("w"), r.d("h"), CallLayout.Role.entries.first { it.wire == r.s("role") }, r["z"]!!.jsonPrimitive.int)
        }
        val div = o["divider"]!!.let { if (it is JsonNull) null else it.jsonObject }
        val st = o["stage"]!!.jsonObject
        val pair = o["pair"]!!.let { if (it is JsonNull) null else it.jsonObject }
        return CallLayout.Rects(
            tiles,
            div?.let { CallLayout.Divider(it.d("x"), it.d("y"), it.d("w"), it.d("h"), Dir.of(it.s("dir"))!!) },
            CallLayout.Box(st.d("x"), st.d("y"), st.d("w"), st.d("h")),
            pair?.let { CallLayout.PairBox(it.d("x"), it.d("y"), it.d("w"), it.d("h"), corner(it["corner"]!!)) },
            o.d("textInsetTop"),
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
        val header = root["tile_header"]!!.jsonObject.entries.associate { (k, v) -> TileId.of(k)!! to v.jsonPrimitive.double }
        assertEquals(header, CallLayout.TILE_HEADER)
        assertEquals(root["pair_pad"]!!.jsonPrimitive.double, CallLayout.PAIR_PAD)
        assertEquals(root["pair_gap"]!!.jsonPrimitive.double, CallLayout.PAIR_GAP)
    }

    @Test fun pairSizeAndBoardButtonMatch() {
        val pairs = root["pairs"]!!.jsonArray
        assertTrue(pairs.size >= 200)
        for (p in pairs) {
            val o = p.jsonObject
            val st = o["stage"]!!.jsonObject
            val stage = CallLayout.Box(st.d("x"), st.d("y"), st.d("w"), st.d("h"))
            fun asp(k: String): Double? = o[k]!!.let { if (it is JsonNull) null else it.jsonPrimitive.let { v -> if (v.isString) Double.NaN else v.double } }
            val aspects = buildMap { asp("remote")?.let { put(TileId.REMOTE, it) }; asp("self")?.let { put(TileId.SELF, it) } }
            val size = o["size"]!!.jsonObject
            val want = CallLayout.PairSize(size.d("w"), size.d("h"), size.d("faceH"), size.d("remoteW"), size.d("selfW"))
            assertEquals(want, CallLayout.pairSize(stage, aspects, o.d("scale"), o["narrow"]!!.jsonPrimitive.boolean), "pairSize $o")
        }
        val buttons = root["board_buttons"]!!.jsonArray
        assertTrue(buttons.size > 100)
        for (b in buttons) {
            val o = b.jsonObject
            val l = layout(o["layout"]!!.jsonObject)
            assertEquals(o["on_stage"]!!.jsonPrimitive.boolean, CallLayout.boardOnStage(l), "boardOnStage $l")
            assertEquals(action(o["action"]!!.jsonObject), CallLayout.boardButton(l, o["narrow"]!!.jsonPrimitive.boolean), "boardButton $l")
        }
    }

    @Test fun reducerArrangementsAndRectsMatch() = checkSequences("sequences", 50, 1000)

    /** Round 4: walks with drops and the phone screen + board split (portrait stacked, landscape side by side). */
    @Test fun dropSequencesMatch() = checkSequences("drop_sequences", 30, 1000)

    /** Round 4 PR 5: a presented lesson material — walks snapshotted over every screen × material availability. */
    @Test fun materialSequencesMatch() {
        checkSequences("material_sequences", 30, 1000)
        for (s in root["material_split_allowed"]!!.jsonArray) {
            val o = s.jsonObject
            val l = layout(o["layout"]!!.jsonObject)
            assertEquals(o["allowed"]!!.jsonPrimitive.boolean, CallLayout.narrowSplitAllowed(l), "narrowSplitAllowed $l")
        }
    }

    private fun avail(o: JsonObject) = Availability(o["screen"]!!.jsonPrimitive.boolean, o["material"]?.jsonPrimitive?.boolean ?: false)

    private val swipeAvails = listOf(Availability(false), Availability(true))
    private val swipeAvailsM = listOf(Availability(false, false), Availability(false, true), Availability(true, false), Availability(true, true))

    private fun checkSequences(key: String, minSeqs: Int, minRects: Int) {
        val seqs = root[key]!!.jsonArray
        assertTrue(seqs.size > minSeqs)
        var checkedRects = 0
        for ((i, seq) in seqs.withIndex()) {
            var l = CallLayout.DEFAULT_LAYOUT
            for ((k, stepEl) in seq.jsonObject["steps"]!!.jsonArray.withIndex()) {
                val step = stepEl.jsonObject
                val a = step["action"]!!.jsonObject
                l = if (a.s("type") == "swipe") CallLayout.swipeFocus(l, avail(a), a["delta"]!!.jsonPrimitive.int)
                else CallLayout.reduce(l, action(a))
                val label = "seq $i step $k ($a)"
                assertEquals(layout(step["layout"]!!.jsonObject), l, "$label layout")
                val orders = step["swipe_order"]!!.jsonArray
                val avs = if (orders.size == 4) swipeAvailsM else swipeAvails
                for ((oi, av) in avs.withIndex()) assertEquals(orders[oi].jsonArray.map(::tile), CallLayout.swipeOrder(l, av), "$label swipe order $av")
                for (arrEl in step["arrangements"]!!.jsonArray) {
                    val o = arrEl.jsonObject
                    val av = avail(o)
                    val w = o.d("width")
                    assertEquals(arrangement(o["arr"]!!.jsonObject), CallLayout.arrangeTiles(l, av, w), "$label arrangement w=$w screen=${av.screen}")
                }
                for (rEl in step["rects"]!!.jsonArray) {
                    val o = rEl.jsonObject
                    val av = avail(o)
                    val w = o.d("w")
                    val h = o.d("h")
                    val aspects = aspectSets[o["aspects"]!!.jsonPrimitive.int]
                    val got = CallLayout.layoutRects(l, CallLayout.arrangeTiles(l, av, w), w, h, aspects)
                    assertEquals(rects(o["rects"]!!.jsonObject), got, "$label rects ${w}x$h screen=${av.screen} aspects=$aspects")
                    checkedRects++
                }
            }
        }
        assertTrue(checkedRects > minRects)
    }

    @Test fun dropZonesMatch() {
        assertEquals(root.d("drop_edge"), CallLayout.DROP_EDGE)
        assertEquals(root["drop_zones"]!!.jsonArray.map(::zone), CallLayout.DROP_ZONES)
        val labels = root["drop_zone_labels"]!!.jsonObject.entries.associate { (k, v) -> CallLayout.DropZone.of(k)!! to v.str() }
        assertEquals(labels, CallLayout.DROP_ZONE_LABELS)
        val ats = root["drop_zone_ats"]!!.jsonArray
        assertTrue(ats.size >= 400)
        for (a in ats) {
            val o = a.jsonObject
            assertEquals(zone(o["zone"]!!), CallLayout.dropZoneAt(o.d("fx"), o.d("fy")), "dropZoneAt $o")
        }
        val boxes = root["drop_zone_boxes"]!!.jsonArray
        assertTrue(boxes.size >= 600)
        for (b in boxes) {
            val o = b.jsonObject
            assertEquals(box(o["box"]!!.jsonObject), CallLayout.dropZoneBox(zone(o["zone"]!!), box(o["stage"]!!.jsonObject)), "dropZoneBox $o")
        }
    }

    @Test fun layoutForDropMatches() {
        val drops = root["drops"]!!.jsonArray
        assertTrue(drops.size > 5000)
        for (d in drops) {
            val o = d.jsonObject
            val l = layout(o["layout"]!!.jsonObject)
            val t = tile(o["tile"]!!)
            val z = zone(o["zone"]!!)
            val want = layout(o["result"]!!.jsonObject)
            assertEquals(want, CallLayout.layoutForDrop(l, t, z), "layoutForDrop $l $t $z")
            assertEquals(want, CallLayout.reduce(l, Action.Drop(t, z)), "drop action $l $t $z")
        }
        for (s in root["split_allowed"]!!.jsonArray) {
            val o = s.jsonObject
            val l = layout(o["layout"]!!.jsonObject)
            assertEquals(o["allowed"]!!.jsonPrimitive.boolean, CallLayout.narrowSplitAllowed(l), "narrowSplitAllowed $l")
        }
        for (s in root["split_dirs"]!!.jsonArray) {
            val o = s.jsonObject
            assertEquals(Dir.of(o.s("result")), CallLayout.splitDirFor(Dir.of(o.s("dir"))!!, o.d("w"), o.d("h")), "splitDirFor $o")
        }
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
