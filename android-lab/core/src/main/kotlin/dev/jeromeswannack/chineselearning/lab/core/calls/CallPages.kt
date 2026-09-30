package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * One board page as the room lists it (shared/calls/pages.ts `BoardPageMeta`): the call's text
 * board keeps its content per tutor relationship, across calls, as numbered pages.
 */
data class BoardPageMeta(
    val id: String,
    val title: String? = null,
    /** The first characters of the page (the thumbnail strip). */
    val preview: String = "",
    /** Visible characters on the page. */
    val chars: Int = 0,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    /** The call the page was made in (null: made outside a call). */
    val callId: String? = null,
)

/** Port of the pure page rules in shared/calls/pages.ts that the apps use (labels, titles). */
object CallPages {
    const val MAX_PAGE_TITLE = 60

    /** Port of pageLabel(): "Page 7" or its title. [index] is 0-based in strip order. */
    fun pageLabel(index: Int, title: String?): String {
        val t = title?.let { JsJson.trim(it) }
        return if (!t.isNullOrEmpty()) t else "Page ${index + 1}"
    }

    /** Port of sanitizePageTitle(): one line, ≤ 60 characters (code points); blank → null ("Page N"). */
    fun sanitizePageTitle(raw: String?): String? {
        if (raw == null) return null
        val tabs = Regex("[\\r\\n\\t]+").replace(raw, " ")
        val one = JsJson.trim(JsJson.replaceSpaceRuns(tabs, " "))
        if (one.isEmpty()) return null
        val cps = one.codePoints().toArray()
        if (cps.size <= MAX_PAGE_TITLE) return one
        return String(cps, 0, MAX_PAGE_TITLE)
    }

    /** A `BoardPageMeta` from the room (null when it has no id). */
    fun parseMeta(el: JsonElement?): BoardPageMeta? {
        val o = el as? JsonObject ?: return null
        fun str(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun num(k: String) = (o[k] as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.content.toDoubleOrNull()?.toLong() }
        return BoardPageMeta(
            id = str("id") ?: return null,
            title = str("title"),
            preview = str("preview").orEmpty(),
            chars = (num("chars") ?: 0).toInt(),
            createdAt = num("created_at") ?: 0,
            updatedAt = num("updated_at") ?: 0,
            callId = str("call_id"),
        )
    }
}

/**
 * Which board page this device shows, where the other person is, and following
 * (web: the pages part of useCall / the text board). Each person views the page they choose;
 * "Follow" makes my view jump whenever theirs does (turning a page myself stops following);
 * "Bring <name> here" moves them to my page. Both start on the call's opening page.
 */
data class BoardPagesState(
    /** The relationship's pages in strip order (empty from an older room: no strip). */
    val pages: List<BoardPageMeta> = emptyList(),
    /** The page my text board holds (the room's last `page_doc` / welcome). null = an older room. */
    val current: String? = null,
    /** A page I asked for and haven't got yet (highlighted at once). */
    val requested: String? = null,
    /** The call's opening page: where someone who joins starts. */
    val opening: String? = null,
    /** client id → the page each other person looks at. */
    val views: Map<String, String> = emptyMap(),
    /** The other person's client id (calls are 1:1). */
    val other: String? = null,
    val following: Boolean = false,
    /** Numbers the pages removed by the last `pages` list had ("… deleted page N"). */
    val removedNumbers: Map<String, Int> = emptyMap(),
) {
    /** The page shown as current in the strip. */
    val shown: String? get() = requested ?: current
    val otherPage: String? get() = other?.let { views[it] }
    fun number(id: String?): Int? = pages.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.plus(1)
    fun has(id: String?): Boolean = id != null && pages.any { it.id == id }
}

/** What the controller does after a page event. */
sealed interface PageEffect {
    /** Ask the room for this page (`page_open`). */
    data class Open(val page: String) : PageEffect
    /** A short notice ("Minghui brought you to page 3"). */
    data class Notice(val text: String) : PageEffect
}

/** The "<name> is on page N" bar above the strip. */
data class FollowBar(val text: String, val following: Boolean)

/** The pure reducer over [BoardPagesState] (unit-tested in core). */
object BoardPages {
    data class Step(val state: BoardPagesState, val effects: List<PageEffect> = emptyList(), val loadWelcomeText: Boolean = true)

    private fun open(s: BoardPagesState, page: String?): Step =
        if (page == null || page == s.shown || !s.has(page)) Step(s) else Step(s.copy(requested = page), listOf(PageEffect.Open(page)))

