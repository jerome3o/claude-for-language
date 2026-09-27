package dev.jeromeswannack.chineselearning.lab.ui.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.collectAsState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.ui.homework.HomeHomeworkSlot
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.OnboardingGate
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `/` — the study home, or the teaching home for a tutor account (web: HomePage → TutorHome). Package A (study) / F (tutor home). */
fun NavGraphBuilder.homeGraph(nav: LabNav) {
    composable(Routes.route(Routes.HOME)) {
        val app = nav.app
        if (app.prefs.accountRole == "tutor") {
            val relationships by app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collectAsStateWithLifecycle(null)
            val decks by produceState(emptyList<Pair<String, String>>(), app.repo.dataVersion.collectAsState().value) {
                value = withContext(Dispatchers.IO) {
                    app.repo.dao.decks().sortedWith(compareByDescending<dev.jeromeswannack.chineselearning.lab.data.DeckEntity> { it.studyPriority }.thenByDescending { it.createdAt }).map { it.id to it.name }
                }
            }
            TutorHomeScreen(
                TutorHomeUi(
                    firstName = app.prefs.userName?.substringBefore(' '),
                    studentCount = relationships?.students?.count { it.status == "active" },
                    decks = decks,
                ),
                onOpen = nav::open,
            )
        } else {
            val vm: HomeViewModel = viewModel(factory = HomeViewModel.Factory(app))
            val ui by vm.ui.collectAsStateWithLifecycle()
            val sync by app.repo.status.collectAsStateWithLifecycle()
            val online by app.online.collectAsStateWithLifecycle()
            // Package E: an invited student's first open, then the homework cards under Study.
            OnboardingGate(nav, totalDue = ui.due.total) { HomeScreen(
                ui = ui,
                sync = sync,
                online = online,
                homework = { HomeHomeworkSlot(nav) },
                actions = HomeActions(
                    onStudyAll = { nav.open(Routes.study()) },
                    onStudyDeck = { nav.open(Routes.study(it)) },
                    onSync = { app.scope.launch { app.repo.sync() } },
                    onSignIn = nav.onSignIn,
                    onAllDecks = { nav.openTabPath(Routes.DECKS) },
                ),
            ) }
        }
    }
}
