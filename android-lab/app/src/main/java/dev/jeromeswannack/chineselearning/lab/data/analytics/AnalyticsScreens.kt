package dev.jeromeswannack.chineselearning.lab.data.analytics

import androidx.navigation.NavBackStackEntry
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/** The web-shaped route pattern of a back-stack entry, for `app.screen_view` (screenName() makes it `/decks/:id`). */
object AnalyticsScreens {
    /** Port target: the web's screenName(location.pathname) — same names on both apps. */
    fun routeOf(pattern: String?, placeholderPath: String?): String = when (pattern) {
        null, Routes.HOME_ROUTE -> "/"
        // A screen that isn't native yet stands in for the web path it shows.
        Routes.PLACEHOLDER_ROUTE -> placeholderPath ?: "/"
        else -> "/" + pattern
    }

    fun routeOf(entry: NavBackStackEntry): String =
        routeOf(entry.destination.route, entry.arguments?.getString("path"))
}
