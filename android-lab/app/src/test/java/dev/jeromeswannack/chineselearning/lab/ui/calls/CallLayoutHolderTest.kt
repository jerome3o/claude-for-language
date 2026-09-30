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
}
