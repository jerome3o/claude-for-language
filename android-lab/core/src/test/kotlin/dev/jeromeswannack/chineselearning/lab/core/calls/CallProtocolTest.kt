package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Room messages as worker/src/durable/call-room.ts sends them, and signals as the browser sends them. */
class CallProtocolTest {
    @Test fun parsesWelcomeWithBoardAndChat() {
        val m = CallProtocol.parseServer(
            """{"type":"welcome","client_id":"c9","server_time":1790000000500,"started_at":1790000000000,
               "peers":[{"client_id":"c1","user_id":"u2","name":"王老师","picture_url":null,"state":{"mic":true,"cam":false,"screen":false,"recording":true}}],
               "board":[{"type":"text","id":"t1","by":"u2","color":"#1f2937","x":0.1,"y":0.2,"size":80,"text":"你好"},{"type":"stroke","id":"s1","by":"u2","color":"#dc2626","width":10,"points":[[0.1,0.1],[0.2,0.3]]}],
               "chat":[{"id":"m1","user_id":"u2","name":"王老师","text":"加油","at":1790000000100}]}""",
        )
        assertIs<ServerMessage.Welcome>(m)
        assertEquals("c9", m.clientId)
        assertEquals(1_790_000_000_500, m.serverTime)
        assertEquals(PeerMediaState(mic = true, recording = true), m.peers.single().state)
        assertEquals(listOf("t1", "s1"), m.board.map { it.id })
        assertEquals("加油", m.chat.single().text)
    }

    @Test fun parsesEveryOtherMessage() {
        assertEquals(ServerMessage.PeerLeft("c1"), CallProtocol.parseServer("""{"type":"peer_left","client_id":"c1"}"""))
        assertEquals(ServerMessage.PeerState("c1", PeerMediaState(cam = true)), CallProtocol.parseServer("""{"type":"peer_state","client_id":"c1","state":{"cam":true}}"""))
        assertIs<ServerMessage.Board>(CallProtocol.parseServer("""{"type":"board","op":{"type":"clear","by":"u2"}}"""))
        assertEquals(ServerMessage.BoardLive("u2", null), CallProtocol.parseServer("""{"type":"board_live","from":"u2","stroke":null}"""))
        assertEquals(3, (CallProtocol.parseServer("""{"type":"board_live","from":"u2","stroke":{"id":"x","color":"#1f2937","width":10,"points":[[0,0],[0.5,0.5],[1,1]]}}""") as ServerMessage.BoardLive).stroke!!.points.size)
        assertEquals(ServerMessage.Pong(5, 99), CallProtocol.parseServer("""{"type":"pong","t":5,"server_time":99}"""))
        assertEquals(ServerMessage.Ended("u2"), CallProtocol.parseServer("""{"type":"ended","by":"u2"}"""))
        assertEquals(ServerMessage.Replaced, CallProtocol.parseServer("""{"type":"replaced"}"""))
        assertNull(CallProtocol.parseServer("""{"type":"mystery"}"""))
        assertNull(CallProtocol.parseServer("not json"))
    }

    @Test fun clientMessagesRoundTrip() {
        val json = Json.parseToJsonElement(CallProtocol.board(BoardItem.Text("t", "me", "#1f2937", 0.5, 0.25, 80.0, "字")))
        val op = CallBoard.parse((json as kotlinx.serialization.json.JsonObject)["op"])
        assertEquals(BoardItem.Text("t", "me", "#1f2937", 0.5, 0.25, 80.0, "字"), op)
        assertTrue(CallProtocol.state(PeerMediaState(mic = true)).contains("\"mic\":true"))
        assertEquals("""{"type":"board_live","stroke":null}""", CallProtocol.boardLive(null))
    }

