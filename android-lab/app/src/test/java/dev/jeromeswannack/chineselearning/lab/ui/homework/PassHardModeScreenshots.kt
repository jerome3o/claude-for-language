package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.runtime.Composable
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.HardMode
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.RetryBars
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.CardExtras
import dev.jeromeswannack.chineselearning.lab.ui.study.CardStartState
import dev.jeromeswannack.chineselearning.lab.ui.study.PassCardUi
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.study.TakeUi
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionUi
import org.junit.Test

/**
 * Hard mode in the homework pass (docs/HOMEWORK.md §3e; web: HomeworkPassPage + StudyCard `pass.hard`):
 * the read card's answer checked on the question, the Sentence round, a give-up locking Got it, and a
 * word's second angle on another card. `./gradlew :app:recordRoborazziDebug` → app/screenshots/hwpass-hard-*.png.
 */
class PassHardModeScreenshots : LabScreenshotTest() {
    companion object {
        /** 12 words, 2 angles each in All mode: 7 steps answered, 4 words done, one Not yet owed. */
        fun pass(angle: Int = 1, cardType: String = CardTypes.HANZI_TO_MEANING) = PassCardUi(
            assignmentId = "a1", noteId = "n1", attempt = 0, title = "餐厅点菜", part = null,
            due = dev.jeromeswannack.chineselearning.lab.core.Homework.dueLabel("2026-10-27", "2026-10-25"),
            done = 4, total = 12, retrying = 1, canUndo = true,
            bar = RetryBars.retryBar(answered = 7, fresh = 14, retries = 1, itemsDone = 4, items = 12),
            cardType = cardType, angle = angle, hardMode = HardMode.ALL, hardApplies = true,
        )

        fun ui(type: String = CardTypes.HANZI_TO_MEANING, take: TakeUi = TakeUi()) =
            StudyUi(StudyPhase.Showing(PassStudyCardScreenshots.view(type)), QueueCounts(0, 0, 0, 0), extras = CardExtras(take = take))
    }

    @Composable
    private fun card(ui: StudyUi, pass: PassCardUi, start: CardStartState) =
        StudyScreen(ui, playingKey = null, actions = StudyActions(), cardStart = start, autoplay = false, pass = pass)

    @Test fun round() = shoot("hwpass-hard-02-sentence-round") {
        card(ui(take = TakeUi(hasTake = true, transcription = TranscriptionUi.Done(PassStudyCardScreenshots.said))), pass(), CardStartState(roundOpen = true))
    }

    @Test fun gaveUp() = shoot("hwpass-hard-03-gave-up-got-it-locked") {
        card(ui(), pass(), CardStartState(flipped = true, gaveUp = true))
    }

    @Test fun secondAngle() = shoot("hwpass-hard-04-second-angle") {
        card(ui(CardTypes.MEANING_TO_HANZI), pass(angle = 2, cardType = CardTypes.MEANING_TO_HANZI), CardStartState())
    }
}
