package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.geometry.Offset
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.ItemEvent
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.SentenceFeedback
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptMediaDto
import dev.jeromeswannack.chineselearning.lab.data.api.CustomLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.LessonCompletionDto
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.study.SessionStats
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config
import kotlin.random.Random

/** Every exercise type, before and after answering, the player's end + rating, and the Mini Lessons pages. */
class LessonScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-09-27T09:30:00.000Z")
    private val previews = CardScheduler.intervalPreviews(CardScheduler.initialCardState(), now)

    private fun env() = ExerciseEnv(
        playClip = { _, _ -> true },
        sentenceFeedback = { _, _, _ ->
            SentenceFeedback("minor", true, LessonSentence("吃完饭以后，我把碗洗干净了。", "Chī wán fàn yǐhòu, wǒ bǎ wǎn xǐ gānjìng le.", "After dinner I washed the bowls."), "Nice use of 把! Add 了 after the result to show it's done.")
        },
        random = Random(7),
    )

    private fun player(ex: LessonExercise, env: ExerciseEnv = env()): @Composable () -> Unit = {
        LessonPlayer("The 把 sentence", "🧱", LessonSamples.lesson(ex), env, PlayerContext.Session(Samples.counts), previews, {}, {})
    }

    /** Renders, runs [act] (taps / typing), lets it settle, saves the shot. */
    private fun shootAfter(name: String, dark: Boolean = false, content: @Composable () -> Unit, act: () -> Unit) {
        compose.setContent { LabTheme(dark = dark) { content() } }
        compose.mainClock.advanceTimeBy(1_500)
        act()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    private fun tap(text: String) {
        val node = compose.onAllNodesWithText(text).onLast()
        runCatching { node.performScrollTo() } // below the fold in a long exercise
        node.performClick()
        compose.mainClock.advanceTimeBy(300)
    }
    private fun type(text: String) = compose.onNode(hasSetTextAction()).performTextInput(text)

    // ---- question state of every type ----
    @Test fun note() = shoot("lessons-01-note", content = player(LessonSamples.note))
    @Test fun scramble() = shoot("lessons-02-scramble", content = player(LessonSamples.scramble))
    @Test fun choice() = shoot("lessons-04-choice", content = player(LessonSamples.choice))
    @Test fun translate() = shoot("lessons-06-translate", content = player(LessonSamples.translate))
    @Test fun match() = shoot("lessons-08-match", content = player(LessonSamples.match))
    @Test fun describe() = shoot("lessons-10-describe", content = player(LessonSamples.describe))
    @Test fun speak() = shoot("lessons-12-speak", content = player(LessonSamples.speak))
    @Test fun listenChoice() = shoot("lessons-14-listen-choice", content = player(LessonSamples.listenChoice))
    @Test fun listenTranslate() = shoot("lessons-16-listen-translate", content = player(LessonSamples.listenTranslate))
    @Test fun sentenceMaking() = shoot("lessons-18-sentence-making", content = player(LessonSamples.sentenceMaking))
    @Test fun writeTyped() = shoot("lessons-20-write-typed", content = player(LessonSamples.writeTyped))
    @Test fun writeHandwriting() = shoot("lessons-22-write-handwriting", content = player(LessonSamples.writeHand))
    @Test fun dictation() = shoot("lessons-24-dictation", content = player(LessonSamples.dictation))
    @Test fun oral() = shoot("lessons-26-oral", content = player(LessonSamples.oral))
    @Test fun conversation() = shoot("lessons-28-conversation", content = player(LessonSamples.conversation))

    // ---- answered ----
    @Test fun scrambleAnswered() = shootAfter("lessons-03-scramble-answered", content = player(LessonSamples.scramble)) {
        listOf("我", "门", "把", "关上了").forEach(::tap)
        tap("Check")
    }
    @Test fun choiceAnswered() = shootAfter("lessons-05-choice-answered", content = player(LessonSamples.choice)) { tap("请关窗户把。") }
    @Test fun translateAnswered() = shootAfter("lessons-07-translate-answered", content = player(LessonSamples.translate)) {
        type("请把书放在桌子上")
        tap("Show answer")
    }
    @Test fun matchAnswered() = shootAfter("lessons-09-match-answered", content = player(LessonSamples.match)) {
        tap("门"); tap("window") // a miss
        for ((h, e) in listOf("门" to "door", "窗户" to "window", "桌子" to "table", "作业" to "homework")) { tap(h); tap(e) }
    }
    @Test fun describeAnswered() = shootAfter("lessons-11-describe-answered", content = player(LessonSamples.describe)) { tap("🎤 I've described it") }
    @Test fun speakAnswered() = shootAfter("lessons-13-speak-answered", content = player(LessonSamples.speak)) { tap("🎤 I've said my sentence") }
    @Test fun listenChoiceAnswered() = shootAfter("lessons-15-listen-choice-answered", content = player(LessonSamples.listenChoice)) { tap("有") }
    @Test fun listenTranslateAnswered() = shootAfter("lessons-17-listen-translate-answered", content = player(LessonSamples.listenTranslate)) {
        type("Where did you put the keys?")
        tap("Show answer")
    }
    @Test fun sentenceMakingAnswered() = shootAfter("lessons-19-sentence-making-answered", content = player(LessonSamples.sentenceMaking)) {
        type("吃完饭我把碗洗干净")
        tap("Check")
    }
    @Test fun writeTypedAnswered() = shootAfter("lessons-21-write-typed-answered", content = player(LessonSamples.writeTyped)) {
        type("冰相")
        tap("Check")
    }
    @Test fun writeHandwritingAnswered() = shootAfter("lessons-23-write-handwriting-answered", content = player(LessonSamples.writeHand)) {
        compose.onNodeWithTag("sketch-pad").performTouchInput {
            swipe(Offset(width * 0.12f, height * 0.3f), Offset(width * 0.38f, height * 0.3f), 200)
            swipe(Offset(width * 0.25f, height * 0.15f), Offset(width * 0.25f, height * 0.85f), 200)
            swipe(Offset(width * 0.1f, height * 0.6f), Offset(width * 0.4f, height * 0.6f), 200)
            swipe(Offset(width * 0.6f, height * 0.2f), Offset(width * 0.6f, height * 0.85f), 200)
            swipe(Offset(width * 0.6f, height * 0.2f), Offset(width * 0.9f, height * 0.2f), 200)
            swipe(Offset(width * 0.9f, height * 0.2f), Offset(width * 0.88f, height * 0.85f), 200)
        }
        tap("Check")
    }
    @Test fun dictationAnswered() = shootAfter("lessons-25-dictation-answered", content = player(LessonSamples.dictation)) {
        type("请把们关上")
        tap("Check")
    }
    @Test fun oralAnswered() = shootAfter("lessons-27-oral-answered", content = player(LessonSamples.oral)) { tap("Say it without recording") }
    @Test fun conversationAnswered() = shootAfter("lessons-29-conversation-answered", content = player(LessonSamples.conversation)) {
        compose.mainClock.advanceTimeBy(3_000)
        tap("Two")
        tap("Show answer")
        tap("✓ Got it")
        tap("Show transcript")
    }

    // ---- the player: in the session, finished, dark / unfolded ----
    @Test fun inSession() = shoot("lessons-30-in-session") {
        StudyScreen(
            StudyUi(phase = StudyPhase.Lesson(SessionLesson(entry(), previews, 1)), counts = Samples.counts, stats = SessionStats(reviews = 8, correct = 7, streak = 4), canUndo = true),
            playingKey = null,
            actions = StudyActions(lessonEnv = env()),
            autoplay = false,
        )
    }
    @Test fun finished() = shootAfter("lessons-31-finished", content = player(LessonSamples.choice)) {
        tap("请把窗户关上。")
        tap("Continue")
    }
    @Test fun preview() = shootAfter("lessons-32-preview-finished", content = {
        LessonPlayer("The 把 sentence", "🧱", LessonSamples.lesson(LessonSamples.speak), env(), PlayerContext.Preview, null, {}, {})
    }) {
        tap("🎤 I've said my sentence")
        tap("✓ Yes")
    }
    @Test fun dark() = shootAfter("lessons-33-choice-dark", dark = true, content = player(LessonSamples.choice)) { tap("请把窗户关上。") }
    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("lessons-34-conversation-unfolded", content = player(LessonSamples.conversation))

    // ---- Mini Lessons page + My answers ----
    private fun entry(id: String = "L1", spec: CustomLessonSpec = LessonSamples.full, events: List<ItemEvent> = emptyList(), created: String = "2026-09-20T10:00:00Z", source: String = "mcp"): LessonEntry =
        LessonEntry(
            CustomLessonDto(id, spec.title, spec.description, spec.icon, source, "active", created, null, spec,
                events.map { LessonCompletionDto(it.id, id, 3, 4, it.at, it.rating) }),
            events,
            ItemSchedule.state(events),
        )

    private val lessonsUi by lazy {
        val review = listOf(ItemEvent("e1", "L3", 2, "2026-09-20T10:00:00.000Z"), ItemEvent("e2", "L3", 2, "2026-09-21T10:00:00.000Z"), ItemEvent("e3", "L3", 3, "2026-09-25T10:00:00.000Z"))
        MiniLessonsUi(
            lessons = listOf(
                entry(),
                entry("L2", LessonSamples.lesson(LessonSamples.conversation, LessonSamples.listenChoice).copy(title = "At the hotel", icon = "🏨", description = "Checking in, asking about breakfast"), listOf(ItemEvent("e0", "L2", 0, "2026-09-27T08:00:00.000Z")), source = "tutor"),
                entry("L3", LessonSamples.lesson(LessonSamples.writeTyped, LessonSamples.dictation).copy(title = "Kitchen words", icon = "🍳", description = null), review, source = "chat"),
            ),
            cutoff = StudyCutoff(Js.parseDate("2026-09-27T23:59:59.999Z")),
        )
    }

    @Test fun miniLessons() = shoot("lessons-40-mini-lessons") { MiniLessonsScreen(lessonsUi, MiniLessonsActions(onBack = {})) }
    @Test fun miniLessonsExpanded() = shootAfter("lessons-41-mini-lessons-expanded", content = { MiniLessonsScreen(lessonsUi, MiniLessonsActions(onBack = {})) }) {
        compose.onNodeWithText("The 把 sentence").performClick()
    }
    @Test fun miniLessonsOffline() = shoot("lessons-42-mini-lessons-offline") {
        MiniLessonsScreen(lessonsUi.copy(offline = true, updatedAt = System.currentTimeMillis() - 3 * 3_600_000, lessons = lessonsUi.lessons!!.take(1)), MiniLessonsActions(onBack = {}))
    }

    private val attempt = AttemptDetailDto(
        "a1", "L1", "2026-09-27T09:12:00.000Z", 312_000, 4, 6, 2, LessonSamples.full,
        LessonAttemptData(
            "2026-09-27T09:07:00.000Z", 312_000,
            listOf(
                ExerciseAttempt(0, 0, "note", null, 0, 0, 34_000),
                ExerciseAttempt(0, 1, "choice", true, 1, 1, 21_000, ExerciseAnswer(choice = 0)),
                ExerciseAttempt(1, 0, "scramble", false, 0, 1, 48_000, ExerciseAnswer(order = listOf("我", "门", "把", "关上了"), hintUsed = true)),
                ExerciseAttempt(1, 1, "translate", true, 1, 1, 62_000, ExerciseAnswer(text = "请把书放在桌子上", selfAssessed = true)),
                ExerciseAttempt(1, 2, "dictation", false, 0, 1, 55_000, ExerciseAnswer(text = "请把们关上", plays = 3)),
                ExerciseAttempt(1, 3, "oral_expression", true, 1, 1, 80_000, ExerciseAnswer(selfAssessed = true, recording = dev.jeromeswannack.chineselearning.lab.core.AttemptRecording("s1e3", 27_000, "audio/mp4"))),
            ),
        ),
        listOf(AttemptMediaDto("s1e3", "lesson-attempts/u/a1/s1e3.m4a", "done", "我周末把房间打扫了，然后跟朋友吃饭。", "At the weekend I cleaned my room, then ate with friends.")),
    )

    @Test fun attemptReview() = shoot("lessons-43-my-answers") { AttemptDetailScreen(loaded(attempt), onBack = {}, onRetry = {}, onPlay = {}, playingKey = null) }

    private fun <T> loaded(v: T) = dev.jeromeswannack.chineselearning.lab.data.platform.Loadable(data = v, loading = false)

}
