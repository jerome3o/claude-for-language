package dev.jeromeswannack.chineselearning.lab.data.analytics

import android.util.Log
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.analytics.AnalyticsEvents
import dev.jeromeswannack.chineselearning.lab.core.analytics.AnalyticsPrivacy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.util.UUID

/**
 * Usage analytics (docs/ANALYTICS.md; web: services/analytics.ts) — which screens and features
 * are used, so the admin can ask "has Minghui used feature X?". NEVER messages, cards,
 * answers or recordings: every event goes through the shared catalogue
 * ([AnalyticsEvents], unknown names ignored) and privacy filter
 * ([AnalyticsPrivacy.sanitizeProps]) BEFORE it is queued.
 *
 *   app.analytics.track("study.card_rated", mapOf("rating" to "good", "card_type" to type))
 *   app.analytics.screen("decks/{id}")   // the shell does this on every route change
 *
 * Context on every event: platform "lab", app_version, session_id (new at process start and
 * after 30 min in the background — each new session emits `app.open`), the current screen.
 * Events wait in their own small Room queue ([AnalyticsQueue]) and go up in batches of ≤ 500
 * during every sync ([AnalyticsSync]) and every minute while the app is in front and online.
 * Opt-out ([shareUsage] false: Settings → Advanced, mirrored from /api/auth/me) records
 * nothing and clears the queue.
 *
 * Analytics can never crash or slow the app: [track] / [screen] do no I/O on the caller's
 * thread, and every step is wrapped (failures are logged, never thrown).
 */
