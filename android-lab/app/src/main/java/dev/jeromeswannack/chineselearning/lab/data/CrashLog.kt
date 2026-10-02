package dev.jeromeswannack.chineselearning.lab.data

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Crashes made visible to us (there is no other crash reporting): an uncaught exception's
 * stack trace is written to a file before the process dies, and the system's own record of
 * how the last runs ended (ApplicationExitInfo: crashes, native crashes, ANRs with their
 * thread dump) is read on the next start. Both ride along in the next debug report
 * (DebugReport.kt → POST /api/debug/reports, `crashes`), then are forgotten.
 *
 * Everything here swallows its own failures — crash reporting must never cause a crash.
 */
object CrashLog {
    private const val TAG = "LabCrash"
    private const val DIR = "crash"
    private const val MAX_TRACE = 12_000
    private const val PREFS = "lab_crash"
    private const val EXIT_SEEN = "exit_seen_ms"

    /** Where crashes are sent (POST /api/debug/crash). Tests point it at a MockWebServer. */
    @Volatile
    internal var apiBase: String = dev.jeromeswannack.chineselearning.lab.Config.API_BASE

    /** How long the dying process waits for the crash upload before it hands on to the platform. */
    internal const val UPLOAD_WAIT_MS = 3_000L

    /** Installs the handler (once per process) in front of the platform's. */
    fun install(context: Context, appVersion: String) {
        val app = context.applicationContext ?: context
        val dir = File(app.filesDir, DIR)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        if (previous is Handler) return
        Thread.setDefaultUncaughtExceptionHandler(Handler(app, dir, appVersion, previous))
    }

    private class Handler(val context: Context, val dir: File, val version: String, val previous: Thread.UncaughtExceptionHandler?) : Thread.UncaughtExceptionHandler {
        override fun uncaughtException(t: Thread, e: Throwable) {
            try {
                val text = write(dir, version, t.name, e)
                if (text != null) writeLast(context, text)
            } catch (_: Throwable) {
            }
            // Send it NOW, while the process is still alive (a crash at launch never gets to a
            // later sync): a blocking POST on its own thread, at most UPLOAD_WAIT_MS.
            try {
                uploadBlocking(context, version, UPLOAD_WAIT_MS)
            } catch (_: Throwable) {
            }
            previous?.uncaughtException(t, e)
        }
    }

    /** A caught failure worth telling us about (a background job that would have crashed the app). */
    fun recordNonFatal(context: Context, appVersion: String, e: Throwable) {
        try {
            write(File(context.filesDir, DIR), appVersion, "non-fatal: " + Thread.currentThread().name, e)
        } catch (_: Throwable) {
        }
    }

    internal fun write(dir: File, version: String, thread: String, e: Throwable): String? {
        val sw = StringWriter()
        e.printStackTrace(PrintWriter(sw))
        return writeText(dir, "uncaught", version, thread, sw.toString())
    }

    /** One file per crash / freeze (a crash loop keeps the first few, not just the last). Returns the text written. */
    internal fun writeText(dir: File, prefix: String, version: String, thread: String, trace: String): String? {
        dir.mkdirs()
        val text = buildString {
            append(System.currentTimeMillis()).append('\n')
            append(version).append('\n')
            append(thread).append('\n')
            append(trace.take(MAX_TRACE))
        }
        val files = dir.listFiles().orEmpty()
        if (files.size >= 5) return text
        File(dir, "$prefix-${System.currentTimeMillis()}-${System.nanoTime()}.txt").writeText(text)
        return text
    }

