package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Port of shared/calls/connection.ts — keeping a call alive through a bad connection, the pure
 * rules both apps follow (parity-tested: parity/fixtures/calls-connection.ts →
 * CallsConnectionParityTest).
 *
 * - The signalling socket and the media connection are independent: a socket that drops and comes
 *   back from the SAME app session ([newInstanceId]) keeps the PeerConnection ([shouldAdoptPeer]).
 *   A peer whose socket is gone is kept, frozen, for [PEER_AWAY_GRACE_MS].
 * - `disconnected` gets [DISCONNECT_GRACE_MS] to heal, then an ICE restart; `failed` restarts at
 *   once; further restarts back off 2 s, 4 s … 30 s ([nextIceRestartAt]); never while the socket
 *   is down.
 * - [videoEncodingFor]: the camera keeps its frame rate and drops resolution; a shared screen keeps
 *   its resolution and drops frames.
 */
object CallConnection {
    const val DISCONNECT_GRACE_MS = 2500L
    const val PEER_AWAY_GRACE_MS = 30_000L
    const val MAX_RESTART_BACKOFF_MS = 30_000L
    const val ROOM_PING_MS = 10_000L
    const val ROOM_PONG_TIMEOUT_MS = 8_000L

    const val CAMERA_MAX_BITRATE = 900_000
    const val SCREEN_MAX_BITRATE = 1_500_000
    const val CAMERA_HALF_BELOW_BPS = 350_000.0
    const val CAMERA_QUARTER_BELOW_BPS = 180_000.0

    const val MAX_DIAG_EVENTS_PER_MESSAGE = 50
    const val MAX_DIAG_EVENTS = 600
    const val MAX_COMPOSE_CHARS = 40

    /** What a client may send. The room's own lines are kind "call" (entered / left / timed out / who ended the call). */
    val DIAG_KINDS = listOf("pc", "ice", "room", "restart", "route", "media", "join", "peer")
    const val ROOM_DIAG_KIND = "call"

    enum class PcState(val wire: String) {
        NEW("new"), CONNECTING("connecting"), CONNECTED("connected"), DISCONNECTED("disconnected"), FAILED("failed"), CLOSED("closed");

        companion object {
            fun of(wire: String): PcState? = entries.firstOrNull { it.wire == wire }
        }
    }

    data class LinkHealth(
        val pc: PcState,
        /** When [pc] last changed (ms). */
        val changedAt: Long,
        /** ICE restarts since the connection was last connected. */
        val restarts: Int,
        val lastRestartAt: Long?,
        /** Has this link ever been connected (a later drop is a *re*connect). */
        val everConnected: Boolean,
    )

    sealed interface LinkEvent {
        data class Pc(val state: PcState, val at: Long) : LinkEvent
        data class Restarted(val at: Long) : LinkEvent
    }

    fun initialLinkHealth(now: Long) = LinkHealth(PcState.NEW, now, 0, null, false)

    fun linkHealthOn(h: LinkHealth, e: LinkEvent): LinkHealth = when (e) {
        is LinkEvent.Restarted -> h.copy(restarts = h.restarts + 1, lastRestartAt = e.at)
        is LinkEvent.Pc -> when {
            e.state == h.pc -> h
            e.state == PcState.CONNECTED -> LinkHealth(PcState.CONNECTED, e.at, 0, null, true)
            else -> h.copy(pc = e.state, changedAt = e.at)
        }
    }

    /** Wait before restart number [n] (1 = the first after the initial one): 2 s, 4 s, 8 s … 30 s. */
    fun restartBackoffMs(n: Int): Long {
        val exp = maxOf(0, n - 1)
        val v = 2000.0 * StrictMath.pow(2.0, exp.toDouble())
        return minOf(MAX_RESTART_BACKOFF_MS.toDouble(), v).toLong()
    }

    /** When to restart ICE next (ms; may be in the past = now), or null when nothing needs doing. */
    fun nextIceRestartAt(h: LinkHealth, signallingOpen: Boolean): Long? {
        if (!signallingOpen) return null
        if (h.pc != PcState.DISCONNECTED && h.pc != PcState.FAILED) {
            // A restart that never got back to connected (stuck connecting) is retried on the backoff.
            if (h.pc == PcState.CONNECTING && h.lastRestartAt != null) return h.lastRestartAt + restartBackoffMs(h.restarts) + DISCONNECT_GRACE_MS
            return null
        }
        if (h.restarts == 0) return if (h.pc == PcState.FAILED) h.changedAt else h.changedAt + DISCONNECT_GRACE_MS
        return (h.lastRestartAt ?: h.changedAt) + restartBackoffMs(h.restarts)
    }

    /** The small badge in the other person's tile. */
    enum class TileStatus(val wire: String) { LIVE("live"), CONNECTING("connecting"), RECONNECTING("reconnecting") }

