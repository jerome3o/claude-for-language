package dev.jeromeswannack.chineselearning.lab.data.calls

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.calls.Ogg
import dev.jeromeswannack.chineselearning.lab.core.calls.PieceRecorder
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** The call-recording upload queue: register → raw chunks → close, in order, idempotent, surviving a killed app. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CallUploadsTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var outbox: Outbox
    private lateinit var cache: JsonCache
    private lateinit var uploads: CallUploads

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        val api = Api(server.url("").toString().removeSuffix("/")) { "token-1" }
        val dir = File(ApplicationProvider.getApplicationContext<android.app.Application>().filesDir, "outbox-calls").apply { deleteRecursively() }
        outbox = Outbox(db.platform(), api, dir)
        cache = JsonCache(db.platform(), api.json)
        uploads = CallUploads(outbox, cache)
        CallUploads.activeCallId = null
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    /** An encoder that emits one 20 ms CELT packet per 960 samples. */
    private class Fake : PieceRecorder.Encoder {
        override val preSkip = 312
        private var n = 0
        override fun encode(pcm: ShortArray, offset: Int, length: Int): List<ByteArray> {
            n += length
            val out = ArrayList<ByteArray>()
            while (n >= 960) { n -= 960; out += byteArrayOf((31 shl 3).toByte(), 1, 2) }
            return out
        }
        override fun finish() = emptyList<ByteArray>()
    }

    @Test fun recorderOutputDrainsInOrderAsRawOggChunks() = runBlocking {
        var ids = 0
        val rec = PieceRecorder({ Fake() }, uploads.sink("c1"), { 1_000L }, { 250L }, firstIndex = uploads.nextIndex("c1"), newId = { "piece000${ids++}" },
            pieceSamples = 48L * 20_000, chunkSamples = 48L * 10_000)
        repeat(2_500) { rec.feed(ShortArray(480) { 7 }) } // 25 s → a 20 s piece (2 chunks) + a 5 s piece
        rec.stop()
        assertEquals(2, uploads.nextIndex("c1"))
        assertEquals(1 + 2 + 1 + 1 + 1 + 1, uploads.pending("c1").first())

        repeat(7) { server.enqueue(MockResponse().setBody("{}")) }
        val r = outbox.drain()
        assertEquals(7, r.sent)
        val reqs = List(7) { server.takeRequest() }
        assertEquals(
            listOf(
                "POST /api/calls/c1/pieces", "PUT /api/calls/c1/pieces/piece0000/chunks/0", "PUT /api/calls/c1/pieces/piece0000/chunks/1", "POST /api/calls/c1/pieces/piece0000/close",
                "POST /api/calls/c1/pieces", "PUT /api/calls/c1/pieces/piece0001/chunks/0", "POST /api/calls/c1/pieces/piece0001/close",
            ),
            reqs.map { "${it.method} ${it.path}" },
        )
        assertTrue(reqs[0].body.readUtf8().let { it.contains("\"piece_index\":0") && it.contains("\"started_at\":1250") && it.contains("audio/ogg;codecs=opus") })
        assertEquals("audio/ogg", reqs[1].getHeader("Content-Type"))
        // The two chunks concatenate into one valid Ogg stream.
        val bytes = reqs[1].body.readByteArray() + reqs[2].body.readByteArray()
        assertTrue(Ogg.readPages(bytes).all { it.crcOk })
        assertTrue(reqs[3].body.readUtf8().contains("\"chunk_count\":2"))
        assertEquals(0, uploads.pending("c1").first())
    }

    @Test fun anOpenPieceFromAKilledAppIsClosedWithTheChunksItSaved() = runBlocking {
        val sink = uploads.sink("c2")
        sink.register(PieceRecorder.PieceStart("orphan01", 0, 5_000, PieceRecorder.MIME_TYPE))
        sink.chunk("orphan01", 0, byteArrayOf(1, 2, 3))
        // …the app dies here. While that call is on screen its piece is live, not an orphan:
        CallUploads.activeCallId = "c2"
        assertEquals(0, uploads.closeOrphans(CallUploads.activeCallId))
        CallUploads.activeCallId = null
        assertEquals(1, uploads.closeOrphans(null))
        assertEquals(0, uploads.closeOrphans(null)) // once
        val paths = outbox.all().map { it.path }
        assertEquals(listOf("/api/calls/c2/pieces", "/api/calls/c2/pieces/orphan01/chunks/0", "/api/calls/c2/pieces/orphan01/close"), paths)
        assertTrue(outbox.all().last().bodyJson!!.contains("\"chunk_count\":1"))
        // Uploaded → the piece is forgotten.
        repeat(3) { server.enqueue(MockResponse().setBody("{}")) }
        outbox.drain()
        uploads.closeOrphans(null)
        assertTrue(uploads.pieces().isEmpty())
    }

    @Test fun reQueueingTheSameChunkIsANoOp() = runBlocking {
        val sink = uploads.sink("c3")
        sink.register(PieceRecorder.PieceStart("same0001", 0, 5_000, PieceRecorder.MIME_TYPE))
        sink.register(PieceRecorder.PieceStart("same0001", 0, 5_000, PieceRecorder.MIME_TYPE))
        sink.chunk("same0001", 0, byteArrayOf(1))
        sink.chunk("same0001", 0, byteArrayOf(1))
        assertEquals(2, outbox.pendingCount())
    }
}
