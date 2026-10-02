package dev.jeromeswannack.chineselearning.lab.data.chat

import android.app.Activity
import android.app.Application
import android.os.Bundle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Which chat is on screen, and whether the app is in the foreground — no notification for a
 * chat the person is looking at (docs/CHAT.md §5). The chat route sets [visibleConversation];
 * the activity callbacks set [foreground] (also what starts / stops the live socket).
 */
object ChatPresence {
    private val _visible = MutableStateFlow<String?>(null)
    val visibleConversation: StateFlow<String?> = _visible

    private val _foreground = MutableStateFlow(false)
    val foreground: StateFlow<Boolean> = _foreground

    fun chatOpened(conversationId: String) { _visible.value = conversationId }

    fun chatClosed(conversationId: String) { _visible.compareAndSet(conversationId, null) }

    /** The chat for [conversationId] is on screen right now. */
    fun isShowing(conversationId: String): Boolean = _foreground.value && _visible.value == conversationId

    fun setForeground(value: Boolean) { _foreground.value = value }

    /** Counts started activities: one or more = the app is in the foreground. */
    fun track(app: Application) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            private var started = 0
            override fun onActivityStarted(activity: Activity) { started++; setForeground(true) }
            override fun onActivityStopped(activity: Activity) { started = (started - 1).coerceAtLeast(0); if (started == 0) setForeground(false) }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityResumed(activity: Activity) = Unit
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
    }
}
