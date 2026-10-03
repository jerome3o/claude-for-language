package dev.jeromeswannack.chineselearning.lab.ui.nav

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/*
 * Where the app opens, and what a "go study" tap does (Jerome: "if I click the notification but
 * the last thing I was doing was my one-off homework, it should leave that up on the screen").
 *
 *  - Warm start (the activity is alive): Android shows the same screen; nothing here runs.
 *  - Cold start (process death without saved state, an app update, a reboot, a relaunch from
 *    Recents): the back stack saved by [LastRouteStore] is rebuilt when it is under
 *    [MAX_AGE_MS] old; older than that the app opens on its normal landing.
 *  - A "go study" entry (the widget, a due-card / homework reminder notification — the intent
 *    carries `ShellLinks.EXTRA_SOFT`) leaves a resumable activity in progress on screen
 *    ([isResumable]: a homework pass, a reader, a lesson, a picture hunt, a quest); otherwise it
 *    opens its path, and Study is single-instance (LabNav.openStudy).
 *  - Every other link (a chat notification, a call, the coach) is explicit and always opens.
 */
object NavResume {
    /** How long "where I was" is worth restoring / protecting. */
    const val MAX_AGE_MS = 6 * 3_600_000L

    /** At most this many screens are rebuilt on a cold start (the top ones). */
    const val MAX_DEPTH = 8

    private val RESUMABLE = listOf(
        Regex("^/homework/[^/]+/?$"), // the one-off homework pass
        Regex("^/readers/(?!generate$)[^/]+/?$"),
        Regex("^/today/(lessons/[^/]+|reader)/?$"), // today's lesson / story from Home
        Regex("^/picture-hunt/[^/]+/?$"),
        Regex("^/quests/[^/]+/?$"),
        Regex("^/tutor-notes/practice/?$"),
        Regex("^/(library|decks)/[^/]+/try/?$"),
        Regex("^/library/catalogue/[^/]+/?$"),
    )

    /** Never rebuilt on a cold start: a live call (rejoining by itself would be wrong), an invite. */
    private val NEVER_RESTORE = listOf(Regex("^/calls/[^/]+/?$"), Regex("^/join/"))

    fun pathname(path: String) = path.substringBefore('?')

    fun isStudy(path: String) = pathname(path).trimEnd('/') == "/study"

    /** An activity worth coming back to as it was, which a "go study" tap must not replace. */
    fun isResumable(path: String) = pathname(path).let { p -> RESUMABLE.any { it.containsMatchIn(p) } }

    fun isRestorable(path: String) = pathname(path).let { p -> NEVER_RESTORE.none { it.containsMatchIn(p) } }

    fun isFresh(savedAt: Long?, now: Long) = savedAt != null && now - savedAt in 0..MAX_AGE_MS

    /**
     * The screens to rebuild over [startPath] on a cold start, bottom first: the saved stack when
     * it is fresh, cut below the first screen that must not be rebuilt, the start screen itself
     * dropped (it is already there), at most [MAX_DEPTH] from the top.
     */
    fun stackToRestore(last: LastRoute?, now: Long, startPath: String): List<String> {
        if (last == null || !isFresh(last.savedAt, now)) return emptyList()
        val kept = last.paths.takeWhile(::isRestorable)
        val above = if (kept.firstOrNull() == startPath) kept.drop(1) else kept
        return above.takeLast(MAX_DEPTH)
    }

    /**
     * A "go study" entry while [top] is on screen (last seen at [seenAt]): true = leave it there.
     * A resumable activity stays while it is fresh; anything else gives way.
     */
    fun softEntryStays(top: String?, seenAt: Long?, now: Long): Boolean =
        top != null && isResumable(top) && isFresh(seenAt, now)
}

/** The back stack as web paths (bottom first) and when it was last on screen. */
data class LastRoute(val paths: List<String>, val savedAt: Long) {
    val top: String? get() = paths.lastOrNull()
}

/** Where the app was, kept across process death (SharedPreferences, written on every move + pause). */
class LastRouteStore(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("lab_nav", Context.MODE_PRIVATE)

    fun save(paths: List<String>, now: Long = System.currentTimeMillis()) {
        if (paths.isEmpty()) return
        val json = JSONObject().put("paths", JSONArray(paths)).put("at", now).toString()
        sp.edit().putString(KEY, json).apply()
    }

    fun load(): LastRoute? = runCatching {
        val o = JSONObject(sp.getString(KEY, null) ?: return null)
        val arr = o.getJSONArray("paths")
        LastRoute((0 until arr.length()).map { arr.getString(it) }, o.getLong("at"))
    }.getOrNull()

    fun clear() = sp.edit().remove(KEY).apply()

    private companion object {
        const val KEY = "last_route_v1"
    }
}
