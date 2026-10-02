package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.PresentedMaterial
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/** Calls round 4 PR 5: lesson materials in the room protocol, as worker/src/durable/call-room.ts sends them. */
class CallMaterialProtocolTest {
    private val pm = PresentedMaterial("m1", "第五课", 2, 5, "u1", "王老师")

    @Test fun welcomeCarriesWhatIsPresentedAndItsPageDrawings() {
        val m = CallProtocol.parseServer(
            """{"type":"welcome","client_id":"c9","server_time":1,"started_at":1,"peers":[],"board":[],"chat":[],
               "material":{"material_id":"m1","title":"第五课","page":2,"page_count":5,"by":"u1","by_name":"王老师"},
               "material_annots":{"target":"material:m1:2","annots":{"strokes":[{"key":"c1:s1","from":"c1","name":"A","stroke":{"id":"s1","color":"#f43f5e","width":0.006,"points":[[0.1,0.1],[0.2,0.2]],"done":true}}],"texts":[]}}}""",
        )
        assertIs<ServerMessage.Welcome>(m)
        assertEquals(pm, m.material)
        assertEquals("material:m1:2", m.materialAnnots!!.target)
        assertEquals("s1", m.materialAnnots!!.annots.strokes.single().stroke.id)
        // An older room / nothing presented.
        val old = CallProtocol.parseServer("""{"type":"welcome","client_id":"c9","peers":[],"board":[],"chat":[]}""") as ServerMessage.Welcome
        assertNull(old.material)
        assertNull(old.materialAnnots)
    }

    @Test fun materialMessages() {
        assertEquals(
            ServerMessage.Material(pm, "c1", "王老师"),
            CallProtocol.parseServer("""{"type":"material","presenting":{"material_id":"m1","title":"第五课","page":2,"page_count":5,"by":"u1","by_name":"王老师"},"from":"c1","name":"王老师"}"""),
        )
        assertEquals(ServerMessage.Material(null, "c1", "A"), CallProtocol.parseServer("""{"type":"material","presenting":null,"from":"c1","name":"A"}"""))
        assertNull(CallProtocol.parseServer("""{"type":"material"}"""))
        val ma = CallProtocol.parseServer("""{"type":"material_annots","target":"material:m1:3","annots":{"strokes":[],"texts":[]}}""")
        assertEquals(ServerMessage.MaterialAnnotsMsg("material:m1:3", KeptAnnotations()), ma)
        assertNull(CallProtocol.parseServer("""{"type":"material_annots"}"""))
    }

    @Test fun annotationsCarryTheirTarget() {
        val a = CallProtocol.parseServer("""{"type":"annot","from":"c1","name":"A","stroke":{"id":"s1","color":"#f43f5e","width":0.006,"points":[[0.1,0.1]],"done":false},"target":"material:m1:0"}""") as ServerMessage.Annot
        assertEquals("material:m1:0", a.target)
        assertNull((CallProtocol.parseServer("""{"type":"annot","from":"c1","name":"A","stroke":{"id":"s1","color":"#f43f5e","width":0.006,"points":[[0.1,0.1]],"done":false}}""") as ServerMessage.Annot).target)
        assertEquals(ServerMessage.AnnotClear("c1", "material:m1:1"), CallProtocol.parseServer("""{"type":"annot_clear","from":"c1","target":"material:m1:1"}"""))
        assertEquals(ServerMessage.AnnotClear("c1"), CallProtocol.parseServer("""{"type":"annot_clear","from":"c1","target":""}"""))
        assertEquals(ServerMessage.AnnotTextDelete("c1", "t1", "material:m1:1"), CallProtocol.parseServer("""{"type":"annot_text_delete","from":"c1","id":"t1","target":"material:m1:1"}"""))
        assertEquals(ServerMessage.AnnotPingMsg("c1", "A", 0.5, 0.25, "material:m1:1"), CallProtocol.parseServer("""{"type":"annot_ping","from":"c1","name":"A","x":0.5,"y":0.25,"target":"material:m1:1"}"""))
        val t = CallProtocol.parseServer("""{"type":"annot_text","from":"c1","name":"A","text":{"id":"t1","color":"#22c55e","x":0.1,"y":0.1,"text":"好","size":0.04,"done":true},"target":"material:m1:1"}""") as ServerMessage.AnnotTextMsg
        assertEquals("material:m1:1", t.target)
    }

    @Test fun encodesClientMessages() {
        assertEquals("""{"type":"material_open","material_id":"m1","page":0}""", CallProtocol.materialOpen("m1"))
        assertEquals("""{"type":"material_page","page":3}""", CallProtocol.materialPage(3))
        assertEquals("""{"type":"material_close"}""", CallProtocol.materialClose())
        assertEquals("""{"type":"annot_clear","target":"material:m1:0"}""", CallProtocol.annotClear("material:m1:0"))
        assertEquals("""{"type":"annot_clear"}""", CallProtocol.annotClear())
        assertEquals("""{"type":"annot_text_delete","id":"t","target":"material:m1:0"}""", CallProtocol.annotTextDelete("t", "material:m1:0"))
        assertEquals("""{"type":"annot_ping","x":0.5,"y":0.5,"target":"material:m1:0"}""", CallProtocol.annotPing(0.5, 0.5, "material:m1:0"))
        assertEquals(true, CallProtocol.annot(AnnotStroke("s", "#f43f5e", 0.006, listOf(0.1 to 0.1), true), "material:m1:0").endsWith(""""target":"material:m1:0"}"""))
    }
}
