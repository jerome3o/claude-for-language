package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.platform.LabPlatform
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** Tutor notes: cached by the sync step, shown once, seen-marking queued through the outbox. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class TutorNotesTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var platform: LabPlatform

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        db = Room.inMemoryDatabaseBuilder(context, LabDatabase::class.java).allowMainThreadQueries().build()
        val api = Api(server.url("").toString().removeSuffix("/")) { "token-1" }
        platform = LabPlatform(db, api, File(context.filesDir, "tutor-notes-test").apply { deleteRecursively() })
        platform.register("study-notes", TutorNotes.Sync)
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    private val two = """{"notes":[
        {"event_id":"e1","kind":"recording","card_id":"c1","note_id":"n1","hanzi":"打算","comment":"second tone, not fourth","tutor_name":"Wang Laoshi","updated_at":"2026-09-20T10:00:00Z"},
        {"event_id":"f1","kind":"flag","card_id":null,"note_id":"n1","hanzi":"打算","comment":"打算 is a plan you've thought through","tutor_name":"Wang Laoshi","updated_at":"2026-09-21T10:00:00Z"}
    ]}"""

    @Test fun syncCachesNotesAndSeenIsHiddenThenPosted() = runBlocking {
        server.enqueue(MockResponse().setBody(two))
        platform.afterSync(full = false)
        assertEquals("/api/me/recording-notes", server.takeRequest().path)

        val shown = TutorNotes.forCard(platform.cache, "c1", "n1")
        assertEquals(listOf("f1", "e1"), shown.map { it.id })
        assertEquals("Wang Laoshi replied to your flag:", CardExtrasLogic.tutorNoteFrom(shown.first()))

        // Rated with the notes on screen: gone at once, even offline.
        TutorNotes.markSeen(platform.cache, platform.outbox, shown.map { it.id })
        assertEquals(emptyList<TutorNote>(), TutorNotes.forCard(platform.cache, "c1", "n1"))
        assertEquals(2, platform.outbox.pendingCount())
        // Marking again queues nothing twice.
        TutorNotes.markSeen(platform.cache, platform.outbox, listOf("e1"))
        assertEquals(2, platform.outbox.pendingCount())

        // Next sync: the outbox posts the seen marks, then the feed no longer lists them.
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        server.enqueue(MockResponse().setBody("""{"notes":[]}"""))
        platform.afterSync(full = false)
        assertEquals(setOf("/api/me/recording-notes/e1/seen", "/api/me/recording-notes/f1/seen"), setOf(server.takeRequest().path, server.takeRequest().path))
        assertEquals("/api/me/recording-notes", server.takeRequest().path)
        assertEquals(0, platform.outbox.pendingCount())
        assertEquals(emptySet<String>(), platform.cache.get<Set<String>>(TutorNotes.SEEN_KEY))
    }

    @Test fun aSeenNoteStaysHiddenWhileTheServerStillListsIt() = runBlocking {
        server.enqueue(MockResponse().setBody(two))
        platform.afterSync(full = false)
        server.takeRequest()
        TutorNotes.markSeen(platform.cache, platform.outbox, listOf("e1"))
        // The seen post fails (server hiccup): the note must not come back.
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setBody(two))
        platform.afterSync(full = false)
        assertEquals(listOf("f1"), TutorNotes.forCard(platform.cache, "c1", "n1").map { it.id })
        assertEquals(1, platform.outbox.pendingCount())
    }
}
