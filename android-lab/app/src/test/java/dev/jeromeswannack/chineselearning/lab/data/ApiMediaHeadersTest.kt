package dev.jeromeswannack.chineselearning.lab.data

import dev.jeromeswannack.chineselearning.lab.Config
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * Person-made media (recordings, lesson answers, call audio, uploaded card photos) is served by
 * /api/audio/<key> only with a credential since Oct 2026 (docs/AUDIO.md "Private media"): every
 * download from our API carries the session, a download from any other host never does. The
 * offline copy is kept by R2 key (Repository.fileName), never by URL.
 */
class ApiMediaHeadersTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = Api(server.url("/").toString().trimEnd('/')) { "sess-1" }
    }

    @After fun tearDown() = server.shutdown()

    @Test fun downloadFromOurApiSendsTheSession() = runBlocking {
        server.enqueue(MockResponse().setBody("RIFF"))
        val dest = File(Files.createTempDirectory("media").toFile(), "recordings_r1.webm")
        api.download(Config.audioUrl("recordings/r1.webm", api.baseUrl), dest)
        val req = server.takeRequest()
        assertEquals("/api/audio/recordings/r1.webm", req.path)
        assertEquals("Bearer sess-1", req.getHeader("Authorization"))
        assertTrue(dest.exists())
    }

    @Test fun otherHostsGetNoSession() {
        assertEquals(mapOf("Authorization" to "Bearer sess-1"), api.mediaHeaders("${api.baseUrl}/api/audio/calls/c1/p1.webm"))
        assertTrue(api.mediaHeaders("https://example.com/api/audio/recordings/r1.webm").isEmpty())
        assertTrue(Api(api.baseUrl) { null }.mediaHeaders("${api.baseUrl}/api/audio/recordings/r1.webm").isEmpty())
    }

    @Test fun signedOutDownloadSendsNoHeader() = runBlocking {
        server.enqueue(MockResponse().setBody("ID3"))
        val anon = Api(api.baseUrl) { null }
        val dest = File(Files.createTempDirectory("media").toFile(), "generated_a.mp3")
        anon.download(Config.audioUrl("generated/a.mp3", anon.baseUrl), dest)
        assertNull(server.takeRequest().getHeader("Authorization"))
    }
}