    /** Pending uncaught-exception files plus new system exit records, as report JSON (empty = nothing to tell). */
    fun pending(context: Context): JsonArray = buildJsonArray {
        try {
            File(context.filesDir, DIR).listFiles().orEmpty().sortedBy { it.name }.forEach { f ->
                runCatching {
                    val lines = f.readText().split('\n', limit = 4)
                    add(buildJsonObject {
                        put("id", f.name.removeSuffix(".txt"))
                        put("source", if (f.name.startsWith("freeze")) "freeze" else "uncaught")
                        put("at", Js_iso(lines.getOrNull(0)?.toLongOrNull() ?: f.lastModified()))
                        put("app_version", lines.getOrNull(1) ?: "")
                        put("thread", lines.getOrNull(2) ?: "")
                        put("trace", lines.getOrNull(3) ?: "")
                    })
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "reading crash files failed", e)
        }
        try {
            for (info in exitInfos(context)) add(info)
        } catch (e: Throwable) {
            Log.w(TAG, "reading exit reasons failed", e)
        }
    }

    private fun exitInfos(context: Context): List<kotlinx.serialization.json.JsonObject> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
        val am = context.getSystemService(ActivityManager::class.java) ?: return emptyList()
        val seen = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(EXIT_SEEN, 0)
        // Every way the system ended us that isn't the user or an update (low memory, freezer… say a lot too).
        val wanted = setOf(0, 2, 3, 4, 5, 6, 7, 9, 12, 13, 14)
        return am.getHistoricalProcessExitReasons(context.packageName, 0, 10)
            .filter { it.timestamp > seen && it.reason in wanted }
            .map { info ->
                val trace = if (info.reason == ApplicationExitInfo.REASON_ANR || info.reason == ApplicationExitInfo.REASON_CRASH_NATIVE) {
                    runCatching { info.traceInputStream?.use { s -> String(s.readNBytesCompat(MAX_TRACE)) } }.getOrNull()
                } else null
                buildJsonObject {
                    put("id", "exit-${info.timestamp}-${info.pid}")
                    put("source", "exit_info")
                    put("at", Js_iso(info.timestamp))
                    put("reason", reasonName(info.reason))
                    put("description", info.description ?: "")
                    put("importance", info.importance)
                    put("pss_kb", info.pss)
                    put("rss_kb", info.rss)
                    put("process", info.processName ?: "")
                    if (trace != null) put("trace", trace)
                }
            }
    }

    private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(4096)
        while (out.size() < max) {
            val n = read(buf, 0, minOf(buf.size, max - out.size()))
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    private fun reasonName(r: Int) = when (r) {
        0 -> "unknown"
        2 -> "signaled"
        3 -> "low_memory"
        4 -> "crash"
        5 -> "crash_native"
        6 -> "anr"
        7 -> "initialization_failure"
        9 -> "excessive_resource_usage"
        12 -> "dependency_died"
        13 -> "other"
        14 -> "freezer"
        else -> "reason_$r"
    }

    /** After a report carrying [pending] was accepted: forget what it carried. */
    fun clear(context: Context) {
        try {
            File(context.filesDir, DIR).listFiles().orEmpty().forEach { it.delete() }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val am = context.getSystemService(ActivityManager::class.java)
                val newest = am?.getHistoricalProcessExitReasons(context.packageName, 0, 1)?.firstOrNull()?.timestamp ?: 0
                if (newest > 0) context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(EXIT_SEEN, newest).apply()
            }
        } catch (_: Throwable) {
        }
    }

    /** True when an uncaught crash was recorded and not reported yet. */
    fun hasPendingUncaught(context: Context): Boolean =
        runCatching { File(context.filesDir, DIR).listFiles().orEmpty().isNotEmpty() }.getOrDefault(false)

    // ---------------------------------------------------------------------------------------
    // Immediate upload (POST /api/debug/crash): a crash at launch never reaches a later sync.
    // ---------------------------------------------------------------------------------------

    private val uploadLock = Any()

    /**
     * Sends everything pending (crash / freeze files + new exit records) to the server now, on
     * the calling thread, and forgets it on a 2xx. Returns true when there was nothing to send
     * or it was accepted. Never throws. Must not run on the main thread (network).
     */
    fun uploadNow(context: Context, appVersion: String): Boolean = try {
        synchronized(uploadLock) {
            val items = pending(context)
            if (items.isEmpty()) {
                true
            } else {
                val ok = post(context, appVersion, items)
                if (ok) clearSent(context, items)
                ok
            }
        }
    } catch (e: Throwable) {
        Log.w(TAG, "crash upload failed", e)
        false
    }

    /** [uploadNow] on its own thread, waiting at most [waitMs] (the uncaught handler: the process is about to die). */
    fun uploadBlocking(context: Context, appVersion: String, waitMs: Long) {
        val t = Thread({ uploadNow(context, appVersion) }, "lab-crash-upload")
        t.isDaemon = true
        t.start()
        t.join(waitMs)
    }

    /** At start-up, before any UI: last run's crash files and the system's exit records go up in the background. */
    fun uploadInBackground(context: Context, appVersion: String) {
        val app = context.applicationContext ?: context
        val t = Thread({
            try {
                rememberExitForScreen(app)
            } catch (_: Throwable) {
            }
            uploadNow(app, appVersion)
        }, "lab-crash-startup-upload")
        t.isDaemon = true
        t.start()
    }

