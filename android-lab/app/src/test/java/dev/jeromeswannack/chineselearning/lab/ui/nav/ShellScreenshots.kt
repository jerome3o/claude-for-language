package dev.jeromeswannack.chineselearning.lab.ui.nav

import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksTabScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.home.TutorHomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.TutorHomeUi
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreActions
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreScreen
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreUi
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.PlaceholderScreen
import dev.jeromeswannack.chineselearning.lab.data.SyncPhase
import dev.jeromeswannack.chineselearning.lab.data.SyncRun
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.ui.more.DebugReportRow
import org.junit.Test
import org.robolectric.annotation.Config

/** The shell: tab bar per role, Home / More / Decks / placeholders. */
class ShellScreenshots : LabScreenshotTest() {
    private val student = NavRole(hasTutor = true, loaded = true)
    private val tutorAccount = NavRole(hasStudents = true, isTutorOnly = true, loaded = true, isTutorAccount = true)

    private fun more(role: NavRole, admin: Boolean = false) = MoreUi(
        userName = "Jerome Swannack", email = "jerome@example.com", role = role, isAdmin = admin,
        sync = SyncStatus(lastSyncAt = System.currentTimeMillis(), unsynced = 2, audioTotal = 830, audioCached = 812), pendingWrites = 1,
    )

    @Test fun studyTab() = shootInShell("shell-01-study-tab", TabId.STUDY) {
        HomeScreen(HomeUi(loaded = true, userName = "Jerome Swannack", due = Samples.counts, decks = Samples.decks, reviewedToday = 31), Samples.sync(), online = true, actions = HomeActions())
    }

    @Test fun decksTab() = shootInShell("shell-02-decks-tab", TabId.DECKS) {
        DecksTabScreen(true, Samples.decks, onStudy = {}, onOpenMainApp = {})
    }

    @Test fun tutorTabPlaceholder() = shootInShell("shell-03-tutor-placeholder", TabId.TUTOR) {
        PlaceholderScreen("/connections", onBack = null, onOpenInMainApp = {})
    }

    @Test fun moreTab() = shootInShell("shell-04-more", TabId.MORE) {
        MoreScreen(more(student), MoreActions(), extraRows = listOf({ DebugReportRow("Sent: 24 due · 8,946 cards · 41,210 reviews (212 KB)", sending = false) {} }))
    }

    @Test fun pushedPlaceholder() = shootInShell("shell-05-placeholder-pushed", TabId.MORE) {
        PlaceholderScreen("/coach", onBack = {}, onOpenInMainApp = {})
    }

    @Test fun tutorAccountHome() = shootInShell("shell-06-tutor-account-home", active = null, tabs = NavRules.tabsFor(tutorAccount)) {
        TutorHomeScreen(TutorHomeUi("Lin", 4, Samples.decks.map { it.id to it.name }), onOpen = {})
    }

    @Test fun tutorAccountMore() = shootInShell("shell-07-tutor-account-more", TabId.MORE, tabs = NavRules.tabsFor(tutorAccount)) {
        MoreScreen(more(tutorAccount), MoreActions())
    }

    @Test fun studentWithStudentsDark() = shootInShell("shell-08-dark-more", TabId.MORE, tabs = NavRules.tabsFor(NavRole(hasStudents = true, loaded = true)), dark = true) {
        MoreScreen(more(NavRole(hasStudents = true, hasTutor = true, loaded = true), admin = true), MoreActions())
    }

    /** More → Lab app scrolled to the sync rows: Last sync opened with per-step timings (Repository.sync). */
    @Test fun moreSyncTimings() = shootInShell("shell-10-more-sync-timings", TabId.MORE) {
        val run = SyncRun(
            full = true, atMs = System.currentTimeMillis() - 60_000, totalMs = 5_699, ok = true,
            phases = listOf(
                SyncPhase("Profile", 113),
                SyncPhase("Downloading decks", 580, "24 decks · 3,000 notes"),
                SyncPhase("Saving decks", 2150, "3,000 notes · 9,000 cards"),
                SyncPhase("Downloading reviews", 1048, "45,470 received · 45,470 new · 10 pages"),
                SyncPhase("Card states", 1748, "9,000 replayed · 6,487 changed"),
                SyncPhase("Sentences", 14, "0 sentences"),
            ),
        )
        val state = androidx.compose.foundation.lazy.rememberLazyListState(initialFirstVisibleItemIndex = 5)
        MoreScreen(more(student).copy(sync = SyncStatus(lastSyncAt = System.currentTimeMillis() - 60_000, audioTotal = 6200, audioCached = 1450, lastRun = run), syncDetailsOpen = true), MoreActions(), listState = state)
    }

    @Config(qualifiers = LabScreenshotTest.UNFOLDED)
    @Test fun unfoldedMore() = shootInShell("shell-09-unfolded-more", TabId.MORE) {
        MoreScreen(more(student), MoreActions())
    }
}