class Analytics(
    private val queue: AnalyticsQueue,
    private val appVersion: String,
    /** The `share_usage` pref (default true). */
    private val shareUsage: () -> Boolean,
    /** Background scope for queue writes and the foreground upload loop. */
    private val scope: CoroutineScope,
    /** Queue writes run here one at a time (keeps their order; never the UI thread). */
    private val io: CoroutineDispatcher,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
    /** Online and signed in: the foreground loop only uploads then. */
    private val canUpload: () -> Boolean = { true },
    /** POSTs the body to /api/analytics/events and returns the HTTP status (throws IOException offline). */
    private val uploader: suspend (String) -> Int = { 0 },
    private val debugLog: (String) -> Unit = { Log.d(TAG, it) },
) {
    @Volatile var sessionId: String = newId()
        private set

    /** The screen on top (route pattern, `screenName()`), null before the first one. */
    @Volatile var currentScreen: String? = null
        private set
    private var screenSince: Long? = null
    private var backgroundAt: Long? = null
    private var foregroundLoop: Job? = null
    private val flushLock = Mutex()

    /** Starts the first session (LabApp.onCreate). */
    fun start() = safe("start") { track("app.open", mapOf("install_kind" to "lab")) }

    /**
     * Records [event] with [props] (ids, enums, counts, booleans — anything else is dropped by
     * the privacy filter). Unknown or server-only names are ignored. Never throws, never blocks.
     */
    fun track(event: String, props: Map<String, Any?> = emptyMap()) = safe("track") {
        if (!shareUsage()) return@safe
        if (!AnalyticsEvents.isClientEvent(event)) {
            debugLog("ignored unknown analytics event $event")
            return@safe
        }
        val now = clock()
        val id = newId()
        val json = wireJson(id, now, event, currentScreen, AnalyticsPrivacy.sanitizeProps(event, props))
        scope.launch(io) { safeSuspend("queue") { queue.add(id, json, now) } }
    }

    private var currentKey: String? = null

    /**
     * The route on top changed ([route] = the Lab route pattern or a web path; [key] = what
     * makes it a different screen, e.g. the full path, so deck A → deck B counts). Records
     * `app.screen_view` for the screen being LEFT with the time spent on it.
     */
    @Synchronized
    fun screen(route: String, key: String = route) = safe("screen") {
        val name = AnalyticsPrivacy.screenName(if (route.startsWith("/")) route else "/$route")
        if (key == currentKey && screenSince != null) return@safe
        leaveScreen()
        currentScreen = name
        currentKey = key
        screenSince = clock()
    }

    /** The app went to the background: the screen on top gets its time; the upload loop stops. */
    @Synchronized
    fun onBackground() = safe("background") {
        leaveScreen()
        backgroundAt = clock()
        foregroundLoop?.cancel()
        foregroundLoop = null
    }

    /** The app came to the front: a new session after 30 min away; the minute upload loop starts. */
    @Synchronized
    fun onForeground() = safe("foreground") {
        val away = backgroundAt?.let { clock() - it }
        backgroundAt = null
        if (away != null && away >= SESSION_GAP_MS) {
            sessionId = newId()
            track("app.open", mapOf("install_kind" to "lab"))
        }
        if (currentScreen != null) screenSince = clock()
        if (foregroundLoop?.isActive != true) {
            foregroundLoop = scope.launch {
                while (isActive) {
                    delay(UPLOAD_EVERY_MS)
                    if (canUpload()) flush()
                }
            }
        }
    }

    private fun leaveScreen() {
        val name = currentScreen ?: return
        val since = screenSince ?: return
        screenSince = null
        // `screen` on this event is still [name]: track reads currentScreen before the caller replaces it.
        if (name.isNotEmpty()) track("app.screen_view", mapOf("duration_ms" to (clock() - since).coerceAtLeast(0)))
    }

    /**
     * Uploads the queue in batches of ≤ [MAX_PER_UPLOAD]. A 2xx deletes the batch; a 4xx other
     * than 408 / 429 drops it (it can never succeed); anything else (offline, 5xx) keeps it for
     * the next try. Opted out → the queue is cleared instead. Returns how many were uploaded.
     */
    suspend fun flush(): Int = flushLock.withLock {
        var sent = 0
        safeSuspend("flush") {
            withContext(io) {
                if (!shareUsage()) {
                    queue.clear()
                    return@withContext
                }
                repeat(MAX_BATCHES_PER_FLUSH) {
                    val rows = queue.oldest(MAX_PER_UPLOAD)
                    if (rows.isEmpty()) return@withContext
                    val body = rows.joinToString(",", prefix = "{\"events\":[", postfix = "]}") { it.json }
                    val status = try {
                        uploader(body)
                    } catch (e: IOException) {
                        return@withContext // offline: keep everything
                    }
                    when {
                        status in 200..299 -> {
                            queue.remove(rows.map { it.seq })
                            sent += rows.size
                        }
                        status in 400..499 && status != 408 && status != 429 -> {
                            debugLog("analytics batch refused ($status) — dropped ${rows.size}")
                            queue.remove(rows.map { it.seq })
                        }
                        else -> return@withContext
                    }
                    if (rows.size < MAX_PER_UPLOAD) return@withContext
                }
            }
        }
        sent
    }

    /**
     * Turning sharing OFF: the `settings.analytics {on:false}` event is recorded and the queue
     * flushed first (best effort, a few seconds), then [persist] stores the choice and the
     * queue is cleared. Turning it ON stores it, then records `settings.analytics {on:true}`.
     */
    suspend fun changeSharing(on: Boolean, persist: (Boolean) -> Unit) {
        if (on) {
            persist(true)
            track("settings.analytics", mapOf("on" to true))
            return
        }
        track("settings.analytics", mapOf("on" to false))
        withTimeoutOrNull(5_000) {
            withContext(io) { } // the event above is queued
            if (canUpload()) flush()
        }
        persist(false)
        safeSuspend("clear") { withContext(io) { queue.clear() } }
    }

    /** Sign-out: try to send this account's events, then forget the rest (never another account's). */
    suspend fun beforeSignOut() {
        withTimeoutOrNull(5_000) { if (canUpload()) flush() }
        safeSuspend("clear") { withContext(io) { queue.clear() } }
    }

    suspend fun queuedCount(): Int = safeSuspendOr(0) { withContext(io) { queue.count() } }

    private fun wireJson(id: String, now: Long, event: String, screen: String?, props: Map<String, Any?>): String =
        buildJsonObject {
            put("id", id)
            put("ts", Js.toIsoString(now))
            put("event", event)
            if (screen != null) put("screen", screen)
            if (props.isNotEmpty()) put("props", JsonObject(props.mapValues { (_, v) -> toJson(v) }))
            put("session_id", sessionId)
            put("platform", PLATFORM)
            put("app_version", appVersion)
        }.toString()

    private fun toJson(v: Any?) = when (v) {
        null -> JsonNull
        is Boolean -> JsonPrimitive(v)
        is Double -> if (v == Math.rint(v) && Math.abs(v) < 1e15) JsonPrimitive(v.toLong()) else JsonPrimitive(v)
        is Number -> JsonPrimitive(v)
        else -> JsonPrimitive(v.toString())
    }

    private inline fun safe(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Throwable) {
            runCatching { Log.w(TAG, "analytics $what failed", e) }
        }
    }

    private suspend fun safeSuspend(what: String, block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            runCatching { Log.w(TAG, "analytics $what failed", e) }
        }
    }

    private suspend fun <T> safeSuspendOr(fallback: T, block: suspend () -> T): T = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        fallback
    }

    companion object {
        /** The app's instance once LabApp has started (null in plain unit tests / previews). */
        @Volatile var current: Analytics? = null

        /** [track] on the app's instance from anywhere (a no-op before start-up / in previews). */
        fun track(event: String, props: Map<String, Any?> = emptyMap()) {
            current?.track(event, props)
        }

        /**
         * `error.shown` props for an error sentence the app shows: a code and the HTTP status,
         * never the sentence itself (it may quote the server or the user).
         */
        fun errorProps(text: String, where: String): Map<String, Any?> {
            val status = Regex("\\(([0-9]{3})\\)").find(text)?.groupValues?.get(1)?.toIntOrNull()
            val t = text.lowercase()
            val code = when {
                "no connection" in t || "offline" in t || "online" in t -> "offline"
                "signed out" in t || "sign in" in t -> "signed_out"
                status != null && status >= 500 -> "server"
                status != null -> "http_$status"
                "isn't there" in t || "not found" in t -> "not_found"
                "access" in t -> "forbidden"
                "couldn't" in t || "could not" in t || "failed" in t -> "failed"
                else -> "other"
            }
            return mapOf("code" to code, "where" to where, "status" to status)
        }

        private const val TAG = "Analytics"
        const val PLATFORM = "lab"
        /** A new analytics session after this long in the background (shared rule, docs/ANALYTICS.md). */
        const val SESSION_GAP_MS = 30 * 60_000L
        const val UPLOAD_EVERY_MS = 60_000L
        /** shared/analytics/wire.ts MAX_EVENTS_PER_UPLOAD. */
        const val MAX_PER_UPLOAD = 500
        private const val MAX_BATCHES_PER_FLUSH = 20
    }
}
