package dev.jeromeswannack.chineselearning.lab.ui.nav

import android.net.Uri
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

/** Web-path navigation: native when registered, placeholder otherwise; deep links; tab switching. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class LabNavTest {
    private lateinit var controller: NavHostController
    private lateinit var nav: LabNav
    private val handedOff = mutableListOf<String>()

    @Before fun setUp() {
        controller = NavHostController(ApplicationProvider.getApplicationContext())
        controller.navigatorProvider.addNavigator(ComposeNavigator())
        controller.graph = controller.createGraph(startDestination = Routes.HOME_ROUTE) {
            composable(Routes.route("/")) {}
            composable(Routes.route("/decks")) {}
            composable(Routes.route("/decks/{id}")) {}
            composable(Routes.route("/more")) {}
            composable(Routes.route("/study?deck={deck}"), arguments = listOf(navArgument("deck") { type = NavType.StringType; nullable = true; defaultValue = null })) {}
            composable(Routes.PLACEHOLDER_ROUTE, arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = "/" })) {}
        }
        nav = LabNav(LabApp(), controller, handoff = { handedOff += it })
    }

    @Test fun nativePathsOpenTheirScreen() {
        nav.open("/decks/abc")
        assertEquals("decks/{id}", controller.currentDestination?.route)
        assertEquals("/decks/abc", nav.currentPath())
        nav.open(Routes.study("d1"))
        assertEquals("/study", nav.currentPath())
        assertEquals("d1", controller.currentBackStackEntry?.arguments?.getString("deck"))
    }

    @Test fun unknownPathsOpenThePlaceholderWithTheirPath() {
        nav.open("/readers/r1")
        assertEquals(Routes.PLACEHOLDER_ROUTE, controller.currentDestination?.route)
        assertEquals("/readers/r1", nav.currentPath())
        assertTrue(handedOff.isEmpty())
    }

    @Test fun anUndeclaredQueryFallsBackToThePlainRoute() {
        nav.open("/decks?q=打算")
        assertEquals("decks", controller.currentDestination?.route)
    }

    @Test fun openOrHandoffSkipsThePlaceholder() {
        nav.openOrHandoff("/cards/n1")
        assertEquals(listOf("/cards/n1"), handedOff)
        assertEquals(Routes.HOME_ROUTE, controller.currentDestination?.route)
        assertTrue(nav.isNative("/decks/x"))
        assertFalse(nav.isNative("/coach"))
    }

    @Test fun tabsKeepOneEntryPerRoot() {
        nav.openTab(NavRules.MORE)
        nav.openTab(NavRules.DECKS)
        nav.open("/decks/abc")
        nav.openTab(NavRules.MORE)
        assertEquals("/more", nav.currentPath())
        // Home + More: switching never stacks tab roots on each other.
        assertEquals(listOf("home", "more"), controller.currentBackStack.value.mapNotNull { it.destination.route }.filter { it != controller.graph.route })
        // Back to Decks restores its stack; re-selecting it pops to the root.
        nav.openTab(NavRules.DECKS)
        assertEquals("/decks/abc", nav.currentPath())
        nav.openTab(NavRules.DECKS)
        assertEquals("/decks", nav.currentPath())
    }

    @Test fun deepLinks() {
        assertEquals("/decks/abc", deepLinkPath(Uri.parse("chineselearning-lab:///decks/abc")))
        assertEquals("/decks/abc", deepLinkPath(Uri.parse("chineselearning-lab://decks/abc")))
        assertEquals("/coach?text=%E4%BD%A0", deepLinkPath(Uri.parse("chineselearning-lab:///coach?text=%E4%BD%A0")))
        assertEquals("/", deepLinkPath(Uri.parse("chineselearning-lab:///")))
        assertNull(deepLinkPath(Uri.parse("chineselearning-lab://auth?session_token=x&nonce=y")))
        assertNull(deepLinkPath(Uri.parse("https://example.com/decks")))
    }

    @Test fun routeHelpersSpeakWebPaths() {
        assertEquals("/decks/a%20b", Routes.deck("a b"))
        assertEquals("/study", Routes.study())
        assertEquals("/coach?text=%E4%BD%A0%E5%A5%BD", Routes.coach("你好"))
        // The widget's ✏️: straight into the coach's sentence box, keyboard up.
        assertEquals("/coach?focus=1", dev.jeromeswannack.chineselearning.lab.shell.ShellLinks.COACH_TYPE)
        assertEquals("/coach", dev.jeromeswannack.chineselearning.lab.shell.ShellLinks.coach("  "))
        assertEquals("home", Routes.routeForPath("/"))
        assertEquals("decks/abc", Routes.routeForPath("/decks/abc"))
    }
}
