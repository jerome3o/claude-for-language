package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import dev.jeromeswannack.chineselearning.lab.ui.lessons.rememberExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.readers.rememberReaderEnv

/** `/homework` (the list) and `/homework/:id` (the one-off pass, immersive). Package E. */
fun NavGraphBuilder.homeworkGraph(nav: LabNav) {
    composable(Routes.route(Routes.homework())) {
        val vm: HomeworkListViewModel = viewModel(factory = HomeworkListViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        HomeworkListScreen(ui, onBack = nav::back, onOpen = { nav.open(Routes.homeworkPass(it)) })
    }
    composable(Routes.route("/homework/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val vm: HomeworkPassViewModel = viewModel(factory = HomeworkPassViewModel.Factory(nav.app, id))
        val ui by vm.ui.collectAsStateWithLifecycle()
        val playing by nav.app.audio.playingKey.collectAsStateWithLifecycle()
        val sentences = remember { passSentenceActions(nav.app) }
        val lessonEnv = rememberExerciseEnv(nav.app)
        val readerEnv = rememberReaderEnv(nav.app, (ui as? PassUi.Player)?.reader?.reader?.id.orEmpty())
        val context = androidx.compose.ui.platform.LocalContext.current
        HomeworkPassScreen(
            ui,
            PassActions(
                onClose = nav::back,
                onReveal = vm::reveal,
                onAnswer = vm::answer,
                onPlay = vm::play,
                onAddToDaily = vm::addToDaily,
                onLongTerm = vm::setLongTerm,
                onRetrySync = vm::retrySync,
                onAllHomework = { nav.open(Routes.homework()) },
                onLessonComplete = vm::completeLesson,
                onReaderFinished = vm::finishReader,
                sentences = sentences,
                onPlaySentence = vm::playSentence,
                onOpenLink = { url -> vm.linkOpened(); openExternal(context, url) },
                onLinkDone = vm::markLinkDone,
            ),
            lessonEnv = lessonEnv,
            readerEnv = readerEnv,
            playingKey = playing,
        )
    }
}

/**
 * The pass's example sentences use the study card's tools (CardTools): the breakdown from the
 * offline cache first (`study/explain/<id>`, `study/explain-text/<hanzi>` — the same keys the
 * study card and the Coach fill), else the explain endpoints; "+ Add as card" through the
 * content service. None of it writes a review event or a homework event.
 */
fun passSentenceActions(app: dev.jeromeswannack.chineselearning.lab.LabApp): SentenceActions {
    val tools = CardTools(app)
    return SentenceActions(
        cachedExplanation = { r -> tools.cachedExplanation(r.sentenceId, r.hanzi) },
        explain = { r -> tools.explain(r.sentenceId, r.hanzi, r.pinyin, r.translation) },
        decks = { withContext(Dispatchers.IO) { dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { it.id to it.name } } },
        deckHas = tools::deckHas,
        addCard = { deckId, c -> tools.addNote(deckId, NewNoteBody(c.hanzi, c.pinyin, c.english)) },
    )
}
