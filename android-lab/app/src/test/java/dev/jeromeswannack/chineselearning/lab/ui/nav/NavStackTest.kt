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

    @Before fun setUp() {
        controller = NavHostController(ApplicationProvider.getApplicationContext())
        controller.navigatorProvider.addNavigator(ComposeNavigator())
        controller.graph = controller.createGraph(startDestination = Routes.HOME_ROUTE) {
            composable(Routes.route("/")) {}
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

    @Test fun aSecondStudyBringsTheFirstBackInsteadOfStacking() {
        nav.open(Routes.study())
        nav.open(Routes.coach(draft = "我们走吧", focus = true)) // ⋯ → Sentence coach from the card
        nav.open(Routes.study()) // the widget / a notification while the coach is up
        assertEquals(listOf("/", "/study"), stack())
        nav.back() // ✕ once: Home, not the same study screen again
        assertEquals("/", nav.currentPath())
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

    @Test fun aReminderTapLeavesTheHomeworkPassOnScreen() {
        nav.open(Routes.homework())
        nav.open(Routes.homeworkPass("hw1"))
        val before = stack()
        nav.handle(NavRequest(Routes.study(), soft = true), seenAt = now - hour, now = now)
        assertEquals(before, stack())
        // A reader / today's story / lesson in progress stays too.
        nav.open(Routes.todayReader())
        nav.handle(NavRequest(Routes.study(), soft = true), seenAt = now, now = now)
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
