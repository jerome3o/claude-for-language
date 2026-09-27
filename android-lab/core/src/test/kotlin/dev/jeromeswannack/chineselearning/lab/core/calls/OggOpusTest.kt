package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OggOpusTest {
    @Test
    fun crcMatchesKnownVector() {
        // CRC-32/MPEG-2-style Ogg CRC (poly 0x04c11db7, init 0, no reflect, no xorout) of "123456789".
        assertEquals(0x89A1897F.toInt(), Ogg.crc("123456789".toByteArray()))
    }

    @Test
    fun packetSamplesFromToc() {
        assertEquals(960, Opus.packetSamples(byteArrayOf((1 shl 3).toByte())))          // SILK NB 20 ms
        assertEquals(960, Opus.packetSamples(byteArrayOf((31 shl 3).toByte())))         // CELT FB 20 ms
        assertEquals(120, Opus.packetSamples(byteArrayOf((28 shl 3).toByte())))          // CELT FB 2.5 ms
        assertEquals(1920, Opus.packetSamples(byteArrayOf(((31 shl 3) or 1).toByte())))   // two frames
        assertEquals(2880, Opus.packetSamples(byteArrayOf(((31 shl 3) or 3).toByte(), 3))) // code 3, 3 frames
        assertEquals(0, Opus.packetSamples(ByteArray(0)))
    }

    @Test
    fun preSkipFromAndroidConfigBlob() {
        val head = OggOpusWriter.opusHead(1, 3840, 48_000)
        val blob = "AOPUSHDR".toByteArray() + ByteArray(8) + head + "AOPUSDLY".toByteArray() + ByteArray(16)
        assertEquals(3840, Opus.preSkipFromConfig(blob))
        assertNull(Opus.preSkipFromConfig(ByteArray(40)))
    }

    @Test
    fun cutStreamConcatenatesIntoOneValidStream() {
        val w = OggOpusWriter(serial = 0x1234, preSkip = 312)
        val chunks = ArrayList<ByteArray>()
        chunks += w.headers()
        var expectGranule = 0L
        val packets = ArrayList<ByteArray>()
        for (c in 0 until 3) {
            repeat(50 + c * 100) { k ->
                // 20 ms CELT packets of varying size, some over 255 bytes (two lacing values).
                val p = ByteArray(1 + (k * 7) % 400) { (it + k).toByte() }.also { it[0] = (31 shl 3).toByte() }
                packets += p
                w.addPacket(p)
                expectGranule += 960
            }
            chunks[chunks.size - 1] = chunks.last() + w.flush()
            chunks += ByteArray(0)
        }
        chunks[chunks.size - 1] = w.flush(eos = true)
        val all = chunks.fold(ByteArray(0)) { a, b -> a + b }
        val pages = Ogg.readPages(all)
        assertTrue(pages.all { it.crcOk }, "every page CRC checks")
        assertEquals(OggOpusWriter.BOS, pages.first().flags)
        assertEquals(OggOpusWriter.EOS, pages.last().flags)
        assertEquals((0 until pages.size).toList(), pages.map { it.sequence })
        assertTrue(pages.all { it.serial == 0x1234 })
        assertEquals("OpusHead", String(pages[0].packets[0].copyOf(8)))
        assertEquals("OpusTags", String(pages[1].packets[0].copyOf(8)))
        val audio = pages.drop(2).flatMap { it.packets }
        assertEquals(packets.size, audio.size)
        packets.zip(audio).forEach { (a, b) -> assertContentEquals(a, b) }
        assertEquals(expectGranule, pages.last().granule)
        // Granules never go backwards and each page holds at most 255 lacing values (by construction).
        assertTrue(pages.zipWithNext().all { (a, b) -> b.granule >= a.granule })
    }
}
