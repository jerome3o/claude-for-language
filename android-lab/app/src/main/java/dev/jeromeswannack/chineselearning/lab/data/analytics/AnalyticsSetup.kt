package dev.jeromeswannack.chineselearning.lab.data.analytics

import android.app.Activity
import android.app.Application
import android.os.Bundle
import dev.jeromeswannack.chineselearning.lab.BuildConfig
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.put
import dev.jeromeswannack.chineselearning.lab.data.api.send
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.Serializable

@Serializable
data class AnalyticsPrefBody(val share_usage: Boolean)

/** `PUT /api/profile/analytics` — Settings → Advanced → "Share usage data". */
suspend fun Api.setShareUsage(on: Boolean): AnalyticsPrefBody = put("/api/profile/analytics", AnalyticsPrefBody(on))

/** `POST /api/me/usage-events` (shared USAGE_UPLOAD_PATH) with a prepared `{ events: [...] }` body → the HTTP status. */
suspend fun Api.uploadUsageEvents(bodyJson: String): Int = send("POST", "/api/me/usage-events", bodyJson).code

/** Builds and wires the app's [Analytics] (LabApp.onCreate). */
object AnalyticsSetup {
    fun create(app: LabApp): Analytics {
        val queue = RoomAnalyticsQueue(AnalyticsDatabase.open(app).events())
        @Suppress("OPT_IN_USAGE")
        val io = Dispatchers.IO.limitedParallelism(1)
        return Analytics(
            queue = queue,
            appVersion = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
            shareUsage = { app.prefs.shareUsage },
            scope = app.scope,
            io = io,
            canUpload = { app.online.value && app.repo.isSignedIn },
            uploader = { body -> app.repo.api.uploadUsageEvents(body) },
        )
    }

    /** Session start, foreground / background from the activities, sign-out, the sync step. */
    fun install(app: LabApp, analytics: Analytics) {
        Analytics.current = analytics
        app.repo.beforeSignOut += { analytics.beforeSignOut() }
        analytics.start()
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            private var started = 0
            override fun onActivityStarted(activity: Activity) {
                if (started++ == 0) analytics.onForeground()
            }

            override fun onActivityStopped(activity: Activity) {
                started = (started - 1).coerceAtLeast(0)
                if (started == 0) analytics.onBackground()
            }

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }
}

/** The sync step (data/platform/FeatureSyncs.kt): uploads the queue after every sync. */
object AnalyticsSync : FeatureSync {
    override suspend fun sync(ctx: SyncContext) {
        Analytics.current?.flush()
    }
}
