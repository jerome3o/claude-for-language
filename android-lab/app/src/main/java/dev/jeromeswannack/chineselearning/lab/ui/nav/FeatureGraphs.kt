package dev.jeromeswannack.chineselearning.lab.ui.nav

import androidx.navigation.NavGraphBuilder
import dev.jeromeswannack.chineselearning.lab.ui.connections.connectionsGraph
import dev.jeromeswannack.chineselearning.lab.ui.decks.decksGraph
import dev.jeromeswannack.chineselearning.lab.ui.home.homeGraph
import dev.jeromeswannack.chineselearning.lab.ui.homework.homeworkGraph
import dev.jeromeswannack.chineselearning.lab.ui.library.libraryGraph
import dev.jeromeswannack.chineselearning.lab.ui.more.moreGraph
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.placeholderGraph
import dev.jeromeswannack.chineselearning.lab.ui.progress.progressGraph
import dev.jeromeswannack.chineselearning.lab.ui.study.studyGraph
import dev.jeromeswannack.chineselearning.lab.ui.strokes.strokesGraph

/**
 * THE registry of screens — one line per feature, nothing else. Each feature registers its
 * routes in its own `ui/<feature>/<Feature>Nav.kt` (`fun NavGraphBuilder.<feature>Graph(nav: LabNav)`),
 * using web-shaped patterns (`Routes.route("/decks/{id}")`). A path no graph registers opens
 * the placeholder, so adding a line here is all it takes to go native.
 */
fun NavGraphBuilder.featureGraphs(nav: LabNav) {
    homeGraph(nav)          // "/"            A study home · F tutor home
    studyGraph(nav)         // "/study"       A
    decksGraph(nav)         // "/decks"       C
    progressGraph(nav)      // "/progress"    D
    connectionsGraph(nav)   // "/connections" E (+ F dashboard)
    libraryGraph(nav)       // "/library"     G
    moreGraph(nav)          // "/more"        shell
    homeworkGraph(nav)      // "/homework"    E
    strokesGraph(nav)       // "/practice/strokes" H
    // Add yours above this line, one line each.
    placeholderGraph(nav)   // everything else → main app (keep last)
}
