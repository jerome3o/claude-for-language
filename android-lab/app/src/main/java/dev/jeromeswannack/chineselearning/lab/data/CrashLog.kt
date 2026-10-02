package dev.jeromeswannack.chineselearning.lab.data

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.serialization.json.JsonArray
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

    /** Installs the handler (once per process) in front of the platform's. */
    fun install(context: Context, appVersion: String) {
        val dir = File(context.filesDir, DIR)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        if (previous is Handler) return
        Thread.setDefaultUncaughtExceptionHandler(Handler(dir, appVersion, previous))
    }

    private class Handler(val dir: File, val version: String, val previous: Thread.UncaughtExceptionHandler?) : Thread.UncaughtExceptionHandler {
        override fun uncaughtException(t: Thread, e: Throwable) {
            try {
                write(dir, version, t.name, e)
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

    internal fun write(dir: File, version: String, thread: String, e: Throwable) {
        dir.mkdirs()
        val sw = StringWriter()
        e.printStackTrace(PrintWriter(sw))
        val text = buildString {
            append(System.currentTimeMillis()).append('\n')
            append(version).append('\n')
            append(thread).append('\n')
            append(sw.toString().take(MAX_TRACE))
        }
        // One file per crash (a crash loop keeps the first few, not just the last).
        val files = dir.listFiles().orEmpty()
        if (files.size >= 5) return
        File(dir, "uncaught-${System.currentTimeMillis()}-${System.nanoTime()}.txt").writeText(text)
    }

    /** Pending uncaught-exception files plus new system exit records, as report JSON (empty = nothing to tell). */
    fun pending(context: Context): JsonArray = buildJsonArray {
        try {
            File(context.filesDir, DIR).listFiles().orEmpty().sortedBy { it.name }.forEach { f ->
                runCatching {
                    val lines = f.readText().split('\n', limit = 4)
                    add(buildJsonObject {
                        put("source", "uncaught")
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

    @Suppress("FunctionName")
    private fun Js_iso(ms: Long): String = dev.jeromeswannack.chineselearning.lab.core.Js.toIsoString(ms)
}
