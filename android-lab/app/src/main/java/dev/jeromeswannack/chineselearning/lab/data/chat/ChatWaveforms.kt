package dev.jeromeswannack.chineselearning.lab.data.chat

import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.readers.decodeClip
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File

/**
 * A voice bubble's waveform (docs/CHAT.md "Round 2"): the peaks of the decoded clip in [BARS]
 * bars, cached per message (JsonCache `chat/wave/<id>`), so it is drawn at once next time and
 * offline. Until a clip is decoded the bubble shows seeded bars ([seeded]).
 */
object ChatWaveforms {
    const val BARS = 40
    const val KIND = "chat"

    @Serializable
    data class Cached(val size: Long, val bars: List<Float>)

    fun key(id: String) = "chat/wave/$id"

    /** Max-pools [peaks] (any length) into [bars] values in 0..1, the loudest bar = 1. */
    fun pool(peaks: List<Float>, bars: Int = BARS): List<Float> {
        if (peaks.isEmpty()) return emptyList()
        val out = FloatArray(bars) { b ->
            val from = b * peaks.size / bars
            val to = maxOf(from + 1, (b + 1) * peaks.size / bars).coerceAtMost(peaks.size)
            var m = 0f
            for (i in from until to) if (peaks[i] > m) m = peaks[i]
            m
        }
        val max = out.maxOrNull()?.takeIf { it > 0.001f } ?: return List(bars) { 0f }
        return out.map { (it / max).coerceIn(0f, 1f) }
    }

    /** Placeholder bars, fixed per message. */
    fun seeded(seed: String, bars: Int = BARS): List<Float> {
        val r = java.util.Random(seed.hashCode().toLong())
        return List(bars) { 0.3f + r.nextFloat() * 0.7f }
    }

    /** Cached bars for [id] when they belong to this file; else decoded (and cached when [persist]). */
    suspend fun bars(cache: JsonCache?, id: String, file: File, persist: Boolean = true, decode: (File) -> List<Float>? = { f -> decodeClip(f)?.peaks }): List<Float>? {
        val size = file.length()
        if (cache != null) runCatching { cache.get(key(id), Cached.serializer()) }.getOrNull()?.takeIf { it.size == size && it.bars.size == BARS }?.let { return it.bars }
        val peaks = withContext(Dispatchers.Default) { decode(file) } ?: return null
        val bars = pool(peaks)
        if (bars.isEmpty()) return null
        if (cache != null && persist) runCatching { cache.put(key(id), KIND, Cached(size, bars), Cached.serializer()) }
        return bars
    }
}