    /**
     * The room's welcome. A first join shows the opening page. A rejoin (after a dropout) goes
     * back to the page I was on when it still exists — the welcome's text is then not loaded
     * (it is the opening page's) and the room is asked for mine.
     */
    fun welcome(prev: BoardPagesState, pages: List<BoardPageMeta>, page: String?, views: Map<String, String>, rejoin: Boolean, other: String?): Step {
        if (page == null) return Step(BoardPagesState(other = other)) // an older room: one board, no pages
        val base = BoardPagesState(pages = pages, current = page, opening = page, views = views, other = other, following = rejoin && prev.following)
        val mine = prev.shown
        if (rejoin && mine != null && mine != page && pages.any { it.id == mine }) {
            return Step(base.copy(current = prev.current ?: page, requested = mine), listOf(PageEffect.Open(mine)), loadWelcomeText = false)
        }
        val s = base
        if (s.following) {
            val theirs = s.otherPage
            if (theirs != null && theirs != s.shown && s.has(theirs)) return open(s, theirs)
        }
        return Step(s)
    }

    /** Someone joined: they start on the opening page until their `page_view` says otherwise. */
    fun peerJoined(s: BoardPagesState, clientId: String): BoardPagesState {
        val start = s.opening ?: return s.copy(other = clientId)
        return s.copy(other = clientId, views = if (clientId in s.views) s.views else s.views + (clientId to start))
    }

    fun peerLeft(s: BoardPagesState, clientId: String): BoardPagesState = s.copy(views = s.views - clientId)

    /** The page list changed (new / renamed / duplicated / deleted). */
    fun pagesChanged(s: BoardPagesState, pages: List<BoardPageMeta>): BoardPagesState {
        val ids = pages.map { it.id }.toSet()
        val removed = s.pages.withIndex().filter { it.value.id !in ids }.associate { it.value.id to it.index + 1 }
        return s.copy(pages = pages, removedNumbers = removed)
    }

    /** The room sent a page's document: my board now shows it. */
    fun docLoaded(s: BoardPagesState, page: String): BoardPagesState =
        s.copy(current = page, requested = if (s.requested == page) null else s.requested)

    /** Someone now looks at [page]; following them turns my page too. */
    fun pageView(s: BoardPagesState, clientId: String, page: String): Step {
        val next = s.copy(views = s.views + (clientId to page))
        return if (next.following && clientId == next.other) open(next, page) else Step(next)
    }

    fun preview(s: BoardPagesState, page: String, preview: String, chars: Int, updatedAt: Long): BoardPagesState =
        s.copy(pages = s.pages.map { if (it.id == page) it.copy(preview = preview, chars = chars, updatedAt = updatedAt) else it })

    /** [page] was deleted (by [by]; [mine] = I deleted it): whoever was on it goes to [fallback]. */
    fun deleted(s: BoardPagesState, page: String, fallback: String, by: String, mine: Boolean): Step {
        val n = s.removedNumbers[page] ?: s.number(page)
        val views = s.views.mapValues { (_, v) -> if (v == page) fallback else v }
        val next = s.copy(views = views, opening = if (s.opening == page) fallback else s.opening)
        // Not on it (or already on the way to another page): nothing to do.
        if (next.shown != page) return Step(next)
        val effects = buildList {
            add(PageEffect.Open(fallback))
            if (!mine) add(PageEffect.Notice("${by.ifBlank { "Someone" }} deleted page ${n ?: ""}".trimEnd()))
        }
        return Step(next.copy(requested = fallback), effects)
    }

    /** "Bring <name> here" from the other person: go to their page. */
    fun summoned(s: BoardPagesState, name: String, page: String): Step {
        if (!s.has(page)) return Step(s)
        val o = open(s, page)
        return o.copy(effects = o.effects + PageEffect.Notice("${name.ifBlank { "Your partner" }} brought you to page ${s.number(page)}"))
    }

    /** I tap a thumbnail: that page, and following stops. */
    fun turnTo(s: BoardPagesState, page: String): Step = open(s.copy(following = false), page)

    /** I make / duplicate a page (the room opens it for me): following stops. */
    fun madePage(s: BoardPagesState): BoardPagesState = s.copy(following = false)

    /** "Go there": the other person's page. */
    fun goThere(s: BoardPagesState): Step = open(s, s.otherPage)

    /** Follow on (jumps to their page now) / off. */
    fun setFollowing(s: BoardPagesState, on: Boolean): Step =
        if (!on) Step(s.copy(following = false)) else open(s.copy(following = true), s.otherPage)

    /** The bar above the strip, or null (they are on my page / not here / no pages). */
    fun followBar(s: BoardPagesState, name: String): FollowBar? {
        if (s.current == null || s.other == null) return null
        if (s.following) return FollowBar("Following $name", following = true)
        val theirs = s.otherPage ?: return null
        if (theirs == s.shown || !s.has(theirs)) return null
        return FollowBar("$name is on page ${s.number(theirs)}", following = false)
    }
}
