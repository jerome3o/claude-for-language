package dev.jeromeswannack.chineselearning.lab.core.calls

import java.io.ByteArrayOutputStream

/**
 * The call recorder's logic, without Android (port of frontend/src/services/calls/recorder.ts):
 *
 *  - a new PIECE every [PIECE_MS] (each piece is a standalone Ogg/Opus file the transcriber
 *    reads on its own), numbered on from the pieces this call already has;
 *  - a CHUNK every [CHUNK_MS]: the Ogg pages written since the last chunk (chunk 0 starts
 *    with the headers), handed to the [Sink] — which stores it and queues the upload;
 *  - piece start times on the SERVER clock (`clockOffset`), so both people's transcripts line up.
 *
 * Time is counted in samples fed (48 kHz mono), not wall-clock timers, so a piece is cut at an
 * exact sample and nothing falls in a gap. Muted audio is recorded as silence, like a disabled
 * MediaStreamTrack in the web app.
 */
class PieceRecorder(
    private val encoders: () -> Encoder,
    private val sink: Sink,
    /** Local wall clock (ms). */
    private val now: () -> Long,
    /** serverTime − localTime (ms). */
    private val clockOffset: () -> Long,
    firstIndex: Int = 0,
    private val newId: () -> String,
    private val newSerial: () -> Int = { (Math.random() * Int.MAX_VALUE).toInt() },
    private val pieceSamples: Long = PIECE_MS * SAMPLES_PER_MS,
    private val chunkSamples: Long = CHUNK_MS * SAMPLES_PER_MS,
) {
    /** One Opus encoder (MediaCodec on the phone, a fake in tests): 48 kHz mono PCM in, packets out. */
    interface Encoder {
        /** Encoder lookahead in 48 kHz samples (OpusHead pre-skip). */
        val preSkip: Int
        fun encode(pcm: ShortArray, offset: Int, length: Int): List<ByteArray>
        /** Flushes the rest (end of stream) and releases the encoder. */
        fun finish(): List<ByteArray>
    }

    /** Where pieces go (the upload queue). Called on the recording thread, in order. */
    interface Sink {
        fun register(piece: PieceStart)
        fun chunk(pieceId: String, idx: Int, bytes: ByteArray)
        fun close(pieceId: String, chunkCount: Int, durationMs: Long)
    }

    data class PieceStart(val id: String, val index: Int, val startedAt: Long, val mimeType: String)

    private class Active(val id: String, val encoder: Encoder, val writer: OggOpusWriter) {
        var samples = 0L
        var sinceChunk = 0L
        var chunks = 0
        val buffer = ByteArrayOutputStream()
    }

    private var nextIndex = firstIndex
    private var active: Active? = null

    val recording: Boolean get() = active != null
    val currentPieceId: String? get() = active?.id

    /** Feeds 48 kHz mono PCM. Starts a piece if none is open; cuts chunks and pieces on their boundaries. */
    fun feed(pcm: ShortArray, offset: Int = 0, length: Int = pcm.size - offset, muted: Boolean = false) {
        val data = if (muted) ShortArray(length) else pcm
        var at = if (muted) 0 else offset
        var left = length
        while (left > 0) {
            val piece = active ?: startPiece()
            val room = minOf(chunkSamples - piece.sinceChunk, pieceSamples - piece.samples)
            val n = minOf(room, left.toLong()).toInt()
            piece.encoder.encode(data, at, n).forEach { piece.writer.addPacket(it) }
            piece.samples += n
            piece.sinceChunk += n
            at += n
            left -= n
            if (piece.samples >= pieceSamples) finishPiece(piece)
            else if (piece.sinceChunk >= chunkSamples) cutChunk(piece, eos = false)
        }
    }

    /** Stops: the open piece gets its last chunk and its close. */
    fun stop() {
        active?.let { finishPiece(it) }
    }

    private fun startPiece(): Active {
        val encoder = encoders()
        val writer = OggOpusWriter(newSerial(), preSkip = encoder.preSkip)
        val piece = Active(newId(), encoder, writer)
        piece.buffer.write(writer.headers())
        val start = PieceStart(piece.id, nextIndex++, now() + clockOffset(), MIME_TYPE)
        sink.register(start)
        active = piece
        return piece
    }

    private fun cutChunk(piece: Active, eos: Boolean) {
        piece.buffer.write(piece.writer.flush(eos))
        piece.sinceChunk = 0
        // The server refuses empty chunks; an encoder that hasn't emitted yet just waits for the next cut.
        if (piece.buffer.size() == 0) return
        sink.chunk(piece.id, piece.chunks++, piece.buffer.toByteArray())
        piece.buffer.reset()
    }

    private fun finishPiece(piece: Active) {
        runCatching { piece.encoder.finish() }.getOrDefault(emptyList()).forEach { piece.writer.addPacket(it) }
        cutChunk(piece, eos = true)
        sink.close(piece.id, piece.chunks, piece.samples / SAMPLES_PER_MS)
        active = null
    }

    companion object {
        const val PIECE_MS = 5 * 60_000L
        const val CHUNK_MS = 10_000L
        const val SAMPLE_RATE = 48_000
        const val SAMPLES_PER_MS = 48L
        const val BITRATE = 32_000
        const val MIME_TYPE = "audio/ogg;codecs=opus"
    }
}

/**
 * 16-bit PCM from the microphone (any rate, mono or interleaved stereo, little-endian bytes)
 * → 48 kHz mono for the encoder. Linear interpolation; keeps its position across calls so
 * consecutive buffers join without clicks. One instance per input format.
 */
class PcmTo48kMono(private val inputRate: Int, private val channels: Int) {
    private val step = inputRate.toDouble() / PieceRecorder.SAMPLE_RATE
    private var pos = 0.0
    private var prev: Short = 0

    fun convert(bytes: ByteArray, length: Int = bytes.size): ShortArray {
        val frames = length / (2 * channels)
        val mono = ShortArray(frames) { f ->
            var sum = 0
            for (c in 0 until channels) {
                val i = (f * channels + c) * 2
                sum += ((bytes[i].toInt() and 0xff) or (bytes[i + 1].toInt() shl 8)).toShort().toInt()
            }
            (sum / channels).toShort()
        }
        return resample(mono)
    }

    fun resample(mono: ShortArray): ShortArray {
        if (inputRate == PieceRecorder.SAMPLE_RATE) return mono
        // Positions are input indexes; -1 is the previous buffer's last sample.
        val n = mono.size
        val out = ArrayList<Short>((n / step).toInt() + 2)
        while (pos < n - 1) {
            val i = Math.floor(pos).toInt()
            val frac = pos - i
            val a = if (i < 0) prev.toInt() else mono[i].toInt()
            val b = mono[i + 1].toInt()
            out += Math.round(a + (b - a) * frac).toInt().toShort()
            pos += step
        }
        pos -= n
        if (n > 0) prev = mono[n - 1]
        return out.toShortArray()
    }
}
