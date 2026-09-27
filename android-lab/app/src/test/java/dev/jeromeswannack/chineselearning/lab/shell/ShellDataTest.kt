package dev.jeromeswannack.chineselearning.lab.shell

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.Repository
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import dev.jeromeswannack.chineselearning.lab.ui.home.TodayCounts
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The widget / notification data provider reads the same queue as Home and the session, and a
 * rating from a notification is exactly an in-app review (event appended, state recomputed
 * from events, queued for upload).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ShellDataTest {
    private val zone = ZoneId.of("Europe/London")
    private val now = Js.parseDate("2026-09-27T10:00:00.000Z")
    private val day = 24 * 60 * 60 * 1000L
    private lateinit var ctx: Application
    private lateinit var db: LabDatabase
    private lateinit var prefs: Prefs

    @Before
    fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        db = newDb()
        prefs = Prefs(ctx).apply { clearAccount(); sessionToken = "test-token"; budget = StudyBudget(3, 6) }
    }

    @After
    fun tearDown() = db.close()

    private fun newDb() = Room.inMemoryDatabaseBuilder(ctx, LabDatabase::class.java).allowMainThreadQueries().build()

    private fun note(id: String, hanzi: String) =
        NoteEntity(id, "d1", hanzi, "xuéxí", "to study", null, null, null, "我每天学习中文。", null, "I study Chinese every day.", null, null, null)

    /** 10 unseen words (30 new cards) + one word in review, long overdue. */
    private suspend fun seed(db: LabDatabase) {
        val dao = db.dao()
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 3", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        val notes = (1..10).map { note("n$it", "字$it") } + note("seen", "学习")
        dao.upsertNotes(notes)
        val cards = notes.flatMap { n ->
            listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi").map { t -> CardEntity("${n.id}-$t", n.id, "d1", t) }
        }
        dao.insertCardsIfMissing(cards)
        val events = listOf(
            ReviewEventEntity("e1", "seen-hanzi_to_meaning", Rating.GOOD, Js.toIsoString(now - 60 * day), 1000, null, synced = true),
            ReviewEventEntity("e2", "seen-hanzi_to_meaning", Rating.GOOD, Js.toIsoString(now - 60 * day + 11 * 60_000), 1000, null, synced = true),
            ReviewEventEntity("e3", "seen-hanzi_to_meaning", Rating.GOOD, Js.toIsoString(now - 50 * day), 1000, null, synced = true),
        )
        dao.insertEvents(events)
        val byCard = events.groupBy { it.cardId }
        dao.upsertCards(cards.map { c -> c.withState(CardScheduler.computeCardState(byCard[c.id].orEmpty().map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) })) })
    }

    @Test
    fun widgetCountsAreTheStudyButtonsAndRespectTheBudget() = runBlocking {
        seed(db)
        val snap = ShellSnapshot.load(db.dao(), prefs, emptyList(), now, zone)
        assertEquals(TodayCounts.compute(db.dao(), prefs, now, zone), snap.due)
        // The global budget (3 new words a day) caps the new cards, whatever the deck caps say.
        assertEquals(3, snap.due.new)
        assertEquals(1, snap.due.review)
        // Only the overdue review card may be asked about — never a new one.
        assertEquals("seen-hanzi_to_meaning", snap.notifyCard?.id)
        assertTrue(snap.stillDue("seen-hanzi_to_meaning"))
        assertFalse(snap.stillDue("n1-hanzi_to_meaning"))
    }

    @Test
    fun signedOutShowsNothing() = runBlocking {
        seed(db)
        prefs.sessionToken = null
        val snap = ShellSnapshot.load(db.dao(), prefs, listOf(ShellRules.HomeworkItem("h", "HSK", "deck", "one_off", "2026-09-27", "active")), now, zone)
        assertFalse(snap.signedIn)
        assertEquals(0, snap.due.total)
        assertNull(snap.notifyCard)
        assertTrue(snap.homework.isEmpty())
        assertEquals("Sign in to start studying", ShellRules.widgetText(snap.widget).detail)
    }

    @Test
    fun homeworkDueTodayReachesTheWidget() = runBlocking {
        seed(db)
        val items = listOf(
            ShellRules.HomeworkItem("h1", "Unit 4 words", "deck", "one_off", "2026-09-27", "active"),
            ShellRules.HomeworkItem("h2", "Next week", "deck", "one_off", "2026-10-04", "active"),
        )
        val snap = ShellSnapshot.load(db.dao(), prefs, items, now, zone)
        assertEquals(listOf("h1"), snap.homework.map { it.item.id })
        assertEquals("📝 Unit 4 words · due today", ShellRules.widgetText(snap.widget).homework)
    }

    @Test
    fun ratingFromANotificationIsAnInAppReview() = runBlocking {
        seed(db)
        val cardId = "seen-hanzi_to_meaning"
        val repo = Repository(ctx, db, Api(tokenProvider = { null }), prefs)
        val content = assertNotNull(NotificationReview.content(db.dao(), cardId))
        assertEquals("学习", content.hanzi)
        assertEquals("我每天学习中文。", content.sentence)
        val previews = NotificationReview.previews(db.dao(), cardId, now)
        assertEquals(CardScheduler.intervalPreviews(db.dao().card(cardId)!!.state(), now), previews)

        val rated = NotificationReview.rate(repo, cardId, Rating.GOOD, now)

        // The event is appended locally, unsynced (sync / the upload worker send it)…
        val events = db.dao().eventsForCard(cardId)
        assertEquals(4, events.size)
        val added = events.single { it.id == rated.eventId }
        assertEquals(Rating.GOOD, added.rating)
        assertEquals(Js.toIsoString(now), added.reviewedAt)
        assertFalse(added.synced)
        assertEquals(1, db.dao().unsyncedCount())
        // …and the card is exactly its events replayed.
        val card = db.dao().card(cardId)!!
        val expected = CardScheduler.computeCardState(events.map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) })
        assertEquals(CardEntity(cardId, "seen", "d1", "hanzi_to_meaning").withState(expected), card)
        assertEquals(CardQueue.REVIEW, card.queue)
        assertEquals("学习", rated.hanzi)
        assertEquals(previews.first { it.rating == Rating.GOOD }.intervalText, rated.nextIn)

        // Same inputs through the session's own path give the same card.
        val other = newDb()
        seed(other)
        Repository(ctx, other, Api(tokenProvider = { null }), prefs).recordReview(cardId, Rating.GOOD, null, null, now)
        assertEquals(card, other.dao().card(cardId))
        other.close()

        // Once answered it is no longer due: the widget count drops and no card is left to ask.
        val after = ShellSnapshot.load(db.dao(), prefs, emptyList(), now, zone)
        assertEquals(0, after.due.review)
        assertNull(after.notifyCard)
    }
}
