package dev.jeromeswannack.chineselearning.lab.data.readers

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import dev.jeromeswannack.chineselearning.lab.core.AudioBlocks
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File
import java.nio.ByteOrder

const val WAVE_BUCKETS = 96

/** A page clip's waveform peaks (0..1, null when undecodable) and phrase blocks. */
data class ClipAnalysis(val durationMs: Int, val peaks: List<Float>?, val blocks: List<AudioBlocks.Block>)

/** Per-bucket peaks of mono PCM, normalised to 0..1 (`peaksOf` in services/readerAudioBlocks.ts). */
fun peaksOf(samples: FloatArray, count: Int, buckets: Int = WAVE_BUCKETS): List<Float> {
    val size = Math.max(1, count / buckets)
    val peaks = FloatArray(buckets)
    for (b in 0 until buckets) {
        var peak = 0f
        var i = b * size
        val end = Math.min(count, i + size)
        while (i < end) { val v = Math.abs(samples[i]); if (v > peak) peak = v; i += 4 }
        peaks[b] = peak
    }
    val max = Math.max(0.01f, peaks.max())
    return peaks.map { it / max }
}

/**
 * `decodeClip`: the clip decoded to PCM (MediaExtractor + MediaCodec, first channel),
 * reduced to waveform peaks and split into phrase blocks by the shared segmenter
 * (core `AudioBlocks`, parity-tested against the web). Null when it can't be decoded.
 */
fun decodeClip(file: File): ClipAnalysis? = runCatching {
    val extractor = MediaExtractor()
    try {
        extractor.setDataSource(file.absolutePath)
        val track = (0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 1
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        var samples = FloatArray(1 shl 16)
        var count = 0
        try {
            codec.configure(format, null, null, 0)
            codec.start()
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            while (!outputDone) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val buf = codec.getInputBuffer(i)!!
                        val n = extractor.readSampleData(buf, 0)
                        if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else { codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0); extractor.advance() }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val out = codec.outputFormat
                    sampleRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = Math.max(1, out.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
                } else if (o >= 0) {
                    val pcm = codec.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                    val frames = pcm.remaining() / channels
                    if (count + frames > samples.size) samples = samples.copyOf(Math.max(samples.size * 2, count + frames))
                    for (f in 0 until frames) samples[count++] = pcm.get(f * channels) / 32768f
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }
            codec.stop()
        } finally {
            codec.release()
        }
        if (count == 0) return null
        val durationMs = AudioBlocks.clipDurationMs(count.toLong(), sampleRate)
        val envelope = AudioBlocks.rmsEnvelope(samples, count, sampleRate)
        ClipAnalysis(durationMs, peaksOf(samples, count), AudioBlocks.segment(envelope, durationMs.toDouble()))
    } finally {
        extractor.release()
    }
}.getOrNull()

@Serializable
private data class CachedBlock(val startMs: Int, val endMs: Int)

@Serializable
private data class CachedClip(val size: Long, val version: Int, val durationMs: Int, val peaks: List<Float>?, val blocks: List<CachedBlock>)

/**
 * Cache-first clip analysis (the web's `analyzeReaderClip` + IndexedDB `readerAudioBlocks`):
 * decoded once per clip, kept in the JsonCache so the blocks show instantly and offline.
 * A different file size = a regenerated clip; a new [AudioBlocks.VERSION] = re-segment.
 */
class ReaderClipAnalyzer(private val cache: JsonCache, private val decode: (File) -> ClipAnalysis? = ::decodeClip) {
    suspend fun analyze(key: String, file: File): ClipAnalysis? {
        val cacheKey = "readers/audio-blocks/$key"
        val size = file.length()
        runCatching { cache.get(cacheKey, CachedClip.serializer()) }.getOrNull()
            ?.takeIf { it.size == size && it.version == AudioBlocks.VERSION && it.blocks.isNotEmpty() }
            ?.let { c -> return ClipAnalysis(c.durationMs, c.peaks, c.blocks.map { AudioBlocks.Block(it.startMs, it.endMs) }) }
        val a = withContext(Dispatchers.Default) { decode(file) } ?: return null
        if (a.blocks.isEmpty()) return null
        runCatching {
            cache.put(cacheKey, KIND, CachedClip(size, AudioBlocks.VERSION, a.durationMs, a.peaks, a.blocks.map { CachedBlock(it.startMs, it.endMs) }), CachedClip.serializer())
        }
        return a
    }

    companion object {
        const val KIND = "reader-audio-blocks"
    }
}