    @Test fun signalsAsTheBrowserSendsThem() {
        val offer = CallSignal.parse(Json.parseToJsonElement("""{"description":{"type":"offer","sdp":"v=0\r\n"}}"""))
        assertEquals(CallSignal.Description("offer", "v=0\r\n"), offer)
        val cand = CallSignal.parse(Json.parseToJsonElement("""{"candidate":{"candidate":"candidate:1 1 udp 2 1.2.3.4 5 typ host","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"ab"}}"""))
        assertEquals(CallSignal.Candidate("candidate:1 1 udp 2 1.2.3.4 5 typ host", "0", 0, "ab"), cand)
        assertEquals(CallSignal.EndOfCandidates, CallSignal.parse(Json.parseToJsonElement("""{"candidate":null}""")))
        assertEquals(CallSignal.EndOfCandidates, CallSignal.parse(Json.parseToJsonElement("""{"candidate":{"candidate":"","sdpMid":"0"}}""")))
        assertEquals(cand, CallSignal.parse(cand!!.toJson()))
        assertEquals(offer, CallSignal.parse(offer!!.toJson()))
        assertNull(CallSignal.parse(Json.parseToJsonElement("""{"description":{"type":"weird","sdp":""}}""")))
    }

    @Test fun round4LinkIdsAndHelloNeverTripTheParser() {
        // The web (round 4) sends `link` on every signal and `{ hello: true, link }` first.
        val hello = Json.parseToJsonElement("""{"hello":true,"link":"k3j9x0ab"}""")
        assertEquals(CallSignal.Hello, CallSignal.parse(hello))
        assertEquals("k3j9x0ab", CallSignal.linkOf(hello))
        val offer = Json.parseToJsonElement("""{"description":{"type":"offer","sdp":"v=0"},"link":"L1","extra":{"x":[1,2]}}""")
        assertEquals(CallSignal.Description("offer", "v=0"), CallSignal.parse(offer))
        assertEquals("L1", CallSignal.linkOf(offer))
        assertEquals(CallSignal.EndOfCandidates, CallSignal.parse(Json.parseToJsonElement("""{"candidate":null,"link":"L1"}""")))
        // Older apps: no id. Odd shapes: no signal, no crash.
        assertNull(CallSignal.linkOf(Json.parseToJsonElement("""{"candidate":null}""")))
        assertNull(CallSignal.linkOf(Json.parseToJsonElement("""{"hello":true,"link":7}""")))
        assertNull(CallSignal.parse(Json.parseToJsonElement("""{"hello":"yes"}""")))
        assertNull(CallSignal.parse(Json.parseToJsonElement("""{"link":"L1"}""")))
        assertNull(CallSignal.parse(Json.parseToJsonElement("""[1,2]""")))
        assertNull(CallSignal.linkOf(Json.parseToJsonElement("\"str\"")))
        // Mine go out with my link id, and round-trip.
        val out = CallSignal.Hello.toJson("abc")
        assertEquals("""{"hello":true,"link":"abc"}""", out.toString())
        val cand = CallSignal.Candidate("candidate:1", "0", 0)
        assertEquals(cand, CallSignal.parse(cand.toJson("abc")))
        assertEquals("abc", CallSignal.linkOf(cand.toJson("abc")))
        val msg = CallProtocol.parseServer("""{"type":"signal","from":"c1","data":{"hello":true,"link":"L9"}}""")
        assertEquals(CallSignal.Hello, CallSignal.parse((msg as ServerMessage.Signal).data))
    }

