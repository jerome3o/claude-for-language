package dev.jeromeswannack.chineselearning.lab.ui.today

import androidx.compose.runtime.Composable
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonResume
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonPlayer
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResumeHandle
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonSamples
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PlayerContext
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.study.CardView
import dev.jeromeswannack.chineselearning.lab.ui.study.SessionStats
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.study.TodayLeft
import dev.jeromeswannack.chineselearning.lab.ui.study.TodaySummary
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * The Lab "today split" (`./gradlew :app:recordRoborazziDebug` → app/screenshots/today-*.png):
 * Home with the three kinds (all to do / some done / all done), the "Flashcards done" pause,
 * today's lesson list, the top-bar chip, the all-clear finish, and a lesson continuing where
 * it was left. Folded + unfolded, light + dark.
 */
class TodayScreenshots : LabScreenshotTest() {
    private val decks = listOf(
        DeckSummary("d1", "HSK 3 · Plans & time", 120, QueueCounts(3, 2, 1, 9)),
        DeckSummary("d2", "Homework — 周末的活动", 24, QueueCounts(0, 0, 0, 6)),
        DeckSummary("d3", "Food & ordering", 58, QueueCounts(0, 0, 0, 3)),
    )
    private val sync = SyncStatus(lastSyncAt = System.currentTimeMillis() - 4 * 60_000, audioTotal = 830, audioCached = 812)

    @Composable
    private fun home(today: TodayHome, due: QueueCounts) = HomeScreen(
        ui = HomeUi(loaded = true, userName = "Jerome Swannack", due = due, reviewedToday = today.cardsReviewed, decks = decks, today = today),
        sync = sync, online = true, actions = HomeActions(),
    )

    private val dueNow = QueueCounts(3, 2, 1, 18)
    private val none = QueueCounts(0, 0, 0, 0)

    @Test fun homeAllToDo() = shootInShell("today-01-home", TabId.STUDY) { home(TodaySamples.midDay, dueNow) }
    @Test fun homeSomeDone() = shootInShell("today-02-home-some-done", TabId.STUDY) { home(TodaySamples.someDone, none) }
    @Test fun homeAllDone() = shootInShell("today-03-home-all-done", TabId.STUDY) { home(TodaySamples.allDone, none) }
    @Test fun homeDark() = shootInShell("today-04-home-dark", TabId.STUDY, dark = true) { home(TodaySamples.midDay, dueNow) }
    @Config(qualifiers = UNFOLDED)
    @Test fun homeUnfolded() = shootInShell("today-05-home-unfolded", TabId.STUDY) { home(TodaySamples.someDone, none) }

    @Composable
    private fun pause(celebrate: Boolean) = StudyScreen(
        StudyUi(StudyPhase.Extras(2, true, TodaySamples.pauseTitles), none, SessionStats(reviews = 24, correct = 21), canUndo = true,
            today = TodaySummary(23 * 60_000L + 20_000, 142, 121, celebrate = celebrate)),
        playingKey = null, actions = StudyActions(), autoplay = false,
    )

    @Test fun thePause() = shoot("today-06-pause") { pause(celebrate = false) }
    @Test fun thePauseCelebrating() = shoot("today-07-pause-celebrating", settleMs = 900) { pause(celebrate = true) }
    @Test fun thePauseDark() = shoot("today-08-pause-dark", dark = true) { pause(celebrate = false) }
    @Config(qualifiers = UNFOLDED)
    @Test fun thePauseUnfolded() = shoot("today-09-pause-unfolded") { pause(celebrate = false) }

    @Test fun lessonList() = shoot("today-10-lesson-list") { TodayLessonsScreen(TodaySamples.midDay, {}, {}, {}) }
    @Test fun lessonListDark() = shoot("today-11-lesson-list-dark", dark = true) { TodayLessonsScreen(TodaySamples.someDone, {}, {}, {}) }
    @Config(qualifiers = UNFOLDED)
    @Test fun lessonListUnfolded() = shoot("today-12-lesson-list-unfolded") { TodayLessonsScreen(TodaySamples.midDay, {}, {}, {}) }

    private val note = NoteEntity(
        id = "n1", deckId = "d1", hanzi = "打算", pinyin = "dǎsuàn", english = "to plan; to intend", audioUrl = null,
        funFacts = "**打** (dǎ) to hit, to do · **算** (suàn) to calculate", context = null,
        sentenceClue = "你周末打算做什么？", sentenceCluePinyin = "Nǐ zhōumò dǎsuàn zuò shénme?", sentenceClueTranslation = "What are you planning to do this weekend?",
        sentenceClueAudioUrl = null, alternatives = null, createdAt = "2026-09-01 10:00:00",
    )

    /** A card mid-session: the top bar's "📘2 📖1" says what's waiting after the cards. */
    @Test fun studyChip() = shoot("today-13-study-chip") {
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-09-10T08:00:00.000Z")
        state = CardScheduler.applyReview(state, 2, "2026-09-10T08:12:00.000Z")
        val card = QueueCard("c1", "n1", "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, note, emptyList(), CardScheduler.intervalPreviews(state, Js.parseDate("2026-09-27T09:30:00.000Z")), emptyList(), 1, "HSK 3 · Plans & time")
        StudyScreen(StudyUi(StudyPhase.Showing(view), QueueCounts(3, 2, 1, 18), SessionStats(reviews = 9, correct = 8), canUndo = true, todayLeft = TodayLeft(2, true)), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    /** The session over with everything done today: "Everything for today ✓" and the smaller burst. */
    @Test fun allClear() = shoot("today-14-done-all-clear", settleMs = 400) {
        StudyScreen(
            StudyUi(StudyPhase.Done, none, SessionStats(reviews = 26, correct = 23), today = TodaySummary(31 * 60_000L, 142, 121, celebrate = false, lessonsDone = 2, readerDone = true, allClear = true)),
            playingKey = null, actions = StudyActions(), autoplay = false,
        )
    }

    /** A lesson opened again the same day: "Continuing where you left off · Start over". */
    @Test fun lessonContinues() = shoot("today-15-lesson-continues") {
        val spec = CustomLessonSpec("把 sentences", sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.scramble, LessonSamples.choice, LessonSamples.translate))))
        val saved = LessonResume.Progress("L1", "h", "2026-09-27", 0, 0, index = 2, correct = 1, total = 1,
            attempts = listOf(ExerciseAttempt(0, 0, "note"), ExerciseAttempt(0, 1, "scramble", correct = true, points = 1, maxPoints = 1)))
        LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(), PlayerContext.Today, previews = null, onComplete = {}, onEnd = {}, resume = LessonResumeHandle(saved))
    }

    @Test fun lessonContinuesDark() = shoot("today-16-lesson-continues-dark", dark = true) {
        val spec = CustomLessonSpec("把 sentences", sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.scramble, LessonSamples.choice, LessonSamples.translate))))
        val saved = LessonResume.Progress("L1", "h", "2026-09-27", 0, 0, index = 2, correct = 1, total = 1)
        LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(), PlayerContext.Today, previews = null, onComplete = {}, onEnd = {}, resume = LessonResumeHandle(saved))
    }
}
