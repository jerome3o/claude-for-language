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
 * The Lab "today split" in the real session: flashcards only (no lesson every 8 reviews),
 * then the "Flashcards done" pause, then the leftover lessons and today's story in the usual
 * order; lessons / the story done from Home are not offered again and the session just ends.
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

    private fun result(rating: Int) = LessonResult(1, 1, rating, LessonAttemptData(Js.toIsoString(now), 1_000, emptyList()), emptyList())

    @Test
    fun flashcardsOnlyThenThePauseThenLessonsAndTheStory() {
        val vm = StudyViewModel(app, null)
        // 12 cards, well past the old 8-review lesson break: never a lesson in between.
        var rated = 0
        while (true) {
            val u = awaitUi(vm, "a card or the pause") { it.phase is StudyPhase.Showing || it.phase is StudyPhase.Extras }
            if (u.phase is StudyPhase.Extras) break
            assertEquals(TodayLeft(2, true), u.todayLeft) // the top bar's 📘2 📖1
            val presentation = (u.phase as StudyPhase.Showing).view.presentation
            vm.rate(Rating.GOOD, 2_000, null)
            rated++
            awaitUi(vm, "the next item") { n ->
                assertFalse(n.phase is StudyPhase.Lesson || n.phase is StudyPhase.Reader, "no lesson / reader between the cards")
                (n.phase as? StudyPhase.Showing)?.view?.presentation != presentation
            }
        }
        assertEquals(12, rated)
        val pause = awaitUi(vm, "the pause with today's numbers") { it.phase is StudyPhase.Extras && it.today != null }
        val extras = pause.phase as StudyPhase.Extras
        assertEquals(2, extras.lessons)
        assertTrue(extras.reader)
        assertEquals(listOf("🧱 把 sentences", "📘 有 vs 又", "📖 小明在巴黎"), extras.titles)
        assertTrue(pause.today!!.celebrate) // the cards' celebration, once a day

        // Continue: the leftover lessons (oldest new first), then the story.
        vm.continueToExtras()
        val first = awaitUi(vm, "lesson 1") { it.phase is StudyPhase.Lesson }.phase as StudyPhase.Lesson
        assertEquals("L1", first.lesson.entry.id)
        vm.completeLesson(result(Rating.EASY))
        val second = awaitUi(vm, "lesson 2") { (it.phase as? StudyPhase.Lesson)?.lesson?.entry?.id == "L2" }
        assertEquals(TodayLeft(1, true), second.todayLeft)
        vm.completeLesson(result(Rating.EASY))
        awaitUi(vm, "the story") { it.phase is StudyPhase.Reader }
        vm.finishReader(30_000)
        val done = awaitUi(vm, "done with today's numbers") { it.phase is StudyPhase.Done && it.today != null }
        assertEquals(2, done.today!!.lessonsDone)
        assertTrue(done.today!!.readerDone)
        assertTrue(done.today!!.allClear) // the second, smaller celebration
        assertFalse(done.today!!.celebrate)
        // Recorded like any session lesson / story.
        runBlocking {
            assertEquals(1, app.cache.get(LessonStore.LOCAL, ListSerializer(dev.jeromeswannack.chineselearning.lab.data.lessons.LocalCompletion.serializer()))!!.count { it.lessonId == "L1" })
            assertTrue(app.outbox.all().any { it.path == "/api/reader-reviews" })
        }
    }

    @Test
    fun extrasDoneFromHomeAreNotOfferedAgain() {
        runBlocking {
            val today = TodayData(app)
            today.completeLesson("L1", result(Rating.EASY))
            today.completeLesson("L2", result(Rating.EASY))
            today.finishReader("R1", 20_000)
            val home = TodayHomeLoader.load(app)
            assertEquals(0, home.lessonsToDo.size)
            assertEquals(2, home.lessonsDone.size)
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
        assertEquals(2, done.today!!.lessonsDone)
        assertTrue(done.today!!.readerDone)
    }

    @Test
    fun noCardsDueOpensOnThePause() {
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
        assertEquals(2, (u.phase as StudyPhase.Extras).lessons)
    }

    @Test
    fun aNewLessonStartedTodayTakesOneOfTheDaysSlots() {
        runBlocking {
            seedExtras(app, lessons = 3)
            assertEquals(listOf("L1", "L2"), TodayHomeLoader.load(app).lessonsToDo.map { it.id })
            TodayData(app).completeLesson("L1", result(Rating.EASY))
            val after = TodayHomeLoader.load(app)
            // L3 isn't pulled in: "New lessons a day" = 2 here.
            assertEquals(listOf("L2"), after.lessonsToDo.map { it.id })
            assertEquals(listOf("L1"), after.lessonsDone.map { it.id })
        }
    }

    @Test
    fun oneNewLessonADayByDefault() {
        runBlocking {
            seedExtras(app, lessons = 3, newLessonsPerDay = null)
            assertEquals(listOf("L1"), TodayHomeLoader.load(app).lessonsToDo.map { it.id })
            TodayData(app).completeLesson("L1", result(Rating.GOOD))
            val after = TodayHomeLoader.load(app)
            // The day's one new lesson is done: L2 waits for tomorrow.
            assertEquals(emptyList<String>(), after.lessonsToDo.map { it.id })
            assertEquals(listOf("L1"), after.lessonsDone.map { it.id })
        }
    }

    @Test
    fun completingALessonClearsItsHalfDoneRun() {
        runBlocking {
            val progress = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore.get(app)
            val entry = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime.of(app).store.entry("L1")!!
            val hash = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore.specHash(entry.lesson.spec)
            progress.save("L1", hash, 1, 1, 1, now, emptyList(), emptyList())
            assertTrue(progress.has("L1"))
            assertEquals(listOf(true), TodayHomeLoader.load(app).lessonsToDo.filter { it.id == "L1" }.map { it.inProgress })
            TodayData(app).completeLesson("L1", result(Rating.GOOD))
            assertFalse(progress.has("L1"))
        }
    }

    companion object {
        /**
         * Two new lessons (+ a third when asked) and today's story on the phone, as a sync leaves
         * them; "New lessons a day" = [newLessonsPerDay] (null = the default, one a day).
         */
        suspend fun seedExtras(app: LabApp, lessons: Int = 2, newLessonsPerDay: Int? = 2) {
            app.cache.put(
                dev.jeromeswannack.chineselearning.lab.data.revisit.RevisitStore.SETTINGS,
                dev.jeromeswannack.chineselearning.lab.data.revisit.RevisitStore.KIND,
                newLessonsPerDay?.let { dev.jeromeswannack.chineselearning.lab.data.api.RevisitSettingsDto(new_lessons_per_day = it.toDouble(), is_default = false) }
                    ?: dev.jeromeswannack.chineselearning.lab.data.api.RevisitSettingsDto(),
                dev.jeromeswannack.chineselearning.lab.data.api.RevisitSettingsDto.serializer(),
            )
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