    @Test fun roundTwoFieldsInstanceComposeAndDiag() {
        val joined = CallProtocol.parseServer("""{"type":"peer_joined","peer":{"client_id":"c2","user_id":"u2","name":"王老师","picture_url":null,"state":{},"instance":"k3j9x0ab12cd"}}""")
        assertEquals("k3j9x0ab12cd", (joined as ServerMessage.PeerJoined).peer.instance)
        // Older rooms / junk: no instance.
        assertNull((CallProtocol.parseServer("""{"type":"peer_joined","peer":{"client_id":"c2","user_id":"u2","name":"x","state":{}}}""") as ServerMessage.PeerJoined).peer.instance)
        assertNull((CallProtocol.parseServer("""{"type":"peer_joined","peer":{"client_id":"c2","user_id":"u2","name":"x","state":{},"instance":"a b"}}""") as ServerMessage.PeerJoined).peer.instance)
        val w = CallProtocol.parseServer("""{"type":"welcome","client_id":"c9","peers":[{"client_id":"c1","user_id":"u2","name":"A","state":{},"instance":"abcd1234"}],"board":[],"chat":[],
            "text_cursors":[{"client_id":"c1","user_id":"u2","name":"A","sel":null,"compose":"ni\nhao"}]}""") as ServerMessage.Welcome
        assertEquals("abcd1234", w.peers.single().instance)
        assertEquals("ni hao", w.textCursors.single().compose)
        val cur = CallProtocol.parseServer("""{"type":"text_cursor","client_id":"c1","user_id":"u2","name":"A","sel":null,"compose":"你hao"}""") as ServerMessage.TextCursorMsg
        assertEquals("你hao", cur.cursor.compose)
        assertNull((CallProtocol.parseServer("""{"type":"text_cursor","client_id":"c1","user_id":"u2","name":"A","sel":null,"compose":"  "}""") as ServerMessage.TextCursorMsg).cursor.compose)
        assertNull((CallProtocol.parseServer("""{"type":"text_cursor","client_id":"c1","user_id":"u2","name":"A","sel":null}""") as ServerMessage.TextCursorMsg).cursor.compose)
        // Outgoing: compose only while composing; diag batches of ≤ 50.
        assertEquals("""{"type":"text_cursor","sel":null,"compose":"ni"}""", CallTextBoard.cursorMessage(null, "ni"))
        assertEquals("""{"type":"text_cursor","sel":null}""", CallTextBoard.cursorMessage(null))
        val events = (1..60).map { CallConnection.DiagEvent(it.toLong(), "pc", "e$it") }
        val msg = Json.parseToJsonElement(CallProtocol.diag(events)) as kotlinx.serialization.json.JsonObject
        assertEquals("diag", (msg["type"] as kotlinx.serialization.json.JsonPrimitive).content)
        assertEquals(events.take(50), CallConnection.sanitizeDiagEvents(msg["events"]))
    }

    @Test fun keepDrawingsModeInAndOut() {
        // Round 2 C: "Keep" on the shared-screen drawings is one setting for both people.
        assertEquals("""{"type":"annot_mode","persist":true}""", CallProtocol.annotMode(true))
        assertEquals("""{"type":"annot_mode","persist":false}""", CallProtocol.annotMode(false))
        assertEquals(ServerMessage.AnnotMode("c1", "王老师", true), CallProtocol.parseServer("""{"type":"annot_mode","from":"c1","name":"王老师","persist":true}"""))
        assertEquals(ServerMessage.AnnotMode("c1", "", false), CallProtocol.parseServer("""{"type":"annot_mode","from":"c1","persist":false}"""))
        assertEquals(ServerMessage.AnnotMode("c1", "", false), CallProtocol.parseServer("""{"type":"annot_mode","from":"c1","persist":"yes"}"""))
        val kept = CallProtocol.parseServer("""{"type":"welcome","client_id":"c9","peers":[],"board":[],"chat":[],"annot_persist":true}""") as ServerMessage.Welcome
        assertTrue(kept.annotPersist)
        // An older room sends no annot_persist: drawings fade.
        val old = CallProtocol.parseServer("""{"type":"welcome","client_id":"c9","peers":[],"board":[],"chat":[]}""") as ServerMessage.Welcome
        assertEquals(false, old.annotPersist)
    }

    // ------------------------------------------------------------ board pages (round 3)

