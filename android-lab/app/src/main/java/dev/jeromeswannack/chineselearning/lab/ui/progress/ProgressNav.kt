package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.PlaceholderScreen

/** The Progress tab (package D; web: pages/MyProgressPage.tsx). Placeholder until D lands. */
fun NavGraphBuilder.progressGraph(nav: LabNav) {
    composable(Routes.route(Routes.PROGRESS)) {
        PlaceholderScreen(Routes.PROGRESS, onBack = null) { nav.openInMainApp(Routes.PROGRESS) }
    }
}