    /** POST {client, app_version, device, crashes} with the stored session token. */
    private fun post(context: Context, appVersion: String, items: JsonArray): Boolean {
        val token = context.getSharedPreferences("lab", Context.MODE_PRIVATE).getString("session_token", null) ?: return false
        val body = buildJsonObject {
            put("client", "lab")
            put("app_version", appVersion)
            put("device", "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
            put("crashes", items)
        }.toString().toByteArray(Charsets.UTF_8)
        val conn = java.net.URL("$apiBase/api/debug/crash").openConnection() as java.net.HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 2_500
            conn.readTimeout = 2_500
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    }

    /** Forget exactly what [items] carried (files written meanwhile stay for the next upload). */
    private fun clearSent(context: Context, items: JsonArray) {
        val ids = items.mapNotNull { ((it as? JsonObject)?.get("id") as? JsonPrimitive)?.content }.toSet()
        File(context.filesDir, DIR).listFiles().orEmpty().forEach { f -> if (f.name.removeSuffix(".txt") in ids) f.delete() }
        val newestExit = ids.filter { it.startsWith("exit-") }.mapNotNull { it.split('-').getOrNull(1)?.toLongOrNull() }.maxOrNull() ?: return
        val sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (newestExit > sp.getLong(EXIT_SEEN, 0)) sp.edit().putLong(EXIT_SEEN, newestExit).apply()
    }

    // ---------------------------------------------------------------------------------------
    // "Last crash / freeze" screen (LastCrashActivity): the trace of the previous run's crash
    // or freeze, shown once on the next open, before the app's own UI.
    // ---------------------------------------------------------------------------------------

    private const val LAST_FILE = "lab_last_crash.txt"
    private const val SCREEN_SEEN = "screen_seen_ms"
    private val FATAL_EXITS = setOf(ApplicationExitInfo.REASON_ANR, ApplicationExitInfo.REASON_CRASH, ApplicationExitInfo.REASON_CRASH_NATIVE)

    /** Keeps the newest fatal trace (crash / freeze / ANR) outside the upload queue, for the screen. */
    internal fun writeLast(context: Context, text: String) {
        try {
            File(context.filesDir, LAST_FILE).writeText(text)
        } catch (_: Throwable) {
        }
    }

    /** The system's record of an ANR / crash in the last run (it has the ANR's thread dump) → the screen's text. */
    private fun rememberExitForScreen(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val am = context.getSystemService(ActivityManager::class.java) ?: return
        val seen = maxOf(lastShownAt(context), lastFileAt(context))
        val info = am.getHistoricalProcessExitReasons(context.packageName, 0, 5)
            .firstOrNull { it.timestamp > seen && it.reason in FATAL_EXITS }
            ?: return
        val trace = runCatching { info.traceInputStream?.use { s -> String(s.readNBytesCompat(MAX_TRACE)) } }.getOrNull()
        writeLast(context, buildString {
            append(info.timestamp).append('\n')
            append("(previous run)").append('\n')
            append("system: ").append(reasonName(info.reason)).append('\n')
            append(info.description ?: "").append('\n')
            if (trace != null) append(trace)
        })
    }

    private fun lastShownAt(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(SCREEN_SEEN, 0)

    private fun lastFileAt(context: Context): Long = runCatching {
        File(context.filesDir, LAST_FILE).takeIf { it.exists() }?.useLines { it.firstOrNull()?.toLongOrNull() } ?: 0L
    }.getOrDefault(0L)

    /**
     * True when the previous run ended in a crash / freeze the person hasn't seen yet. Cheap
     * (small file reads + the system's exit list, no trace): MainActivity asks before its UI.
     */
    fun hasUnseenCrash(context: Context): Boolean = try {
        val shown = lastShownAt(context)
        lastFileAt(context) > shown || fatalFiles(context).any { it.first > shown } || unseenExit(context, shown)
    } catch (_: Throwable) {
        false
    }

    private fun unseenExit(context: Context, shown: Long): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        val am = context.getSystemService(ActivityManager::class.java) ?: return false
        return am.getHistoricalProcessExitReasons(context.packageName, 0, 3).any { it.timestamp > shown && it.reason in FATAL_EXITS }
    }

    /** Pending crash / freeze files (not the non-fatal ones), newest first: (time, text). */
    private fun fatalFiles(context: Context): List<Pair<Long, String>> =
        File(context.filesDir, DIR).listFiles().orEmpty().mapNotNull { f ->
            runCatching {
                val text = f.readText()
                val lines = text.split('\n', limit = 4)
                if (lines.getOrNull(2)?.startsWith("non-fatal") == true) null
                else (lines.getOrNull(0)?.toLongOrNull() ?: f.lastModified()) to text
            }.getOrNull()
        }.sortedByDescending { it.first }

    /** The text for the screen (call off the main thread: it may read the system's ANR dump). */
    fun lastCrashText(context: Context): String {
        try {
            rememberExitForScreen(context)
        } catch (_: Throwable) {
        }
        val shown = lastShownAt(context)
        val candidates = buildList {
            runCatching { File(context.filesDir, LAST_FILE).takeIf { it.exists() }?.readText() }.getOrNull()
                ?.let { add((it.substringBefore('\n').toLongOrNull() ?: 0L) to it) }
            addAll(runCatching { fatalFiles(context) }.getOrDefault(emptyList()))
        }.filter { it.first > shown }.sortedByDescending { it.first }
        val newest = candidates.firstOrNull() ?: return "No crash recorded."
        val lines = newest.second.split('\n', limit = 4)
        return buildString {
            append("When: ").append(Js_iso(newest.first)).append('\n')
            append("Version: ").append(lines.getOrNull(1) ?: "?").append('\n')
            append("Thread: ").append(lines.getOrNull(2) ?: "?").append("\n\n")
            append(lines.getOrNull(3) ?: "")
        }
    }

    /** "Continue": the screen isn't shown again for what it showed. */
    fun markCrashSeen(context: Context) {
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(SCREEN_SEEN, System.currentTimeMillis()).commit()
        } catch (_: Throwable) {
        }
    }