    fun tileStatus(pc: PcState, everConnected: Boolean, peerAway: Boolean): TileStatus {
        if (pc == PcState.CONNECTED) return TileStatus.LIVE
        return if (everConnected || peerAway) TileStatus.RECONNECTING else TileStatus.CONNECTING
    }

    fun tileStatus(h: LinkHealth, peerAway: Boolean) = tileStatus(h.pc, h.everConnected, peerAway)

    /**
     * A (re)announced peer is the same connection when it is the same person from the same app
     * session — and the link we have is worth keeping ([pc], when known): a `failed` / `closed` one
     * can't come back, and one still `new` never got going (its offer may have gone to their old
     * socket, so it would wait forever). Those are renegotiated from scratch.
     */
    fun shouldAdoptPeer(currentUserId: String?, currentInstance: String?, incomingUserId: String, incomingInstance: String?, pc: PcState? = null): Boolean {
        if (pc != null && !linkWorthKeeping(pc)) return false
        return currentUserId != null && !incomingInstance.isNullOrEmpty() && currentInstance == incomingInstance && currentUserId == incomingUserId
    }

    fun shouldAdoptPeer(current: CallPeer?, incoming: CallPeer, pc: PcState? = null): Boolean =
        shouldAdoptPeer(current?.userId, current?.instance, incoming.userId, incoming.instance, pc)

    /** Port of linkWorthKeeping: a media link in this state can still carry the call (an ICE restart may heal it). */
    fun linkWorthKeeping(pc: PcState): Boolean = pc == PcState.CONNECTING || pc == PcState.CONNECTED || pc == PcState.DISCONNECTED

    /** What to do with a signal, by the link id it carries (port of LinkSignalAction). */
    enum class LinkSignalAction(val wire: String) { APPLY("apply"), REPLACE("replace"), IGNORE("ignore") }

    /**
     * Port of linkSignalAction. Every link has an id, sent with each of its signals (`link`), and a
     * fresh link says `hello` first. A signal from a link id other than the one mine is talking to
     * ([bound]) means the other side started over (their old link failed): mine starts over too
     * (REPLACE). Signals from a link already replaced ([retired]) are late leftovers (IGNORE);
     * signals without an id come from an app before link ids (APPLY, as before).
     */
    fun linkSignalAction(bound: String?, retired: Collection<String>, incoming: String?): LinkSignalAction {
        if (incoming.isNullOrEmpty()) return LinkSignalAction.APPLY
        if (incoming in retired) return LinkSignalAction.IGNORE
        if (bound == null || bound == incoming) return LinkSignalAction.APPLY
        return LinkSignalAction.REPLACE
    }

    /** A random id for one media link (web newLinkId: 8 base-36 characters). */
    fun newLinkId(): String = java.lang.Long.toString((Math.random() * 2.8e12).toLong(), 36).padStart(8, '0').takeLast(8)

    /** A random instance id for this app session (web: newInstanceId). */
    fun newInstanceId(): String {
        val r = java.lang.Long.toString((Math.random() * 1e16).toLong(), 36).padStart(8, '0').takeLast(8)
        val t = java.lang.Long.toString(System.currentTimeMillis(), 36).takeLast(4)
        return r + t
    }

    private val INSTANCE = Regex("^[a-zA-Z0-9]{4,32}$")

    fun sanitizeInstance(raw: JsonElement?): String? {
        val p = raw as? JsonPrimitive ?: return null
        if (!p.isString) return null
        return p.content.takeIf { INSTANCE.matches(it) }
    }

    fun sanitizeInstance(raw: String?): String? = raw?.takeIf { INSTANCE.matches(it) }

    // ------------------------------------------------------------------ encodings

    enum class VideoSource { CAMERA, SCREEN }

    data class VideoEncoding(
        val maxBitrate: Int,
        val maxFramerate: Int,
        val scaleResolutionDownBy: Double,
        /** "maintain-framerate" | "maintain-resolution" */
        val degradationPreference: String,
    )

    /**
     * The sender's encoding for [source] given the estimated outgoing bitrate ([availableBps], bits/s;
     * null = unknown) and the scale in use now (so it doesn't flap).
     */
    fun videoEncodingFor(source: VideoSource, availableBps: Double?, currentScale: Double = 1.0): VideoEncoding {
        if (source == VideoSource.SCREEN) return VideoEncoding(SCREEN_MAX_BITRATE, 15, 1.0, "maintain-resolution")
        var scale = 1.0
        if (availableBps != null) {
            val quarter = if (currentScale >= 4) CAMERA_QUARTER_BELOW_BPS * 1.5 else CAMERA_QUARTER_BELOW_BPS
            val half = if (currentScale >= 2) CAMERA_HALF_BELOW_BPS * 1.5 else CAMERA_HALF_BELOW_BPS
            if (availableBps < quarter) scale = 4.0
            else if (availableBps < half) scale = 2.0
        } else scale = currentScale
        return VideoEncoding(CAMERA_MAX_BITRATE, 24, scale, "maintain-framerate")
    }

