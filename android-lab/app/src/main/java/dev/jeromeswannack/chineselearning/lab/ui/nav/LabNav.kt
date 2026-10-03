package dev.jeromeswannack.chineselearning.lab.ui.nav

import android.net.Uri
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph
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
/** A link from outside the app; [soft] = a "go study" entry (see NavResume). */
data class NavRequest(val path: String, val soft: Boolean = false)

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
        // Study is single-instance: never a second session under the first (Jerome's "I click the
        // X, it slides down, and reveals the same study screen again").
        if (NavResume.isStudy(p)) return openStudy(p)
        // The same screen again (a double tap, the widget tapped twice, a repeated intent) stays one layer.
        if (currentFullPath() == p) return
        if (tryNavigate(Routes.routeForPath(p))) return
        if (p.contains('?') && tryNavigate(Routes.routeForPath(p.substringBefore('?')))) return
        controller.navigate(Routes.placeholder(p))
    }

    /** True when [path] has a native screen (e.g. to mark More rows that open the main app). */
    fun isNative(path: String): Boolean {
        val route = Routes.routeForPath(path.substringBefore('?'))
        // findNode matches a filled-in route ("decks/abc") against the patterns ("decks/{id}").
        return runCatching { controller.graph.findNode(route)?.let { it.route != Routes.PLACEHOLDER_ROUTE } == true }.getOrDefault(false)
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

    /**
     * Opens Study with at most one Study entry on the stack: one already there (with the same
     * deck) comes back to the top, whatever was opened over it closed; a Study for another deck
     * replaces it. Closing Study then returns to whatever was open before it.
     */
    fun openStudy(path: String = Routes.study()) {
        val p = if (path.startsWith("/")) path else "/$path"
        val existing = controller.currentBackStack.value.lastOrNull { it.destination.route == Routes.STUDY_ROUTE }
        if (existing != null) {
            if (fullPathOf(existing) == p) {
                controller.popBackStack(existing.destination.id, inclusive = false)
                return
            }
            controller.popBackStack(existing.destination.id, inclusive = true)
        }
        if (!tryNavigate(Routes.routeForPath(p))) controller.navigate(Routes.placeholder(p))
    }

    /**
     * A link from outside the app (MainActivity). [NavRequest.soft] ("go study": the widget, a
     * reminder notification) leaves a fresh resumable activity on screen (NavResume); explicit
     * links (a chat, a call) always open.
     */
    fun handle(request: NavRequest, seenAt: Long?, now: Long = System.currentTimeMillis()) {
        if (request.soft && NavResume.softEntryStays(currentFullPath(), seenAt, now)) return
        open(request.path)
    }

    /** Rebuilds a saved stack (bottom first) over the start screen — a cold start (NavResume). */
    fun restore(paths: List<String>) = paths.forEach { runCatching { open(it) } }

    /** The back stack as full web paths (with their query), bottom first — what LastRouteStore keeps. */
    fun stackPaths(): List<String> =
        controller.currentBackStack.value.filter { it.destination !is NavGraph }.map(::fullPathOf)

    /** The full web path of the screen on top, query included ("/study?deck=abc"). */
    fun currentFullPath(): String? = controller.currentBackStackEntry?.takeIf { it.destination !is NavGraph }?.let(::fullPathOf)

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
        private val ARG = Regex("\\{([^}]+)\\}")
        private val WHOLE_ARG = Regex("^\\{([^}]+)\\}$")

        /** [pathOf] with the query the route declares ("/study?deck=abc", "/coach?draft=…"), ids encoded: re-openable. */
        fun fullPathOf(entry: NavBackStackEntry): String {
            val pattern = entry.destination.route ?: return "/"
            val args = entry.arguments
            if (pattern == Routes.PLACEHOLDER_ROUTE) return args?.getString("path") ?: "/"
            if (pattern == Routes.HOME_ROUTE) return "/"
            @Suppress("DEPRECATION")
            fun arg(name: String): String? = args?.get(name)?.toString()
            val base = pattern.substringBefore('?').replace(ARG) { m -> Uri.encode(arg(m.groupValues[1]).orEmpty()) }
            val query = pattern.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.mapNotNull { part ->
                val name = WHOLE_ARG.find(part.substringAfter('=', ""))?.groupValues?.get(1) ?: return@mapNotNull null
                val value = arg(name) ?: return@mapNotNull null
                "${part.substringBefore('=')}=${Uri.encode(value)}"
            }
            return "/$base" + if (query.isEmpty()) "" else "?" + query.joinToString("&")
        }

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
