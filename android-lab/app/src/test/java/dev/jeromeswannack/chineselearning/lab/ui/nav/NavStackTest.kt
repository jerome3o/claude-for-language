package dev.jeromeswannack.chineselearning.lab.ui.nav

import androidx.navigation.NavGraph
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.composable
import androidx.navigation.createGraph
import androidx.navigation.navArgument
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The back stack rules behind Jerome's two navigation bugs: Study is single-instance (no "X →
 * the same study screen again"), a "go study" tap leaves a homework pass / reader / lesson on
 * screen, and a cold start rebuilds where the app was while that is fresh (NavResume).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NavStackTest {
    private lateinit var controller: NavHostController
    private lateinit var nav: LabNav
    private val hour = 3_600_000L
    private val now = 1_800_000_000_000L

    @Before fun setUp() = build(Routes.HOME_ROUTE)

    private fun build(start: String) {
        controller = NavHostController(ApplicationProvider.getApplicationContext())
        controller.navigatorProvider.addNavigator(ComposeNavigator())
        controller.graph = controller.createGraph(startDestination = start) {
            composable(Routes.route("/")) {}
            composable(Routes.route("/chats")) {}
            composable(Routes.route("/connections")) {}
            composable(Routes.route("/progress")) {}
            composable(Routes.route("/more")) {}
            composable(Routes.route("/library")) {}
            composable(Routes.route("/decks")) {}
            composable(Routes.route("/decks/{id}")) {}
            composable(Routes.route("/homework")) {}
            composable(Routes.route("/homework/{id}")) {}
            composable(Routes.route("/readers/{id}")) {}
            composable(Routes.route("/today/reader")) {}
            composable(Routes.route("/calls/{id}")) {}
            composable(Routes.route("/connections/{relId}/chat/{convId}")) {}
            composable(
                Routes.route("/coach?text={text}&draft={draft}&focus={focus}"),
                arguments = listOf("text", "draft", "focus").map { a -> navArgument(a) { type = NavType.StringType; nullable = true; defaultValue = null } },
            ) {}
            composable(Routes.STUDY_ROUTE, arguments = listOf(navArgument("deck") { type = NavType.StringType; nullable = true; defaultValue = null })) {}
            composable(Routes.PLACEHOLDER_ROUTE, arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = "/" })) {}
        }
        nav = LabNav(LabApp(), controller, handoff = {})
    }

    private fun stack() = controller.currentBackStack.value.filter { it.destination !is NavGraph }.map(LabNav::fullPathOf)
    private fun studies() = stack().count { NavResume.isStudy(it) }

    // ---------------- Bug 1: one Study ----------------

    @Test fun studyAlwaysOpensAndCloseTakesEveryStackedCopyOff() {
        nav.open(Routes.study())
        nav.open(Routes.coach(draft = "我们走吧", focus = true)) // ⋯ → Sentence coach from the card
        nav.open(Routes.study()) // the widget / a notification while the coach is up: Study opens
        assertEquals("/study", nav.currentFullPath())
        nav.closeStudy()
        assertEquals(Routes.coach(draft = "我们走吧", focus = true), nav.currentFullPath())
    }

    @Test fun closeStudyPopsConsecutiveCopiesToTheScreenBeforeTheFirst() {
        nav.open(Routes.deck("abc"))
        // However they got there (an older build, a restored stack), stacked copies go at once.
        controller.navigate(Routes.routeForPath(Routes.study()))
        controller.navigate(Routes.routeForPath(Routes.study("abc")))
        controller.navigate(Routes.routeForPath(Routes.study()))
        assertEquals(3, studies())
        nav.closeStudy()
        assertEquals(listOf("/", "/decks/abc"), stack())
    }

    @Test fun closeStudyWithNothingUnderneathLandsOnHome() {
        build(Routes.STUDY_ROUTE)
        nav.closeStudy()
        assertEquals("/", nav.currentFullPath())
    }

    @Test fun repeatedOpensNeverAddLayers() {
        repeat(3) { nav.open(Routes.study()) }
        assertEquals(1, studies())
        repeat(3) { nav.open(Routes.homeworkPass("hw1")) }
        assertEquals(listOf("/", "/study", "/homework/hw1"), stack())
    }

    @Test fun studyForAnotherDeckReplacesTheSession() {
        nav.open(Routes.study("d1"))
        nav.open(Routes.study())
        assertEquals(listOf("/", "/study"), stack())
        nav.open(Routes.study("d2"))
        assertEquals(listOf("/", "/study?deck=d2"), stack())
    }

    @Test fun closingStudyReturnsToWhateverWasOpenBefore() {
        nav.open(Routes.deck("abc"))
        nav.open(Routes.study("abc"))
        nav.back()
        assertEquals("/decks/abc", nav.currentFullPath())
    }

    // ---------------- "go study" taps (widget, reminders) ----------------

    @Test fun aStudyReminderOpensStudyOverTheHomeworkPassWhichStaysUnderneath() {
        nav.open(Routes.homework())
        nav.open(Routes.homeworkPass("hw1"))
        nav.handle(NavRequest(Routes.study(), soft = true), seenAt = now - hour, now = now)
        assertEquals("/study", nav.currentFullPath())
        nav.closeStudy()
        assertEquals(listOf("/", "/homework", "/homework/hw1"), stack())
    }

    @Test fun theHomeworkReminderLeavesAPassInProgressOnScreen() {
        nav.open(Routes.homeworkPass("hw1"))
        val before = stack()
        nav.handle(NavRequest(Routes.homework(), soft = true), seenAt = now - hour, now = now)
        assertEquals(before, stack())
        nav.open(Routes.todayReader())
        nav.handle(NavRequest(Routes.homeworkPass("hw2"), soft = true), seenAt = now, now = now)
        assertEquals("/today/reader", nav.currentFullPath())
    }

    @Test fun aReminderTapOpensStudyWhenNothingResumableIsGoingOn() {
        nav.open(Routes.deck("abc"))
        nav.handle(NavRequest(Routes.study(), soft = true), seenAt = now, now = now)
        assertEquals(listOf("/", "/decks/abc", "/study"), stack())
        // Study already open: reused, no new layer.
        nav.handle(NavRequest(Routes.study(), soft = true), seenAt = now, now = now)
        assertEquals(1, studies())
    }

    @Test fun aPassLeftOverSixHoursAgoGivesWayToStudy() {
        nav.open(Routes.homeworkPass("hw1"))
        nav.handle(NavRequest(Routes.study(), soft = true), seenAt = now - 7 * hour, now = now)
        assertEquals("/study", nav.currentFullPath())
    }

    @Test fun chatLinksAreExplicitAndAlwaysOpen() {
        nav.open(Routes.homeworkPass("hw1"))
        nav.handle(NavRequest(Routes.chat("r1", "c1")), seenAt = now, now = now)
        assertEquals("/connections/r1/chat/c1", nav.currentFullPath())
    }

    // ---------------- the Study tab always lands on Study ----------------

    private val studentTabs = NavRules.tabsFor(NavRole(loaded = true))
    private val withStudents = NavRules.tabsFor(NavRole(hasStudents = true, loaded = true))
    private fun tab(tabs: List<TabSpec>, id: TabId) = tabs.first { it.id == id }

    /** The failing case (v0.456): a cold start rebuilt [Home, Chats, Study]; ✕, then the Study tab stayed on Chats — every time. */
    @Test fun theStudyTabOpensHomeAfterARestoredStack() {
        nav.restore(NavResume.stackToRestore(LastRoute(listOf("/", "/chats", "/study"), now), now, "/"))
        assertEquals(listOf("/", "/chats", "/study"), stack())
        nav.closeStudy()
        assertEquals("/chats", nav.currentFullPath())
        nav.openTab(tab(studentTabs, TabId.STUDY))
        assertEquals("/", nav.currentFullPath())
        nav.openTab(tab(studentTabs, TabId.MORE))
        assertEquals("/more", nav.currentFullPath())
        nav.openTab(tab(studentTabs, TabId.STUDY))
        assertEquals("/", nav.currentFullPath())
        nav.openTab(tab(studentTabs, TabId.CHATS))
        assertEquals("/chats", nav.currentFullPath())
        nav.openTab(tab(studentTabs, TabId.STUDY))
        assertEquals("/", nav.currentFullPath())
    }

    @Test fun theStudyTabLandsOnStudyFromEveryTab() {
        for (start in listOf(Routes.HOME_ROUTE, Routes.routeForPath("/connections"))) {
            for (tabs in listOf(studentTabs, withStudents)) {
                for (from in tabs.filter { it.id != TabId.STUDY }) {
                    // Tapped there, a cold start rebuilt onto it, and the same with a Study closed over it.
                    for (how in 0..2) {
                        build(start)
                        when (how) {
                            0 -> nav.openTab(from)
                            1 -> nav.restore(listOf(from.to))
                            else -> { nav.restore(listOf(from.to, Routes.study())); nav.closeStudy() }
                        }
                        val label = "start=$start tabs=${tabs.map { it.id }} from=${from.id} case=$how stack=${stack()}"
                        nav.openTab(tab(tabs, TabId.STUDY))
                        assertEquals(label, "/", nav.currentFullPath())
                        // …and again after another round trip through that tab.
                        nav.openTab(from)
                        assertEquals("$label (back to ${from.id})", from.id, NavRules.activeTab(tabs, nav.currentPath()))
                        nav.openTab(tab(tabs, TabId.STUDY))
                        assertEquals("$label (2nd)", "/", nav.currentFullPath())
                    }
                }
            }
        }
    }

    @Test fun everyTabLandsOnItsOwnRoot() {
        nav.restore(listOf("/chats", "/more"))
        for (round in 1..2) for (t in studentTabs) {
            nav.openTab(t)
            assertEquals("round $round ${t.id}", t.id, NavRules.activeTab(studentTabs, nav.currentPath()))
        }
    }

    // ---------------- cold start: "where I was" ----------------

    @Test fun fullPathsRoundTrip() {
        nav.open(Routes.study("d 1"))
        assertEquals("/study?deck=d%201", nav.currentFullPath())
        nav.open(Routes.coach(draft = "你好", focus = true))
        assertEquals(Routes.coach(draft = "你好", focus = true), nav.currentFullPath())
        nav.open("/readers/r1")
        assertEquals("/readers/r1", nav.currentFullPath())
    }

    @Test fun aFreshStackIsRebuiltOverTheStartScreen() {
        val saved = LastRoute(listOf("/", "/homework", "/homework/hw1"), now - 2 * hour)
        nav.restore(NavResume.stackToRestore(saved, now, "/"))
        assertEquals(listOf("/", "/homework", "/homework/hw1"), stack())
        nav.back()
        assertEquals("/homework", nav.currentFullPath())
    }

    @Test fun aStaleStackIsNotRebuilt() {
        val saved = LastRoute(listOf("/", "/homework/hw1"), now - 7 * hour)
        assertTrue(NavResume.stackToRestore(saved, now, "/").isEmpty())
        assertTrue(NavResume.stackToRestore(null, now, "/").isEmpty())
    }

    @Test fun aLiveCallIsNeverRejoinedByItself() {
        val saved = LastRoute(listOf("/", "/decks", "/calls/c1", "/decks/abc"), now)
        assertEquals(listOf("/decks"), NavResume.stackToRestore(saved, now, "/"))
    }

    @Test fun theStoreKeepsTheStack() {
        val store = LastRouteStore(ApplicationProvider.getApplicationContext())
        store.clear()
        assertNull(store.load())
        store.save(listOf("/", "/coach?draft=%E4%BD%A0&focus=1"), now)
        assertEquals(LastRoute(listOf("/", "/coach?draft=%E4%BD%A0&focus=1"), now), store.load())
    }

    @Test fun resumableActivities() {
        listOf("/homework/hw1", "/readers/r1", "/today/reader", "/today/lessons/l1", "/picture-hunt/p1", "/quests/q1", "/library/x/try")
            .forEach { assertTrue(it, NavResume.isResumable(it)) }
        listOf("/", "/homework", "/readers", "/readers/generate", "/study", "/decks/abc", "/connections/r/chat/c")
            .forEach { assertFalse(it, NavResume.isResumable(it)) }
    }
}
