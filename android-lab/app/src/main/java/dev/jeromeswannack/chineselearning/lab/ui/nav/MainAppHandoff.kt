package dev.jeromeswannack.chineselearning.lab.ui.nav

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import dev.jeromeswannack.chineselearning.lab.Config

/**
 * Hand off to the solid hybrid app at a web [route] (its MainActivity routes
 * `chineselearning:///<route>`), else the website. The fallback for everything the Lab app
 * doesn't do natively yet — never leave a dead end.
 */
fun Context.openInMainApp(route: String) {
    val path = if (route.startsWith("/")) route else "/$route"
    val deepLink = Intent(Intent.ACTION_VIEW, Uri.parse("${Config.HYBRID_SCHEME}://$path"))
        .setPackage(Config.HYBRID_PACKAGE)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        startActivity(deepLink)
    } catch (_: ActivityNotFoundException) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Config.WEB_URL + path)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            // No browser at all (test devices) — nothing sensible left to do.
        }
    }
}

/**
 * The web path a `chineselearning-lab://…` link points at, or null for the sign-in callback
 * (`chineselearning-lab://auth?…`, handled by MainActivity) and foreign links.
 * Accepts both `chineselearning-lab:///decks/abc` and `chineselearning-lab://decks/abc`.
 */
fun deepLinkPath(uri: Uri): String? {
    if (uri.scheme != Config.AUTH_REDIRECT_SCHEME) return null
    val host = uri.host.orEmpty()
    if (host == "auth") return null
    val path = (if (host.isNotEmpty()) "/$host" else "") + (uri.encodedPath ?: "")
    val clean = if (path.isEmpty()) "/" else path
    return clean + (uri.encodedQuery?.let { "?$it" } ?: "")
}

/**
 * What a link from OUTSIDE the app may open (MainActivity.handleIntent): a browser page or another
 * app sending `chineselearning-lab:///<path>`, the launcher's static shortcuts
 * (res/xml/shell_shortcuts.xml), the hybrid-style `route` extra. The app's own notifications,
 * widget, conversation shortcuts and services come through the internal alias
 * (shell/ShellLinks.isInternal) and are not limited.
 *
 * A short list of entry points that only show a screen — nothing that sends a message, starts a
 * Claude call, joins a call, redeems an invite or changes a setting on open — with only the query
 * parameters each needs. Anything else opens Home.
 */
object ExternalLinks {
    const val HOME = "/"

    /** Path → the query parameters it may keep, with their accepted values. */
    private val ALLOWED: Map<String, Map<String, Set<String>>> = mapOf(
        "/" to emptyMap(),
        "/study" to emptyMap(), // launcher shortcut "Study"
        "/coach" to mapOf("focus" to setOf("1")), // launcher shortcut "Coach" — never `text` / `action` (no Claude call from a link)
        "/analyze" to emptyMap(), // launcher shortcut "Analyze"
    )

    /** The allowed form of [path] (an in-app web path, query included), else [HOME]. */
    fun safePath(path: String?): String {
        if (path.isNullOrBlank()) return HOME
        val hash = path.indexOf('#').let { if (it < 0) path.length else it }
        val beforeHash = path.substring(0, hash)
        val q = beforeHash.indexOf('?')
        var p = if (q < 0) beforeHash else beforeHash.substring(0, q)
        if (p.length > 1) p = p.trimEnd('/')
        if (p.isEmpty()) p = HOME
        val params = ALLOWED[p] ?: return HOME
        if (q < 0 || params.isEmpty()) return p
        val kept = beforeHash.substring(q + 1).split('&').mapNotNull { pair ->
            val i = pair.indexOf('=')
            val key = if (i < 0) pair else pair.substring(0, i)
            val value = if (i < 0) "" else pair.substring(i + 1)
            if (params[key]?.contains(value) == true) "$key=$value" else null
        }.distinct()
        return if (kept.isEmpty()) p else p + "?" + kept.joinToString("&")
    }
}
