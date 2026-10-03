package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Materials
import dev.jeromeswannack.chineselearning.lab.core.PresentedMaterial
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
            // Round 4: Keep is the default — an older room that never says counts as kept (annotPersistOf).
            annotPersist = CallAnnotate.annotPersistOf((o["annot_persist"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull),
            annots = CallAnnotate.parseKept(o["annots"]),
            pages = (o["pages"] as? JsonArray)?.mapNotNull { CallPages.parseMeta(it) }.orEmpty(),
            page = o.str("page"),
            pageViews = (o["page_views"] as? JsonObject)?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { k to it } }?.toMap().orEmpty(),
            material = Materials.sanitizePresented(o["material"]),
            materialAnnots = (o["material_annots"] as? JsonObject)?.let { ma ->
                val t = ma.str("target") ?: return@let null
                MaterialAnnots(t, CallAnnotate.parseKept(ma["annots"]) ?: KeptAnnotations())
            },
            // In-call activities: the session being played (absent / null = none).
            activity = CallActivities.parseSession(o["activity"]),
            // Round 5: the relationship's tutor (null = a solo call / an older room) and what she last showed.
            tutorId = o.str("tutor_id")?.takeIf { it.isNotEmpty() },
            shown = CallFollow.parseShown(o["shown"]),
        )
        "text" -> o.str("from")?.let { from -> ServerMessage.Text(from, (o["ops"] as? JsonArray)?.mapNotNull { CallTextDoc.sanitizeOp(it) }.orEmpty(), o.str("page")) }
        "text_cursor" -> parseCursor(o)?.let { ServerMessage.TextCursorMsg(it, o.str("page")) }
        "pages" -> ServerMessage.Pages((o["pages"] as? JsonArray ?: return null).mapNotNull { CallPages.parseMeta(it) })
        "page_doc" -> o.str("page")?.let { page ->
            ServerMessage.PageDoc(page, CallTextDoc.parseSnapshot(o["text"]), (o["text_cursors"] as? JsonArray)?.mapNotNull { parseCursor(it) }.orEmpty())
        }
        "page_view" -> { val c = o.str("client_id"); val p = o.str("page"); if (c != null && p != null) ServerMessage.PageView(c, p) else null }
        "page_preview" -> o.str("page")?.let { ServerMessage.PagePreview(it, o.str("preview").orEmpty(), (o.long("chars") ?: 0).toInt(), o.long("updated_at") ?: 0) }
        "page_deleted" -> { val p = o.str("page"); val f = o.str("fallback"); if (p != null && f != null) ServerMessage.PageDeleted(p, f, o.str("by").orEmpty()) else null }
        "page_summon" -> o.str("page")?.let { ServerMessage.PageSummon(o.str("from").orEmpty(), o.str("name").orEmpty(), it) }
        "annot" -> o.str("from")?.let { from -> CallAnnotate.sanitizeStroke(o["stroke"])?.let { ServerMessage.Annot(from, o.str("name").orEmpty(), it, o.target()) } }
        "annot_mode" -> ServerMessage.AnnotMode(o.str("from").orEmpty(), o.str("name").orEmpty(), (o["persist"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true)
        "annot_clear" -> ServerMessage.AnnotClear(o.str("from").orEmpty(), o.target())
        "annot_text" -> o.str("from")?.let { from -> CallAnnotate.sanitizeText(o["text"])?.let { ServerMessage.AnnotTextMsg(from, o.str("name").orEmpty(), it, o.target()) } }
        "annot_text_delete" -> o.str("id")?.takeIf { it.isNotEmpty() }?.let { ServerMessage.AnnotTextDelete(o.str("from").orEmpty(), it.take(64), o.target()) }
        "annot_ping" -> o.str("from")?.let { from -> CallAnnotate.sanitizePing(o)?.let { (x, y) -> ServerMessage.AnnotPingMsg(from, o.str("name").orEmpty(), x, y, o.target()) } }
        // Lesson materials (round 4 PR 5): what is presented now (null = nothing), and a page's kept drawings.
        "material" -> if (o["presenting"] == null) null else ServerMessage.Material(Materials.sanitizePresented(o["presenting"]), o.str("from"), o.str("name"))
        // In-call activities: the session after a start / action / close (null = closed). A session that doesn't parse is ignored.
        "activity" -> when (val se = o["session"]) {
            null -> null
            is JsonNull -> ServerMessage.Activity(null, o.str("from"), o.str("name"))
            else -> CallActivities.parseSession(se)?.let { ServerMessage.Activity(it, o.str("from"), o.str("name")) }
        }
        "material_annots" -> o.str("target")?.let { ServerMessage.MaterialAnnotsMsg(it, CallAnnotate.parseKept(o["annots"]) ?: KeptAnnotations()) }
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
        // Round 5: what the tutor shows now (null = nothing), and "the tutor stopped your screen share".
        "shown" -> if (!o.containsKey("shown")) null else ServerMessage.Shown(CallFollow.parseShown(o["shown"]))
        "share_stopped" -> ServerMessage.ShareStopped(o.str("by").orEmpty(), o.str("name").orEmpty())
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
    // Annotations: [target] null = the shared screen; `material:<id>:<page>` = a presented material's page (round 4 PR 5).
    fun annot(stroke: AnnotStroke, target: String? = null): String = buildJsonObject { put("type", "annot"); put("stroke", stroke.toJson()); target?.let { put("target", it) } }.toString()
    fun annotClear(target: String? = null): String = buildJsonObject { put("type", "annot_clear"); target?.let { put("target", it) } }.toString()
    /** Place / edit / move a text box on the shared screen (round 4). */
    fun annotText(text: AnnotText, target: String? = null): String = buildJsonObject { put("type", "annot_text"); put("text", text.toJson()); target?.let { put("target", it) } }.toString()
    fun annotTextDelete(id: String, target: String? = null): String = buildJsonObject { put("type", "annot_text_delete"); put("id", id); target?.let { put("target", it) } }.toString()
    /** Present a lesson material (both see it; page turns are shared). */
    fun materialOpen(materialId: String, page: Int = 0): String = buildJsonObject { put("type", "material_open"); put("material_id", materialId); put("page", page) }.toString()
    fun materialPage(page: Int): String = buildJsonObject { put("type", "material_page"); put("page", page) }.toString()
    fun materialClose(): String = buildJsonObject { put("type", "material_close") }.toString()
    /** In-call activities: start one from the catalogue (replaces any running one). */
    fun activityStart(activityId: String): String = buildJsonObject { put("type", "activity_start"); put("activity_id", activityId) }.toString()
    /** Act in the running activity ([sessionId] must match the room's, else the room resyncs me). */
    fun activityAction(sessionId: String, action: ActivityAction): String = buildJsonObject { put("type", "activity_action"); put("session_id", sessionId); put("action", action.toJson()) }.toString()
    /** Close the activity (its result is kept with the lesson). */
    fun activityClose(sessionId: String? = null): String = buildJsonObject { put("type", "activity_close"); sessionId?.let { put("session_id", it) } }.toString()
    /** Keep drawings on the shared screen (true) or let them fade (false) — one setting for both. */
    fun annotMode(persist: Boolean): String = buildJsonObject { put("type", "annot_mode"); put("persist", persist) }.toString()
    fun annotPing(x: Double, y: Double, target: String? = null): String = buildJsonObject { put("type", "annot_ping"); put("x", x); put("y", y); target?.let { put("target", it) } }.toString()
    /** Connection events for the call's diagnostics log (≤ 50 per message). */
    fun diag(events: List<CallConnection.DiagEvent>): String = CallConnection.diagMessage(events.take(CallConnection.MAX_DIAG_EVENTS_PER_MESSAGE))
    // Board pages (shared/calls/pages.ts).
    /** Look at a page: the room answers with `page_doc` and tells the others (`page_view`). */
    fun pageOpen(page: String): String = buildJsonObject { put("type", "page_open"); put("page", page) }.toString()
    /** A new page at the end; the room opens it for me. */
    fun pageNew(): String = buildJsonObject { put("type", "page_new") }.toString()
    /** A copy of [page] right after it; the room opens it for me. */
    fun pageDuplicate(page: String): String = buildJsonObject { put("type", "page_duplicate"); put("page", page) }.toString()
    /** null = back to "Page N". */
    fun pageRename(page: String, title: String?): String = buildJsonObject { put("type", "page_rename"); put("page", page); put("title", title?.let { JsonPrimitive(it) } ?: JsonNull) }.toString()
    /** Refused by the room for the last page left. */
    fun pageDelete(page: String): String = buildJsonObject { put("type", "page_delete"); put("page", page) }.toString()
    /** "Bring <name> here": move the other person to [page]. */
    fun pageSummon(page: String): String = buildJsonObject { put("type", "page_summon"); put("page", page) }.toString()
    fun ping(t: Long): String = buildJsonObject { put("type", "ping"); put("t", t) }.toString()
    fun end(): String = buildJsonObject { put("type", "end") }.toString()
    /** I'm leaving (the call goes on for the other person): the room stops counting me as present at once. */
    /** Round 5, the tutor only: put [view] on the student's stage (null = stop showing); [follow] = a page turn of what is shown. */
    fun show(view: CallFollow.ShowView?, follow: Boolean = false): String = CallFollow.showMessage(view, follow)
    /** Round 5, the tutor only: stop the other person's screen share. */
    fun stopShare(): String = CallFollow.stopShareMessage()
    fun leave(): String = buildJsonObject { put("type", "leave") }.toString()

    private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    /** An annotation's `target` (absent / empty = the shared screen). */
    private fun JsonObject.target(): String? = str("target")?.takeIf { it.isNotEmpty() }
    private fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.let { it.longOrNull ?: it.content.toDoubleOrNull()?.toLong() }
}

/** `welcome.material_annots`: a material page's kept drawings. */
data class MaterialAnnots(val target: String, val annots: KeptAnnotations)

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
        /** Drawings on a shared screen are kept rather than fading (round 4: absent = kept, the default). */
        val annotPersist: Boolean = CallAnnotate.DEFAULT_ANNOT_PERSIST,
        /** Drawings and texts the room kept (round 4; only while kept): drawn at once, as finished. */
        val annots: KeptAnnotations? = null,
        /** Board pages in strip order (empty from an older room). */
        val pages: List<BoardPageMeta> = emptyList(),
        /** The page [text] is — the one this call opened on (null from an older room). */
        val page: String? = null,
        /** Which page each other client looks at. */
        val pageViews: Map<String, String> = emptyMap(),
        /** A lesson material being presented (round 4 PR 5), and its current page's kept drawings / text. */
        val material: PresentedMaterial? = null,
        val materialAnnots: MaterialAnnots? = null,
        /** The in-call activity being played (null = none). */
        val activity: ActivitySession? = null,
        /** Round 5: the relationship's tutor (null = a solo call, or an older room) — leads "Show for student" / "Stop their share". */
        val tutorId: String? = null,
        /** Round 5: what the tutor last showed (CallFollow). */
        val shown: CallFollow.ShownState? = null,
    ) : ServerMessage
    /** [page] = the board page the ops belong to (null from an older room). */
    data class Text(val from: String, val ops: List<TextOp>, val page: String? = null) : ServerMessage
    data class TextCursorMsg(val cursor: TextCursor, val page: String? = null) : ServerMessage
    data class Pages(val pages: List<BoardPageMeta>) : ServerMessage
    /** The page I asked for (or just made): its document and the carets on it. */
    data class PageDoc(val page: String, val text: List<TextRun>?, val textCursors: List<TextCursor>) : ServerMessage
    data class PageView(val clientId: String, val page: String) : ServerMessage
    /** A page's thumbnail text changed. */
    data class PagePreview(val page: String, val preview: String, val chars: Int, val updatedAt: Long) : ServerMessage
    data class PageDeleted(val page: String, val fallback: String, val by: String) : ServerMessage
    /** The other person ([name]) brought me to [page]. */
    data class PageSummon(val from: String, val name: String, val page: String) : ServerMessage
    /** [target]: null = the shared screen; `material:<id>:<page>` = a presented material's page (round 4 PR 5). */
    data class Annot(val from: String, val name: String, val stroke: AnnotStroke, val target: String? = null) : ServerMessage
    data class AnnotClear(val from: String, val target: String? = null) : ServerMessage
    /** A text box placed / typed into / moved by [from] (round 4). */
    data class AnnotTextMsg(val from: String, val name: String, val text: AnnotText, val target: String? = null) : ServerMessage
    data class AnnotTextDelete(val from: String, val id: String, val target: String? = null) : ServerMessage
    data class AnnotMode(val from: String, val name: String, val persist: Boolean) : ServerMessage
    data class AnnotPingMsg(val from: String, val name: String, val x: Double, val y: Double, val target: String? = null) : ServerMessage
    /** What is being presented now (null = nothing), after an open / page turn / close; [from] = the client who did it. */
    data class Material(val presenting: PresentedMaterial?, val from: String? = null, val name: String? = null) : ServerMessage
    /** The kept drawings / text of a material page (on opening or turning to it). */
    data class MaterialAnnotsMsg(val target: String, val annots: KeptAnnotations) : ServerMessage
    /** The in-call activity after a start / action / close (null = closed); [from] = the client whose message caused it. */
    data class Activity(val session: ActivitySession?, val from: String? = null, val name: String? = null) : ServerMessage
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
    /** Round 5: what the tutor shows now (after a `show`); null = nothing. */
    data class Shown(val shown: CallFollow.ShownState?) : ServerMessage
    /** Round 5, to the person sharing: the tutor ([by], [name]) stopped your screen share — stop capturing. */
    data class ShareStopped(val by: String, val name: String) : ServerMessage
}
