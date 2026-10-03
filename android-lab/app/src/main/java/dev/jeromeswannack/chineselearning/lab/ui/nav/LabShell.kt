package dev.jeromeswannack.chineselearning.lab.ui.nav

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * The signed-in app: one NavHost over every feature graph (FeatureGraphs.kt) with the tab
 * bar under it. The bar follows the web's rules exactly — the tab set from the role
 * (NavRules.tabsFor), the lit tab from the current path (activeTab), hidden on immersive
 * paths (isImmersiveRoute) and while the keyboard is up.
 *
 * [pending] is a link from outside (`chineselearning-lab:///decks/abc`, the widget, a notification)
 * to apply once the graph exists ([LabNav.handle]). [restoreFrom] is the stack saved before the
 * process died (a cold start without saved state, NavResume): rebuilt first when still fresh.
 * The stack is saved on every move and whenever the app goes to the background.
 */
@Composable
fun LabShell(
    app: LabApp,
    handoff: (String) -> Unit,
    onSignedOut: () -> Unit,
    onSignIn: () -> Unit,
    pending: NavRequest? = null,
    onPendingConsumed: () -> Unit = {},
    restoreFrom: LastRoute? = null,
    onRestored: () -> Unit = {},
    onNav: (LabNav) -> Unit = {},
) {
    val vm: ShellViewModel = viewModel(factory = ShellViewModel.Factory(app))
    val shell by vm.state.collectAsStateWithLifecycle()
    val state = shell
    if (state == null) {
        // The role comes from Room in a few ms; don't flash a wrong tab set meanwhile.
        Box(Modifier.fillMaxSize().background(Lab.colors.background))
        return
    }
    val controller = rememberNavController()
    val nav = remember(controller) { LabNav(app, controller, handoff, vm.state, onSignedOut, onSignIn) }
    val entry by controller.currentBackStackEntryAsState()
    val path = entry?.let(LabNav::pathOf) ?: state.landing
    val tabRoots = remember(state.tabs) { state.tabs.map { Routes.routeForPath(it.to) }.toSet() }
    val badges by remember(app) { TabBadges.observe(app) }.collectAsStateWithLifecycle(emptyMap())

    // Package J: incoming video calls — poll + ring while in front, background checks when not.
    androidx.lifecycle.compose.LifecycleStartEffect(app) {
        app.callAlerts.setForeground(true)
        onStopOrDispose { app.callAlerts.setForeground(false) }
    }
    LaunchedEffect(path) { app.callAlerts.path = path }
    // Usage analytics: each route change records app.screen_view for the screen left (data/analytics/).
    LaunchedEffect(entry) { entry?.let { e -> app.analytics.screen(dev.jeromeswannack.chineselearning.lab.data.analytics.AnalyticsScreens.routeOf(e), LabNav.pathOf(e)) } }

    LaunchedEffect(nav) { onNav(nav) }
    val lastRoutes = remember(app) { LastRouteStore(app) }
    // Where the app was, for a cold start (and a "go study" tap's freshness check): what was on
    // screen when it was last in front. Read at launch; the first save below overwrites it.
    val seenAt = remember { mutableStateOf(restoreFrom?.savedAt) }
    LaunchedEffect(restoreFrom) {
        if (restoreFrom != null) {
            nav.restore(NavResume.stackToRestore(restoreFrom, System.currentTimeMillis(), nav.currentFullPath() ?: "/"))
            onRestored()
        }
    }
    LaunchedEffect(pending) {
        if (pending != null) {
            nav.handle(pending, seenAt.value)
            onPendingConsumed()
        }
    }
    LaunchedEffect(controller) {
        controller.currentBackStack.collect {
            val paths = nav.stackPaths()
            if (paths.isNotEmpty()) {
                lastRoutes.save(paths)
                seenAt.value = System.currentTimeMillis()
            }
        }
    }
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_PAUSE) {
        lastRoutes.save(nav.stackPaths())
        seenAt.value = System.currentTimeMillis()
    }

    ShellFrame(
        tabs = state.tabs,
        active = NavRules.activeTab(state.tabs, path),
        showBar = !NavRules.isImmersiveRoute(path),
        onSelect = { tab -> app.haptics.tick(); nav.openTab(tab) },
        badges = badges,
    ) {
        NavHost(
            navController = controller,
            startDestination = Routes.routeForPath(state.landing),
            enterTransition = { if (isTabSwitch(tabRoots)) fadeIn(tween(160)) else pushEnter() },
            exitTransition = { if (isTabSwitch(tabRoots)) fadeOut(tween(110)) else fadeOut(tween(140)) },
            popEnterTransition = { fadeIn(tween(180)) },
            popExitTransition = { popExit() },
        ) {
            featureGraphs(nav)
        }
        dev.jeromeswannack.chineselearning.lab.ui.calls.CallTopBar(nav, path)
    }
}

/**
 * The stateless frame: content above, tab bar below (sliding away on immersive routes and
 * while typing). Screenshot tests render it with any content.
 */
@Composable
fun ShellFrame(tabs: List<TabSpec>, active: TabId?, showBar: Boolean, onSelect: (TabSpec) -> Unit, badges: Map<TabId, Int> = emptyMap(), content: @Composable () -> Unit) {
    // Measured, not WindowInsets.isImeVisible: that reads true where no keyboard exists (tests).
    val imeUp = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val barShowing = showBar && !imeUp
    Column(Modifier.fillMaxSize().background(Lab.colors.background)) {
        // The tab bar pads the navigation bar itself, so while it shows the screens above it
        // must not pad it again; on immersive routes they do (LabScreenFrame, safeDrawing).
        Box(Modifier.weight(1f).then(if (barShowing) Modifier.consumeWindowInsets(WindowInsets.navigationBars.only(WindowInsetsSides.Bottom)) else Modifier)) { content() }
        AnimatedVisibility(
            visible = barShowing,
            enter = slideInVertically(tween(220, easing = FastOutSlowInEasing)) { it } + fadeIn(tween(160)),
            exit = slideOutVertically(tween(180)) { it } + fadeOut(tween(120)),
        ) {
            LabTabBar(tabs, active, onSelect, badges = badges)
        }
    }
}

private fun AnimatedContentTransitionScope<NavBackStackEntry>.isTabSwitch(tabRoots: Set<String>): Boolean =
    initialState.destination.route in tabRoots && targetState.destination.route in tabRoots

private fun AnimatedContentTransitionScope<NavBackStackEntry>.pushEnter(): EnterTransition =
    if (NavRules.isImmersiveRoute(LabNav.pathOf(targetState))) {
        slideInVertically(tween(260, easing = FastOutSlowInEasing)) { it / 8 } + fadeIn(tween(200))
    } else {
        slideInHorizontally(tween(240, easing = FastOutSlowInEasing)) { it / 6 } + fadeIn(tween(200))
    }

private fun AnimatedContentTransitionScope<NavBackStackEntry>.popExit(): ExitTransition =
    if (NavRules.isImmersiveRoute(LabNav.pathOf(initialState))) {
        slideOutVertically(tween(220)) { it / 8 } + fadeOut(tween(160))
    } else {
        slideOutHorizontally(tween(220)) { it / 6 } + fadeOut(tween(160))
    }
