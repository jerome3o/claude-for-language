package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.PlaceholderScreen

/** `/library` — the tutor's Lesson Library tab (package G; web: pages/editor/LessonLibraryPage.tsx). Placeholder until G lands. */
fun NavGraphBuilder.libraryGraph(nav: LabNav) {
    composable(Routes.route(Routes.LIBRARY)) {
        PlaceholderScreen(Routes.LIBRARY, onBack = null) { nav.openInMainApp(Routes.LIBRARY) }
    }
}
