package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.launch

/** `/study?deck=` — the session (immersive: no tab bar). Package A. */
fun NavGraphBuilder.studyGraph(nav: LabNav) {
    composable(
        Routes.route("/study?deck={deck}"),
        arguments = listOf(navArgument("deck") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        StudyRoute(
            app = nav.app,
            deckId = entry.arguments?.getString("deck"),
            onExit = {
                nav.back()
                nav.app.scope.launch { nav.app.repo.sync() }
            },
            onOpen = { path -> nav.open(path) },
            onHandoff = { path -> nav.openOrHandoff(path) },
        )
    }
}