    /** "Send to Claude": the shown text as its own crash entry, uploaded now (with anything else pending). Off the main thread. */
    fun sendShown(context: Context, appVersion: String, text: String): Boolean = try {
        val item = buildJsonObject {
            put("id", "screen-" + Integer.toHexString(text.hashCode()))
            put("source", "last_crash_screen")
            put("at", Js_iso(System.currentTimeMillis()))
            put("app_version", appVersion)
            put("trace", text.take(MAX_TRACE))
        }
        val ok = post(context, appVersion, JsonArray(listOf(item)))
        uploadNow(context, appVersion)
        ok
    } catch (_: Throwable) {
        false
    }

    // ---------------------------------------------------------------------------------------
    // Freeze watchdog: an ANR has no exception, so the uncaught handler never sees it. A
    // daemon thread posts a no-op to the main thread every FREEZE_MS; when it hasn't run by
    // the next check the main thread is stuck, so its stack (and every other thread's) is
    // written and POSTed from the watchdog thread, which isn't blocked.
    // ---------------------------------------------------------------------------------------

    internal const val FREEZE_MS = 2_000L

    @Volatile
    private var watchdog: Thread? = null

    fun startFreezeWatchdog(context: Context, appVersion: String) {
        if (watchdog != null || Build.FINGERPRINT == "robolectric") return
        val app = context.applicationContext ?: context
        val main = android.os.Handler(android.os.Looper.getMainLooper())
        val t = Thread({
            var reported = 0
            while (true) {
                val ran = java.util.concurrent.atomic.AtomicBoolean(false)
                main.post { ran.set(true) }
                Thread.sleep(FREEZE_MS)
                if (ran.get()) continue
                val started = System.currentTimeMillis() - FREEZE_MS
                if (reported < 3) {
                    reported++
                    try {
                        val text = writeText(File(app.filesDir, DIR), "freeze", appVersion, "main (no response for ${FREEZE_MS / 1000}s+)", freezeDump())
                        if (text != null) writeLast(app, text)
                        uploadNow(app, appVersion)
                    } catch (_: Throwable) {
                    }
                }
                // One report per freeze: wait for the main thread to come back.
                while (!ran.get()) Thread.sleep(250)
                Log.w(TAG, "main thread was frozen for ${System.currentTimeMillis() - started} ms")
            }
        }, "lab-freeze-watchdog")
        t.isDaemon = true
        watchdog = t
        t.start()
    }

    /** The main thread's stack first, then every other live thread's. */
    internal fun freezeDump(): String = buildString {
        val mainThread = android.os.Looper.getMainLooper().thread
        append("FROZEN main thread (state ").append(mainThread.state).append("):\n")
        mainThread.stackTrace.forEach { append("    at ").append(it).append('\n') }
        append("\nOther threads:\n")
        Thread.getAllStackTraces().entries.filter { it.key !== mainThread && it.value.isNotEmpty() }
            .sortedBy { it.key.name }
            .forEach { (th, st) ->
                append('"').append(th.name).append("\" ").append(th.state).append('\n')
                st.take(25).forEach { append("    at ").append(it).append('\n') }
            }
    }

    @Suppress("FunctionName")
    private fun Js_iso(ms: Long): String = dev.jeromeswannack.chineselearning.lab.core.Js.toIsoString(ms)
}
