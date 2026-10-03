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
        // Study always opens (closeStudy takes every stacked copy off at once).
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

    /**
     * Switches to a tab's root, keeping each tab's own back stack (like the web's tab bar) — and
     * the tapped tab is ALWAYS what ends up on screen. A saved tab state could send the Study tab
     * straight back to Chats (a cold-start stack rebuilt by [restore] then saved under Home's id
     * and restored by `restoreState`: "Study won't open"); when the result is not the tapped tab,
     * that saved state is dropped and the tab's root opened plainly.
     */
    fun openTab(tab: TabSpec) {
        val route = Routes.routeForPath(tab.to)
        runCatching {
            if (onTab(tab)) {
                // Re-selecting the active tab pops back to its root.
                if (!controller.popBackStack(route, inclusive = false)) navigateTab(route)
            } else {
                navigateTab(route)
            }
        }
        if (!onTab(tab)) forceTab(route)
    }

    private fun onTab(tab: TabSpec) = NavRules.activeTab(listOf(tab), currentPath()) == tab.id

    /** The tab's root on screen with no saved state involved: the start screen popped back to, anything else pushed over it. */
    private fun forceTab(route: String) {
        runCatching { controller.clearBackStack(route) }
        val start = runCatching { controller.graph.findStartDestination() }.getOrNull()
        if (start != null && start.route == route) {
            if (controller.popBackStack(start.id, inclusive = false)) return
        }
        val ok = runCatching {
            controller.navigate(route) {
                if (start != null) popUpTo(start.id)
                launchSingleTop = true
            }
        }.isSuccess
        if (!ok) controller.navigate(Routes.placeholder("/$route"))
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
     * Opens Study — always, never refused: Jerome would "much rather have the bug and be able to
     * study". Study already on top (a double tap, the widget twice) is reused (launchSingleTop);
     * a Study under other screens may get a second copy on top, and [closeStudy] then takes every
     * consecutive copy off at once, so ✕ returns to the screen before the first.
     */
    fun openStudy(path: String = Routes.study()) {
        val p = if (path.startsWith("/")) path else "/$path"
        val route = Routes.routeForPath(p)
        val ok = try {
            controller.navigate(route) { launchSingleTop = true }
            true
        } catch (_: IllegalArgumentException) {
            false
        }
        if (!ok) controller.navigate(Routes.placeholder(p))
    }

    /**
     * ✕ / back in a study session: every Study entry on top of the stack comes off, so stacked
     * copies never show "the same study screen again"; nothing left under them → Home.
     */
    fun closeStudy() {
        var guard = 0
        while (controller.currentBackStackEntry?.destination?.route == Routes.STUDY_ROUTE && guard++ < 64) {
            if (!controller.popBackStack()) {
                controller.navigate(Routes.HOME_ROUTE)
                return
            }
        }
        if (controller.currentBackStackEntry == null || controller.currentBackStackEntry?.destination is NavGraph) controller.navigate(Routes.HOME_ROUTE)
    }

    /**
     * A link from outside the app (MainActivity). Study always opens; another [NavRequest.soft]
     * link (the homework reminder) leaves a fresh resumable activity on screen (NavResume);
     * explicit links (a chat, a call) always open.
     */
    fun handle(request: NavRequest, seenAt: Long?, now: Long = System.currentTimeMillis()) {
        // A "go study" tap (widget, due-card reminder) ALWAYS opens Study — over a homework pass
        // too, which stays underneath (✕ returns to it). Only a soft link to something else (the
        // homework reminder) leaves a pass in progress on screen.
        if (request.soft && !NavResume.isStudy(request.path) && NavResume.softEntryStays(currentFullPath(), seenAt, now)) return
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
