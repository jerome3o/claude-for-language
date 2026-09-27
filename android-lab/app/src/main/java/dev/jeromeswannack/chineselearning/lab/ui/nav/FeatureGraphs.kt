package dev.jeromeswannack.chineselearning.lab.ui.nav

import androidx.navigation.NavGraphBuilder
import dev.jeromeswannack.chineselearning.lab.ui.catalogue.catalogueGraph
import dev.jeromeswannack.chineselearning.lab.ui.cards.cardsGraph
import dev.jeromeswannack.chineselearning.lab.ui.connections.connectionsGraph
import dev.jeromeswannack.chineselearning.lab.ui.decks.decksGraph
import dev.jeromeswannack.chineselearning.lab.ui.editor.editorGraph
import dev.jeromeswannack.chineselearning.lab.ui.home.homeGraph
import dev.jeromeswannack.chineselearning.lab.ui.lessons.lessonsGraph
import dev.jeromeswannack.chineselearning.lab.ui.library.libraryGraph
import dev.jeromeswannack.chineselearning.lab.ui.more.moreGraph
import dev.jeromeswannack.chineselearning.lab.ui.placeholder.placeholderGraph
import dev.jeromeswannack.chineselearning.lab.ui.progress.progressGraph
import dev.jeromeswannack.chineselearning.lab.ui.settings.settingsGraph
import dev.jeromeswannack.chineselearning.lab.ui.study.studyGraph
import dev.jeromeswannack.chineselearning.lab.ui.teaching.teachingGraph
import dev.jeromeswannack.chineselearning.lab.ui.strokes.strokesGraph
import dev.jeromeswannack.chineselearning.lab.ui.quests.questsGraph
import dev.jeromeswannack.chineselearning.lab.ui.coach.coachGraph
import dev.jeromeswannack.chineselearning.lab.ui.analyze.analyzeGraph

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
    editorGraph(nav)        // editors, Try it, catalogue trials, print views  G
    catalogueGraph(nav)     // "/library/catalogue" G (above /library/{id})
    libraryGraph(nav)       // "/library"     G
    moreGraph(nav)          // "/more"        shell
    settingsGraph(nav)      // "/settings"   D
    teachingGraph(nav)      // "/connections/{relId}/…" F (tutor side)
    cardsGraph(nav)         // "/cards/:noteId" C (card hub)
    strokesGraph(nav)       // "/practice/strokes" H
    lessonsGraph(nav)       // "/lessons", "/lesson-attempts"  B
    questsGraph(nav)        // "/quests"     H
    coachGraph(nav)         // "/coach"      H
    analyzeGraph(nav)       // "/analyze"    H
    // Add yours above this line, one line each.
    placeholderGraph(nav)   // everything else → main app (keep last)
}
