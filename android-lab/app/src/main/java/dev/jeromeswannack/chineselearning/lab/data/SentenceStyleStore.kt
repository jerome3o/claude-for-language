package dev.jeromeswannack.chineselearning.lab.data

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.SentenceStyle
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data class SentenceStyleBody(val sentence_style: String?)

/**
 * "Example sentence style" on this phone (core SentenceStyle, port of shared/study/sentenceStyle.ts; web
 * services/sentenceStyle.ts): the account's register for NEW example sentences (`users.sentence_style`, NULL =
 * everyday), from /api/auth/me and /api/sync/changes into Prefs ([Prefs.sentenceStyle] keeps [style] in step) so
 * Settings shows it offline. docs/STUDY_SESSION.md "Example sentence style".
 */
object SentenceStyleStore {
    /** The style in effect. Prefs sets it at start-up and on every change. */
    val style = MutableStateFlow(SentenceStyle.DEFAULT)

    /**
     * Settings → Study → "Example sentence style": Prefs at once (offline too), then the idempotent
     * `PUT /api/profile/sentence-style` through the Outbox. The default (everyday) is stored as NULL.
     */
    fun save(app: LabApp, next: String) {
        val before = style.value
        val chosen = SentenceStyle.of(next)
        if (chosen == before) return
        app.prefs.sentenceStyle = chosen
        Analytics.track("settings.sentence_style", mapOf("style" to chosen, "from" to before))
        app.scope.launch {
            runCatching {
                val body = SentenceStyleBody(if (chosen == SentenceStyle.DEFAULT) null else chosen)
                app.outbox.enqueueJson("settings", "PUT", "/api/profile/sentence-style", body, id = "sentence-style-${System.currentTimeMillis()}")
                if (app.online.value) app.outbox.drain() else app.scheduleBackgroundUpload()
            }
        }
    }
}
