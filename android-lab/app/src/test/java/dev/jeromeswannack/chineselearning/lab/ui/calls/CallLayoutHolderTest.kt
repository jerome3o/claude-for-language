package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.PresetId
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The call layout as the call screen keeps it: remembered per user (the web's key and JSON), screen preset when they share. */
class CallLayoutHolderTest {
    private class MapStore : CallLayoutStore {
        val map = HashMap<String, String>()
        override fun load(key: String) = map[key]
        override fun save(key: String, value: String) { map[key] = value }
    }

    @Test fun layoutPersistsPerUserAndRestores() {
        val store = MapStore()
        val a = CallLayoutHolder(store)
        a.bind("u1")
        a.dispatch(Action.Preset(PresetId.BOARD))
        a.dispatch(Action.Ratio(0.4))
        a.dispatch(Action.SelfCorner(CallLayout.Corner.TL))
        val saved = Json.parseToJsonElement(store.map.getValue("call-layout-v1:u1")).jsonObject
        assertEquals("split", saved["mode"]!!.jsonPrimitive.content)
        assertEquals("text", saved["main"]!!.jsonPrimitive.content)
        assertEquals("0.4", saved["ratio"]!!.jsonPrimitive.content)
        // Reopening the call (a new ViewModel) restores it; another user on this phone gets their own.
        val b = CallLayoutHolder(store)
        b.bind("u1")
        assertEquals(a.layout.value.copy(open = emptyList()), b.layout.value.copy(open = emptyList()))
        assertEquals(a.layout.value.open.toSet(), b.layout.value.open.toSet())
        val c = CallLayoutHolder(store)
        c.bind("u2")
        assertEquals(CallLayout.DEFAULT_LAYOUT, c.layout.value)
    }

    @Test fun readsTheWebJsonAndSurvivesGarbage() {
        val store = MapStore()
        store.map["call-layout-v1:u1"] = """{"mode":"focus","main":"chat","second":"text","ratio":0.62,"dir":"row","selfCorner":"bl","selfScale":1.4,"remoteFloat":false,"remoteCorner":"tr","open":["remote","chat","self"]}"""
        store.map["call-layout-v1:u2"] = "{not json"
        val a = CallLayoutHolder(store).apply { bind("u1") }
        assertEquals(TileId.CHAT, a.layout.value.main)
        assertEquals(CallLayout.Corner.BL, a.layout.value.selfCorner)
        assertEquals(false, a.layout.value.remoteFloat)
        assertEquals(CallLayout.DEFAULT_LAYOUT, CallLayoutHolder(store).apply { bind("u2") }.layout.value)
    }

    @Test fun theirScreenShareSwitchesToScreenOnceOnTheChange() {
        val h = CallLayoutHolder(MapStore())
        h.bind("u1")
        h.dispatch(Action.Focus(TileId.TEXT))
        h.setRemoteSharing(true)
        assertEquals(TileId.SCREEN, h.layout.value.main)
        assertEquals(CallLayout.Mode.FOCUS, h.layout.value.mode)
        // The learner moves on (the board); an unfold / rotation re-reports "sharing": the choice stays.
        h.dispatch(Action.Focus(TileId.TEXT))
        h.setRemoteSharing(true)
        assertEquals(TileId.TEXT, h.layout.value.main)
        // They stop and share again: back on the stage.
        h.setRemoteSharing(false)
        h.setRemoteSharing(true)
        assertEquals(TileId.SCREEN, h.layout.value.main)
    }

    @Test fun theirShareUsesTheFacesPairUnlessTheUserChoseSeparateCameras() {
        val store = MapStore()
        val h = CallLayoutHolder(store).apply { bind("u1") }
        h.setRemoteSharing(true)
        val arr = CallLayout.arrangeTiles(h.layout.value, CallLayout.Availability(true), 840.0)
        assertEquals(listOf(TileId.SCREEN), arr.stage)
        assertEquals(CallLayout.Corner.TL, arr.pair)
        // Separate cameras, chosen and remembered: the next call's share keeps them separate.
        h.dispatch(Action.SetPip(CallLayout.Pip.SEPARATE))
        val next = CallLayoutHolder(store).apply { bind("u1") }
        next.setRemoteSharing(true)
        val arr2 = CallLayout.arrangeTiles(next.layout.value, CallLayout.Availability(true), 840.0)
        assertNull(arr2.pair)
        assertEquals(listOf(TileId.REMOTE, TileId.SELF), arr2.floating.map { it.tile })
        // A tap on the pair (back to together first) → Speaker.
        next.dispatch(Action.SetPip(CallLayout.Pip.PAIR))
        next.dispatch(Action.PairTap)
        assertEquals(TileId.REMOTE, next.layout.value.main)
    }

    @Test fun aRoundTwoLayoutReadsAsFacesTogether() {
        val store = MapStore()
        store.map["call-layout-v1:u1"] = """{"mode":"focus","main":"text","second":"text","ratio":0.62,"dir":"row","selfCorner":"br","selfScale":1,"remoteFloat":true,"remoteCorner":"tr","open":["remote","text","self"]}"""
        val h = CallLayoutHolder(store).apply { bind("u1") }
        assertEquals(CallLayout.Pip.PAIR, h.layout.value.pip)
        assertEquals(CallLayout.Corner.TL, CallLayout.arrangeTiles(h.layout.value, CallLayout.Availability(false), 412.0).pair)
        h.dispatch(Action.PairCorner(CallLayout.Corner.BR))
        val saved = Json.parseToJsonElement(store.map.getValue("call-layout-v1:u1")).jsonObject
        assertEquals("br", saved["pairCorner"]!!.jsonPrimitive.content)
        assertEquals("pair", saved["pip"]!!.jsonPrimitive.content)
    }

    @Test fun alreadySharingWhenTheUserIsKnown() {
        val h = CallLayoutHolder(MapStore())
        h.setRemoteSharing(true)
        h.bind("u1")
        assertEquals(TileId.SCREEN, h.layout.value.main)
    }

    @Test fun nothingIsSavedBeforeTheUserIsKnown() {
        val store = MapStore()
        val h = CallLayoutHolder(store)
        h.dispatch(Action.Preset(PresetId.GRID))
        assertNull(store.map["call-layout-v1:"])
        assertEquals(0, store.map.size)
        h.replace(CallLayout.swipeFocus(h.layout.value, CallLayout.Availability(false), 1))
        assertEquals(CallLayout.Mode.FOCUS, h.layout.value.mode)
        assertEquals(TileId.REMOTE, h.layout.value.main)
    }

    // ---- round 4: the long-press menu / the chip — the shared screen and the board together

    private val folded = 396.0 to 700.0 // the Fold's cover screen in portrait (tiles box, dp)
    private val landscape = 600.0 to 380.0
    private val unfolded = 824.0 to 700.0

    private fun sharingHolder(store: MapStore = MapStore()): CallLayoutHolder =
        CallLayoutHolder(store).apply { bind("u1"); dispatch(Action.Focus(TileId.TEXT)); setRemoteSharing(true) }

    @Test fun belowTheScreenOnAFoldedPhoneStacksScreenThenBoard() {
        val store = MapStore()
        val h = sharingHolder(store)
        assertEquals(true, h.applySplit(ScreenBoardSplit.Choice.BELOW, TileId.TEXT))
        val l = h.layout.value
        assertEquals(CallLayout.Mode.SPLIT, l.mode)
        assertEquals(TileId.SCREEN to TileId.TEXT, l.main to l.second)
        val (w, hh) = folded
        val arr = CallLayout.arrangeTiles(l, CallLayout.Availability(true), w)
        assertEquals(listOf(TileId.SCREEN, TileId.TEXT), arr.stage)
        assertEquals(CallLayout.Corner.TL, arr.pair) // the faces keep floating
        val r = CallLayout.layoutRects(l, arr, w, hh)
        assertEquals(CallLayout.Dir.COLUMN, r.divider!!.dir)
        assertTrue(r.tiles.getValue(TileId.SCREEN).y < r.tiles.getValue(TileId.TEXT).y)
        assertEquals(ScreenBoardSplit.Choice.BELOW, ScreenBoardSplit.current(l, w, hh))
        // Remembered like any layout (the web reads the same JSON).
        val saved = Json.parseToJsonElement(store.map.getValue("call-layout-v1:u1")).jsonObject
        assertEquals("split", saved["mode"]!!.jsonPrimitive.content)
        assertEquals("screen", saved["main"]!!.jsonPrimitive.content)
        // The same layout turned to landscape is side by side.
        val (lw, lh) = landscape
        val side = CallLayout.layoutRects(l, CallLayout.arrangeTiles(l, CallLayout.Availability(true), lw), lw, lh)
        assertEquals(CallLayout.Dir.ROW, side.divider!!.dir)
    }

    @Test fun aboveTheScreenPutsTheBoardFirstAndKeepsTheDivider() {
        val h = sharingHolder()
        h.applySplit(ScreenBoardSplit.Choice.BELOW, TileId.TEXT)
        h.dispatch(Action.Ratio(0.7))
        h.applySplit(ScreenBoardSplit.Choice.ABOVE, TileId.TEXT)
        val l = h.layout.value
        assertEquals(TileId.TEXT to TileId.SCREEN, l.main to l.second)
        assertEquals(CallLayout.Dir.COLUMN, l.dir)
        assertEquals(0.7, l.ratio, 0.0)
        assertEquals(ScreenBoardSplit.Choice.ABOVE, ScreenBoardSplit.current(l, folded.first, folded.second))
    }

    @Test fun besideWhenUnfoldedThenBoardOnlyThenScreenOnly() {
        val h = sharingHolder()
        h.applySplit(ScreenBoardSplit.Choice.BESIDE, TileId.TEXT)
        var l = h.layout.value
        assertEquals(CallLayout.Mode.SPLIT, l.mode)
        assertEquals(CallLayout.Dir.ROW, l.dir)
        assertEquals(TileId.SCREEN to TileId.TEXT, l.main to l.second)
        val (w, hh) = unfolded
        val r = CallLayout.layoutRects(l, CallLayout.arrangeTiles(l, CallLayout.Availability(true), w), w, hh)
        assertEquals(CallLayout.Dir.ROW, r.divider!!.dir)
        h.applySplit(ScreenBoardSplit.Choice.BOARD_ONLY, TileId.TEXT)
        l = h.layout.value
        assertEquals(CallLayout.Mode.FOCUS to TileId.TEXT, l.mode to l.main)
        h.applySplit(ScreenBoardSplit.Choice.SCREEN_ONLY, TileId.TEXT)
        l = h.layout.value
        assertEquals(CallLayout.Mode.FOCUS to TileId.SCREEN, l.mode to l.main)
        // Nothing changes → no haptic.
        assertEquals(false, h.applySplit(ScreenBoardSplit.Choice.SCREEN_ONLY, TileId.TEXT))
    }

    @Test fun theChipTogglesTheDefaultSplitForTheScreenShape() {
        val h = sharingHolder()
        val (w, hh) = folded
        assertEquals(ScreenBoardSplit.Choice.BELOW, ScreenBoardSplit.toggle(h.layout.value, w, hh))
        assertEquals(ScreenBoardSplit.Choice.BESIDE, ScreenBoardSplit.toggle(h.layout.value, landscape.first, landscape.second))
        assertEquals(ScreenBoardSplit.Choice.BESIDE, ScreenBoardSplit.toggle(h.layout.value, unfolded.first, unfolded.second))
        h.applySplit(ScreenBoardSplit.toggle(h.layout.value, w, hh), ScreenBoardSplit.boardOf(h.layout.value))
        assertTrue(ScreenBoardSplit.isSplit(h.layout.value))
        h.applySplit(ScreenBoardSplit.toggle(h.layout.value, w, hh), ScreenBoardSplit.boardOf(h.layout.value))
        assertEquals(CallLayout.Mode.FOCUS to TileId.SCREEN, h.layout.value.mode to h.layout.value.main)
    }

    @Test fun theDrawingSplitsToo() {
        val h = sharingHolder()
        h.applySplit(ScreenBoardSplit.Choice.BELOW, TileId.DRAW)
        val l = h.layout.value
        assertEquals(TileId.SCREEN to TileId.DRAW, l.main to l.second)
        assertTrue(CallLayout.narrowSplitAllowed(l))
        assertEquals(TileId.DRAW, ScreenBoardSplit.boardOf(l, TileId.SCREEN))
    }

    @Test fun theMenuWordingFollowsTheScreenShape() {
        val h = sharingHolder()
        val av = CallLayout.Availability(true)
        fun labels(box: Pair<Double, Double>, pressed: TileId = TileId.SCREEN) = ScreenBoardSplit.menu(h.layout.value, av, box.first, box.second, pressed).map { it.label }
        assertEquals(listOf("Show the board below the screen", "Show the board above the screen", "Board only", "Screen only"), labels(folded))
        assertEquals(listOf("Show the board beside the screen", "Board only", "Screen only"), labels(landscape))
        assertEquals(listOf("Show the board beside the screen", "Show the board below the screen", "Board only", "Screen only"), labels(unfolded))
        assertEquals("Show the drawing below the screen", labels(folded, TileId.DRAW).first())
        // Their screen is on the stage: "Screen only" is ticked; nothing to offer without a share.
        assertEquals(listOf(ScreenBoardSplit.Choice.SCREEN_ONLY), ScreenBoardSplit.menu(h.layout.value, av, folded.first, folded.second).filter { it.current }.map { it.choice })
        assertTrue(ScreenBoardSplit.menu(h.layout.value, CallLayout.Availability(false), folded.first, folded.second).isEmpty())
    }

    @Test fun withoutAShareAPhoneShowsTheBoardAlone() {
        val h = sharingHolder()
        h.applySplit(ScreenBoardSplit.Choice.BELOW, TileId.TEXT)
        val arr = CallLayout.arrangeTiles(h.layout.value, CallLayout.Availability(false), folded.first)
        assertEquals(CallLayout.Mode.FOCUS, arr.mode)
        // Their share stops: the split falls back (the screen → their camera); a phone shows one tile.
        assertEquals(1, arr.stage.size)
    }
}
