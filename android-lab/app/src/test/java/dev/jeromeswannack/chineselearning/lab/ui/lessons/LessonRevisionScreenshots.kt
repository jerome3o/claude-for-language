package dev.jeromeswannack.chineselearning.lab.ui.lessons

import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonRevision
import dev.jeromeswannack.chineselearning.lab.core.LessonRun
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.api.CustomLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonCompletionDto
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.data.lessons.SavedLessonRun
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeworkPassScreen
import dev.jeromeswannack.chineselearning.lab.ui.homework.PassActions
import dev.jeromeswannack.chineselearning.lab.ui.homework.PassLesson
import dev.jeromeswannack.chineselearning.lab.ui.homework.PassUi
import org.junit.Test

/**
 * Revise until right first time (`./gradlew :app:recordRoborazziDebug` → app/screenshots/lesson-run-*.png):
 * the Mini Lessons list (to do: a run in progress, a revision due, a new lesson; revision coming;
 * done for good) with sizes, a run continued days later, the retry round with the orange bar, the
 * end ("Back in a week as a revision…"), a finished homework pass.
 */
class LessonRevisionScreenshots : LabScreenshotTest() {
    private val homework = "你吃什么，我就吃什么：什么…就…什么、要么…要么…、多 + verb"
    private val spec = CustomLessonSpec("China trip 1 · Arriving at Pudong: metro or Didi?", icon = "✈️",
        sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.choice, LessonSamples.translate, LessonSamples.match, LessonSamples.choice))))

    private fun entry(id: String, title: String, icon: String, created: String, runs: List<LessonCompletionDto> = emptyList()): LessonEntry {
        val s = spec.copy(title = title, icon = icon, description = null)
        val records = runs.map { LessonRevision.RunRecord(it.id, it.completedAt, it.outcome, it.rating) }
        return LessonEntry(CustomLessonDto(id, title, null, icon, "chat", "active", created, null, s, runs), records, LessonRevision.state(records))
    }

    private fun run(id: String, lesson: String, at: String, missed: List<String>) =
        LessonCompletionDto(id, lesson, 3 - missed.size, 3, at, outcome = LessonRevision.Outcome(listOf("s0e1", "s0e2", "s0e3", "s0e4"), missed))

    private val lessonsUi = MiniLessonsUi(
        lessons = listOf(
            entry("trip1", "China trip 1 · Arriving at Pudong: metro or Didi?", "✈️", "2026-10-06T22:43:00Z"),
            entry("trip2", "China trip 2 · Checking in at a JI Hotel", "🏨", "2026-10-06T22:44:56Z"),
            entry("hw", homework, "🍜", "2026-10-07T13:02:06Z", listOf(run("c1", "hw", "2026-10-14T19:00:00Z", listOf("s0e1", "s0e3")))),
            entry("weather", "天气 · Talking about the weather", "🌦", "2026-10-02T09:00:00Z", listOf(run("c2", "weather", "2026-10-19T19:00:00Z", listOf("s0e2")))),
            entry("numbers", "Numbers & prices", "💴", "2026-09-20T09:00:00Z", listOf(run("c3", "numbers", "2026-10-01T19:00:00Z", emptyList()))),
        ),
        cutoff = StudyCutoff(Js.parseDate("2026-10-22T23:59:59.999Z")),
        inProgress = mapOf("trip1" to "full"),
    )

    @Test fun miniLessons() = shoot("lesson-run-01-mini-lessons") { MiniLessonsScreen(lessonsUi, MiniLessonsActions(onBack = {})) }
    @Test fun miniLessonsDark() = shoot("lesson-run-02-mini-lessons-dark", dark = true) { MiniLessonsScreen(lessonsUi, MiniLessonsActions(onBack = {})) }

    /** Opened again three days later: "Continue where you left off (3 of 5)". */
    private val saved = SavedLessonRun(
        "trip1", LessonRun.shape(spec), state = LessonRun.State(pos = 2, owed = listOf("s0e1")), startedAt = 0, savedAt = 0,
        attempts = listOf(ExerciseAttempt(0, 0, "note"), ExerciseAttempt(0, 1, "choice", false, 0, 1)),
    )
    @Test fun resumed() = shoot("lesson-run-03-continue") {
        LessonPlayer(spec.title, "✈️", spec, ExerciseEnv(), PlayerContext.Lesson(), onComplete = {}, onEnd = {}, resume = LessonResumeHandle(saved))
    }
    @Test fun resumedDark() = shoot("lesson-run-04-continue-dark", dark = true) {
        LessonPlayer(spec.title, "✈️", spec, ExerciseEnv(), PlayerContext.Lesson(), onComplete = {}, onEnd = {}, resume = LessonResumeHandle(saved))
    }

    /** The retry round: every exercise answered, two owed (orange), the first one again. */
    private val retrying = saved.copy(state = LessonRun.State(pos = 5, owed = listOf("s0e1", "s0e3"), fixed = 0, retried = 0))
    @Test fun retryRound() = shoot("lesson-run-05-retry-round", settleMs = 600) {
        LessonPlayer(spec.title, "✈️", spec, ExerciseEnv(), PlayerContext.Lesson(), onComplete = {}, onEnd = {}, resume = LessonResumeHandle(retrying))
    }
    @Test fun retryRoundDark() = shoot("lesson-run-06-retry-round-dark", dark = true, settleMs = 600) {
        LessonPlayer(spec.title, "✈️", spec, ExerciseEnv(), PlayerContext.Lesson(), onComplete = {}, onEnd = {}, resume = LessonResumeHandle(retrying))
    }

    /** A revision: what was missed + a few that were got. */
    @Test fun revision() = shoot("lesson-run-07-revision", settleMs = 600) {
        LessonPlayer(homework, "🍜", spec, ExerciseEnv(), PlayerContext.Lesson("home"), onComplete = {}, onEnd = {}, revisionKeys = listOf("s0e1", "s0e3", "s0e4"))
    }

    /** Home's card: a revision due and a new lesson, each with its size (no tutor rows: "To do"). */
    private val homeUi = dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkUi(
        card = dev.jeromeswannack.chineselearning.lab.core.HomeHomework.build(
            emptyList(), emptyList(),
            lessons = lessonsUi.lessons!!.map { it.homeLesson(lessonsUi.cutoff.ts) },
        ),
    )
    @Test fun home() = shoot("lesson-run-09-home-card") {
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen("Home") { item { dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkSection(homeUi, dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkActions()) } }
    }
    @Test fun homeDark() = shoot("lesson-run-10-home-card-dark", dark = true) {
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen("Home") { item { dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkSection(homeUi, dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkActions()) } }
    }

    /** A finished homework pass: ▶ Do it again. */
    @Test fun homeworkPassDone() = shoot("lesson-run-08-homework-done", settleMs = 600) {
        HomeworkPassScreen(PassUi.Player("lesson", homework, complete = true, loaded = true, lesson = PassLesson("hw", homework, "🍜", spec)), PassActions())
    }
}
