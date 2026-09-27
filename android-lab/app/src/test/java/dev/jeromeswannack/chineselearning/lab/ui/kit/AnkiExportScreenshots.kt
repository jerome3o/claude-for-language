package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportProgress
import dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportResult
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.VocabItemDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadersActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadersListScreen
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadersUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import java.io.File

/** Package K: the native Anki export sheet (options / progress / result) and the readers list's new actions. */
class AnkiExportScreenshots : LabScreenshotTest() {
    /** Captures every window, so the bottom sheet and the dropdown are in the picture. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun shootScreen(name: String, dark: Boolean = false, act: () -> Unit = {}, content: @Composable () -> Unit) {
        compose.setContent { LabTheme(dark = dark) { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        act()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/$name.png")
    }

    private val readers = listOf(
        GradedReaderDto(
            id = "r1", titleChinese = "小猫的一天", titleEnglish = "A kitten's day", difficulty = "beginner", topic = "animals",
            createdAt = "2026-09-26T08:00:00Z",
            pages = listOf(ReaderPageDto("p1", 1, "小猫早上起床。", "xiǎo māo zǎoshang qǐchuáng", "The kitten gets up in the morning.")),
            vocabularyUsed = listOf(VocabItemDto("起床", "qǐchuáng", "get up"), VocabItemDto("公园", "gōngyuán", "park")),
        ),
        GradedReaderDto(
            id = "r2", titleChinese = "我的新邻居", titleEnglish = "My new neighbour", difficulty = "elementary",
            createdAt = "2026-09-20T08:00:00Z",
            pages = listOf(ReaderPageDto("q1", 1, "我有一个新邻居。", "wǒ yǒu yí gè xīn línjū", "I have a new neighbour.")),
            vocabularyUsed = listOf(VocabItemDto("邻居", "línjū", "neighbour")),
        ),
    )
    private val listUi = ReadersUi(readers = readers)

    /** The sheet over the screen it was opened from, as on the phone. */
    @Composable
    private fun overReaders(ui: AnkiExportUi) {
        ReadersListScreen(listUi, ReadersActions(onBack = {}))
        LabBottomSheet(onDismiss = {}) { AnkiExportContent(ui, AnkiExportActions()) }
    }

    private val result = AnkiExportResult(File("HSK-3-Plans-and-time.apkg"), "HSK-3-Plans-and-time.apkg", notes = 48, cards = 139, audioIncluded = 91, audioMissing = 5, bytes = 1_843_200)

    @Test fun deckOptions() = shootScreen("anki-01-deck-options") {
        overReaders(AnkiExportUi("HSK 3 · Plans & time", AnkiExportKind.DECK, includeProgress = true))
    }

    @Test fun readerOptions() = shootScreen("anki-02-reader-options") {
        overReaders(AnkiExportUi("小猫的一天", AnkiExportKind.READER))
    }

    @Test fun fetchingAudio() = shootScreen("anki-03-progress") {
        overReaders(AnkiExportUi("HSK 3 · Plans & time", AnkiExportKind.DECK, phase = AnkiExportPhase.Running(AnkiExportProgress(AnkiExportProgress.Stage.AUDIO, 37, 96))))
    }

    @Test fun done() = shootScreen("anki-04-result") {
        overReaders(AnkiExportUi("HSK 3 · Plans & time", AnkiExportKind.DECK, phase = AnkiExportPhase.Done(result.copy(audioMissing = 0, audioIncluded = 96), notice = "Saved to Downloads: HSK-3-Plans-and-time.apkg")))
    }

    @Test fun doneOfflineMissingClips() = shootScreen("anki-05-result-offline") {
        overReaders(AnkiExportUi("HSK 3 · Plans & time", AnkiExportKind.DECK, wasOffline = true, phase = AnkiExportPhase.Done(result)))
    }

    @Test fun error() = shootScreen("anki-06-error") {
        overReaders(AnkiExportUi("我的新邻居", AnkiExportKind.READER, phase = AnkiExportPhase.Error("This reader is not available offline")))
    }

    @Test fun darkResult() = shootScreen("anki-07-result-dark", dark = true) {
        overReaders(AnkiExportUi("Ordering coffee", AnkiExportKind.LESSON, phase = AnkiExportPhase.Done(result.copy(filename = "Lessons-Ordering-coffee.apkg", notes = 9, cards = 17, audioIncluded = 9, audioMissing = 0, bytes = 204_800))))
    }

    @Test fun readersListActions() = shoot("anki-08-readers-list") {
        ReadersListScreen(listUi, ReadersActions(onBack = {}))
    }

    @Test fun readersListMenu() = shootScreen("anki-09-readers-menu", act = { compose.onNodeWithContentDescription("More actions").performClick() }) {
        ReadersListScreen(listUi, ReadersActions(onBack = {}))
    }

    @Test fun readersImportProblem() = shoot("anki-10-readers-import-error") {
        ReadersListScreen(listUi.copy(message = "Could not import:\npages[0].content_chinese: required\ntitle_english: required"), ReadersActions(onBack = {}))
    }
}
