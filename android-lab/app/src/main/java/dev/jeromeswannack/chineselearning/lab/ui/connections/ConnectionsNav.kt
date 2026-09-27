package dev.jeromeswannack.chineselearning.lab.ui.connections

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.PlaceholderScreen

/**
 * `/connections` — the Tutor tab for a student, the Students tab for a tutor (web:
 * ConnectionsPage renders StudentsDashboard once the account has an active student).
 * Package E owns this file and the student-side routes; package F adds the dashboard as
 * `ui/teaching/StudentsDashboardScreen.kt` and switches to it here on `role.hasStudents`,
 * and registers its own `/connections/{relId}/…` tutor routes in `ui/teaching/TeachingNav.kt`.
 */
fun NavGraphBuilder.connectionsGraph(nav: LabNav) {
    composable(Routes.route(Routes.CONNECTIONS)) {
        val shell by nav.shell.collectAsStateWithLifecycle()
        if (shell?.role?.hasStudents == true) dev.jeromeswannack.chineselearning.lab.ui.teaching.StudentsDashboardRoute(nav) // F
        else PlaceholderScreen(Routes.CONNECTIONS, onBack = null) { nav.openInMainApp(Routes.CONNECTIONS) }
    }
}
