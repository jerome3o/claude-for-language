package dev.jeromeswannack.chineselearning.lab.data.audio

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.NoteAudio
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.Repository
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Auto-audio against a fake server: a silent card gets its clips made, mirrored into Room and
 * cached; one request per note at a time; failures back off (the retry tap doesn't wait);
 * offline requests wait in a queue that survives a restart; a clip that 404s is remade; the
 * sync's pass covers the upcoming queue.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NoteAudioFixerTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var repo: Repository
    private var online = true
    private var now = 1_000_000L
    /** POST bodies of ensure-audio, by note id. */
    private val ensured = Collections.synchronizedList(mutableListOf<Pair<String, String>>())
    /** Notes the fake server can't make audio for. */
    private val failing = Collections.synchronizedSet(HashSet<String>())
    /** Clip keys the fake server has (GET /api/audio/<key>). */
    private val clips = Collections.synchronizedSet(HashSet<String>())
    private var hold: CountDownLatch? = null

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                return when {
                    path.startsWith("/api/notes/") && path.endsWith("/ensure-audio") -> {
                        val id = path.removePrefix("/api/notes/").removeSuffix("/ensure-audio")
                        ensured += id to request.body.readUtf8()
                        hold?.await(5, TimeUnit.SECONDS)
                        if (id in failing) MockResponse().setBody("""{"note":null,"word":"failed","sentence":"failed"}""")
                        else {
                            clips += "generated/$id.mp3"
                            clips += "generated/$id-s.mp3"
                            MockResponse().setBody(
                                """{"note":{"id":"$id","deck_id":"d1","hanzi":"刮风","pinyin":"guā fēng","english":"to be windy","audio_url":"generated/$id.mp3",""" +
                                    """"sentence_clue":"今天刮风了。","sentence_clue_audio_url":"generated/$id-s.mp3"},"word":"generated","sentence":"generated"}""",
                            )
                        }
                    }
                    path.startsWith("/api/audio/") -> {
                        val key = path.removePrefix("/api/audio/")
                        if (key in clips) MockResponse().setBody(Buffer().write(ByteArray(64) { 1 })) else MockResponse().setResponseCode(404)
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        File(context.filesDir, "audio").deleteRecursively()
        db = Room.inMemoryDatabaseBuilder(context, LabDatabase::class.java).allowMainThreadQueries().build()
        val prefs = Prefs(context).apply { budget = StudyBudget(3, 0) }
        repo = Repository(context, db, Api(server.url("").toString().removeSuffix("/")) { "token-1" }, prefs)
    }

    @After fun tearDown() {
        hold?.countDown()
        server.shutdown()
        db.close()
    }

    private fun fixer() = NoteAudioFixer(repo, online = { online }, clock = { now })

    private fun note(id: String, audio: String? = null, clue: String? = "今天刮风了。", clueAudio: String? = null) =
        NoteEntity(id, "d1", "刮风", "guā fēng", "to be windy", audio, null, null, clue, null, null, clueAudio, null, null)

    private suspend fun seed(vararg notes: NoteEntity) {
        repo.dao.upsertDecks(listOf(DeckEntity("d1", "Weather", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        repo.dao.upsertNotes(notes.toList())
        repo.dao.insertCardsIfMissing(notes.map { CardEntity("c-${it.id}", it.id, "d1", "audio_to_hanzi") })
    }

    @Test fun aSilentCardGetsItsClipsMirroredAndCached() = runBlocking {
        seed(note("n1"))
        val f = fixer()
        val made = async(start = CoroutineStart.UNDISPATCHED) { withTimeout(5_000) { f.updates.first() } }
        f.checkCard(repo.dao.note("n1")!!).join()
        assertEquals(listOf("n1" to "{}"), ensured.toList())
        val row = repo.dao.note("n1")!!
        assertEquals("generated/n1.mp3", row.audioUrl)
        assertEquals("generated/n1-s.mp3", row.sentenceClueAudioUrl)
        assertEquals(row, made.await())
        assertNotNull("word clip cached for offline", repo.cachedAudio("generated/n1.mp3"))
        assertNotNull("sentence clip cached for offline", repo.cachedAudio("generated/n1-s.mp3"))
        assertNull(f.statuses.value["n1"])
        // Idempotent from here: nothing missing, nothing sent.
        f.checkCard(row).join()
        assertEquals(1, ensured.size)
    }

    @Test fun aNoteWithBothClipsIsLeftAloneAndAMissingSentenceClipAloneIsAsked() = runBlocking {
        clips += "generated/w.mp3"
        clips += "generated/w2.mp3"
        seed(note("full", audio = "generated/w.mp3", clueAudio = "generated/w.mp3"), note("noClue", audio = "generated/w2.mp3"))
        val f = fixer()
        f.checkCard(repo.dao.note("full")!!).join()
        assertTrue(ensured.isEmpty())
        assertNotNull("an uncached clip is downloaded when the card shows", repo.cachedAudio("generated/w.mp3"))
        f.checkCard(repo.dao.note("noClue")!!).join()
        assertEquals(listOf("noClue"), ensured.map { it.first })
    }

    @Test fun oneRequestPerNoteAtATime() = runBlocking {
        seed(note("n1"))
        val f = fixer()
        hold = CountDownLatch(1)
        val first = async(kotlinx.coroutines.Dispatchers.IO) { f.ensure("n1") }
        withTimeout(5_000) { while (f.statuses.value["n1"] != NoteAudio.Status.Generating) kotlinx.coroutines.delay(5) }
        assertNull("deduped while the first is in flight", f.ensure("n1"))
        assertNull("even the retry tap", f.ensure("n1", manual = true))
        hold!!.countDown()
        assertNotNull(first.await())
        assertEquals(1, ensured.size)
    }

    @Test fun failuresBackOffAndTheRetryTapSkipsTheWait() = runBlocking {
        seed(note("n1"))
        failing += "n1"
        val f = fixer()
        f.ensure("n1")
        val status = f.statuses.value["n1"] as NoteAudio.Status.Failed
        assertEquals(1, status.attempts)
        assertEquals(now + NoteAudio.BACKOFF_MS[0], status.retryAtMs)
        f.ensure("n1") // backing off: not sent
        assertEquals(1, ensured.size)
        f.ensure("n1", manual = true) // "Couldn't make audio — retry"
        assertEquals(2, ensured.size)
        failing -= "n1"
        now += NoteAudio.BACKOFF_MS[1]
        assertNotNull(f.ensure("n1"))
        assertNull(f.statuses.value["n1"])
    }

    @Test fun offlineRequestsWaitAndSurviveARestartThenTheSyncMakesThem() = runBlocking {
        seed(note("n1"), note("n2"))
        online = false
        val f = fixer()
        f.checkCard(repo.dao.note("n1")!!).join()
        assertEquals(NoteAudio.Status.WaitingForConnection, f.statuses.value["n1"])
        assertTrue(ensured.isEmpty())
        // The app is closed on the train and opened again later, online.
        val again = fixer()
        online = true
        again.backfillInBackground().join()
        // The queued note first, then the upcoming queue.
        assertEquals(setOf("n1", "n2"), ensured.map { it.first }.toSet())
        assertEquals("generated/n1.mp3", repo.dao.note("n1")!!.audioUrl)
        assertTrue(repo.platform.cache.get<List<String>>(NoteAudioFixer.QUEUE_KEY).orEmpty().isEmpty())
    }

    @Test fun aClipThat404sIsRemadeWithItsKeyReported() = runBlocking {
        seed(note("n1", audio = "generated/gone.mp3", clue = null))
        val f = fixer()
        f.checkCard(repo.dao.note("n1")!!).join()
        assertEquals(listOf("n1" to """{"broken":["generated/gone.mp3"]}"""), ensured.toList())
        assertEquals("generated/n1.mp3", repo.dao.note("n1")!!.audioUrl)
        assertTrue(f.brokenKeys().isEmpty())
    }

    @Test fun theSyncPassCoversTheUpcomingQueueAFewAtATime() = runBlocking {
        val many = (1..20).map { note("m$it") }
        seed(*many.toTypedArray())
        val f = fixer()
        f.backfillInBackground().join()
        // Today's 3 new cards + the next 10 new ones, capped at the per-sync limit.
        assertEquals(NoteAudio.MAX_PER_SYNC, ensured.size)
        f.backfillInBackground().join()
        assertTrue("the next pass continues where it stopped", ensured.size > NoteAudio.MAX_PER_SYNC)
        assertEquals(ensured.size, ensured.map { it.first }.toSet().size)
    }
}
