package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * Port of shared/calls/follow.ts — round 5 (Minghui, 3 Oct 2026): the tutor leads the student's screen.
 *
 * - **Show for student**: the tutor puts what is on her stage (the text board on a page, the drawing
 *   board, a material page, her shared screen, an activity) on the student's stage, with a quiet
 *   "Minghui is showing you this" banner. Opening the board does it without the button. The room holds
 *   the latest [ShownState] (a reconnect gets it in `welcome`); the student's device applies each NEW
 *   show once ([followStep]) — after that their own layout choice wins until the tutor shows something
 *   new. Page turns on a shown board page are followed while the student is still looking at the board.
 * - **Stop their share**: the relationship's tutor can stop the student's screen share; never the
 *   other way round ([canStopShare], enforced by the room).
 *
 * Parity-tested against the TypeScript (parity/fixtures/calls-follow.ts → CallsFollowParityTest).
 */
object CallFollow {
    /** `ShowKind` — the wire names are the stage tile ids. */
    enum class ShowKind(val wire: String) {
        TEXT("text"), DRAW("draw"), MATERIAL("material"), SCREEN("screen"), ACTIVITY("activity");

        companion object {
            fun of(wire: String?): ShowKind? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `SHOW_KINDS`. */
    val SHOW_KINDS: List<ShowKind> = ShowKind.entries.toList()

    /** `ShowView`: what the tutor shows. [page] only for [ShowKind.TEXT] (the board page she is on). */
    data class ShowView(val kind: ShowKind, val page: String? = null) {
        fun toJson(): JsonObject = buildJsonObject {
            put("kind", kind.wire)
            if (kind == ShowKind.TEXT && page != null) put("page", page)
        }

        companion object {
            val DRAW = ShowView(ShowKind.DRAW)
            fun text(page: String?) = ShowView(ShowKind.TEXT, page)
        }
    }

    /** `ShownState`: the room's record of the latest show. [id] changes when something NEW is shown; [v] counts follow-ups (page turns). */
    data class ShownState(val id: String, val v: Int, val by: String, val name: String, val view: ShowView, val at: Long) {
        fun toJson(): JsonObject = buildJsonObject {
            put("id", id); put("v", v); put("by", by); put("name", name); put("view", view.toJson()); put("at", at)
        }
    }

    /** `AppliedShow`: the last show this device acted on. */
    data class AppliedShow(val id: String, val v: Int)

    /** `FollowStep`. */
    sealed interface FollowStep {
        /** Nothing to do (already applied, or not mine to follow, or the tile isn't there). */
        data object None : FollowStep
        /** A new show: put [tile] on the stage (and open [page] for the board), show the banner. */
        data class Stage(val tile: CallLayout.TileId, val page: String?) : FollowStep
        /** A page turn on the board page already shown, while I'm on the board: just open the page. */
        data class Page(val page: String) : FollowStep
    }

    /** `sanitizeShowView`: a `show` message's view, cleaned (null = refused). */
    fun sanitizeShowView(raw: JsonElement?): ShowView? {
        val o = raw as? JsonObject ?: return null
        val kindEl = o["kind"] as? JsonPrimitive ?: return null
        if (!kindEl.isString) return null
        val kind = ShowKind.of(kindEl.content) ?: return null
        if (kind == ShowKind.TEXT) {
            val p = (o["page"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            return if (p != null && p.isNotEmpty() && p.length <= 64) ShowView(ShowKind.TEXT, p) else ShowView(ShowKind.TEXT)
        }
        return ShowView(kind)
    }

    /** The room's `ShownState` (welcome / `shown`); anything malformed = null. */
    fun parseShown(raw: JsonElement?): ShownState? {
        val o = raw as? JsonObject ?: return null
        fun str(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val id = str("id") ?: return null
        val view = sanitizeShowView(o["view"]) ?: return null
        val v = (o["v"] as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.content.toDoubleOrNull()?.toLong() } ?: 1
        val at = (o["at"] as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.content.toDoubleOrNull()?.toLong() } ?: 0
        return ShownState(id, v.toInt(), str("by").orEmpty(), str("name").orEmpty(), view, at)
    }

    /** `tileForShow`: the stage tile a view lives in. */
    fun tileForShow(view: ShowView): CallLayout.TileId = CallLayout.TileId.of(view.kind.wire)!!

    /** `canShow`: only the relationship's tutor leads (never in a solo call, never the student). */
    fun canShow(senderId: String, tutorId: String?): Boolean = !tutorId.isNullOrEmpty() && senderId == tutorId

    /** `canStopShare`: the tutor may stop the OTHER person's screen share; the student may stop nobody's. */
    fun canStopShare(senderId: String, tutorId: String?, targetId: String): Boolean = canShow(senderId, tutorId) && targetId != senderId

    /**
     * `nextShown`: the room's next state for a `show`. [follow] = an automatic follow-up of what is
     * already shown (her board page turned): the same id, `v` + 1 — only when the kind is the same and
     * it is hers; anything else (and every press of the button) is a new show.
     */
    fun nextShown(cur: ShownState?, view: ShowView, byUserId: String, byName: String, follow: Boolean, now: Long, newId: () -> String): ShownState {
        if (follow && cur != null && cur.view.kind == view.kind && cur.by == byUserId) return cur.copy(v = cur.v + 1, view = view, at = now)
        return ShownState(newId(), 1, byUserId, byName, view, now)
    }

    /**
     * `followStep`: what the student's device does with the room's `shown`. [myId]: me — the tutor's
     * own device never follows itself. [available]: the tile exists on my side now. [onTile]: the
     * shown tile is on my stage now (decides whether a page turn is followed).
     */
    fun followStep(applied: AppliedShow?, shown: ShownState?, myId: String, available: Boolean, onTile: Boolean): FollowStep {
        if (shown == null || shown.by == myId) return FollowStep.None
        val page = if (shown.view.kind == ShowKind.TEXT) shown.view.page else null
        if (applied == null || applied.id != shown.id) {
            return if (available) FollowStep.Stage(tileForShow(shown.view), page) else FollowStep.None
        }
        if (shown.v > applied.v && page != null && onTile) return FollowStep.Page(page)
        return FollowStep.None
    }

    /** `showingBanner`: the banner on the student's stage. */
    fun showingBanner(name: String): String = "${JsJson.trim(name).ifEmpty { "Your tutor" }} is showing you this"

    /** `shareStoppedNote`: the note on the student's screen when the tutor stops their share. */
    fun shareStoppedNote(name: String): String = "${JsJson.trim(name).ifEmpty { "Your tutor" }} stopped your screen share"

    /** The tutor's corner button and its done state. */
    const val SHOW_BUTTON_LABEL = "Show for student"
    const val SHOWN_BUTTON_LABEL = "Showing ✓"
    /** The control on the student's screen tile (tutor only). */
    const val STOP_THEIR_SHARE_LABEL = "Stop their share"

    /** `isShowing`: does the tutor's corner button read "Showing ✓" for this tile? */
    fun isShowing(shown: ShownState?, myId: String, view: ShowView): Boolean {
        if (shown == null || shown.by != myId || shown.view.kind != view.kind) return false
        if (view.kind == ShowKind.TEXT && shown.view.kind == ShowKind.TEXT) return shown.view.page == view.page
        return true
    }

    /** `autoShowBoard`: opening the board shows it to the student without the button — a board tile (text / draw) that just came onto the tutor's stage. */
    fun autoShowBoard(wasOnStage: List<CallLayout.TileId>, nowOnStage: List<CallLayout.TileId>): ShowKind? {
        for (t in listOf(CallLayout.TileId.TEXT to ShowKind.TEXT, CallLayout.TileId.DRAW to ShowKind.DRAW)) {
            if (t.first in nowOnStage && t.first !in wasOnStage) return t.second
        }
        return null
    }

    /** The `show` client message (null view = stop showing). */
    fun showMessage(view: ShowView?, follow: Boolean = false): String = buildJsonObject {
        put("type", "show")
        put("view", view?.toJson() ?: JsonNull)
        if (follow) put("follow", true)
    }.toString()

    /** The `stop_share` client message. */
    fun stopShareMessage(): String = buildJsonObject { put("type", "stop_share") }.toString()
}
