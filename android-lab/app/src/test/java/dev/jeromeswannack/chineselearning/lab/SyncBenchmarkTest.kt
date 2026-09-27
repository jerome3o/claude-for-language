package dev.jeromeswannack.chineselearning.lab

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.Repository
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * How long the first (full) sync and a follow-up sync of a big account take, with the real
 * Repository against a real local worker and a FILE-backed Room database (per-transaction
 * commits cost something, as on a phone — where they cost much more).
 *
 * Opt-in. Seed an account shaped like a heavy user (24 decks, ~3,000 notes / 9,000 cards,
 * ~45k review events: `/api/test/auth`, `POST /api/decks`, `POST /api/decks/:id/notes/batch`,
 * `POST /api/reviews` in batches of 500), then:
 * `LAB_E2E_API=http://localhost:8787 LAB_BENCH_TOKEN=<session token> ./gradlew :app:testDebugUnitTest --tests '*SyncBenchmarkTest*' -i`
 * and read the `BENCH` lines.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SyncBenchmarkTest {
    private val base = System.getenv("LAB_E2E_API")
    private val token = System.getenv("LAB_BENCH_TOKEN")

    private fun report(label: String, repo: Repository, ms: Long) {
        println("BENCH === $label: $ms ms")
        repo.status.value.lastRun?.phases?.forEach { println("BENCH   %-20s %6d ms  %s".format(it.name, it.ms, it.detail)) }
    }

    @Test
    fun fullThenIncrementalSyncOfABigAccount() = runBlocking {
        assumeTrue("set LAB_E2E_API and LAB_BENCH_TOKEN to run the sync benchmark", base != null && token != null)
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        val db = Room.databaseBuilder(ctx, LabDatabase::class.java, "bench-${UUID.randomUUID()}.db").build()
        val prefs = Prefs(ctx).apply { clearAccount(); sessionToken = token }
        val repo = Repository(ctx, db, Api(base!!) { prefs.sessionToken }, prefs)

        var t = System.nanoTime()
        repo.sync()
        report("first sync (full)", repo, (System.nanoTime() - t) / 1_000_000)
        assertNull(repo.status.value.error, "sync error: ${repo.status.value.error}")

        t = System.nanoTime()
        repo.sync()
        report("second sync (incremental, nothing new)", repo, (System.nanoTime() - t) / 1_000_000)
        assertNull(repo.status.value.error)

        t = System.nanoTime()
        repo.sync(forceFull = true)
        report("full resync (everything local already)", repo, (System.nanoTime() - t) / 1_000_000)
        assertNull(repo.status.value.error)
        repo.awaitAudioPrefetch()

        // The home screen's work after a sync (HomeViewModel.load): one queue for "all" + one per deck.
        val dao = repo.dao
        repeat(3) { round ->
            t = System.nanoTime()
            val zone = ZoneId.of("Europe/London")
            val now = System.currentTimeMillis()
            val decks = dao.decks()
            val cards = dao.cards().map { it.toQueueCard() }
            val tCards = (System.nanoTime() - t) / 1_000_000
            val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
            val tFirst = (System.nanoTime() - t) / 1_000_000
            val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(now, zone))
            val tIntro = (System.nanoTime() - t) / 1_000_000
            val cutoff = StudyQueue.cutoff(now, zone)
            val queueDecks = decks.map { it.toQueueDeck() }
            StudyQueue.build(queueDecks, cards, StudyBudget.DEFAULT, 0, introduced, cutoff, null)
            val tAll = (System.nanoTime() - t) / 1_000_000
            decks.forEach { d -> StudyQueue.build(queueDecks, cards, StudyBudget.DEFAULT, 0, introduced, cutoff, d.id) }
            println("BENCH home load round $round: ${(System.nanoTime() - t) / 1_000_000} ms (cards $tCards, firstReviews $tFirst, introduced $tIntro, all-queue $tAll)")
        }

        // Correctness: every card's cached state is exactly the replay of its events.
        val events = dao.allEvents().groupBy { it.cardId }
        val cards = dao.cards()
        var reviewed = 0
        for (c in cards) {
            val evs = events[c.id].orEmpty().map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) }
            if (evs.isNotEmpty()) reviewed++
            val want = c.withState(CardScheduler.computeCardState(evs))
            assertEquals(want, c, c.id)
        }
        println("BENCH cards=${cards.size} reviewedCards=$reviewed events=${events.values.sumOf { it.size }} notes=${dao.noteCount()} decks=${dao.decks().size}")
        db.close()
    }
}
