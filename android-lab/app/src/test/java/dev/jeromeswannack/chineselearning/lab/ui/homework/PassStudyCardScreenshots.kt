package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.runtime.Composable
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.CardExtras
import dev.jeromeswannack.chineselearning.lab.ui.study.CardStartState
import dev.jeromeswannack.chineselearning.lab.ui.study.CardView
import dev.jeromeswannack.chineselearning.lab.ui.study.PassCardUi
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.study.TakeUi
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionComparison
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionUi
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * The homework pass on the STUDY CARD (web: HomeworkPassPage → StudyCard `pass`): the read card
 * with the pass's title / counter / due line, the 🎤 take and "You said", Not yet / Got it where the
 * ratings are (a matching take suggests Got it), "Add to my long-term review" and ⚡ Study it today
 * on the answer side. `./gradlew :app:recordRoborazziDebug` → app/screenshots/hwpass-*.png.
 */
class PassStudyCardScreenshots : LabScreenshotTest() {
    companion object {
        val note = NoteEntity(
            "n1", "d1", "服务员", "fúwùyuán", "waiter; waitress", null,
            "服 (fú) serve · 务 (wù) affairs · 员 (yuán) person — someone whose job is to serve.",
            null, "服务员，我们要点菜。", "Fúwùyuán, wǒmen yào diǎn cài.", "Waiter, we'd like to order.", null, null, "2026-09-26T10:00:00Z",
        )
        val sentences = listOf(
            SentenceEntity("s1", "n1", 0, "那个服务员很热情。", "nàge fúwùyuán hěn rèqíng.", "That waiter is very friendly.", null, "core", null),
            SentenceEntity("s2", "n1", 1, "我姐姐在饭店当服务员。", "wǒ jiějie zài fàndiàn dāng fúwùyuán.", "My older sister works as a waitress in a restaurant.", null, "collocation", null),
        )

        fun view(type: String = CardTypes.HANZI_TO_MEANING, presentation: Int = 1): CardView {
            val state = CardScheduler.initialCardState()
            return CardView(QueueCard("c1", "n1", "d1", type, state), note, sentences, CardScheduler.intervalPreviews(state, 0L), emptyList(), presentation, "餐厅点菜")
        }

        fun ui(take: TakeUi = TakeUi(), online: Boolean = true) =
            StudyUi(StudyPhase.Showing(view()), QueueCounts(0, 0, 0, 0), online = online, extras = CardExtras(take = take))

        fun pass(longTermOn: Boolean = false, started: Boolean = false, bumped: Boolean = false, bumpedBy: String? = null, done: Int = 5, retrying: Int = 1, canUndo: Boolean = true) = PassCardUi(
            assignmentId = "a1", noteId = "n1", attempt = 0, title = "餐厅点菜", part = "day 1 of 2",
            due = Homework.dueLabel("2026-09-28", "2026-09-27"), done = done, total = 12, retrying = retrying,
            longTermOn = longTermOn, started = started, bumped = bumped, bumpedBy = bumpedBy, canUndo = canUndo,
        )

        val said = TranscriptionComparison("服务员", "fú wù yuán", isMatch = true, containsExpected = false)
        val missed = TranscriptionComparison("父母", "fù mǔ", isMatch = false, containsExpected = false)
    }

    @Composable
    private fun card(ui: StudyUi, pass: PassCardUi, revealed: Boolean) =
        StudyScreen(ui, playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = revealed), autoplay = false, pass = pass)

    @Test fun front() = shoot("hwpass-01-read-card") { card(ui(), pass(), revealed = false) }

    @Test fun recording() = shoot("hwpass-02-recording") { card(ui(TakeUi(recording = true)), pass(), revealed = false) }

    @Test fun takeWaiting() = shoot("hwpass-03-take-waiting") { card(ui(TakeUi(hasTake = true)), pass(), revealed = false) }

    @Test fun youSaidGotItSuggested() = shoot("hwpass-04-you-said-got-it-suggested") {
        card(ui(TakeUi(hasTake = true, transcription = TranscriptionUi.Done(said))), pass(), revealed = true)
    }

    @Test fun bumped() = shoot("hwpass-05-bumped-long-term-on") {
        card(ui(TakeUi(hasTake = true, transcription = TranscriptionUi.Done(said))), pass(longTermOn = true, bumped = true), revealed = true)
    }

    @Test fun missNoSuggestion() = shoot("hwpass-06-miss-no-suggestion", dark = true) {
        card(ui(TakeUi(hasTake = true, transcription = TranscriptionUi.Done(missed))), pass(), revealed = true)
    }

    @Test fun shownStartedFromTutor() = shoot("hwpass-07-shown-started-bumped-by-tutor") {
        card(ui(), pass(started = true, bumped = true, bumpedBy = "王老师", done = 11, retrying = 0), revealed = true)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("hwpass-08-unfolded") {
        card(ui(TakeUi(hasTake = true, transcription = TranscriptionUi.Done(said))), pass(longTermOn = true), revealed = true)
    }
}
