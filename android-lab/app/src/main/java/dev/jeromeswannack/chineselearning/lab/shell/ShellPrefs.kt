package dev.jeromeswannack.chineselearning.lab.shell

import android.content.Context

/**
 * The shell's own small state, in its own file so a sign-out (Prefs.clearAccount) keeps the
 * user's notification choice: the Settings toggle, whether the Android 13+ permission was
 * asked once, and which homework was already announced today.
 */
class ShellPrefs(context: Context) {
    private val sp = context.getSharedPreferences("lab-shell", Context.MODE_PRIVATE)

    /** More → Lab app → "Due-card notifications" (on by default, like the hybrid app). */
    var notificationsOn: Boolean
        get() = sp.getBoolean("notifications_on", true)
        set(v) = sp.edit().putBoolean("notifications_on", v).apply()

    /** The first-launch POST_NOTIFICATIONS request was made (never nag twice; the toggle asks again). */
    var askedPermission: Boolean
        get() = sp.getBoolean("asked_permission", false)
        set(v) = sp.edit().putBoolean("asked_permission", v).apply()

    /** Assignment ids already notified on [day] (local yyyy-MM-dd). */
    fun homeworkNotified(day: String): Set<String> =
        if (sp.getString("homework_notified_day", null) == day) sp.getStringSet("homework_notified", emptySet()).orEmpty() else emptySet()

    fun markHomeworkNotified(day: String, ids: Collection<String>) {
        val set = homeworkNotified(day) + ids
        sp.edit().putString("homework_notified_day", day).putStringSet("homework_notified", set).apply()
    }
}
