package dev.jeromeswannack.chineselearning.lab.ui.placeholder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.nav.WebDestinations
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * The generic "not native yet" destination: `nav.open(path)` lands here for any web path
 * no feature has registered. Keep it LAST in FeatureGraphs.
 */
fun NavGraphBuilder.placeholderGraph(nav: LabNav) {
    composable(Routes.PLACEHOLDER_ROUTE, arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = "/" })) { entry ->
        val path = entry.arguments?.getString("path") ?: "/"
        PlaceholderScreen(path, onBack = nav::back, onOpenInMainApp = { nav.openInMainApp(path) })
    }
}

/**
 * A screen the Lab app doesn't have yet: says what it is and opens the main app at the same
 * route — never a dead end. Tab roots pass `onBack = null`. Feature packages use it as the
 * body of their route until the native screen lands:
 *
 *   composable(Routes.route("/progress")) { PlaceholderScreen("/progress", null) { nav.openInMainApp("/progress") } }
 */
@Composable
fun PlaceholderScreen(path: String, onBack: (() -> Unit)?, onOpenInMainApp: () -> Unit) {
    val dest = WebDestinations.find(path)
    LabScreen(title = dest?.title ?: "Main app", onBack = onBack) {
        item {
            Column(
                Modifier.fillMaxWidth().padding(top = 48.dp, start = 12.dp, end = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(dest?.emoji ?: "🧭", fontSize = 56.sp)
                Text("Not in the Lab app yet", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, textAlign = TextAlign.Center)
                Text(
                    dest?.blurb ?: "This screen lives in the main app for now.",
                    style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted, textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(12.dp))
                PrimaryPill("Open in the main app", Modifier.fillMaxWidth().widthIn(max = 360.dp).height(56.dp), onClick = onOpenInMainApp)
                Text(
                    "It opens at the same screen. What you do there syncs back here.",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center,
                )
            }
        }
    }
}
