package dev.jeromeswannack.chineselearning.lab.ui.folders

import androidx.compose.runtime.Composable
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.core.Folders
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.VocabItemDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksActions
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksSamples
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksTabScreen
import dev.jeromeswannack.chineselearning.lab.ui.library.LibraryActions
import dev.jeromeswannack.chineselearning.lab.ui.library.LibrarySamples
import dev.jeromeswannack.chineselearning.lab.ui.library.LibraryScreen
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadersActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadersListScreen
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadersUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test

/** Folders on the Decks list, the Library and Readers (ui/folders/). */
class FolderScreenshots : LabScreenshotTest() {
    private val tutorTabs = NavRules.tabsFor(NavRole(hasStudents = true, isTutorOnly = true, loaded = true, isTutorAccount = true))

    /** Captures every window, so the bottom sheet is in the picture. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun shootScreen(name: String, content: @Composable () -> Unit) {
        compose.setContent { LabTheme { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/$name.png")
    }

    private val deckFolders = listOf(
        Folder("hsk", "u", "deck", "HSK 3", position = 0),
        Folder("wk", "u", "deck", "Week 40 homework", parentId = "hsk", position = 0),
        Folder("food", "u", "deck", "Food & travel", position = 1),
    )

    private val decks = DecksSamples.list.copy(
        decks = DecksSamples.list.decks.map {
            when (it.id) {
                "d1" -> it.copy(folderId = "wk")
                "d2" -> it.copy(folderId = "hsk")
                "d3" -> it.copy(folderId = "food")
                else -> it
            }
        },
    )

    @Test fun decks() = shootInShell("folders-01-decks", TabId.MORE) {
        DecksTabScreen(
            decks,
            DecksActions(),
            folders = FolderUi(Folders.DECK, deckFolders, collapsed = setOf("food")),
        )
    }

    private val lessonFolders = listOf(
        Folder("g", "u", "lesson", "Grammar", position = 0),
        Folder("c", "u", "lesson", "Conversations", position = 1),
    )

    @Test fun library() = shootInShell("folders-02-library", TabId.LIBRARY, tutorTabs) {
        val ui = LibrarySamples.listUi({ l ->
            l.copy(list = l.list.copy(data = l.list.data!!.map { it.copy(folder_id = when (it.id) { "lib1" -> "g"; "lib2" -> "c"; else -> null }) }))
        })
        LibraryScreen(ui, LibraryActions(), folders = FolderUi(Folders.LESSON, lessonFolders))
    }

    @Test fun moveSheet() = shootScreen("folders-03-move-sheet") {
        DecksTabScreen(
            decks,
            DecksActions(),
            folders = FolderUi(Folders.DECK, deckFolders, sheet = FolderSheet.Move(listOf("d4"), null)),
        )
    }

    private val reader = GradedReaderDto(
        "r1", "小明在巴黎", "Xiaoming in Paris", "beginner", "travel",
        listOf(VocabItemDto("巴黎", "Bālí", "Paris"), VocabItemDto("咖啡", "kāfēi", "coffee"), VocabItemDto("日落", "rìluò", "sunset")),
        "ready", null, "2026-09-26T08:00:00Z", folderId = "trips",
    )

    @Test fun readers() = shoot("folders-04-readers") {
        ReadersListScreen(
            ReadersUi(
                readers = listOf(
                    reader,
                    reader.copy(id = "r2", titleChinese = "我的新邻居", titleEnglish = "My new neighbour", difficulty = "elementary", topic = null, createdAt = "2026-09-20T09:00:00Z", folderId = "home"),
                    reader.copy(id = "r3", titleChinese = "动物园的一天", titleEnglish = "A day at the zoo", topic = "animals", createdAt = "2026-09-12T09:00:00Z", folderId = null),
                ),
            ),
            ReadersActions(onBack = {}),
            folders = FolderUi(
                Folders.READER,
                listOf(Folder("trips", "u", "reader", "Trips", position = 0), Folder("home", "u", "reader", "Daily life", position = 1)),
                toast = Folders.movedMessage(Folders.READER, 1, "Trips"),
            ),
        )
    }

    @Test fun selecting() = shoot("folders-05-decks-selecting") {
        DecksTabScreen(
            DecksSamples.list,
            DecksActions(),
            folders = FolderUi(Folders.DECK, emptyList(), selecting = true, selected = setOf("d2", "d3")),
        )
    }

    @Test fun deleteConfirm() = shootScreen("folders-06-delete-confirm") {
        DecksTabScreen(
            decks,
            DecksActions(),
            folders = FolderUi(Folders.DECK, deckFolders, sheet = FolderSheet.ConfirmDelete(deckFolders[0], 1, 1)),
        )
    }
}
