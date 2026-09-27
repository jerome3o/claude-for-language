package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.data.api.CardReviewsDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudySessionDto
import dev.jeromeswannack.chineselearning.lab.data.api.myCardReviews
import dev.jeromeswannack.chineselearning.lab.data.api.studySession
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * Package D — the Progress tab and its drill-downs (web: MyProgressPage, MyDayDetailPage,
 * MyCardReviewDetailPage, SessionReviewPage). Numbers come from the phone (works offline).
 */
fun NavGraphBuilder.progressGraph(nav: LabNav) {
    composable(Routes.route(Routes.PROGRESS)) {
        val app = nav.app
        val vm: ProgressViewModel = viewModel(factory = ProgressViewModel.Factory(app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        ProgressScreen(
            ui,
            ProgressActions(
                openDay = { nav.open(Routes.progressDay(it)) },
                openDeck = { nav.open(Routes.deck(it)) },
                study = { nav.open(Routes.study()) },
                onPick = { app.haptics.tick() },
            ),
        )
    }

    composable(Routes.route("/progress/day/{date}")) { entry ->
        val date = entry.arguments?.getString("date").orEmpty()
        val vm: ProgressDayViewModel = viewModel(factory = ProgressDayViewModel.Factory(nav.app, date, null))
        val day by vm.day.collectAsStateWithLifecycle()
        DayScreen(date, day, onBack = nav::back, openCard = { nav.open(Routes.progressCard(date, it)) })
    }

    composable(Routes.route("/progress/day/{date}/card/{cardId}")) { entry ->
        val app = nav.app
        val date = entry.arguments?.getString("date").orEmpty()
        val cardId = entry.arguments?.getString("cardId").orEmpty()
        val vm: ProgressDayViewModel = viewModel(factory = ProgressDayViewModel.Factory(app, date, cardId))
        val state by vm.card.collectAsStateWithLifecycle()
        // The phone keeps no recording URLs; ask the server (cached for the next time offline).
        val scope = rememberCoroutineScope()
        val server = remember(date, cardId) {
            app.cachedResource<CardReviewsDto>(scope, "progress/card/$date/$cardId", "progress") { myCardReviews(date, cardId) }
        }
        val remote by server.state.collectAsStateWithLifecycle()
        val playing by app.audio.playingKey.collectAsStateWithLifecycle()
        val online by app.online.collectAsStateWithLifecycle()
        val recordings = remote.data?.reviews.orEmpty().mapNotNull { r -> r.recording_url?.takeIf { it.isNotBlank() }?.let { r.id to it } }.toMap()
        CardDayScreen(
            date, state, recordings, playing,
            CardDayActions(
                onBack = nav::back,
                playWord = {
                    val d = (state as? CardDayState.Loaded)?.day ?: return@CardDayActions
                    if (playing != null) app.audio.stop() else app.audio.play(d.audioUrl, d.card.hanzi, online)
                },
                playRecording = { url -> if (playing == url) app.audio.stop() else app.audio.play(url, "", online) },
            ),
        )
    }

    composable(Routes.route("/study/review/{id}")) { entry ->
        val app = nav.app
        val id = entry.arguments?.getString("id").orEmpty()
        val scope = rememberCoroutineScope()
        val res = remember(id) { app.cachedResource<StudySessionDto>(scope, "progress/session/$id", "progress") { studySession(id) } }
        val state by res.state.collectAsStateWithLifecycle()
        val online by app.online.collectAsStateWithLifecycle()
        SessionReviewScreen(
            state,
            SessionReviewActions(
                onBack = nav::back,
                onRetry = { res.refresh() },
                playWord = { key, hanzi -> app.audio.play(key, hanzi, online) },
                playRecording = { url -> app.audio.play(url, "", online) },
            ),
        )
    }
}
