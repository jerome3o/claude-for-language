package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Port of shared/calls/view.ts — "Same view" (Jerome after a lesson with Minghui, 5 Oct 2026):
 * "whatever the tutor clicks into, the student's screen follows — layouts too — and the other way
 * round. Both people see the same thing, even screen shares."
 *
 * The call's STAGE is shared: which tile(s) are on it and how (focus / split / grid, the split's ratio
 * and direction, which boards / chat are open) and the text board's page. The CallRoom holds the
 * latest [SharedView] (a reconnect gets it in `welcome.view`); either person changing their stage sends
 * it and both screens apply it — last change wins (the room orders them). Per-device things stay per
 * device: the faces box / floating cameras and the pixel rectangles.
 *
 * The way out: "My own view" ([ViewMode.OWN]) — nothing is sent and nothing of the other person's is
 * applied; "Bring <name> to my view" publishes my view with `bring` (an invitation for someone on
 * their own view, never forced). Replaces round 5's one-shot "Show for student" ([CallFollow]).
 *
 * Parity-tested against the TypeScript (parity/fixtures/calls-view.ts → CallsViewParityTest).
 */
object CallView {
    /** `StageView`: the shared part of a layout — the stage, and the text board's page (null = not known / leave mine). */
    data class StageView(
        val mode: CallLayout.Mode,
        val main: TileId,
        val second: TileId,
        val ratio: Double,
        val dir: CallLayout.Dir,
        /** The boards / chat that are open (cameras always). */
        val open: List<TileId>,
        val page: String?,
    ) {
        fun toJson(): JsonObject = buildJsonObject { putStage(this@StageView) }
    }

    /** `SharedView`: the room's record of the shared view. [seq] counts changes; [cid] is the sender's id for this change. */
    data class SharedView(
        val view: StageView,
        val seq: Int,
        /** Who changed it last (user id) and their name. */
        val by: String,
        val name: String,
        val cid: String,
        val at: Long,
        /** Sent with "Bring <name> to my view". */
        val bring: Boolean = false,
    ) {
        fun toJson(): JsonObject = buildJsonObject {
            putStage(view)
            put("seq", seq); put("by", by); put("name", name); put("cid", cid); put("at", at)
            if (bring) put("bring", true)
        }
    }

    /** `ViewMode`: following the shared view, or looking around privately. */
    enum class ViewMode(val wire: String) {
        SAME("same"), OWN("own");

        companion object {
            /** Absent / unknown (an older app) = same. */
            fun of(wire: String?): ViewMode = if (wire == "own") OWN else SAME
        }
    }

    /** `viewStep`'s answer. */
    enum class Step { APPLY, INVITE, SKIP }

    private val MODES = listOf(CallLayout.Mode.FOCUS, CallLayout.Mode.SPLIT, CallLayout.Mode.GRID)
    private fun clamp(x: Double, lo: Double, hi: Double): Double = Math.min(hi, Math.max(lo, x))
    private fun round3(x: Double): Double = Js.round(x * 1000) / 1000

    private fun kotlinx.serialization.json.JsonObjectBuilder.putStage(v: StageView) {
        put("mode", v.mode.wire); put("main", v.main.wire); put("second", v.second.wire); put("ratio", v.ratio); put("dir", v.dir.wire)
        putJsonArray("open") { v.open.forEach { add(JsonPrimitive(it.wire)) } }
        put("page", v.page?.let { JsonPrimitive(it) } ?: JsonNull)
    }

    /** `viewOf`: the shared part of my layout. */
    fun viewOf(l: CallLayout.Layout, page: String?): StageView = StageView(
        mode = l.mode, main = l.main, second = l.second, ratio = round3(l.ratio), dir = l.dir,
        open = CallLayout.ALL_TILES.filter { it in l.open },
        page = page?.takeIf { it.isNotEmpty() },
    )

    /** `applyView`: my layout with the shared view applied — every per-device field (cameras, faces box, floating) kept. */
    fun applyView(l: CallLayout.Layout, v: StageView): CallLayout.Layout {
        val open = CallLayout.ALL_TILES.filter { it == TileId.REMOTE || it == TileId.SELF || it in v.open }
        return l.copy(mode = v.mode, main = v.main, second = v.second, ratio = clamp(v.ratio, CallLayout.MIN_RATIO, CallLayout.MAX_RATIO), dir = v.dir, open = open)
    }

