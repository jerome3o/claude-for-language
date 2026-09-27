package dev.jeromeswannack.chineselearning.lab.ui.catalogue

import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.composable
import androidx.navigation.createGraph
import androidx.navigation.navArgument
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.library.libraryGraph
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** `/library/catalogue` must open the catalogue, not `/library/{id}` with id = "catalogue". */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CatalogueRouteTest {
    @Test fun theLiteralCatalogueRouteWins() {
        val controller = NavHostController(ApplicationProvider.getApplicationContext())
        controller.navigatorProvider.addNavigator(ComposeNavigator())
        val nav = LabNav(LabApp(), controller, handoff = {})
        controller.graph = controller.createGraph(startDestination = Routes.HOME_ROUTE) {
            composable(Routes.route("/")) {}
            catalogueGraph(nav)
            libraryGraph(nav)
            composable(Routes.PLACEHOLDER_ROUTE, arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = "/" })) {}
        }

        nav.open(Routes.catalogue())
        assertEquals("library/catalogue", controller.currentDestination?.route)

        nav.open(Routes.libraryItem("lib1"))
        assertEquals("library/{id}", controller.currentDestination?.route)
        assertEquals("/library/lib1", nav.currentPath())

        nav.open(Routes.LIBRARY)
        assertEquals("library", controller.currentDestination?.route)

        // Not registered here (the lead's editor screens): the placeholder, never /library/{id}.
        nav.open(Routes.catalogueTrial("conversation"))
        assertEquals(Routes.PLACEHOLDER_ROUTE, controller.currentDestination?.route)
        assertTrue(nav.isNative(Routes.catalogue()))
    }
}
