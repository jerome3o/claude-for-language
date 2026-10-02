package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.PresentedMaterial
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.KeptAnnotations
import dev.jeromeswannack.chineselearning.lab.core.calls.MaterialAnnots
import dev.jeromeswannack.chineselearning.lab.core.calls.ServerMessage
import dev.jeromeswannack.chineselearning.lab.data.calls.RoomStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Calls round 4 PR 5: presenting a lesson material in the call (web useCall's presenting / materialAnnot). */
@OptIn(ExperimentalCoroutinesApi::class)
class CallMaterialsControllerTest {
    private class Rig(scope: TestScope) {
        val room = CallControllerTest.FakeRoom()
        val controller = CallController(
            "call1", "me",
            CallDeps(
                openRoom = { h, _ -> room.handlers = h; room },
                media = CallControllerTest.FakeMedia(), recorder = CallControllerTest.FakeRecorder(),
                endCall = {}, drainUploads = {}, closeOrphans = {}, keepAlive = {}, prepareScreenShare = {},
                uploadEveryMs = 60_000, now = { scope.testScheduler.currentTime }, log = {},
                devicePrefs = MemoryCallDevicePrefs(),
            ),
            scope.backgroundScope,
        )
        fun sentOf(type: String): List<JsonObject> = room.sent.filter { it["type"]!!.jsonPrimitive.content == type }
        fun on(msg: ServerMessage) = room.handlers.onMessage(msg)
        val s get() = controller.state.value
    }

    private val lesson = PresentedMaterial("m1", "第五课 把字句", 0, 3, "u-tutor", "王老师")
    private fun stroke(id: String, done: Boolean = true) = AnnotStroke(id, "#f43f5e", 0.006, listOf(0.1 to 0.1, 0.3 to 0.4), done)
    private fun kept(vararg ids: String) = KeptAnnotations(strokes = ids.map { KeptAnnotations.KeptStroke("c-a:$it", "c-a", "王老师", stroke(it)) })
    private fun welcome(material: PresentedMaterial? = null, annots: MaterialAnnots? = null) =
        ServerMessage.Welcome("c-me", 1, 1, emptyList(), emptyList(), emptyList(), material = material, materialAnnots = annots)

    private fun TestScope.live(): Rig {
        val rig = Rig(this)
        rig.controller.join(record = false)
        runCurrent()
        rig.room.handlers.onStatus(RoomStatus.OPEN)
        return rig
    }

    @Test fun presentTurnAndStopSendTheRoomMessages() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        rig.on(welcome()); runCurrent()
        assertNull(rig.s.presenting)
        rig.controller.presentMaterial("m1")
        assertEquals("m1", rig.sentOf("material_open").single()["material_id"]!!.jsonPrimitive.content)
        // Nothing presented yet (the room answers): a page turn is not sent.
        rig.controller.turnMaterialPage(1)
        assertTrue(rig.sentOf("material_page").isEmpty())
        rig.on(ServerMessage.Material(lesson, "c-me", "Me")); runCurrent()
        assertEquals(lesson, rig.s.presenting)
        rig.controller.turnMaterialPage(1)
        rig.controller.turnMaterialPage(99) // kept inside the material
        rig.controller.turnMaterialPage(0) // the page on show: nothing to send
        assertEquals(listOf("1", "2"), rig.sentOf("material_page").map { it["page"]!!.jsonPrimitive.content })
        rig.controller.stopPresenting()
        assertEquals(1, rig.sentOf("material_close").size)
        rig.on(ServerMessage.Material(null, "c-a", "王老师")); runCurrent()
        assertNull(rig.s.presenting)
    }

    @Test fun welcomeReplaysWhatIsPresentedAndItsPageDrawings() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        val onPage2 = lesson.copy(page = 2)
        rig.on(welcome(onPage2, MaterialAnnots("material:m1:2", kept("s1", "s2")))); runCurrent()
        assertEquals(onPage2, rig.s.presenting)
        assertEquals(setOf("c-a:s1", "c-a:s2"), rig.s.materialAnnotations.strokes.keys)
        // Kept drawings are shown as finished, not as being drawn.
        assertTrue(rig.s.materialAnnotations.strokes.values.all { it.doneAt != null })
        // The shared screen's store is untouched.
        assertTrue(rig.s.annotations.strokes.isEmpty())
        // A rejoin with nothing presented clears it all.
        rig.on(welcome()); runCurrent()
        assertNull(rig.s.presenting)
        assertTrue(rig.s.materialAnnotations.strokes.isEmpty())
    }

    @Test fun annotationsAreScopedToTheCurrentPage() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        rig.on(welcome(lesson)); runCurrent()
        // Theirs on page 0 (the one on show) → the material store; no target → the shared screen; another page → dropped.
        rig.on(ServerMessage.Annot("c-a", "王老师", stroke("p0"), "material:m1:0"))
        rig.on(ServerMessage.Annot("c-a", "王老师", stroke("scr")))
        rig.on(ServerMessage.Annot("c-a", "王老师", stroke("p1"), "material:m1:1"))
        rig.on(ServerMessage.Annot("c-a", "王老师", stroke("other"), "material:m2:0"))
        runCurrent()
        assertEquals(setOf("c-a:p0"), rig.s.materialAnnotations.strokes.keys)
        assertEquals(setOf("c-a:scr"), rig.s.annotations.strokes.keys)
        assertEquals("王老师", rig.s.materialAnnotations.lastRemoteName)

        // Mine carry the page's target.
        rig.controller.sendMaterialStroke(stroke("mine"))
        rig.controller.sendMaterialPing(0.5, 0.5)
        val text = AnnotText("t1", "#22c55e", 0.2, 0.2, "把", done = true)
        rig.controller.sendMaterialText(text)
        assertEquals(listOf("material:m1:0"), rig.sentOf("annot").map { it["target"]!!.jsonPrimitive.content })
        assertEquals("material:m1:0", rig.sentOf("annot_ping").single()["target"]!!.jsonPrimitive.content)
        assertEquals("material:m1:0", rig.sentOf("annot_text").single()["target"]!!.jsonPrimitive.content)
        assertTrue("me:mine" in rig.s.materialAnnotations.strokes.keys)
        assertEquals(setOf("t1"), rig.s.materialAnnotations.texts.keys)
        rig.controller.deleteMaterialText("t1")
        assertTrue(rig.s.materialAnnotations.texts.isEmpty())
        assertEquals("material:m1:0", rig.sentOf("annot_text_delete").single()["target"]!!.jsonPrimitive.content)

        // Their Clear on the page clears the page only.
        rig.on(ServerMessage.AnnotClear("c-a", "material:m1:0")); runCurrent()
        assertTrue(rig.s.materialAnnotations.strokes.isEmpty())
        assertEquals(setOf("c-a:scr"), rig.s.annotations.strokes.keys)
        // My Clear sends the target; the screen's Clear none.
        rig.controller.sendMaterialStroke(stroke("again"))
        rig.controller.clearMaterialAnnotations()
        rig.controller.clearAnnotations()
        assertEquals(listOf("material:m1:0", null), rig.sentOf("annot_clear").map { it["target"]?.jsonPrimitive?.content })
    }

    @Test fun turningThePageSwapsItsDrawings() = runTest(UnconfinedTestDispatcher()) {
        val rig = live()
        rig.on(welcome(lesson, MaterialAnnots("material:m1:0", kept("a")))); runCurrent()
        assertEquals(setOf("c-a:a"), rig.s.materialAnnotations.strokes.keys)
        // The same page again (e.g. the title) keeps them.
        rig.on(ServerMessage.Material(lesson, "c-a", "王老师")); runCurrent()
        assertEquals(setOf("c-a:a"), rig.s.materialAnnotations.strokes.keys)
        // Another page: cleared, then that page's kept drawings arrive.
        rig.on(ServerMessage.Material(lesson.copy(page = 1), "c-a", "王老师")); runCurrent()
        assertTrue(rig.s.materialAnnotations.strokes.isEmpty())
        // A late answer for the old page is ignored.
        rig.on(ServerMessage.MaterialAnnotsMsg("material:m1:0", kept("old"))); runCurrent()
        assertTrue(rig.s.materialAnnotations.strokes.isEmpty())
        rig.on(ServerMessage.MaterialAnnotsMsg("material:m1:1", kept("b"))); runCurrent()
        assertEquals(setOf("c-a:b"), rig.s.materialAnnotations.strokes.keys)
        // Keep (annot_mode) applies to both stores.
        rig.on(ServerMessage.AnnotMode("c-a", "王老师", false)); runCurrent()
        assertEquals(false, rig.s.materialAnnotations.persist)
        assertEquals(false, rig.s.annotations.persist)
        rig.controller.setAnnotationsKept(true)
        assertEquals(true, rig.s.materialAnnotations.persist)
        // Presenting stopped: nothing to draw on — my strokes are not sent.
        rig.on(ServerMessage.Material(null)); runCurrent()
        val before = rig.sentOf("annot").size
        rig.controller.sendMaterialStroke(stroke("late"))
        assertEquals(before, rig.sentOf("annot").size)
    }

    @Test fun aPresentedMaterialComesOntoTheStageOnce() {
        val h = CallLayoutHolder()
        h.setPresenting("m1")
        assertEquals(CallLayout.TileId.MATERIAL, h.layout.value.main)
        assertEquals(CallLayout.Mode.FOCUS, h.layout.value.mode)
        // I move to the board; a page turn (same material) leaves me there; another material comes up again.
        h.dispatch(CallLayout.Action.Focus(CallLayout.TileId.TEXT))
        h.setPresenting("m1")
        assertEquals(CallLayout.TileId.TEXT, h.layout.value.main)
        h.setPresenting(null)
        h.setPresenting("m2")
        assertEquals(CallLayout.TileId.MATERIAL, h.layout.value.main)
        // The long-press menu pairs the board with the material.
        val av = CallLayout.Availability(screen = false, material = true)
        val items = ScreenBoardSplit.menu(h.layout.value, av, 412.0, 700.0, CallLayout.TileId.MATERIAL)
        assertEquals(listOf("Show the board below the material", "Show the board above the material", "Board only", "Material only"), items.map { it.label })
        assertTrue(h.applySplit(ScreenBoardSplit.Choice.BELOW, CallLayout.TileId.TEXT, CallLayout.TileId.MATERIAL))
        val l = h.layout.value
        assertEquals(CallLayout.Mode.SPLIT, l.mode)
        assertEquals(CallLayout.TileId.MATERIAL, l.main)
        assertEquals(CallLayout.TileId.TEXT, l.second)
        // A phone keeps that split (material + board), stacked.
        assertEquals(listOf(CallLayout.TileId.MATERIAL, CallLayout.TileId.TEXT), CallLayout.arrangeTiles(l, av, 412.0).stage)
    }
}
