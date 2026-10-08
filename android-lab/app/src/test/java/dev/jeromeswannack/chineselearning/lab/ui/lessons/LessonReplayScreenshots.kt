package dev.jeromeswannack.chineselearning.lab.ui.lessons

import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ItemEvent
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.RevisitState
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.api.CustomLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonCompletionDto
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeworkPassScreen
import dev.jeromeswannack.chineselearning.lab.ui.homework.PassActions
import dev.jeromeswannack.chineselearning.lab.ui.homework.PassLesson
import dev.jeromeswannack.chineselearning.lab.ui.homework.PassUi
import dev.jeromeswannack.chineselearning.lab.ui.today.TodayHome
import dev.jeromeswannack.chineselearning.lab.ui.today.TodayLessonRow
import dev.jeromeswannack.chineselearning.lab.ui.today.TodayLessonsScreen
import dev.jeromeswannack.chineselearning.lab.ui.today.TodayReaderRow
import org.junit.Test

/**
 * Lesson close / replay (`./gradlew :app:recordRoborazziDebug` → app/screenshots/replay-*.png):
 * today's lesson list after the homework lesson was done (China trip 1 still to do, the homework
 * lesson "Again ›"), the Mini Lessons list with ▶ Start / ▶ Do it again, a lesson opened again
 * the same day, a replay's Practice only, the replay's done screen, a finished homework pass.
 */
class LessonReplayScreenshots : LabScreenshotTest() {
    private val homework = "你吃什么，我就吃什么：什么…就…什么、要么…要么…、多 + verb"
    private val today = TodayHome(
        cardsDue = 3, cardsReviewed = 162,
        lessonsToDo = listOf(TodayLessonRow("trip1", "China trip 1 · Arriving at Pudong: metro or Didi?", "✈️", "New", inProgress = false)),
        lessonsDone = listOf(TodayLessonRow("hw", homework, "🍜", "Done", done = true)),
        reader = TodayReaderRow(TodayReaderRow.State.TO_READ, "小明在成都", 6),
    )

    @Test fun todayList() = shoot("replay-01-today-list") { TodayLessonsScreen(today, {}, {}, {}) }
    @Test fun todayListDark() = shoot("replay-02-today-list-dark", dark = true) { TodayLessonsScreen(today, {}, {}, {}) }
    @Test fun todayListLoading() = shoot("replay-03-today-list-loading") { TodayLessonsScreen(null, {}, {}, {}) }

    private fun entry(id: String, title: String, icon: String, events: List<ItemEvent> = emptyList(), created: String): LessonEntry {
        val spec = LessonSamples.lesson(LessonSamples.note, LessonSamples.choice, LessonSamples.translate).copy(title = title, icon = icon, description = null)
        return LessonEntry(
            CustomLessonDto(id, title, null, icon, "chat", "active", created, null, spec, events.map { LessonCompletionDto(it.id, id, 14, 28, it.at, it.rating) }),
            events,
            ItemSchedule.state(events),
        )
    }

    private val lessonsUi = MiniLessonsUi(
        lessons = listOf(
            entry("trip1", "China trip 1 · Arriving at Pudong: metro or Didi?", "✈️", created = "2026-10-06T22:43:00Z"),
            entry("trip2", "China trip 2 · Checking in at a JI Hotel", "🏨", created = "2026-10-06T22:44:56Z"),
            entry("hw", homework, "🍜", listOf(ItemEvent("c1", "hw", 1, "2026-10-08T22:39:54.716Z")), created = "2026-10-07T13:02:06Z"),
        ),
        cutoff = StudyCutoff(Js.parseDate("2026-10-08T23:59:59.999Z")),
    )

    @Test fun miniLessons() = shoot("replay-04-mini-lessons") { MiniLessonsScreen(lessonsUi, MiniLessonsActions(onBack = {})) }
    @Test fun miniLessonsDark() = shoot("replay-05-mini-lessons-dark", dark = true) { MiniLessonsScreen(lessonsUi, MiniLessonsActions(onBack = {})) }

    private val spec = CustomLessonSpec("China trip 1 · Arriving at Pudong: metro or Didi?", icon = "✈️",
        sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.choice, LessonSamples.translate))))

    /** Opened earlier today, closed on the intro: "Back to today's lesson · 1 of 3". */
    @Test fun reopened() = shoot("replay-06-reopened") {
        LessonPlayer(spec.title, "✈️", spec, ExerciseEnv(), PlayerContext.Today, previews = null, onComplete = {}, onEnd = {}, resume = LessonResumeHandle(null, openedBefore = true))
    }
    @Test fun reopenedDark() = shoot("replay-07-reopened-dark", dark = true) {
        LessonPlayer(spec.title, "✈️", spec, ExerciseEnv(), PlayerContext.Today, previews = null, onComplete = {}, onEnd = {}, resume = LessonResumeHandle(null, openedBefore = true))
    }

    private val hwState = ItemSchedule.state(listOf(ItemEvent("c1", "hw", 1, "2026-10-08T22:39:54.716Z")))

    /** ▶ Do it again on a lesson that isn't due: the ratings, Done for good and Practice only. */
    @Test fun practiceOnly() = shoot("replay-08-practice-only", settleMs = 600) {
        LessonPlayer(homework, "🍜", spec, ExerciseEnv(), PlayerContext.Replay(practice = true), previews = ItemSchedule.previews(hwState), onComplete = {}, onEnd = {}, startAt = 3)
    }
    @Test fun practiceOnlyDark() = shoot("replay-09-practice-only-dark", dark = true, settleMs = 600) {
        LessonPlayer(homework, "🍜", spec, ExerciseEnv(), PlayerContext.Replay(practice = true), previews = ItemSchedule.previews(hwState), onComplete = {}, onEnd = {}, startAt = 3)
    }

    @Test fun replayDone() = shoot("replay-10-done-practice") {
        ReplayDone(ReplayState.Finished(lessonsUi.lessons!![2], rated = false), onDone = {})
    }

    /** A finished homework lesson pass: ▶ Do it again. */
    @Test fun homeworkPassDone() = shoot("replay-11-homework-done", settleMs = 600) {
        val p = PassLesson("hw", homework, "🍜", spec, ItemSchedule.previews(RevisitState.INITIAL))
        HomeworkPassScreen(PassUi.Player("lesson", homework, complete = true, loaded = true, lesson = p), PassActions())
    }
    @Test fun homeworkPassDoneDark() = shoot("replay-12-homework-done-dark", dark = true, settleMs = 600) {
        val p = PassLesson("hw", homework, "🍜", spec, ItemSchedule.previews(RevisitState.INITIAL))
        HomeworkPassScreen(PassUi.Player("lesson", homework, complete = true, loaded = true, lesson = p), PassActions())
    }
}