    /** `sameStage`: do two views put the same thing on the stage? (`page`: null on either side is "no opinion".) */
    fun sameStage(a: StageView, b: StageView): Boolean {
        if (a.mode != b.mode || a.dir != b.dir || Math.abs(a.ratio - b.ratio) > 0.005) return false
        if (a.open.size != b.open.size || a.open.any { it !in b.open }) return false
        if (!a.page.isNullOrEmpty() && !b.page.isNullOrEmpty() && a.page != b.page) return false
        if (a.mode == CallLayout.Mode.GRID) return true
        if (a.main != b.main) return false
        return a.mode == CallLayout.Mode.FOCUS || a.second == b.second
    }

    /** `sanitizeStageView`: a client's view, cleaned (null = refused). */
    fun sanitizeStageView(raw: JsonElement?): StageView? {
        val r = raw as? JsonObject ?: return null
        fun str(k: String): String? = (r[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun tile(k: String): TileId? = TileId.of(str(k))
        val mode = CallLayout.Mode.of(str("mode"))?.takeIf { it in MODES } ?: return null
        val main = tile("main") ?: return null
        val second = tile("second") ?: TileId.TEXT
        val rp = r["ratio"] as? JsonPrimitive
        val rv = if (rp != null && !rp.isString) rp.doubleOrNull else null
        val ratio = if (rv != null && rv.isFinite()) round3(clamp(rv, CallLayout.MIN_RATIO, CallLayout.MAX_RATIO)) else 0.62
        val openRaw = r["open"]
        val open = if (openRaw is JsonArray) {
            val wires = openRaw.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            CallLayout.ALL_TILES.filter { it.wire in wires }
        } else listOf(TileId.REMOTE, TileId.SELF)
        val page = str("page")?.takeIf { it.isNotEmpty() && it.length <= 64 }
        return StageView(
            mode, main, second, ratio, if (str("dir") == "column") CallLayout.Dir.COLUMN else CallLayout.Dir.ROW,
            CallLayout.ALL_TILES.filter { it == TileId.REMOTE || it == TileId.SELF || it in open }, page,
        )
    }

    /** The room's `SharedView` (welcome / `view`); anything malformed = null. */
    fun parseShared(raw: JsonElement?): SharedView? {
        val o = raw as? JsonObject ?: return null
        val view = sanitizeStageView(o) ?: return null
        fun str(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun num(k: String) = (o[k] as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.content.toDoubleOrNull()?.toLong() }
        val seq = num("seq") ?: return null
        return SharedView(
            view, seq.toInt(), str("by").orEmpty(), str("name").orEmpty(), str("cid").orEmpty(), num("at") ?: 0,
            bring = (o["bring"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true,
        )
    }

    /** `nextSharedView`: the room's next shared view after someone sends `view`. A missing page keeps the current one. */
    fun nextSharedView(cur: SharedView?, view: StageView, byUserId: String, byName: String, cid: String, bring: Boolean, now: Long): SharedView =
        SharedView(view.copy(page = view.page ?: cur?.view?.page), (cur?.seq ?: 0) + 1, byUserId, byName, cid.take(64), now, bring)

    /**
     * `viewForShow`: an older app's "Show for student" (`show`, round 5) becomes a change of the shared
     * view — that tile focused on the stage (the board on its page), everything else kept.
     */
    fun viewForShow(cur: StageView?, show: CallFollow.ShowView): StageView {
        val base = cur ?: viewOf(CallLayout.DEFAULT_LAYOUT, null)
        val tile = CallFollow.tileForShow(show)
        val open = CallLayout.ALL_TILES.filter { it in base.open || it == tile }
        val page = if (show.kind == CallFollow.ShowKind.TEXT) show.page ?: base.page else base.page
        return base.copy(mode = CallLayout.Mode.FOCUS, main = tile, open = open, page = page)
    }

    /**
     * `viewStep`: what this device does with the room's view (welcome or a `view` message). APPLY — put it
     * on my stage (my own change comes back too and applies only if it is the last one I sent); INVITE — I'm
     * on my own view and they asked me to come; SKIP — nothing to do.
     */
    fun viewStep(view: SharedView?, myId: String, lastSentCid: String?, mode: ViewMode, appliedSeq: Int): Step {
        if (view == null || view.seq <= appliedSeq) return Step.SKIP
        val mine = view.by == myId
        if (mode == ViewMode.OWN) return if (!mine && view.bring) Step.INVITE else Step.SKIP
        if (mine && view.cid != lastSentCid) return Step.SKIP
        return Step.APPLY
    }

    /** `shouldSendView`: only on Same view, and only when it differs from the view I last applied / sent. */
    fun shouldSendView(mode: ViewMode, known: StageView?, mine: StageView): Boolean =
        mode == ViewMode.SAME && (known == null || !sameStage(known, mine))

    /** `JUST_SHARED_MS`: how long a tile the other person just put on the stage is safe from my 📝 / 💬 toggling it away. */
    const val JUST_SHARED_MS = 3000L

    /** `TheirLastView`: when the other person last changed the shared view, and the tiles it put on the stage. */
    data class TheirLastView(val at: Long, val tiles: List<TileId>)

    /**
     * `keepJustShared`: both pressing 📝 when the tutor says "open the board" must not open and then close
     * it — a board / chat they put on the stage less than [JUST_SHARED_MS] ago stays when I press its button.
     */
    fun keepJustShared(theirs: TheirLastView?, tile: TileId, now: Long): Boolean =
        theirs != null && now - theirs.at < JUST_SHARED_MS && tile in theirs.tiles

    /** `stageTilesOf`: the tiles a view puts on the stage. */
    fun stageTilesOf(v: StageView): List<TileId> = when (v.mode) {
        CallLayout.Mode.GRID -> v.open
        CallLayout.Mode.SPLIT -> listOf(v.main, v.second)
        CallLayout.Mode.FOCUS -> listOf(v.main)
    }

    /** `theirLastView`: only the tiles their change NEWLY brought onto my stage count (a page turn on a board already up brings nothing). */
    fun theirLastView(before: StageView, after: StageView, now: Long): TheirLastView {
        val was = stageTilesOf(before)
        return TheirLastView(now, stageTilesOf(after).filter { it !in was })
    }

    /** The `view` client message. */
    fun viewMessage(view: StageView, cid: String, bring: Boolean = false): String = buildJsonObject {
        put("type", "view")
        put("view", view.toJson())
        put("cid", cid)
        if (bring) put("bring", true)
    }.toString()

    // ------------------------------------------------------------------ words

    const val SAME_VIEW_LABEL = "Same view"
    const val OWN_VIEW_LABEL = "My own view"

    /** `name.trim().split(/\s+/)[0] || fallback`. */
    private fun first(name: String, fallback: String): String {
        val t = JsJson.trim(name)
        val end = t.indexOfFirst { JsJson.isJsSpace(it) }
        return (if (end < 0) t else t.substring(0, end)).ifEmpty { fallback }
    }

    /** `viewChipLabel`: the view chip in the call's top bar. */
    fun viewChipLabel(mode: ViewMode): String = if (mode == ViewMode.SAME) "👥 $SAME_VIEW_LABEL ✓" else "👤 $OWN_VIEW_LABEL"

    fun sameViewHint(name: String): String = "You and ${first(name, "the other person")} see the same thing — either of you can change it."

    fun ownViewHint(name: String): String = "Look around without moving ${first(name, "the other person")}’s screen."

    fun bringLabel(name: String): String = "Bring ${first(name, "them")} to my view"

    /** `inviteText`: the pill on my screen when they "bring" me while I'm on my own view. */
    fun inviteText(name: String): String = "${first(name, "The other person")} wants you to see their view"

    /** `theyLookAroundText`: shown while the other person is on their own view. */
    fun theyLookAroundText(name: String): String = "${first(name, "The other person")} is looking around on their own"
}
