package dev.jeromeswannack.chineselearning.lab.ui.folders

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.Folder
import dev.jeromeswannack.chineselearning.lab.core.Folders
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Folders inside folders (up to Folders.MAX_FOLDER_DEPTH): the grouped list's rows indent per
 * level, a header drag reorders only its own level, Move folder… refuses cycles and too-deep
 * places, and the ⋯ menu offers "New folder inside…" above the deepest level only.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class NestedFoldersTest {
    @get:Rule val compose = createComposeRule()

    // a › b › c › d › e (five levels), x at the top
    private val chain = listOf(
        Folder("a", "u", "deck", "HSK 2", position = 0),
        Folder("b", "u", "deck", "Week 1", parentId = "a"),
        Folder("c", "u", "deck", "Monday", parentId = "b"),
        Folder("d", "u", "deck", "Morning", parentId = "c"),
        Folder("e", "u", "deck", "Early", parentId = "d"),
        Folder("x", "u", "deck", "Grammar", position = 1),
        Folder("x2", "u", "deck", "Verbs", parentId = "x"),
    )

    @Test fun rowsIndentPerLevelAndCollapseHidesEverythingBelow() {
        val tree = Folders.groupIntoFolders(listOf("i1" to "c", "i2" to null), { it.second }, chain, Folders.DECK)
        val rows = folderRows(tree, emptySet()) { it.first }
        val headers = rows.filterIsInstance<FolderRow.Header>().map { (it.folder?.id ?: "unfiled") to it.depth }
        assertEquals(listOf("a" to 0, "b" to 1, "c" to 2, "d" to 3, "e" to 4, "x" to 0, "x2" to 1, "unfiled" to 0), headers)
        assertEquals(2, rows.filterIsInstance<FolderRow.Item<Pair<String, String?>>>().first { it.key == "i1" }.depth)
        val collapsed = folderRows(tree, setOf("b")) { it.first }
        assertEquals(listOf("a", "b", "x", "x2", null), collapsed.filterIsInstance<FolderRow.Header>().map { it.folder?.id })
    }

    @Test fun aHeaderDragReordersOnlyItsOwnLevel() {
        val parents = headerParents(chain + Folder("b2", "u", "deck", "Week 2", parentId = "a", position = 1))
        val before = listOf("a", "b", "c", "d", "e", "b2", "x", "x2").map { FolderRow.headerKey(it) }
        val after = listOf("a", "b2", "b", "c", "d", "e", "x", "x2").map { FolderRow.headerKey(it) }
        assertEquals(listOf("b2", "b"), changedFolderLevel(after, before, parents))
        assertNull(changedFolderLevel(before, before, parents))
        assertEquals(true, sameFolderLevel(parents, FolderRow.headerKey("b"), FolderRow.headerKey("b2")))
        assertEquals(false, sameFolderLevel(parents, FolderRow.headerKey("b"), FolderRow.headerKey("x")))
        assertEquals(true, sameFolderLevel(parents, FolderRow.headerKey("a"), FolderRow.headerKey("x")))
    }

    @Test fun moveFolderSheetSkipsItsOwnTreeAndGreysTooDeep() {
        val moves = mutableListOf<Pair<String, String?>>()
        compose.setContent {
            LabTheme {
                FolderSheets(
                    FolderUi(Folders.DECK, chain, sheet = FolderSheet.MoveFolder(chain[5])),
                    FolderActions(onMoveFolderTo = { f, p -> moves += f.id to p }),
                )
            }
        }
        compose.onNodeWithTag("folder-breadcrumb", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Now in the top level").assertExists()
        // Grammar (2 levels) fits under Week 1 (level 2) → 4 levels, but not under Monday's child.
        compose.onNodeWithTag("move-folder-to-b").performClick()
        compose.onNodeWithTag("move-folder-to-d").assertIsNotEnabled()
        // Its own subfolder is not offered at all.
        compose.onNodeWithTag("move-folder-to-x2").assertDoesNotExist()
        assertEquals(listOf("x" to "b"), moves)
    }

    @Test fun newFolderInsideAtLevelFour() {
        compose.setContent {
            LabTheme { FolderSheets(FolderUi(Folders.DECK, chain, sheet = FolderSheet.Menu(chain[3], 0, 1)), FolderActions()) }
        }
        compose.onNodeWithText("New folder inside…").assertExists()
        compose.onNodeWithText("Move folder…").assertExists()
    }

    @Test fun noNewFolderInsideAtTheDeepestLevel() {
        compose.setContent {
            LabTheme { FolderSheets(FolderUi(Folders.DECK, chain, sheet = FolderSheet.Menu(chain[4], 0, 0)), FolderActions()) }
        }
        compose.onNodeWithText("New folder inside…").assertDoesNotExist()
    }

    @Test fun deleteSaysSubfoldersMoveIntoTheParent() {
        assertEquals(
            "Its deck moves to Unfiled. Its folder moves into “Week 1”. Nothing is deleted.",
            Folders.deleteFolderMessage(Folders.DECK, "Monday", 1, 1, "Week 1"),
        )
    }
}
