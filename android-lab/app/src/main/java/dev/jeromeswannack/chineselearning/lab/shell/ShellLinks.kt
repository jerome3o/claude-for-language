package dev.jeromeswannack.chineselearning.lab.shell

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * Every way into the app from a notification, the widget or a service is a Lab deep link,
 * `chineselearning-lab:///<web route>` (MainActivity → LabNav.open), sent through the internal alias
 * so MainActivity knows it is the app's own: a native screen, or its placeholder that hands off to
 * the main app.
 */
object ShellLinks {
    /** The hybrid app's intent extra (`MainActivity.EXTRA_ROUTE`): "/coach". Honoured too, held to the external allowlist. */
    const val EXTRA_ROUTE = "route"

    fun uri(path: String): Uri = Uri.parse("${Config.AUTH_REDIRECT_SCHEME}://" + (if (path.startsWith("/")) path else "/$path"))

    /**
     * The non-exported `<activity-alias>` onto MainActivity (AndroidManifest.xml). Only this app — or
     * a PendingIntent / shortcut it made — can start it, so a link that arrives through it is ours
     * and may open any screen; links that come to the exported MainActivity are held to
     * ui/nav/ExternalLinks' allowlist.
     */
    const val INTERNAL_LINK_CLASS = "dev.jeromeswannack.chineselearning.lab.InternalLink"

    /** True when [intent] came through [INTERNAL_LINK_CLASS] of this app ([packageName]). */
    fun isInternal(intent: Intent?, packageName: String): Boolean {
        val c = intent?.component ?: return false
        return c.packageName == packageName && c.className == INTERNAL_LINK_CLASS
    }

    /** ACTION_VIEW of [path] into MainActivity through the internal alias (no flags). */
    fun viewIntent(context: Context, path: String): Intent =
        Intent(Intent.ACTION_VIEW, uri(path)).setClassName(context, INTERNAL_LINK_CLASS)

    fun intent(context: Context, path: String): Intent =
        viewIntent(context, path)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    /** [notification] = the kind of notification it opens from (usage analytics `notification.tapped`). */
    fun pending(context: Context, requestCode: Int, path: String, notification: String? = null): PendingIntent =
        PendingIntent.getActivity(context, requestCode, intent(context, path).withNotification(notification), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** Marks an intent as opened from a notification of [kind] (an id token: chat_message, call, due_card…). */
    const val EXTRA_NOTIFICATION = "lab_notification"

    private fun Intent.withNotification(kind: String?): Intent = if (kind != null) putExtra(EXTRA_NOTIFICATION, kind) else this

    /**
     * A "go study" entry (the widget, a due-card / homework reminder). Study ALWAYS opens (over a
     * pass, which stays underneath); any other soft path (the homework reminder) is skipped while a
     * homework pass, reader, lesson, picture hunt or quest is in progress (ui/nav/NavResume.kt).
     */
    const val EXTRA_SOFT = "lab_soft"

    fun softIntent(context: Context, path: String): Intent = intent(context, path).putExtra(EXTRA_SOFT, true)

    fun softPending(context: Context, requestCode: Int, path: String, notification: String? = null): PendingIntent =
        PendingIntent.getActivity(context, requestCode, softIntent(context, path).withNotification(notification), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** The in-app path an outside intent asks for: the hybrid-style `route` extra (web path). */
    fun routeExtra(intent: Intent?): String? =
        intent?.getStringExtra(EXTRA_ROUTE)?.trim()?.takeIf { it.isNotEmpty() }?.let { if (it.startsWith("/")) it else "/$it" }

    val STUDY: String get() = Routes.study()
    fun coach(text: String?): String = Routes.coach(text?.trim()?.takeIf { it.isNotEmpty() })
    /** The widget's ✏️: the coach's sentence box focused, keyboard up. */
    val COACH_TYPE: String get() = Routes.coach(focus = true)
}
