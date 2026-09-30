package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * Port of shared/calls/protocol.ts: the JSON messages between a call client and the call
 * room (worker/src/durable/call-room.ts). Media goes peer to peer; only these go through
 * the room. [parseServer] never throws — an unknown or malformed message is null.
 */
object CallProtocol {
    const val MAX_CHAT_LENGTH = 1000
    const val MAX_CHAT_MESSAGES = 500
    const val MAX_CALL_PEERS = 2

    private val json = Json { ignoreUnknownKeys = true }

    fun parseServer(text: String): ServerMessage? {
        val o = runCatching { json.parseToJsonElement(text) }.getOrNull() as? JsonObject ?: return null
        return runCatching { parseServer(o) }.getOrNull()
    }

    private fun parseServer(o: JsonObject): ServerMessage? { return when (o.str("type")) {
        "welcome" -> ServerMessage.Welcome(
            clientId = o.str("client_id") ?: return null,
            serverTime = o.long("server_time") ?: 0,
            startedAt = o.long("started_at") ?: 0,
            peers = (o["peers"] as? JsonArray)?.mapNotNull { parsePeer(it) }.orEmpty(),
            board = CallBoard.parseItems(o["board"]),
            chat = (o["chat"] as? JsonArray)?.mapNotNull { parseChat(it) }.orEmpty(),
            text = CallTextDoc.parseSnapshot(o["text"]),
            textCursors = (o["text_cursors"] as? JsonArray)?.mapNotNull { parseCursor(it) }.orEmpty(),
            annotPersist = (o["annot_persist"] as? JsonPrimitive)?.booleanOrNull == true,
        )
        "text" -> o.str("from")?.let { from -> ServerMessage.Text(from, (o["ops"] as? JsonArray)?.mapNotNull { CallTextDoc.sanitizeOp(it) }.orEmpty()) }
        "text_cursor" -> parseCursor(o)?.let { ServerMessage.TextCursorMsg(it) }
        "annot" -> o.str("from")?.let { from -> CallAnnotate.sanitizeStroke(o["stroke"])?.let { ServerMessage.Annot(from, o.str("name").orEmpty(), it) } }
        "annot_mode" -> ServerMessage.AnnotMode(o.str("from").orEmpty(), o.str("name").orEmpty(), (o["persist"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true)
        "annot_clear" -> ServerMessage.AnnotClear(o.str("from").orEmpty())
        "annot_ping" -> o.str("from")?.let { from -> CallAnnotate.sanitizePing(o)?.let { (x, y) -> ServerMessage.AnnotPingMsg(from, o.str("name").orEmpty(), x, y) } }
        "peer_joined" -> parsePeer(o["peer"])?.let { ServerMessage.PeerJoined(it) }
        "peer_left" -> o.str("client_id")?.let { ServerMessage.PeerLeft(it) }
        "peer_state" -> o.str("client_id")?.let { ServerMessage.PeerState(it, parseState(o["state"])) }
        "signal" -> o.str("from")?.let { ServerMessage.Signal(it, o["data"] ?: JsonNull) }
        "board" -> CallBoard.parse(o["op"])?.let { ServerMessage.Board(it) }
        "board_live" -> o.str("from")?.let { ServerMessage.BoardLive(it, LiveStroke.parse(o["stroke"])) }
        "chat" -> parseChat(o["message"])?.let { ServerMessage.Chat(it) }
        "pong" -> ServerMessage.Pong(o.long("t") ?: 0, o.long("server_time") ?: 0)
        "ended" -> ServerMessage.Ended(o.str("by").orEmpty())
        "replaced" -> ServerMessage.Replaced
        "error" -> ServerMessage.Error(o.str("message").orEmpty())
        else -> null
    } }

    fun parsePeer(el: JsonElement?): CallPeer? {
        val o = el as? JsonObject ?: return null
        return CallPeer(
            clientId = o.str("client_id") ?: return null,
            userId = o.str("user_id").orEmpty(),
            name = o.str("name").orEmpty(),
            pictureUrl = o.str("picture_url"),
            state = parseState(o["state"]),
            instance = CallConnection.sanitizeInstance(o["instance"]),
        )
    }

    fun parseState(el: JsonElement?): PeerMediaState {
        val o = el as? JsonObject ?: return PeerMediaState()
        fun b(k: String) = (o[k] as? JsonPrimitive)?.booleanOrNull ?: false
        return PeerMediaState(mic = b("mic"), cam = b("cam"), screen = b("screen"), recording = b("recording"))
    }

    fun parseCursor(el: JsonElement?): TextCursor? {
        val o = el as? JsonObject ?: return null
        return TextCursor(
            o.str("client_id") ?: return null, o.str("user_id").orEmpty(), o.str("name").orEmpty(), CallTextDoc.parseSelection(o["sel"]),
            compose = CallConnection.sanitizeCompose(o["compose"]),
        )
    }

    fun parseChat(el: JsonElement?): CallChatMessage? {
        val o = el as? JsonObject ?: return null
        return CallChatMessage(
            id = o.str("id") ?: return null,
            userId = o.str("user_id").orEmpty(),
            name = o.str("name").orEmpty(),
            text = o.str("text").orEmpty(),
            at = o.long("at") ?: 0,
        )
    }

    // ---- client → room ----

    fun signal(to: String, data: JsonElement): String = buildJsonObject { put("type", "signal"); put("to", to); put("data", data) }.toString()
    fun board(op: BoardOp): String = buildJsonObject { put("type", "board"); put("op", op.toJson()) }.toString()
    fun boardLive(stroke: LiveStroke?): String = buildJsonObject { put("type", "board_live"); put("stroke", stroke?.toJson() ?: JsonNull) }.toString()
    fun chat(text: String): String = buildJsonObject { put("type", "chat"); put("text", text) }.toString()
    fun state(s: PeerMediaState): String = buildJsonObject {
        put("type", "state")
        put("state", buildJsonObject { put("mic", s.mic); put("cam", s.cam); put("screen", s.screen); put("recording", s.recording) })
    }.toString()
    fun annot(stroke: AnnotStroke): String = buildJsonObject { put("type", "annot"); put("stroke", stroke.toJson()) }.toString()
    fun annotClear(): String = buildJsonObject { put("type", "annot_clear") }.toString()
    /** Keep drawings on the shared screen (true) or let them fade (false) — one setting for both. */
    fun annotMode(persist: Boolean): String = buildJsonObject { put("type", "annot_mode"); put("persist", persist) }.toString()
    fun annotPing(x: Double, y: Double): String = buildJsonObject { put("type", "annot_ping"); put("x", x); put("y", y) }.toString()
    /** Connection events for the call's diagnostics log (≤ 50 per message). */
    fun diag(events: List<CallConnection.DiagEvent>): String = CallConnection.diagMessage(events.take(CallConnection.MAX_DIAG_EVENTS_PER_MESSAGE))
    fun ping(t: Long): String = buildJsonObject { put("type", "ping"); put("t", t) }.toString()
    fun end(): String = buildJsonObject { put("type", "end") }.toString()
    /** I'm leaving (the call goes on for the other person): the room stops counting me as present at once. */
    fun leave(): String = buildJsonObject { put("type", "leave") }.toString()

    private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.let { it.longOrNull ?: it.content.toDoubleOrNull()?.toLong() }
}

data class PeerMediaState(val mic: Boolean = false, val cam: Boolean = false, val screen: Boolean = false, val recording: Boolean = false)

/** [instance] = the peer's app session / page load (absent from older clients): the same instance back = the same WebRTC link. */
data class CallPeer(val clientId: String, val userId: String, val name: String, val pictureUrl: String?, val state: PeerMediaState, val instance: String? = null)

data class CallChatMessage(val id: String, val userId: String, val name: String, val text: String, val at: Long)

/** Room → client. */
sealed interface ServerMessage {
    data class Welcome(
        val clientId: String,
        val serverTime: Long,
        val startedAt: Long,
        val peers: List<CallPeer>,
        val board: List<BoardItem>,
        val chat: List<CallChatMessage>,
        /** The shared text board (null from an older room). */
        val text: List<TextRun>? = null,
        val textCursors: List<TextCursor> = emptyList(),
        /** Drawings on a shared screen are kept rather than fading (absent = fade). */
        val annotPersist: Boolean = false,
    ) : ServerMessage
    data class Text(val from: String, val ops: List<TextOp>) : ServerMessage
    data class TextCursorMsg(val cursor: TextCursor) : ServerMessage
    data class Annot(val from: String, val name: String, val stroke: AnnotStroke) : ServerMessage
    data class AnnotClear(val from: String) : ServerMessage
    data class AnnotMode(val from: String, val name: String, val persist: Boolean) : ServerMessage
    data class AnnotPingMsg(val from: String, val name: String, val x: Double, val y: Double) : ServerMessage
    data class PeerJoined(val peer: CallPeer) : ServerMessage
    data class PeerLeft(val clientId: String) : ServerMessage
    data class PeerState(val clientId: String, val state: PeerMediaState) : ServerMessage
    data class Signal(val from: String, val data: JsonElement) : ServerMessage
    data class Board(val op: BoardOp) : ServerMessage
    data class BoardLive(val from: String, val stroke: LiveStroke?) : ServerMessage
    data class Chat(val message: CallChatMessage) : ServerMessage
    data class Pong(val t: Long, val serverTime: Long) : ServerMessage
    data class Ended(val by: String) : ServerMessage
    data object Replaced : ServerMessage
    data class Error(val message: String) : ServerMessage
}
