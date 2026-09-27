package dev.jeromeswannack.chineselearning.lab.core.calls

import java.io.ByteArrayOutputStream

/**
 * A streaming Ogg/Opus muxer (RFC 3533 + RFC 7845) for the call recording. The web app's
 * MediaRecorder hands the server webm/opus; Android has an Opus *encoder* (MediaCodec,
 * API 29+) but no streaming muxer, so the Lab app writes the Ogg pages itself. The byte
 * stream can be cut between pages at any point: concatenating the cuts (the 10 s chunks)
 * gives one valid `audio/ogg` file per piece, which the server accepts as is.
 */
class OggOpusWriter(
    private val serial: Int,
    private val preSkip: Int = DEFAULT_PRE_SKIP,
    private val inputSampleRate: Int = 48_000,
    private val channels: Int = 1,
    private val vendor: String = "chinese-learning-lab",
) {
    private var sequence = 0
    private var granule = 0L
    private val pending = ArrayList<ByteArray>()
    private val pendingSamples = ArrayList<Int>()
    private var headersWritten = false

    /** Total samples (48 kHz) of the packets written so far — the stream's granule position. */
    val granulePosition: Long get() = granule

    /** The two header pages (OpusHead with the BOS flag, then OpusTags). Written once, first. */
    fun headers(): ByteArray {
        check(!headersWritten) { "headers already written" }
        headersWritten = true
        val out = ByteArrayOutputStream()
        out.write(page(listOf(opusHead(channels, preSkip, inputSampleRate)), 0L, BOS))
        out.write(page(listOf(opusTags(vendor)), 0L, 0))
        return out.toByteArray()
    }

    /** Queues one encoded Opus packet ([samples] = its duration at 48 kHz, see [Opus.packetSamples]). */
    fun addPacket(packet: ByteArray, samples: Int = Opus.packetSamples(packet)) {
        require(packet.size < 255 * 255) { "packet too large" }
        pending += packet
        pendingSamples += samples
    }

    /**
     * Pages for every queued packet (empty when none are queued, unless [eos]: then the
     * last page carries the end-of-stream flag, an empty page if need be).
     */
    fun flush(eos: Boolean = false): ByteArray {
        check(headersWritten) { "write headers() first" }
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < pending.size) {
            val packets = ArrayList<ByteArray>()
            var lacing = 0
            while (i < pending.size && lacing + lacingValues(pending[i].size) <= 255) {
                lacing += lacingValues(pending[i].size)
                packets += pending[i]
                granule += pendingSamples[i]
                i++
            }
            val last = i >= pending.size
            out.write(page(packets, granule, if (eos && last) EOS else 0))
        }
        if (eos && pending.isEmpty()) out.write(page(emptyList(), granule, EOS))
        pending.clear()
        pendingSamples.clear()
        return out.toByteArray()
    }

    private fun page(packets: List<ByteArray>, granulePos: Long, flags: Int): ByteArray {
        val segments = ArrayList<Int>()
        for (p in packets) {
            var n = p.size
            while (n >= 255) { segments += 255; n -= 255 }
            segments += n
        }
        val size = 27 + segments.size + packets.sumOf { it.size }
        val b = ByteArray(size)
        "OggS".forEachIndexed { k, c -> b[k] = c.code.toByte() }
        b[4] = 0
        b[5] = flags.toByte()
        putLe(b, 6, granulePos, 8)
        putLe(b, 14, serial.toLong() and 0xffffffffL, 4)
        putLe(b, 18, sequence++.toLong(), 4)
        // 22..25: CRC, computed with the field zeroed.
        b[26] = segments.size.toByte()
        segments.forEachIndexed { k, v -> b[27 + k] = v.toByte() }
        var at = 27 + segments.size
        for (p in packets) { p.copyInto(b, at); at += p.size }
        putLe(b, 22, Ogg.crc(b).toLong() and 0xffffffffL, 4)
        return b
    }

    companion object {
        const val BOS = 0x02
        const val EOS = 0x04

        /** libopus' usual encoder lookahead at 48 kHz, when the encoder doesn't say. */
        const val DEFAULT_PRE_SKIP = 312

        private fun lacingValues(size: Int) = size / 255 + 1

        fun opusHead(channels: Int, preSkip: Int, inputSampleRate: Int): ByteArray {
            val b = ByteArray(19)
            "OpusHead".forEachIndexed { k, c -> b[k] = c.code.toByte() }
            b[8] = 1
            b[9] = channels.toByte()
            putLe(b, 10, preSkip.toLong(), 2)
            putLe(b, 12, inputSampleRate.toLong(), 4)
            // 16..17 output gain 0, 18 mapping family 0 (mono / stereo).
            return b
        }

        fun opusTags(vendor: String): ByteArray {
            val v = vendor.toByteArray(Charsets.UTF_8)
            val b = ByteArray(8 + 4 + v.size + 4)
            "OpusTags".forEachIndexed { k, c -> b[k] = c.code.toByte() }
            putLe(b, 8, v.size.toLong(), 4)
            v.copyInto(b, 12)
            putLe(b, 12 + v.size, 0, 4)
            return b
        }

        private fun putLe(b: ByteArray, at: Int, value: Long, bytes: Int) {
            for (k in 0 until bytes) b[at + k] = (value ushr (8 * k)).toByte()
        }
    }
}

