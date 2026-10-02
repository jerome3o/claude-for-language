package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Availability
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Box
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Corner
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.DEFAULT_LAYOUT
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Dir
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.DropZone
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Mode
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** The web's round-4 layout tests (shared/calls/layout.test.ts "round 4"), on the Kotlin port. */
class CallLayoutRound4Test {
    @Test fun nearAnEdgeIsThatHalfTheMiddleIsTheWholeStage() {
        assertEquals(DropZone.LEFT, CallLayout.dropZoneAt(0.05, 0.5))
        assertEquals(DropZone.RIGHT, CallLayout.dropZoneAt(0.95, 0.4))
        assertEquals(DropZone.TOP, CallLayout.dropZoneAt(0.5, 0.1))
        assertEquals(DropZone.BOTTOM, CallLayout.dropZoneAt(0.5, 0.9))
        assertEquals(DropZone.FULL, CallLayout.dropZoneAt(0.5, 0.5))
        assertEquals(DropZone.FULL, CallLayout.dropZoneAt(0.31, 0.5))
        assertEquals(DropZone.LEFT, CallLayout.dropZoneAt(0.05, 0.2))
        assertEquals(DropZone.LEFT, CallLayout.dropZoneAt(-1.0, 2.0))
    }

    @Test fun highlightsTheHalfTheTileWillTake() {
        val stage = Box(0.0, 0.0, 1000.0, 600.0)
        assertEquals(Box(0.0, 0.0, 500.0, 600.0), CallLayout.dropZoneBox(DropZone.LEFT, stage))
        assertEquals(Box(500.0, 0.0, 500.0, 600.0), CallLayout.dropZoneBox(DropZone.RIGHT, stage))
        assertEquals(Box(0.0, 300.0, 1000.0, 300.0), CallLayout.dropZoneBox(DropZone.BOTTOM, stage))
        assertEquals(stage, CallLayout.dropZoneBox(DropZone.FULL, stage))
    }

    @Test fun droppingOnAHalfSplitsWithWhatWasOnTheStage() {
        val shared = DEFAULT_LAYOUT.copy(mode = Mode.FOCUS, main = TileId.SCREEN)
        val right = CallLayout.layoutForDrop(shared, TileId.TEXT, DropZone.RIGHT)
        assertEquals(listOf(Mode.SPLIT, TileId.SCREEN, TileId.TEXT, Dir.ROW), listOf(right.mode, right.main, right.second, right.dir))
        assertEquals(0.5, right.ratio)
        assertTrue(TileId.TEXT in right.open)
        val top = CallLayout.layoutForDrop(shared, TileId.TEXT, DropZone.TOP)
        assertEquals(listOf(Mode.SPLIT, TileId.TEXT, TileId.SCREEN, Dir.COLUMN), listOf(top.mode, top.main, top.second, top.dir))
        val full = CallLayout.layoutForDrop(right, TileId.CHAT, DropZone.FULL)
        assertEquals(Mode.FOCUS to TileId.CHAT, full.mode to full.main)
        val same = CallLayout.layoutForDrop(shared, TileId.SCREEN, DropZone.LEFT)
        assertEquals(Mode.FOCUS to TileId.SCREEN, same.mode to same.main)
    }

    @Test fun inASplitAHalfReplacesThatSide() {
        val split = DEFAULT_LAYOUT.copy(mode = Mode.SPLIT, main = TileId.SCREEN, second = TileId.TEXT, dir = Dir.ROW, ratio = 0.7)
        CallLayout.layoutForDrop(split, TileId.DRAW, DropZone.LEFT).let { assertEquals(Triple(TileId.DRAW, TileId.TEXT, 0.7), Triple(it.main, it.second, it.ratio)) }
        CallLayout.layoutForDrop(split, TileId.DRAW, DropZone.RIGHT).let { assertEquals(Triple(TileId.SCREEN, TileId.DRAW, 0.7), Triple(it.main, it.second, it.ratio)) }
        CallLayout.layoutForDrop(split, TileId.TEXT, DropZone.LEFT).let { assertEquals(TileId.TEXT to TileId.SCREEN, it.main to it.second) }
        CallLayout.layoutForDrop(split, TileId.DRAW, DropZone.BOTTOM).let {
            assertEquals(listOf(TileId.SCREEN, TileId.DRAW, Dir.COLUMN), listOf(it.main, it.second, it.dir))
            assertEquals(0.5, it.ratio)
        }
        CallLayout.reduce(split, Action.Drop(TileId.CHAT, DropZone.FULL)).let { assertEquals(Mode.FOCUS to TileId.CHAT, it.mode to it.main) }
    }

    @Test fun phonesSplitAScreenWithABoardStackedInPortraitSideBySideInLandscape() {
        val l = DEFAULT_LAYOUT.copy(mode = Mode.SPLIT, main = TileId.SCREEN, second = TileId.TEXT, open = listOf(TileId.REMOTE, TileId.SELF, TileId.TEXT))
        assertTrue(CallLayout.narrowSplitAllowed(l))
        assertEquals(false, CallLayout.narrowSplitAllowed(l.copy(second = TileId.CHAT)))
        val arr = CallLayout.arrangeTiles(l, Availability(true), 412.0)
        assertEquals(Mode.SPLIT, arr.mode)
        assertEquals(listOf(TileId.SCREEN, TileId.TEXT), arr.stage)
        assertEquals(l.pairCorner, arr.pair)
        assertEquals(Dir.COLUMN, CallLayout.layoutRects(l, arr, 412.0, 800.0).divider?.dir)
        assertEquals(Dir.ROW, CallLayout.layoutRects(l, CallLayout.arrangeTiles(l, Availability(true), 600.0), 600.0, 380.0).divider?.dir)
        assertEquals(Mode.FOCUS, CallLayout.arrangeTiles(l, Availability(false), 412.0).mode)
        assertEquals(Dir.COLUMN, CallLayout.splitDirFor(Dir.COLUMN, 1200.0, 800.0))
    }

    @Test fun theTextBoardLeavesRoomForTheFacesBoxInATopCorner() {
        val l = DEFAULT_LAYOUT.copy(mode = Mode.FOCUS, main = TileId.TEXT, open = listOf(TileId.REMOTE, TileId.SELF, TileId.TEXT))
        val r = CallLayout.layoutRects(l, CallLayout.arrangeTiles(l, Availability(false), 1280.0), 1280.0, 680.0)
        val pair = assertNotNull(r.pair)
        assertEquals(pair.y + pair.h + 4 - r.tiles.getValue(TileId.TEXT).y - CallLayout.TILE_HEADER.getValue(TileId.TEXT), r.textInsetTop)
        assertTrue(r.textInsetTop > 0)
        val br = l.copy(pairCorner = Corner.BR)
        assertEquals(0.0, CallLayout.layoutRects(br, CallLayout.arrangeTiles(br, Availability(false), 1280.0), 1280.0, 680.0).textInsetTop)
    }
}
