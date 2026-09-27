package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.compose.runtime.Composable
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config

/** The Lesson Library list, its sheets and the item page. */
class LibraryScreenshots : LabScreenshotTest() {
    private val tutorTabs = NavRules.tabsFor(NavRole(hasStudents = true, isTutorOnly = true, loaded = true, isTutorAccount = true))

    /** Like [shoot] but captures every window, so bottom sheets and dialogs are in the picture. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun shootScreen(name: String, dark: Boolean = false, content: @Composable () -> Unit) {
        compose.setContent { LabTheme(dark = dark) { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/$name.png")
    }

    @Test fun list() = shootInShell("library-01-list", TabId.LIBRARY, tutorTabs) {
        LibraryScreen(LibrarySamples.listUi(), LibraryActions())
    }

    @Test fun empty() = shootInShell("library-02-empty", TabId.LIBRARY, tutorTabs) {
        LibraryScreen(LibraryUi(list = Loadable(emptyList(), updatedAt = 0)), LibraryActions())
    }

    @Test fun offlineWithCache() = shoot("library-03-offline") {
        LibraryScreen(LibraryUi(list = Loadable(LibrarySamples.items, offline = true, updatedAt = System.currentTimeMillis() - 2 * 3_600_000)), LibraryActions())
    }

    @Test fun successNotice() = shoot("library-04-assigned-notice") {
        LibraryScreen(LibrarySamples.listUi({ it.copy(notice = Notice("“把 sentences in the kitchen” assigned to 2 students, 1 already had it", NoticeKind.Success)) }), LibraryActions())
    }

    @Test fun newLessonSheet() = shootScreen("library-05-new-lesson") {
        LibraryScreen(LibrarySamples.listUi({ it.copy(newLesson = NewLessonUi(situation = "Booking a hotel room by phone", level = "Elementary (HSK 3)")) }), LibraryActions())
    }

    @Test fun newLessonDrafting() = shootScreen("library-06-new-lesson-drafting") {
        LibraryScreen(
            LibrarySamples.listUi({ it.copy(newLesson = NewLessonUi(prompt = "A beginner lesson on 了 for finished actions: a short note, two word-order exercises and a speaking task.", busy = NewLessonBusy.DRAFT)) }),
            LibraryActions(),
        )
    }

    @Test fun itemMenu() = shootScreen("library-07-item-menu") {
        LibraryScreen(LibrarySamples.listUi({ it.copy(menuFor = LibrarySamples.items[0]) }), LibraryActions())
    }

    @Test fun assignLongTerm() = shootScreen("library-08-assign") {
        LibraryScreen(LibrarySamples.listUi({ it.copy(assign = LibrarySamples.assign()) }), LibraryActions())
    }

    @Test fun assignOneOff() = shootScreen("library-09-assign-one-off") {
        LibraryScreen(LibrarySamples.listUi({ it.copy(assign = LibrarySamples.assign(HomeworkMode.ONE_OFF)) }), LibraryActions())
    }

    @Test fun assignNoStudents() = shootScreen("library-10-assign-no-students") {
        LibraryScreen(LibrarySamples.listUi({ it.copy(assign = LibrarySamples.assign().copy(students = emptyList(), selected = emptySet())) }), LibraryActions())
    }

    @Test fun item() = shoot("library-11-item") {
        LibraryItemScreen(LibrarySamples.itemUi, LibraryItemActions())
    }

    @Config(qualifiers = "w412dp-h2000dp-xxhdpi")
    @Test fun itemFullPage() = shoot("library-12-item-full") {
        LibraryItemScreen(LibrarySamples.itemUi.copy(pushing = false), LibraryItemActions())
    }

    @Test fun itemExport() = shootScreen("library-13-item-export") {
        LibraryItemScreen(LibrarySamples.itemUi.copy(exportSheet = true), LibraryItemActions())
    }

    @Test fun dark() = shootInShell("library-14-list-dark", TabId.LIBRARY, tutorTabs, dark = true) {
        LibraryScreen(LibrarySamples.listUi(), LibraryActions())
    }

    @Test fun assignDark() = shootScreen("library-15-assign-dark", dark = true) {
        LibraryScreen(LibrarySamples.listUi({ it.copy(assign = LibrarySamples.assign(HomeworkMode.BOTH, setOf("rel-tom"), LibrarySamples.today.plusDays(7))) }), LibraryActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shootInShell("library-16-list-unfolded", TabId.LIBRARY, tutorTabs) {
        LibraryScreen(LibrarySamples.listUi(), LibraryActions())
    }
}
