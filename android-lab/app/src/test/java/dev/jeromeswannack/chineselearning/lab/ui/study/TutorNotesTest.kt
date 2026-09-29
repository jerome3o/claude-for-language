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

    /** GET /api/me/tutor-notes?include_seen=1 — the same two plus an older, already seen one. */
    private val all = """{"notes":[
        {"id":"f1","kind":"flag","card_id":null,"card_type":null,"note_id":"n1","deck_id":"d1","hanzi":"打算","pinyin":"dǎsuàn","english":"to plan","comment":"打算 is a plan you've thought through","tutor_name":"Wang Laoshi","updated_at":"2026-09-21T10:00:00Z","seen_at":null,"recording_url":null,"student_message":"plan vs 计划?"},
        {"id":"e1","kind":"recording","card_id":"c1","card_type":"hanzi_to_meaning","note_id":"n1","deck_id":"d1","hanzi":"打算","pinyin":"dǎsuàn","english":"to plan","comment":"second tone, not fourth","tutor_name":"Wang Laoshi","updated_at":"2026-09-20T10:00:00Z","seen_at":null,"recording_url":"recordings/e1.webm","student_message":null},
        {"id":"e0","kind":"recording","card_id":"c2","card_type":"hanzi_to_meaning","note_id":"n2","deck_id":"d1","hanzi":"喜欢","pinyin":"xǐhuan","english":"to like","comment":"neutral tone","tutor_name":"Wang Laoshi","updated_at":"2026-09-10T10:00:00Z","seen_at":"2026-09-11T10:00:00Z","recording_url":null,"student_message":null}
    ],"next_cursor":null}"""

    @Test fun syncCachesNotesAndSeenIsHiddenThenPosted() = runBlocking {
        server.enqueue(MockResponse().setBody(two))
        server.enqueue(MockResponse().setBody(all))
        platform.afterSync(full = false)
        assertEquals("/api/me/recording-notes", server.takeRequest().path)
        assertEquals("/api/me/tutor-notes?include_seen=1&limit=200", server.takeRequest().path)

        // The Tutor notes page: new = the unseen feed, earlier = the rest; Home's line counts the new ones.
        val page = TutorNotes.list(platform.cache) { null }
        assertEquals(listOf("f1", "e1"), page.fresh.map { it.id })
        assertEquals(listOf("e0"), page.earlier.map { it.id })
        assertEquals("2 new notes from Wang Laoshi", TutorNotes.homeLine(platform.cache))

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
        // Seen here → earlier on the page at once, and Home's line is gone.
        assertEquals(emptyList<String>(), TutorNotes.list(platform.cache) { null }.fresh.map { it.id })
        assertEquals(null, TutorNotes.homeLine(platform.cache))

        // Next sync: the outbox posts the seen marks, then the feed no longer lists them.
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        server.enqueue(MockResponse().setBody("""{"notes":[]}"""))
        server.enqueue(MockResponse().setBody(all))
        platform.afterSync(full = false)
        assertEquals(setOf("/api/me/recording-notes/e1/seen", "/api/me/recording-notes/f1/seen"), setOf(server.takeRequest().path, server.takeRequest().path))
        assertEquals("/api/me/recording-notes", server.takeRequest().path)
        assertEquals("/api/me/tutor-notes?include_seen=1&limit=200", server.takeRequest().path)
        assertEquals(0, platform.outbox.pendingCount())
        assertEquals(emptySet<String>(), platform.cache.get<Set<String>>(TutorNotes.SEEN_KEY))
    }

    @Test fun aSeenNoteStaysHiddenWhileTheServerStillListsIt() = runBlocking {
        server.enqueue(MockResponse().setBody(two))
        server.enqueue(MockResponse().setBody(all))
        platform.afterSync(full = false)
        server.takeRequest()
        server.takeRequest()
        TutorNotes.markSeen(platform.cache, platform.outbox, listOf("e1"))
        // The seen post fails (server hiccup): the note must not come back.
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setBody(two))
        server.enqueue(MockResponse().setBody(all))
        platform.afterSync(full = false)
        assertEquals(listOf("f1"), TutorNotes.forCard(platform.cache, "c1", "n1").map { it.id })
        assertEquals(1, platform.outbox.pendingCount())
    }
}
