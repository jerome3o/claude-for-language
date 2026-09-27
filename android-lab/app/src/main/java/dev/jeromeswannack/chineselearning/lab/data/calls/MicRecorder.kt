package dev.jeromeswannack.chineselearning.lab.data.calls

import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.util.Log
import dev.jeromeswannack.chineselearning.lab.core.calls.OggOpusWriter
import dev.jeromeswannack.chineselearning.lab.core.calls.PieceRecorder
import dev.jeromeswannack.chineselearning.lab.data.calls.rtc.MicTap
import dev.jeromeswannack.chineselearning.lab.ui.calls.CallRecorderControl
import kotlinx.coroutines.CompletableDeferred
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Records THIS participant's microphone during a call, for the transcript (web:
 * services/calls/recorder.ts). The mic comes from [MicTap]; [PieceRecorder] (core) cuts it into
 * 5-minute Ogg/Opus pieces and 10 s chunks; the chunks go to the [CallUploads] queue, never to the
 * network directly. Everything runs on one recording thread, in order.
 */
class MicRecorder(
    private val callId: String,
    private val uploads: CallUploads,
    private val tap: MicTap,
    private val onChunk: () -> Unit = {},
) : CallRecorderControl {
    private val thread = Executors.newSingleThreadExecutor { r -> Thread(r, "call-recorder") }
    private var recorder: PieceRecorder? = null

    override val supported: Boolean get() = MediaCodecOpusEncoder.supported()
    override val recording: Boolean get() = recorder != null
    @Volatile override var muted: Boolean = false

    override suspend fun start(clockOffset: () -> Long) {
        if (recorder != null || !supported) return
        val first = uploads.nextIndex(callId)
        val sink = uploads.sink(callId)
        val notifying = object : PieceRecorder.Sink {
            override fun register(piece: PieceRecorder.PieceStart) = sink.register(piece).also { onChunk() }
            override fun chunk(pieceId: String, idx: Int, bytes: ByteArray) = sink.chunk(pieceId, idx, bytes).also { onChunk() }
            override fun close(pieceId: String, chunkCount: Int, durationMs: Long) = sink.close(pieceId, chunkCount, durationMs).also { onChunk() }
        }
        val rec = PieceRecorder(
            encoders = { MediaCodecOpusEncoder() },
            sink = notifying,
            now = System::currentTimeMillis,
            clockOffset = clockOffset,
            firstIndex = first,
            newId = { UUID.randomUUID().toString().replace("-", "") },
        )
        recorder = rec
        tap.setConsumer { pcm ->
            thread.execute {
                try {
                    if (recorder === rec) rec.feed(pcm, muted = muted)
                } catch (e: Exception) {
                    Log.e("MicRecorder", "recording failed", e)
                }
            }
        }
    }

    override suspend fun stop() {
        val rec = recorder ?: return
        recorder = null
        tap.setConsumer(null)
        val done = CompletableDeferred<Unit>()
        thread.execute {
            runCatching { rec.stop() }.onFailure { Log.e("MicRecorder", "closing the piece failed", it) }
            done.complete(Unit)
        }
        done.await()
    }
}

/** Opus on MediaCodec (Android 10+): 48 kHz mono, 32 kbit/s like the web's MediaRecorder. */
class MediaCodecOpusEncoder : PieceRecorder.Encoder {
    private val codec: MediaCodec = MediaCodec.createEncoderByType(MIME).apply {
        configure(format(), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        start()
    }
    private val info = MediaCodec.BufferInfo()
    private var samplesIn = 0L
    private var configPreSkip: Int? = null

    override val preSkip: Int get() = configPreSkip ?: OggOpusWriter.DEFAULT_PRE_SKIP

    override fun encode(pcm: ShortArray, offset: Int, length: Int): List<ByteArray> {
        val out = ArrayList<ByteArray>()
        var at = offset
        val end = offset + length
        while (at < end) {
            val idx = codec.dequeueInputBuffer(10_000)
            if (idx < 0) { drain(out, 0); continue }
            val buf = codec.getInputBuffer(idx)!!.order(ByteOrder.LITTLE_ENDIAN)
            buf.clear()
            val n = minOf(end - at, buf.remaining() / 2)
            buf.asShortBuffer().put(pcm, at, n)
            codec.queueInputBuffer(idx, 0, n * 2, samplesIn * 1_000_000 / 48_000, 0)
            samplesIn += n
            at += n
            drain(out, 0)
        }
        return out
    }

    override fun finish(): List<ByteArray> {
        val out = ArrayList<ByteArray>()
        try {
            val idx = codec.dequeueInputBuffer(100_000)
            if (idx >= 0) codec.queueInputBuffer(idx, 0, 0, samplesIn * 1_000_000 / 48_000, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            val deadline = System.currentTimeMillis() + 1_000
            while (System.currentTimeMillis() < deadline) {
                if (drain(out, 20_000)) break
            }
        } finally {
            runCatching { codec.stop() }
            runCatching { codec.release() }
        }
        return out
    }

    /** Moves finished packets into [out]; true once end-of-stream came out. */
    private fun drain(out: MutableList<ByteArray>, timeoutUs: Long): Boolean {
        while (true) {
            val idx = codec.dequeueOutputBuffer(info, timeoutUs)
            if (idx < 0) return false
            val buf: ByteBuffer = codec.getOutputBuffer(idx)!!
            val bytes = ByteArray(info.size).also { buf.position(info.offset); buf.get(it) }
            val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                configPreSkip = dev.jeromeswannack.chineselearning.lab.core.calls.Opus.preSkipFromConfig(bytes) ?: configPreSkip
            } else if (bytes.isNotEmpty()) {
                out += bytes
            }
            codec.releaseOutputBuffer(idx, false)
            if (eos) return true
        }
    }

    companion object {
        private const val MIME = MediaFormat.MIMETYPE_AUDIO_OPUS

        private fun format() = MediaFormat.createAudioFormat(MIME, 48_000, 1).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, PieceRecorder.BITRATE)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 48_000)
        }

        @Volatile private var cached: Boolean? = null

        /** Opus encoding needs Android 10 (like the web's `CallRecorder.supported()`, the toggle is off otherwise). */
        fun supported(): Boolean = cached ?: (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            runCatching { MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(format()) != null }.getOrDefault(false)
            ).also { cached = it }
    }
}
