package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.navigation.NavGraph
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.composable
import androidx.navigation.createGraph
import androidx.navigation.navArgument
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Chats tab's route takes `?compose=1&text=` (More → "✦ Ask Claude / Coach", `/coach`): the tab bar
 * still switches to it, re-selects it and keeps its own stack, and the box's path round-trips.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ChatsNavTest {
    private lateinit var controller: NavHostController
    private lateinit var nav: LabNav
    private val tabs = NavRules.tabsFor(NavRole(hasTutor = true, loaded = true))
    private fun tab(id: TabId) = tabs.first { it.id == id }

    @Before fun setUp() {
        controller = NavHostController(ApplicationProvider.getApplicationContext())
        controller.navigatorProvider.addNavigator(ComposeNavigator())
        controller.graph = controller.createGraph(startDestination = Routes.HOME_ROUTE) {
            composable(Routes.route("/")) {}
            composable(
                Routes.route(CHATS_ROUTE_PATTERN),
                arguments = listOf("compose", "text").map { a -> navArgument(a) { type = NavType.StringType; nullable = true; defaultValue = null } },
            ) {}
            composable(Routes.route("/connections")) {}
            composable(Routes.route("/progress")) {}
            composable(Routes.route("/more")) {}
            composable(Routes.route("/chats/claude/{id}")) {}
            composable(Routes.PLACEHOLDER_ROUTE, arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = "/" })) {}
        }
        nav = LabNav(LabApp(), controller, handoff = {})
    }

    private fun stack() = controller.currentBackStack.value.filter { it.destination !is NavGraph }.map(LabNav::fullPathOf)

    @Test fun theTabBarStillOpensChats() {
        nav.openTab(tab(TabId.CHATS))
        assertEquals("/chats", nav.currentFullPath())
        assertTrue(nav.isNative("/chats?compose=1"))
        nav.open("/chats/claude/t1")
        // Re-selecting the tab pops back to its root.
        nav.openTab(tab(TabId.CHATS))
        assertEquals("/chats", nav.currentFullPath())
        nav.openTab(tab(TabId.MORE))
        assertEquals("/more", nav.currentFullPath())
        nav.openTab(tab(TabId.CHATS))
        assertEquals(TabId.CHATS, NavRules.activeTab(tabs, nav.currentPath()))
    }

    @Test fun moreAskClaudeOpensTheBox() {
        nav.openTab(tab(TabId.MORE))
        val path = Routes.chatsCompose("我想学中文")
        nav.open(path)
        assertEquals(path, nav.currentFullPath())
        assertEquals("1", controller.currentBackStackEntry!!.arguments!!.getString("compose"))
        assertEquals("我想学中文", controller.currentBackStackEntry!!.arguments!!.getString("text"))
        assertEquals(TabId.CHATS, NavRules.activeTab(tabs, nav.currentPath()))
        assertEquals(listOf("/", "/more", path), stack())
    }
}