/** Ogg helpers: the page CRC and a small page reader (used by tests and to check a piece). */
object Ogg {
    private val TABLE = IntArray(256).also { t ->
        for (i in 0 until 256) {
            var r = i shl 24
            repeat(8) { r = if (r and 0x80000000.toInt() != 0) (r shl 1) xor 0x04c11db7 else r shl 1 }
            t[i] = r
        }
    }

    /** CRC-32 of an Ogg page (polynomial 0x04c11db7, no reflection, init 0). */
    fun crc(bytes: ByteArray, from: Int = 0, to: Int = bytes.size): Int {
        var crc = 0
        for (i in from until to) crc = (crc shl 8) xor TABLE[((crc ushr 24) xor (bytes[i].toInt() and 0xff)) and 0xff]
        return crc
    }

    data class Page(val flags: Int, val granule: Long, val serial: Int, val sequence: Int, val packets: List<ByteArray>, val crcOk: Boolean)

    /** Splits an Ogg byte stream into pages (complete packets only, as [OggOpusWriter] writes them). */
    fun readPages(bytes: ByteArray): List<Page> {
        val pages = ArrayList<Page>()
        var at = 0
        while (at + 27 <= bytes.size) {
            require(bytes[at] == 'O'.code.toByte() && bytes[at + 1] == 'g'.code.toByte() && bytes[at + 2] == 'g'.code.toByte() && bytes[at + 3] == 'S'.code.toByte()) { "no capture pattern at $at" }
            fun le(off: Int, n: Int): Long { var v = 0L; for (k in n - 1 downTo 0) v = (v shl 8) or (bytes[at + off + k].toLong() and 0xff); return v }
            val nSeg = bytes[at + 26].toInt() and 0xff
            val segs = (0 until nSeg).map { bytes[at + 27 + it].toInt() and 0xff }
            val total = 27 + nSeg + segs.sum()
            val copy = bytes.copyOfRange(at, at + total)
            for (k in 22..25) copy[k] = 0
            val crcOk = crc(copy) == le(22, 4).toInt()
            val packets = ArrayList<ByteArray>()
            var dataAt = at + 27 + nSeg
            var cur = java.io.ByteArrayOutputStream()
            for (s in segs) {
                cur.write(bytes, dataAt, s); dataAt += s
                if (s < 255) { packets += cur.toByteArray(); cur = java.io.ByteArrayOutputStream() }
            }
            pages += Page(bytes[at + 5].toInt(), le(6, 8), le(14, 4).toInt(), le(18, 4).toInt(), packets, crcOk)
            at += total
        }
        require(at == bytes.size) { "trailing bytes" }
        return pages
    }
}

object Opus {
    /** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). 0 for an empty packet. */
    fun packetSamples(packet: ByteArray): Int {
        if (packet.isEmpty()) return 0
        val toc = packet[0].toInt() and 0xff
        val config = toc shr 3
        val frame = when {
            config < 12 -> intArrayOf(480, 960, 1920, 2880)[config % 4]
            config < 16 -> intArrayOf(480, 960)[config % 2]
            else -> intArrayOf(120, 240, 480, 960)[config % 4]
        }
        val frames = when (toc and 3) {
            0 -> 1
            1, 2 -> 2
            else -> if (packet.size > 1) packet[1].toInt() and 0x3f else 0
        }
        return frame * frames
    }

    /** The pre-skip from an encoder's codec-config blob that contains an "OpusHead" (Android wraps it in AOPUSHDR markers). */
    fun preSkipFromConfig(config: ByteArray): Int? {
        val magic = "OpusHead".toByteArray()
        outer@ for (i in 0..config.size - 19) {
            for (k in magic.indices) if (config[i + k] != magic[k]) continue@outer
            return (config[i + 10].toInt() and 0xff) or ((config[i + 11].toInt() and 0xff) shl 8)
        }
        return null
    }
}
