package dev.jeromeswannack.chineselearning.lab.data.feedback

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import dev.jeromeswannack.chineselearning.lab.BuildConfig
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.feedback.FeedbackRules
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.lang.ref.WeakReference
import java.util.UUID

/** The diagnostic context of a feedback item (shared/feedback FeedbackContext; the server filters it again). */
@Serializable
data class FeedbackContextDto(
    val platform: String = "lab",
    val app_version: String? = null,
    val screen: String? = null,
    val install_kind: String? = "lab",
    val device: String? = null,
    val os: String? = null,
    val online: Boolean? = null,
    val viewport: String? = null,
    val via: String? = null,
    val recent_events: List<String> = emptyList(),
) {
    fun line(): String = FeedbackRules.contextLine(platform, app_version, screen, device, os, online, via)
}

@Serializable
data class FeedbackBody(val message: String, val kind: String, val client_id: String, val context: FeedbackContextDto)

/** The sheet the app should show: how it was opened, the window as it was, where. */
data class FeedbackRequest(val id: String, val via: String, val screenshot: File?, val context: FeedbackContextDto)

sealed interface FeedbackSendResult {
    data object Sent : FeedbackSendResult
    data object Queued : FeedbackSendResult
    data class Failed(val message: String) : FeedbackSendResult
}

/** Settings → "Shake to send feedback" (per device, on by default). */
class FeedbackPrefs(context: Context) {
    private val sp = context.getSharedPreferences("lab_feedback", Context.MODE_PRIVATE)
    var shakeOn: Boolean
        get() = sp.getBoolean("shake_on", true)
        set(v) = sp.edit().putBoolean("shake_on", v).apply()
}

/**
 * In-app feedback in the Lab app (docs/FEEDBACK.md; the web's FeedbackProvider + services/feedback.ts):
 * [open] captures the app's own window (PixelCopy — no MediaProjection, no permission), then the shell
 * shows the sheet ([request]); [send] queues `POST /api/feedback` in the Outbox (multipart with the
 * screenshot, JSON without) under the item's client id — the server is idempotent by it — and drains
 * at once when online. Opened from a shake ([ShakeWatcher]), More, Settings.
 */
object FeedbackCenter {
    private val _request = MutableStateFlow<FeedbackRequest?>(null)
    val request: StateFlow<FeedbackRequest?> = _request
    @Volatile private var opening = false
    private var activity: WeakReference<Activity>? = null
    private val json = Json { explicitNulls = false; encodeDefaults = true }

    val isOpen: Boolean get() = _request.value != null || opening

    fun attach(a: Activity) { activity = WeakReference(a) }
    fun detach(a: Activity) { if (activity?.get() === a) activity = null }

