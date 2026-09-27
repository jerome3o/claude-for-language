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
