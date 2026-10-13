package dev.jeromeswannack.chineselearning.lab.data.audio

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.downloadChatMedia
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * The tutor's model recording on a needs-work mark — the Lab twin of
 * frontend/src/services/modelRecordings.ts (docs/RECORDING_REVIEW.md "Model recordings").
 *
 * The clip is private to the tutor and the student, so it is fetched WITH the session from
 * `/api/recording-marks/<eventId>/model-audio?v=…` (never /api/audio/*) and kept as a file under
 * `files/model-recordings/`, named by a hash of the URL — the URL changes with every new clip, so
 * a cached file is never stale. The tutor-notes sync prefetches the clips of my notes, so the card
 * back and the Tutor notes page play them on the train.
 */
class ModelRecordings(private val api: Api, filesDir: File) {
    val dir = File(filesDir, DIR)

    /** The cached file of [url], or null. */
    fun cached(url: String): File? = file(url).takeIf { it.exists() && it.length() > 0 }

    /** The clip: the cached file, else downloaded with the session (null offline / on failure). */
    suspend fun ensure(url: String, online: Boolean = true): File? {
        cached(url)?.let { return it }
        if (!online) return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val dest = file(url)
                api.downloadChatMedia(url, dest)
                dest.takeIf { it.length() > 0 }
            }.getOrNull()
        }
    }

    /** A clip the tutor just recorded: kept under its server URL (no download needed). */
    suspend fun prime(url: String, take: File) = withContext(Dispatchers.IO) {
        runCatching { dir.mkdirs(); take.copyTo(file(url), overwrite = true) }
    }

    /** Sync step: download the clips of these URLs that aren't on the phone yet. */
    suspend fun prefetch(urls: Collection<String?>): Int {
        var n = 0
        for (u in urls.filterNotNull().distinct()) if (cached(u) == null && ensure(u) != null) n++
        return n
    }

    private fun file(url: String) = File(dir, fileName(url))

    companion object {
        const val DIR = "model-recordings"

        /** `model-<sha1(url)>.audio` — the type comes from the bytes when it is played. */
        fun fileName(url: String): String {
            val sha = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
            return "model-$sha.audio"
        }

        fun of(ctx: SyncContext) = ModelRecordings(ctx.api, ctx.outbox.dir.parentFile ?: ctx.outbox.dir)
    }
}
