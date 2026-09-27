package dev.jeromeswannack.chineselearning.lab

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.home.SignInScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.CardStartState
import dev.jeromeswannack.chineselearning.lab.ui.study.CardView
import dev.jeromeswannack.chineselearning.lab.ui.study.SessionStats
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the Lab screens with realistic data for PR screenshots
 * (`./gradlew :app:recordRoborazziDebug` → app/screenshots/). Phone = Pixel Fold
 * folded (412×915dp); `wide` = unfolded.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class ScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val now = Js.parseDate("2026-09-27T09:30:00.000Z")

    private val note = NoteEntity(
        id = "n1", deckId = "d1", hanzi = "打算", pinyin = "dǎsuàn", english = "to plan; to intend",
        audioUrl = null,
        funFacts = "**打** (dǎ) to hit, to do · **算** (suàn) to calculate\nTogether: to reckon on doing something — a plan you've thought through.\n- 打算 + verb: 我打算明年去中国。\n- Softer than 计划 (jìhuà), which is a formal plan.",
        context = null,
        sentenceClue = "你周末打算做什么？", sentenceCluePinyin = "Nǐ zhōumò dǎsuàn zuò shénme?", sentenceClueTranslation = "What are you planning to do this weekend?",
        sentenceClueAudioUrl = null, alternatives = null, createdAt = "2026-09-01 10:00:00",
    )

    private val sentences = listOf(
        SentenceEntity("s1", "n1", 0, "我打算学中文。", "Wǒ dǎsuàn xué Zhōngwén.", "I plan to study Chinese.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "你打算什么时候回家？", "Nǐ dǎsuàn shénme shíhou huí jiā?", "When do you plan to go home?", null, "core", null),
        SentenceEntity("s3", "n1", 2, "他算了算钱，打算买那辆车。", "Tā suànle suàn qián, dǎsuàn mǎi nà liàng chē.", "He counted his money and decided to buy that car.", null, "shared_character", null),
    )

    private fun view(type: String, queue: Int = CardQueue.REVIEW): CardView {
        var state = CardScheduler.initialCardState()
        if (queue == CardQueue.REVIEW) {
            state = CardScheduler.applyReview(state, 2, "2026-09-10T08:00:00.000Z")
            state = CardScheduler.applyReview(state, 2, "2026-09-10T08:12:00.000Z")
            state = CardScheduler.applyReview(state, 2, "2026-09-13T08:00:00.000Z")
        }
        val card = QueueCard("c-$type", "n1", "d1", type, state)
        return CardView(card, note, sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Plans & time")
    }

    private val counts = QueueCounts(new = 3, secondaryNew = 2, learning = 1, review = 18)
    private val stats = SessionStats(reviews = 14, correct = 12, streak = 6, bestStreak = 9, startedAt = System.currentTimeMillis() - 7 * 60_000)

    private fun shoot(name: String, content: @Composable () -> Unit) {
        compose.setContent { LabTheme(dark = false) { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Composable
    private fun study(v: CardView, start: CardStartState = CardStartState(), ui: StudyUi = StudyUi(StudyPhase.Showing(v), counts, stats, canUndo = true)) =
        StudyScreen(ui, playingKey = null, actions = StudyActions(), cardStart = start, autoplay = false)

    @Test fun signIn() = shoot("01-sign-in") { SignInScreen(null) {} }

    @Test fun home() = shoot("02-home") {
        HomeScreen(
            ui = HomeUi(
                loaded = true, userName = "Jerome Swannack", due = counts, reviewedToday = 31,
                decks = listOf(
                    DeckSummary("d1", "HSK 3 · Plans & time", 120, QueueCounts(3, 2, 1, 9)),
                    DeckSummary("d2", "Homework — 周末的活动", 24, QueueCounts(0, 0, 0, 6)),
                    DeckSummary("d3", "Food & ordering", 58, QueueCounts(0, 0, 0, 3)),
                    DeckSummary("d4", "Starter Chinese", 15, QueueCounts(0, 0, 0, 0)),
                ),
            ),
            sync = SyncStatus(lastSyncAt = System.currentTimeMillis() - 4 * 60_000, audioTotal = 830, audioCached = 812),
            online = true,
            actions = HomeActions(),
        )
    }

    /** A first sync of a big account: what it is doing and how far it got. */
    @Test fun homeFirstSync() = shoot("13-home-first-sync") {
        HomeScreen(
            ui = HomeUi(loaded = true, userName = "Jerome Swannack"),
            sync = SyncStatus(running = true, phase = "Downloading reviews", progress = "25,000 so far"),
            online = true,
            actions = HomeActions(),
        )
    }

    @Test fun readFront() = shoot("03-read-front") { study(view(CardTypes.HANZI_TO_MEANING)) }

    @Test fun readBack() = shoot("04-read-back") { study(view(CardTypes.HANZI_TO_MEANING), CardStartState(flipped = true)) }

    @Test fun writeFront() = shoot("05-write-front") { study(view(CardTypes.MEANING_TO_HANZI), CardStartState(answer = "打算")) }

    @Test fun writeCorrect() = shoot("06-write-correct") { study(view(CardTypes.MEANING_TO_HANZI), CardStartState(flipped = true, answer = "打算")) }

    @Test fun listenWrong() = shoot("07-listen-wrong") { study(view(CardTypes.AUDIO_TO_HANZI), CardStartState(flipped = true, answer = "打蒜")) }

    @Test fun listenFront() = shoot("08-listen-front") { study(view(CardTypes.AUDIO_TO_HANZI, CardQueue.NEW)) }

    @Test fun done() = shoot("09-done") {
        study(view(CardTypes.HANZI_TO_MEANING), ui = StudyUi(StudyPhase.Done, QueueCounts(0, 0, 0, 0), stats.copy(reviews = 24, correct = 21, leeches = listOf("n9")), canUndo = true, hasMoreNew = true))
    }

    @Config(qualifiers = "w841dp-h701dp-xxhdpi")
    @Test fun unfoldedBack() = shoot("10-unfolded-back") { study(view(CardTypes.HANZI_TO_MEANING), CardStartState(flipped = true)) }

    @Test fun darkBack() {
        compose.setContent { LabTheme(dark = true) { study(view(CardTypes.MEANING_TO_HANZI), CardStartState(flipped = true, answer = "打算")) } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/11-dark-write-correct.png")
    }
}
