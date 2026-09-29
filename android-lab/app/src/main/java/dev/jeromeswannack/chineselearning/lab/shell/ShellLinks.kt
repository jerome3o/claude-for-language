package dev.jeromeswannack.chineselearning.lab.shell

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.MainActivity
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * Every way into the app from outside it is a Lab deep link, `chineselearning-lab:///<web route>`
 * (MainActivity → LabNav.open): a native screen, or its placeholder that hands off to the main app.
 */
object ShellLinks {
    /** The hybrid app's intent extra (`MainActivity.EXTRA_ROUTE`): "/coach?text=…". Honoured too. */
    const val EXTRA_ROUTE = "route"

    fun uri(path: String): Uri = Uri.parse("${Config.AUTH_REDIRECT_SCHEME}://" + (if (path.startsWith("/")) path else "/$path"))

    fun intent(context: Context, path: String): Intent =
        Intent(Intent.ACTION_VIEW, uri(path), context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    fun pending(context: Context, requestCode: Int, path: String): PendingIntent =
        PendingIntent.getActivity(context, requestCode, intent(context, path), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** The in-app path an outside intent asks for: the hybrid-style `route` extra (web path). */
    fun routeExtra(intent: Intent?): String? =
        intent?.getStringExtra(EXTRA_ROUTE)?.trim()?.takeIf { it.isNotEmpty() }?.let { if (it.startsWith("/")) it else "/$it" }

    val STUDY: String get() = Routes.study()
    fun coach(text: String?): String = Routes.coach(text?.trim()?.takeIf { it.isNotEmpty() })
    /** The widget's ✏️: the coach's sentence box focused, keyboard up. */
    val COACH_TYPE: String get() = Routes.coach(focus = true)
}
