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
}