    // ------------------------------------------------------------------ diagnostics

    /** One connection event (t = ms since epoch on the reporter's clock). */
    data class DiagEvent(val t: Long, val kind: String, val detail: String) {
        fun toJson(): JsonObject = buildJsonObject { put("t", t); put("kind", kind); put("detail", detail) }
    }

    /** A stored event with who reported it. */
    data class DiagEntry(val t: Long, val kind: String, val detail: String, val userId: String, val name: String)

    /** `{ type: 'diag', events }` for the room. */
    fun diagMessage(events: List<DiagEvent>): String = buildJsonObject {
        put("type", "diag")
        putJsonArray("events") { events.forEach { add(it.toJson()) } }
    }.toString()

    private val NEWLINES = Regex("[\r\n]+")
    private val TABS_NEWLINES = Regex("[\r\n\t]+")
    private val DECIMAL = Regex("^[+-]?(\\d+\\.?\\d*([eE][+-]?\\d+)?|\\.\\d+([eE][+-]?\\d+)?)$")
    private val HEX = Regex("^0[xX][0-9a-fA-F]+$")
    private val OCT = Regex("^0[oO][0-7]+$")
    private val BIN = Regex("^0[bB][01]+$")

    /** JavaScript `Number(x)` for a JSON value (missing = NaN). */
    internal fun jsNumber(el: JsonElement?): Double = when (el) {
        null -> Double.NaN
        is JsonNull -> 0.0
        is JsonPrimitive -> if (el.isString) jsNumberOfString(el.content) else when (el.content) {
            "true" -> 1.0
            "false" -> 0.0
            else -> el.content.toDoubleOrNull() ?: Double.NaN
        }
        is JsonArray -> when {
            el.isEmpty() -> 0.0
            el.size == 1 -> when (val only = el[0]) {
                is JsonNull -> 0.0
                is JsonPrimitive -> if (only.isString) jsNumberOfString(only.content) else jsNumberOfString(only.content)
                else -> Double.NaN
            }
            else -> Double.NaN
        }
        is JsonObject -> Double.NaN
    }

    private fun jsNumberOfString(raw: String): Double {
        val s = NoteSearch.jsTrim(raw)
        if (s.isEmpty()) return 0.0
        if (DECIMAL.matches(s)) return s.toDouble()
        if (HEX.matches(s)) return java.math.BigInteger(s.substring(2), 16).toDouble()
        if (OCT.matches(s)) return java.math.BigInteger(s.substring(2), 8).toDouble()
        if (BIN.matches(s)) return java.math.BigInteger(s.substring(2), 2).toDouble()
        return Double.NaN
    }

    fun sanitizeDiagEvents(raw: JsonElement?): List<DiagEvent> {
        val arr = raw as? JsonArray ?: return emptyList()
        val out = ArrayList<DiagEvent>()
        for (e in arr.take(MAX_DIAG_EVENTS_PER_MESSAGE)) {
            val r = e as? JsonObject ?: continue
            val t = jsNumber(r["t"])
            if (!t.isFinite() || t <= 0) continue
            val kindEl = r["kind"] as? JsonPrimitive
            val kind = kindEl?.takeIf { it.isString }?.content
            if (kind == null || kind !in DIAG_KINDS) continue
            val d = r["detail"] as? JsonPrimitive
            val detail = if (d != null && d.isString) NEWLINES.replace(d.content, " ").take(200) else ""
            out += DiagEvent(Js.round(t).toLong(), kind, detail)
        }
        return out
    }

    /** Keep the newest [MAX_DIAG_EVENTS], in time order (stable). */
    fun appendDiag(log: List<DiagEntry>, add: List<DiagEntry>): List<DiagEntry> {
        val all = (log + add).sortedBy { it.t }
        return if (all.size > MAX_DIAG_EVENTS) all.subList(all.size - MAX_DIAG_EVENTS, all.size) else all
    }

    /** The IME composition preview next to someone's caret: one line, ≤ 40 characters (code points). */
    fun sanitizeCompose(raw: String?): String? {
        if (raw == null) return null
        val one = TABS_NEWLINES.replace(raw, " ")
        if (NoteSearch.jsTrim(one).isEmpty()) return null
        var i = 0
        var n = 0
        while (i < one.length && n < MAX_COMPOSE_CHARS) { i += Character.charCount(one.codePointAt(i)); n++ }
        return one.substring(0, i)
    }

    fun sanitizeCompose(raw: JsonElement?): String? {
        val p = raw as? JsonPrimitive ?: return null
        return if (p.isString) sanitizeCompose(p.content) else null
    }
}
