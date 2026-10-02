package dev.jeromeswannack.chineselearning.lab.data.chat

import android.content.Context
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import dev.jeromeswannack.chineselearning.lab.BuildConfig
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.PUSH_DEVICES_PATH
import dev.jeromeswannack.chineselearning.lab.data.api.PushDeviceBody
import dev.jeromeswannack.chineselearning.lab.data.api.PushDeviceTokenBody
import dev.jeromeswannack.chineselearning.lab.data.api.send
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.security.MessageDigest

/**
 * Firebase Cloud Messaging, only when the build has a Firebase config (android-lab/PUSH.md):
 * app/google-services.json → BuildConfig.FCM_* at build time; without it every call here is a
 * no-op and chat notifications come from the live socket + the 15-minute inbox check.
 *
 * Firebase is initialised by hand ([init]) — the google-services plugin and the auto
 * FirebaseInitProvider are off. The token goes to `POST /api/push/devices` through the outbox
 * (survives offline), after sign-in, on [LabMessagingService.onNewToken] and once a day;
 * sign-out sends `DELETE /api/push/devices` while the session is still valid.
 */
object PushRegistration {
    const val KIND = "push_device"
    private const val DAY_MS = 24 * 60 * 60 * 1000L

    val configured: Boolean
        get() = BuildConfig.FCM_APP_ID.isNotEmpty() && BuildConfig.FCM_API_KEY.isNotEmpty() && BuildConfig.FCM_PROJECT_ID.isNotEmpty() && !isRobolectric

    private val isRobolectric get() = Build.FINGERPRINT == "robolectric"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("lab_push", Context.MODE_PRIVATE)

    /** Initialises Firebase from BuildConfig; false when not configured or it failed. */
    fun init(ctx: Context): Boolean {
        if (!configured) return false
        return runCatching {
            if (FirebaseApp.getApps(ctx).isEmpty()) {
                val options = FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FCM_APP_ID)
                    .setApiKey(BuildConfig.FCM_API_KEY)
                    .setProjectId(BuildConfig.FCM_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
                    .build()
                FirebaseApp.initializeApp(ctx, options)
            }
            true
        }.onFailure { android.util.Log.w("PushRegistration", "Firebase init failed", it) }.getOrDefault(false)
    }

    /** Fetches the FCM token and registers it — at most once a day unless [force]. */
    fun ensure(app: LabApp, force: Boolean = false) {
        if (!init(app) || !app.repo.isSignedIn) return
        val last = prefs(app).getLong("registered_at", 0)
        if (!force && System.currentTimeMillis() - last < DAY_MS) return
        runCatching {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                val token = if (task.isSuccessful) task.result else null
                if (token.isNullOrEmpty()) {
                    android.util.Log.w("PushRegistration", "no FCM token", task.exception)
                    return@addOnCompleteListener
                }
                app.scope.launch { register(app, token) }
            }
        }.onFailure { android.util.Log.w("PushRegistration", "token request failed", it) }
    }

    /** Queues `POST /api/push/devices { token }` (upsert by token, so replays are harmless). */
    suspend fun register(app: LabApp, token: String) {
        prefs(app).edit().putString("token", token).apply()
        if (!app.repo.isSignedIn) return // registered after sign-in
        app.outbox.enqueueJson(KIND, "POST", PUSH_DEVICES_PATH, PushDeviceBody(token, device_label = Build.MODEL), id = "push-device-" + hash(token))
        prefs(app).edit().putLong("registered_at", System.currentTimeMillis()).apply()
        ChatActions.flush(app)
    }

    /** Sign-out (before the session is cleared): best effort, this device stops getting pushes. */
    suspend fun unregister(app: LabApp) {
        val p = prefs(app)
        val token = p.getString("token", null)
        p.edit().remove("registered_at").apply()
        if (token == null || !app.repo.isSignedIn) return
        withTimeoutOrNull(5_000) {
            runCatching { app.repo.api.send("DELETE", PUSH_DEVICES_PATH, app.repo.api.json.encodeToString(PushDeviceTokenBody.serializer(), PushDeviceTokenBody(token))) }
        }
    }

    private fun hash(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).take(8).joinToString("") { "%02x".format(it) }
}
