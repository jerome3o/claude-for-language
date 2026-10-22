package dev.jeromeswannack.chineselearning.lab.ui.today

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import dev.jeromeswannack.chineselearning.lab.data.api.CustomLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonStore
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderStore
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonSamples
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyViewModel
import dev.jeromeswannack.chineselearning.lab.ui.study.TodayLeft
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * The Lab "today split" in the real session: flashcards only, then the "Flashcards done" pause,
 * then today's story. Mini lessons are never part of the session any more (Oct 2026) — even with
 * new lessons on the phone; they are done from Home's homework card and the Mini Lessons page.
 * The story read from Home is not offered again and the session just ends.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class TodaySplitStudyTest {
    private lateinit var app: LabApp
    private val now = System.currentTimeMillis()
    private val day = 86_400_000L

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(0, 0)
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        seedCards(12)
        seedExtras(app)
    }

    private suspend fun seedCards(n: Int) {
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 3", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        val words = listOf("一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "百", "千").take(n)
        dao.upsertNotes(words.mapIndexed { i, h -> NoteEntity("n$i", "d1", h, "yī", "one", null, null, "f", "s", null, null, null, null, null) })
        val cards = words.indices.map { CardEntity("c$it", "n$it", "d1", "meaning_to_hanzi") }
        dao.insertCardsIfMissing(cards)
        val events = cards.map { ReviewEventEntity("e-${it.id}", it.id, Rating.GOOD, Js.toIsoString(now - 40 * day), 1000, null, synced = true) }
        dao.insertEvents(events)
        dao.upsertCards(cards.map { c -> c.withState(CardScheduler.computeCardState(events.filter { it.cardId == c.id }.map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) })) })
    }

    private fun idle() = shadowOf(android.os.Looper.getMainLooper()).idle()

    private fun awaitUi(vm: StudyViewModel, what: String, ok: (StudyUi) -> Boolean): StudyUi {
        // Up to ~10 s: the view model's loads run on background dispatchers, slower on a busy CI runner.
        repeat(1000) {
            idle()
            val u = vm.ui.value
            if (ok(u)) return u
            Thread.sleep(10)
        }
        error("timed out waiting for $what: ${vm.ui.value.phase}")
    }

    private fun result() = LessonResult(1, 1, LessonAttemptData(Js.toIsoString(now), 1_000, emptyList()), emptyList())

    @Test
    fun flashcardsOnlyThenThePauseThenTheStoryNeverALesson() {
        val vm = StudyViewModel(app, null)
        var rated = 0
        while (true) {
            val u = awaitUi(vm, "a card or the pause") { it.phase is StudyPhase.Showing || it.phase is StudyPhase.Extras }
            if (u.phase is StudyPhase.Extras) break
            assertEquals(TodayLeft(0, true), u.todayLeft) // the top bar's 📖1 — no 📘
            val presentation = (u.phase as StudyPhase.Showing).view.presentation
            vm.rate(Rating.GOOD, 2_000, null)
            rated++
            awaitUi(vm, "the next item") { n ->
                assertFalse(n.phase is StudyPhase.Reader, "no reader between the cards")
                (n.phase as? StudyPhase.Showing)?.view?.presentation != presentation
            }
        }
        assertEquals(12, rated)
        val pause = awaitUi(vm, "the pause with today's numbers") { it.phase is StudyPhase.Extras && it.today != null }
        val extras = pause.phase as StudyPhase.Extras
        assertEquals(0, extras.lessons)
        assertTrue(extras.reader)
        assertEquals(listOf("📖 小明在巴黎"), extras.titles)
        assertTrue(pause.today!!.celebrate) // the cards' celebration, once a day

        // Continue: the story, then done.
        vm.continueToExtras()
        awaitUi(vm, "the story") { it.phase is StudyPhase.Reader }
        vm.finishReader(30_000)
        val done = awaitUi(vm, "done with today's numbers") { it.phase is StudyPhase.Done && it.today != null }
        assertTrue(done.today!!.readerDone)
        assertTrue(done.today!!.allClear) // the second, smaller celebration
        assertFalse(done.today!!.celebrate)
        runBlocking { assertTrue(app.outbox.all().any { it.path == "/api/reader-reviews" }) }
    }

    @Test
    fun theStoryReadFromHomeIsNotOfferedAgain() {
        runBlocking {
            TodayData(app).finishReader("R1", 20_000)
            val home = TodayHomeLoader.load(app)
            assertEquals(TodayReaderRow.State.READ, home.reader.state)
            assertEquals(12, home.cardsDue)
        }
        val vm = StudyViewModel(app, null)
        repeat(12) {
            val u = awaitUi(vm, "a card") { it.phase is StudyPhase.Showing }
            assertEquals(TodayLeft(), u.todayLeft)
            val presentation = (u.phase as StudyPhase.Showing).view.presentation
            vm.rate(Rating.GOOD, 2_000, null)
            awaitUi(vm, "next") { n -> (n.phase as? StudyPhase.Showing)?.view?.presentation != presentation }
        }
        // No pause: the session just ends, with the usual celebration.
        val done = awaitUi(vm, "done") { it.phase is StudyPhase.Done && it.today != null }
        assertTrue(done.today!!.celebrate)
        assertTrue(done.today!!.readerDone)
    }

    @Test
    fun noCardsDueOpensOnThePauseWithTheStory() {
        runBlocking {
            // Every card reviewed today already: nothing due.
            val dao = app.repo.dao
            dao.cards().forEach { c ->
                val events = listOf(
                    ReviewEventInput("e-${c.id}", c.id, Rating.GOOD, Js.toIsoString(now - 40 * day)),
                    ReviewEventInput("t-${c.id}", c.id, Rating.EASY, Js.toIsoString(now - 60_000)),
                )
                dao.insertEvents(listOf(ReviewEventEntity("t-${c.id}", c.id, Rating.EASY, Js.toIsoString(now - 60_000), 1000, null, synced = true)))
                dao.upsertCards(listOf(c.withState(CardScheduler.computeCardState(events))))
            }
        }
        val vm = StudyViewModel(app, null)
        val u = awaitUi(vm, "the pause") { it.phase is StudyPhase.Extras }
        assertIs<StudyPhase.Extras>(u.phase)
        assertEquals(0, (u.phase as StudyPhase.Extras).lessons)
        assertTrue((u.phase as StudyPhase.Extras).reader)
    }

    @Test
    fun completingALessonClearsItsHalfDoneRun() {
        runBlocking {
            val progress = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore.get(app)
            val entry = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime.of(app).store.entry("L1")!!
            val shape = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore.shape(entry.lesson.spec)
            progress.save(dev.jeromeswannack.chineselearning.lab.data.lessons.SavedLessonRun("L1", shape, state = dev.jeromeswannack.chineselearning.lab.core.LessonRun.State(pos = 1), startedAt = now, savedAt = now))
            assertTrue(progress.has("L1"))
            assertEquals(setOf("L1"), progress.inProgress().keys)
            TodayData(app).completeLesson("L1", result())
            assertFalse(progress.has("L1"))
        }
    }

    companion object {
        /** Two new lessons (+ a third when asked) and today's story on the phone, as a sync leaves them. */
        suspend fun seedExtras(app: LabApp, lessons: Int = 2) {
            val spec = CustomLessonSpec("把 sentences", sections = listOf(LessonSection(exercises = listOf(LessonSamples.choice))))
            val all = listOf(
                CustomLessonDto("L1", "把 sentences", icon = "🧱", createdAt = "2026-09-01T00:00:00Z", spec = spec),
                CustomLessonDto("L2", "有 vs 又", createdAt = "2026-09-02T00:00:00Z", spec = spec.copy(title = "有 vs 又")),
                CustomLessonDto("L3", "了 at the end", createdAt = "2026-09-03T00:00:00Z", spec = spec.copy(title = "了")),
            ).take(lessons)
            app.cache.put(LessonStore.LIST, LessonStore.KIND, all, ListSerializer(CustomLessonDto.serializer()))
            val reader = GradedReaderDto(
                "R1", "小明在巴黎", "Xiaoming in Paris", createdAt = "2026-09-20T00:00:00Z",
                pages = listOf(ReaderPageDto("p1", 1, "小明在巴黎。他很高兴。", "Xiǎo Míng zài Bālí. Tā hěn gāoxìng.", "Xiaoming is in Paris. He is happy.")),
            )
            app.cache.put(ReaderStore.LIST, ReaderStore.KIND, listOf(reader), ListSerializer(GradedReaderDto.serializer()))
        }
    }
}
