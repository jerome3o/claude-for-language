package dev.jeromeswannack.chineselearning.lab.ui.nav

import android.net.Uri
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import dev.jeromeswannack.chineselearning.lab.LabApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * What every feature graph gets: navigation by web path, back, and the hand-off to the
 * main app. Features never touch the NavController directly.
 *
 *   nav.open(Routes.deck(id))          // native screen if registered, else the placeholder
 *   nav.back()
 *   nav.openInMainApp("/decks/$id")    // straight to the hybrid app / website
 */
class LabNav(
    val app: LabApp,
    val controller: NavHostController,
    private val handoff: (String) -> Unit,
    /** The account's role, tabs and landing (ShellViewModel) — read it for role-dependent screens. */
    val shell: StateFlow<ShellState?> = MutableStateFlow(null),
    /** Signed out from inside the app (More → Sign out); MainActivity shows sign-in. */
    val onSignedOut: () -> Unit = {},
    /** Start Google sign-in again (session expired banner). */
    val onSignIn: () -> Unit = {},
) {
    /**
     * Opens a web path ("/decks/abc", "/coach?text=你好"). A registered native destination
     * wins; a path whose query the destination doesn't declare is retried without it;
     * anything else opens the placeholder, which offers the main app.
     */
    fun open(path: String) {
        val p = if (path.startsWith("/")) path else "/$path"
        if (tryNavigate(Routes.routeForPath(p))) return
        if (p.contains('?') && tryNavigate(Routes.routeForPath(p.substringBefore('?')))) return
        controller.navigate(Routes.placeholder(p))
    }

    /** True when [path] has a native screen (e.g. to mark More rows that open the main app). */
    fun isNative(path: String): Boolean {
        val route = Routes.routeForPath(path.substringBefore('?'))
        return runCatching { controller.graph.hasDeepLink(Uri.parse("android-app://androidx.navigation/$route")) }.getOrDefault(false)
    }

    /** Switches to a tab's root, keeping each tab's own back stack (like the web's tab bar). */
    fun openTab(tab: TabSpec) {
        val route = Routes.routeForPath(tab.to)
        val current = currentPath()
        if (NavRules.activeTab(listOf(tab), current) == tab.id) {
            // Re-selecting the active tab pops back to its root.
            if (!controller.popBackStack(route, inclusive = false)) navigateTab(route)
            return
        }
        navigateTab(route)
    }

    /** Goes to a tab's root path ("/decks") as if its tab were tapped (e.g. Home's "All decks"). */
    fun openTabPath(path: String) = navigateTab(Routes.routeForPath(path))

    /**
     * For inline links from a native screen to one that may not be native yet (the study
     * card's "open in app"): the native screen when there is one, else straight to the main
     * app — no placeholder in between.
     */
    fun openOrHandoff(path: String) = if (isNative(path)) open(path) else openInMainApp(path)

    private fun navigateTab(route: String) {
        val ok = runCatching {
            controller.navigate(route) {
                popUpTo(controller.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }.isSuccess
        if (!ok) controller.navigate(Routes.placeholder("/$route"))
    }

    fun back() {
        if (!controller.popBackStack()) controller.navigate(Routes.HOME_ROUTE)
    }

    fun openInMainApp(path: String) = handoff(path)

    /** The web path of the screen on top. */
    fun currentPath(): String = controller.currentBackStackEntry?.let(::pathOf) ?: "/"

    private fun tryNavigate(route: String): Boolean = try {
        controller.navigate(route)
        true
    } catch (_: IllegalArgumentException) {
        false
    }

    companion object {
        /** A back-stack entry as the web path it shows (placeholders report the path they stand in for). */
        fun pathOf(entry: NavBackStackEntry): String {
            val pattern = entry.destination.route ?: return "/"
            val args = entry.arguments
            if (pattern == Routes.PLACEHOLDER_ROUTE) return args?.getString("path") ?: "/"
            if (pattern == Routes.HOME_ROUTE) return "/"
            val base = pattern.substringBefore('?').replace(Regex("\\{([^}]+)\\}")) { m -> args?.get(m.groupValues[1])?.toString().orEmpty() }
            return "/$base"
        }
    }
}
