package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PieceRecorderTest {
    /** 20 ms packets whose first byte is the TOC of a CELT 20 ms frame; one packet per 960 samples, with a 1-packet delay like a real encoder. */
    private class FakeEncoder(val log: MutableList<String>) : PieceRecorder.Encoder {
        override val preSkip = 312
        private var pending = 0
        var fedSamples = 0L
        var mutedSamples = 0L
        private var delayed = 0
        override fun encode(pcm: ShortArray, offset: Int, length: Int): List<ByteArray> {
            fedSamples += length
            for (i in offset until offset + length) if (pcm[i] == 0.toShort()) mutedSamples++
            pending += length
            val out = ArrayList<ByteArray>()
            while (pending >= 960) {
                pending -= 960
                if (delayed == 0) { delayed = 1; continue }
                out += byteArrayOf((31 shl 3).toByte(), 1, 2, 3)
            }
            return out
        }
        override fun finish(): List<ByteArray> { log += "finish"; return List(delayed + if (pending > 0) 1 else 0) { byteArrayOf((31 shl 3).toByte(), 9) } }
    }

    private class Recorded : PieceRecorder.Sink {
        val events = ArrayList<String>()
        val bytes = LinkedHashMap<String, ByteArray>()
        override fun register(piece: PieceRecorder.PieceStart) { events += "register ${piece.id} #${piece.index} @${piece.startedAt} ${piece.mimeType}" }
        override fun chunk(pieceId: String, idx: Int, bytes: ByteArray) {
            events += "chunk $pieceId $idx"
            this.bytes[pieceId] = (this.bytes[pieceId] ?: ByteArray(0)) + bytes
        }
        override fun close(pieceId: String, chunkCount: Int, durationMs: Long) { events += "close $pieceId $chunkCount ${durationMs}ms" }
    }

    @Test
    fun cutsChunksEveryTenSecondsAndPiecesEveryFiveMinutes() {
        val log = ArrayList<String>()
        val sink = Recorded()
        var ids = 0
        val encoders = ArrayList<FakeEncoder>()
        val rec = PieceRecorder(
            encoders = { FakeEncoder(log).also { encoders += it } }, sink = sink, now = { 1_000L }, clockOffset = { 500L },
            firstIndex = 3, newId = { "p${ids++}" }, newSerial = { 7 },
            pieceSamples = 48L * 30_000, chunkSamples = 48L * 10_000, // 30 s pieces for the test
        )
        // 70 s of audio in 10 ms buffers.
        val buf = ShortArray(480) { 100 }
        repeat(7_000) { rec.feed(buf) }
        rec.stop()
        assertEquals(
            listOf(
                "register p0 #3 @1500 audio/ogg;codecs=opus", "chunk p0 0", "chunk p0 1", "chunk p0 2", "close p0 3 30000ms",
                "register p1 #4 @1500 audio/ogg;codecs=opus", "chunk p1 0", "chunk p1 1", "chunk p1 2", "close p1 3 30000ms",
                "register p2 #5 @1500 audio/ogg;codecs=opus", "chunk p2 0", "chunk p2 1", "close p2 2 10000ms",
            ),
            sink.events,
        )
        // Nothing lost at a cut: every sample went to exactly one encoder.
        assertEquals(48L * 70_000, encoders.sumOf { it.fedSamples })
        for ((id, bytes) in sink.bytes) {
            val pages = Ogg.readPages(bytes)
            assertTrue(pages.all { it.crcOk }, "$id CRCs")
            assertEquals(OggOpusWriter.BOS, pages.first().flags)
            assertEquals(OggOpusWriter.EOS, pages.last().flags, "$id ends with EOS")
            assertEquals(312, (pages[0].packets[0][10].toInt() and 0xff) or ((pages[0].packets[0][11].toInt() and 0xff) shl 8))
        }
        assertEquals(3, log.count { it == "finish" })
    }

    @Test
    fun mutedAudioIsSilenceAndOddBufferSizesSplitExactly() {
        val sink = Recorded()
        val encoders = ArrayList<FakeEncoder>()
        val rec = PieceRecorder({ FakeEncoder(ArrayList()).also { encoders += it } }, sink, { 0L }, { 0L }, newId = { "x" }, pieceSamples = 10_000, chunkSamples = 3_000)
        val buf = ShortArray(1_234) { 5 }
        repeat(20) { rec.feed(buf, muted = it % 2 == 1) }
        rec.stop()
        assertEquals(24_680L, encoders.sumOf { it.fedSamples })
        assertEquals(10 * 1_234L, encoders.sumOf { it.mutedSamples })
        assertEquals(3, sink.events.count { it.startsWith("register") })
        assertEquals(3, sink.events.count { it.startsWith("close") })
    }

    @Test
    fun resamplerKeepsRateAndJoinsBuffers() {
        val r = PcmTo48kMono(16_000, 1)
        var out = 0
        repeat(100) { out += r.resample(ShortArray(160) { 1000 }).size } // 1 s at 16 kHz in 10 ms buffers
        assertTrue(out in 47_990..48_000, "got $out samples")
        val same = PcmTo48kMono(48_000, 2)
        val stereo = ByteArray(8) // 2 frames
        stereo[0] = 100; stereo[2] = 50 // frame 0: L=100 R=50 → 75
        assertEquals(listOf<Short>(75, 0), same.convert(stereo).toList())
    }
}
