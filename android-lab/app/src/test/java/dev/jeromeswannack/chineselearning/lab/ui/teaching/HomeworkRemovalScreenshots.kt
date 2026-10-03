package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.core.HomeworkRemoval
import dev.jeromeswannack.chineselearning.lab.core.RemovalFacts
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.SharedReaderDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabToast
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S
import org.junit.Test

/** Taking homework back: the ⋯ item, the confirm sheet (not started / started), the list after, the job card's Undo. */
class HomeworkRemovalScreenshots : LabScreenshotTest() {
    /** Like [shoot] but captures every window, so bottom sheets are in the picture. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun shootScreen(name: String, dark: Boolean = false, content: @Composable () -> Unit) {
        compose.setContent { LabTheme(dark = dark) { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/$name.png")
    }

    private val hsk = HomeworkDeckDto(
        "sd-hsk", "d-hsk", "t-hsk", HSK, HSK, "2026-10-02T21:40:00Z",
        cards_total = 957, notes_total = 319, notes_introduced = 0, words_to_go = 319, days_to_go = 107, queue_position = 1, queue_total = 6,
    )
    private val gone = S.homeworkDecks[1].copy(shared_deck_id = "sd-food", source_deck_name = "Food & ordering", target_deck_name = null, queue_position = null)
    private val readers = listOf(
        SharedReaderDto("sr1", "tr1", "2026-09-24T10:00:00Z", "小猫找妈妈", "The kitten looks for its mum", page_count = 8, read_count = 3, last_read_at = "2026-09-28T08:00:00Z"),
        SharedReaderDto("sr2", "tr2", "2026-09-30T10:00:00Z", "周末去爬山", "A weekend hike", page_count = 6, read_count = 0),
    )

    @Composable
    private fun HomeworkList(decks: List<HomeworkDeckDto>, menuOn: String? = null, toast: String? = null) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                TeachSectionTitle("Homework")
                decks.forEach { d ->
                    HomeworkDeckRow(
                        "rel-jerome", d, false, {}, {}, {}, S.now,
                        removeLabel = HomeworkRemoval.removalMenuLabel(HomeworkRemoval.DECK, "Jerome Swannack"),
                        initialMenu = d.shared_deck_id == menuOn,
                    )
                }
                StudentLessonsCard("rel-jerome", S.lessons, null, {}, S.now, removeLabel = HomeworkRemoval.removalMenuLabel(HomeworkRemoval.LESSON, "Jerome Swannack"))
                SharedReadersCard(readers, HomeworkRemoval.removalMenuLabel(HomeworkRemoval.READER, "Jerome Swannack"), {}, S.now)
            }
            LabToast(toast, Modifier.align(Alignment.BottomCenter))
        }
    }

    private fun sheet(facts: RemovalFacts) = RemovalSheetUi(
        RemovalTarget(facts.kind, "sd", facts.title),
        "Jerome Swannack",
        copy = HomeworkRemoval.removalCopy(facts, "Jerome Swannack"),
    )

    @Test fun menu() = shootScreen("removal-01-menu") {
        HomeworkList(listOf(hsk) + S.homeworkDecks, menuOn = "sd-hsk")
    }

    @Test fun confirmNotStarted() = shootScreen("removal-02-confirm-not-started") {
        HomeworkList(listOf(hsk) + S.homeworkDecks)
        RemoveHomeworkSheet(sheet(RemovalFacts(HomeworkRemoval.DECK, HSK, wordsMet = 0, wordsTotal = 319, canDeleteSource = true)), RemovalSheetActions())
    }

    @Test fun confirmStarted() = shootScreen("removal-03-confirm-started") {
        HomeworkList(listOf(hsk) + S.homeworkDecks)
        RemoveHomeworkSheet(sheet(RemovalFacts(HomeworkRemoval.DECK, "Lesson 8", wordsMet = 12, wordsTotal = 40)), RemovalSheetActions())
    }

    @Test fun confirmLessonChecking() = shootScreen("removal-06-confirm-checking") {
        HomeworkList(S.homeworkDecks)
        RemoveHomeworkSheet(RemovalSheetUi(RemovalTarget(HomeworkRemoval.LESSON, "l1", "了 for completed actions"), "Jerome Swannack"), RemovalSheetActions())
    }

    @Test fun confirmFailed() = shootScreen("removal-07-confirm-error") {
        HomeworkList(listOf(hsk))
        RemoveHomeworkSheet(
            sheet(RemovalFacts(HomeworkRemoval.READER, "小猫找妈妈", times = 3)).copy(error = "You're offline — connect to the internet and try again."),
            RemovalSheetActions(),
        )
    }

    @Test fun after() = shoot("removal-04-after") {
        HomeworkList(S.homeworkDecks + gone, toast = HomeworkRemoval.removalToast(HomeworkRemoval.DECK, HSK, "Jerome Swannack", sourceDeleted = true))
    }

    @Test fun copyGoneMenu() = shootScreen("removal-08-copy-gone-menu") {
        HomeworkList(S.homeworkDecks + gone, menuOn = gone.shared_deck_id)
    }

    @Test fun jobUndo() = shoot("removal-05-job-undo") {
        val sent = DraftSamples.jobs[0]
        val withReader = sent.copy(
            result = sent.result.copy(
                deck = sent.result.deck!!.copy(name = HSK, note_count = 319),
                lessons = listOf(sent.result.lessons[0].copy(removed_at = "2026-10-03T08:00:00Z")),
                reader = JobReaderDto("rd1", "The kitten looks for its mum", "小猫找妈妈", 8, target_reader_id = "tr1"),
            ),
        )
        SessionNotesScreen(
            SessionNotesUi("rel-jerome", "Jerome Swannack", listOf(withReader) + DraftSamples.jobs.drop(1)),
            JobActions(remove = {}), back = {}, submit = { _, _, _, _, _, _, _ -> }, now = S.now,
        )
    }

    private companion object {
        const val HSK = "HSK 1（新版 3.0）_生字表"
    }
}