    @Test fun parsesPageMessages() {
        val w = CallProtocol.parseServer(
            """{"type":"welcome","client_id":"c9","peers":[],"board":[],"chat":[],"text":{"v":1,"runs":[]},
               "pages":[{"id":"p1","title":null,"preview":"你好","chars":2,"created_at":1,"updated_at":2,"call_id":"call1"},{"id":"p2","title":"Tones","preview":"","chars":0,"created_at":3,"updated_at":4,"call_id":null},{"title":"no id"}],
               "page":"p2","page_views":{"c1":"p1","c2":7}}""",
        ) as ServerMessage.Welcome
        assertEquals(listOf(BoardPageMeta("p1", null, "你好", 2, 1, 2, "call1"), BoardPageMeta("p2", "Tones", "", 0, 3, 4, null)), w.pages)
        assertEquals("p2", w.page)
        assertEquals(mapOf("c1" to "p1"), w.pageViews)
        // An older room: nothing about pages.
        val old = CallProtocol.parseServer("""{"type":"welcome","client_id":"c9","peers":[],"board":[],"chat":[]}""") as ServerMessage.Welcome
        assertNull(old.page); assertTrue(old.pages.isEmpty())

        val text = CallProtocol.parseServer("""{"type":"text","from":"c1","ops":[{"t":"ins","id":[1,"u:x"],"after":null,"text":"好"}],"page":"p1"}""") as ServerMessage.Text
        assertEquals("p1", text.page)
        assertNull((CallProtocol.parseServer("""{"type":"text","from":"c1","ops":[]}""") as ServerMessage.Text).page)
        assertEquals("p2", (CallProtocol.parseServer("""{"type":"text_cursor","client_id":"c1","user_id":"u","name":"A","sel":null,"page":"p2"}""") as ServerMessage.TextCursorMsg).page)

        assertEquals(ServerMessage.Pages(listOf(BoardPageMeta("p1"))), CallProtocol.parseServer("""{"type":"pages","pages":[{"id":"p1"}]}"""))
        assertNull(CallProtocol.parseServer("""{"type":"pages"}"""))
        val doc = CallProtocol.parseServer("""{"type":"page_doc","page":"p1","text":{"v":1,"runs":[[1,"u:x","你好",0]]},"text_cursors":[{"client_id":"c1","user_id":"u","name":"A","sel":null}]}""")
        assertIs<ServerMessage.PageDoc>(doc)
        assertEquals("你好", CallTextDoc("me", doc.text).text())
        assertEquals("c1", doc.textCursors.single().clientId)
        assertNull(CallProtocol.parseServer("""{"type":"page_doc","text":{"v":1,"runs":[]}}"""))
        assertEquals(ServerMessage.PageView("c1", "p2"), CallProtocol.parseServer("""{"type":"page_view","client_id":"c1","page":"p2"}"""))
        assertNull(CallProtocol.parseServer("""{"type":"page_view","client_id":"c1"}"""))
        assertEquals(ServerMessage.PagePreview("p1", "你好", 2, 1790000000000), CallProtocol.parseServer("""{"type":"page_preview","page":"p1","preview":"你好","chars":2,"updated_at":1790000000000}"""))
        assertEquals(ServerMessage.PageDeleted("p1", "p2", "王老师"), CallProtocol.parseServer("""{"type":"page_deleted","page":"p1","fallback":"p2","by":"王老师"}"""))
        assertNull(CallProtocol.parseServer("""{"type":"page_deleted","page":"p1"}"""))
        assertEquals(ServerMessage.PageSummon("c1", "王老师", "p2"), CallProtocol.parseServer("""{"type":"page_summon","from":"c1","name":"王老师","page":"p2"}"""))
    }

    @Test fun encodesPageMessages() {
        fun o(s: String) = Json.parseToJsonElement(s) as kotlinx.serialization.json.JsonObject
        assertEquals("""{"type":"page_open","page":"p1"}""", CallProtocol.pageOpen("p1"))
        assertEquals("""{"type":"page_new"}""", CallProtocol.pageNew())
        assertEquals("""{"type":"page_duplicate","page":"p1"}""", CallProtocol.pageDuplicate("p1"))
        assertEquals("""{"type":"page_rename","page":"p1","title":"Tones"}""", CallProtocol.pageRename("p1", "Tones"))
        assertEquals("""{"type":"page_rename","page":"p1","title":null}""", CallProtocol.pageRename("p1", null))
        assertEquals("""{"type":"page_delete","page":"p1"}""", CallProtocol.pageDelete("p1"))
        assertEquals("""{"type":"page_summon","page":"p1"}""", CallProtocol.pageSummon("p1"))
        assertEquals(kotlinx.serialization.json.JsonPrimitive("p1"), o(CallTextBoard.message(emptyList(), "p1"))["page"])
        assertNull(o(CallTextBoard.message(emptyList()))["page"])
        assertEquals("""{"type":"text_cursor","sel":null,"page":"p1"}""", CallTextBoard.cursorMessage(null, page = "p1"))
    }
}
