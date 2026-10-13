package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreActions
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreScreen
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreUi
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Minghui's tidy-up (Oct 2026): the homework library and lesson materials are out of More, and
 * "homework progress" on the dashboard goes straight to the student page's Homework section,
 * scrolled into view and flashed (web `/connections/:relId#homework`).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class TutorTidyTest {
    @get:Rule val compose = createComposeRule()

    @Test fun moreHasNoHomeworkLibraryOrMaterials() {
        val tutor = NavRole(hasStudents = true, isTutorOnly = true, loaded = true, isTutorAccount = true)
        compose.setContent {
            LabTheme { MoreScreen(MoreUi(userName = "Minghui Wang", email = "m@example.com", role = tutor, sync = SyncStatus()), MoreActions()) }
        }
        compose.onNodeWithText("Lesson Library").assertExists()
        compose.onNodeWithText("Homework library").assertDoesNotExist()
        compose.onNodeWithText("Lesson materials").assertDoesNotExist()
    }

    @Test fun homeworkPillOpensTheHomeworkSection() {
        val opened = mutableListOf<String>()
        val o = S.jeromeOverview
        compose.setContent {
            LabTheme { StudentCard(o.copy(pills = o.pills.copy(homework = S.oneOffOpen)), DashboardActions(open = { opened += it }), S.now) }
        }
        compose.onNodeWithText(S.oneOffOpen.pill).performClick()
        assertEquals(listOf("/connections/${o.relationship_id}?section=homework"), opened)
        assertEquals("/connections/rel%201?section=homework", Routes.connection("rel 1", Routes.SECTION_HOMEWORK))
        assertEquals("/connections/rel-1", Routes.connection("rel-1"))
    }

    @Test fun focusScrollsToTheHomeworkSectionAndFlashesIt() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            LabTheme { StudentPageScreen(S.studentPage().copy(focus = SectionFocus(Routes.SECTION_HOMEWORK)), StudentPageActions(), S.now) }
        }
        // The scroll walks the list a screen per frame until the Homework item is laid out.
        var shown = false
        repeat(400) {
            if (!shown) {
                compose.mainClock.advanceTimeByFrame()
                shown = runCatching { compose.onNodeWithTag("student-homework-section").assertIsDisplayed() }.isSuccess
            }
        }
        assertTrue("the Homework section scrolled into view", shown)
        // Once the scroll settles the section flashes.
        var flashed = false
        repeat(200) {
            if (!flashed) {
                compose.mainClock.advanceTimeByFrame()
                flashed = runCatching { compose.onNodeWithTag("section-flash", useUnmergedTree = true).assertExists() }.isSuccess
            }
        }
        assertTrue("the Homework section flashed", flashed)
        compose.onNodeWithTag("student-homework-section").assertIsDisplayed()
        compose.mainClock.advanceTimeBy(4_000)
        compose.onNodeWithTag("section-flash", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun withoutFocusThePageStartsAtTheTop() {
        compose.setContent {
            LabTheme { StudentPageScreen(S.studentPage(), StudentPageActions(), S.now) }
        }
        compose.onNodeWithTag("section-flash", useUnmergedTree = true).assertDoesNotExist()
    }
}
