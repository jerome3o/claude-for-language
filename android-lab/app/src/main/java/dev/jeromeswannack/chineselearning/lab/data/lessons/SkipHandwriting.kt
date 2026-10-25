package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data class SkipHandwritingBody(val skip_handwriting: Boolean)

/**
 * "Skip handwriting exercises" on this phone (core Handwriting; web services/skipHandwriting.ts):
 * the account switch `users.skip_handwriting`, cached in Prefs ([state] follows it) so a lesson
 * played offline follows it. Saving writes Prefs at once and queues the idempotent
 * `PUT /api/profile/skip-handwriting` through the Outbox (offline-first).
 */
object SkipHandwriting {
    /** The switch as the lesson lists and players see it (Prefs keeps it; false in plain data tests). */
    val state = MutableStateFlow(false)

    /** Settings / a row's menu (source = settings | row_menu | undo). */
    fun save(app: LabApp, on: Boolean, source: String) {
        app.prefs.skipHandwriting = on
        Analytics.track("settings.skip_handwriting", mapOf("on" to on, "source" to source))
        app.scope.launch {
            runCatching {
                app.outbox.enqueueJson("settings", "PUT", "/api/profile/skip-handwriting", SkipHandwritingBody(on), id = "skip-handwriting-${System.currentTimeMillis()}")
                if (app.online.value) app.outbox.drain() else app.scheduleBackgroundUpload()
            }
        }
    }
}