    fun context(app: LabApp, via: String): FeedbackContextDto {
        val cfg = app.resources.configuration
        return FeedbackContextDto(
            app_version = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})".take(40),
            screen = app.analytics.currentScreen?.let(FeedbackRules::routePattern),
            device = (if (Build.MODEL.startsWith(Build.MANUFACTURER, ignoreCase = true)) Build.MODEL else "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}").take(80),
            os = "Android ${Build.VERSION.RELEASE}",
            online = app.online.value,
            viewport = "${cfg.screenWidthDp}x${cfg.screenHeightDp}",
            via = via,
            recent_events = app.analytics.recentEventNames().filter { EVENT.matches(it) }.takeLast(15),
        )
    }

    private val EVENT = Regex("^[a-z_]+\\.[a-z0-9_.]+$")

    /** Opens the sheet (once at a time), after a screenshot of the window as it is now. */
    fun open(app: LabApp, via: String) {
        if (isOpen) return
        opening = true
        app.analytics.track("feedback.open", mapOf("via" to via))
        val id = "fb_" + UUID.randomUUID().toString().replace("-", "")
        val ctx = context(app, via)
        val dir = File(app.cacheDir, "feedback").apply { mkdirs() }
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000 }?.forEach { it.delete() }
        capture(app, activity?.get(), File(dir, "$id.jpg")) { file ->
            _request.value = FeedbackRequest(id, via, file, ctx)
            opening = false
        }
    }

    /** Closes the sheet (the screenshot file goes; a queued copy lives in the Outbox's own folder). */
    fun dismiss() {
        _request.value?.screenshot?.delete()
        _request.value = null
    }

    /** The app's window into [out] as a JPEG (long edge ≤ 1600 px), or null. */
    private fun capture(app: LabApp, activity: Activity?, out: File, done: (File?) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        main.post {
            val window = activity?.window
            val view = window?.decorView
            if (window == null || view == null || view.width <= 0 || view.height <= 0 || activity.isFinishing) {
                done(null)
                return@post
            }
            val bitmap = try {
                Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            } catch (_: Throwable) {
                done(null)
                return@post
            }
            try {
                PixelCopy.request(window, bitmap, { result ->
                    if (result != PixelCopy.SUCCESS) {
                        bitmap.recycle()
                        done(null)
                        return@request
                    }
                    app.scope.launch(Dispatchers.IO) {
                        val file = runCatching { writeJpeg(bitmap, out) }.getOrNull()
                        bitmap.recycle()
                        withContext(Dispatchers.Main) { done(file) }
                    }
                }, main)
            } catch (_: Throwable) {
                bitmap.recycle()
                done(null)
            }
        }
    }

    private fun writeJpeg(bitmap: Bitmap, out: File): File {
        val long = maxOf(bitmap.width, bitmap.height)
        val scaled = if (long > MAX_EDGE) {
            val f = MAX_EDGE.toFloat() / long
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * f).toInt().coerceAtLeast(1), (bitmap.height * f).toInt().coerceAtLeast(1), true)
        } else bitmap
        out.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 82, it) }
        if (scaled !== bitmap) scaled.recycle()
        return out
    }

    /**
     * Queues the item and, when online, sends it now. A screenshot is copied into the Outbox's folder
     * (deleted once uploaded), so closing the sheet never loses it.
     */
    suspend fun send(app: LabApp, req: FeedbackRequest, message: String, kind: String, includeScreenshot: Boolean): FeedbackSendResult {
        val text = message.trim().take(FeedbackRules.MAX_MESSAGE)
        val shot = req.screenshot?.takeIf { includeScreenshot && it.exists() && it.length() > 0 }
        if (text.isEmpty() && shot == null) return FeedbackSendResult.Failed("Write a message or keep the screenshot.")
        return try {
            withContext(Dispatchers.IO) {
                if (shot != null) {
                    val staged = app.outbox.stageFile("screenshot.jpg")
                    shot.copyTo(staged, overwrite = true)
                    app.outbox.enqueueUpload(
                        kind = OUTBOX_KIND,
                        path = "/api/feedback",
                        file = staged,
                        fileField = "screenshot",
                        fileName = "screenshot.jpg",
                        mime = "image/jpeg",
                        fields = mapOf("message" to text, "kind" to kind, "client_id" to req.id, "context" to json.encodeToString(req.context)),
                        id = req.id,
                    )
                } else {
                    app.outbox.enqueueJson(OUTBOX_KIND, "POST", "/api/feedback", FeedbackBody(text, kind, req.id, req.context), id = req.id)
                }
            }
            app.analytics.track("feedback.sent", mapOf("via" to req.via, "kind" to kind, "has_screenshot" to (shot != null), "queued" to !app.online.value))
            app.scheduleBackgroundUpload()
            if (!app.online.value) return FeedbackSendResult.Queued
            withTimeoutOrNull(12_000) { runCatching { app.outbox.drain() } }
            val left = app.outbox.all().firstOrNull { it.id == req.id }
            when {
                left == null -> FeedbackSendResult.Sent
                left.state == Outbox.FAILED -> FeedbackSendResult.Failed(
                    left.lastError?.let { Regex("\"error\"\\s*:\\s*\"([^\"]{1,200})\"").find(it)?.groupValues?.get(1) } ?: "The server refused it.",
                )
                else -> FeedbackSendResult.Queued
            }
        } catch (e: Exception) {
            FeedbackSendResult.Failed(e.message ?: "Could not save the feedback.")
        }
    }

    const val OUTBOX_KIND = "feedback"
    private const val MAX_EDGE = 1600
}
