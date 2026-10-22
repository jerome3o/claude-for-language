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
import dev.jeromeswannack.chineselearning.lab.ui.study.PassCardUi
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyRoute
import dev.jeromeswannack.chineselearning.lab.core.LongTerm

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
        val lessonEnv = rememberExerciseEnv(nav.app)
        val readerEnv = rememberReaderEnv(nav.app, (ui as? PassUi.Player)?.reader?.reader?.id.orEmpty())
        val context = androidx.compose.ui.platform.LocalContext.current
        HomeworkPassContent(
            app = nav.app,
            vm = vm,
            actions = PassActions(
                onClose = nav::back,
                onAddToDaily = vm::addToDaily,
                onRetrySync = vm::retrySync,
                onAllHomework = { nav.open(Routes.homework()) },
                onLessonComplete = vm::completeLesson,
                onReaderFinished = vm::finishReader,
                onOpenLink = { url -> vm.linkOpened(); openExternal(context, url) },
                onLinkDone = vm::markLinkDone,
                onLessonAgain = { nav.open(Routes.lessonPlay(it, "homework")) },
                onUndo = vm::undo,
            ),
            onOpen = { path -> nav.open(path) },
            lessonEnv = lessonEnv,
            readerEnv = readerEnv,
        )
    }
}

/**
 * `/homework/:id`: a word of a list is shown on the STUDY CARD, as in Study (StudyRoute's pass
 * mode — the read card's 🎤 take, "You said", Show answer, the back), with Not yet / Got it where
 * the ratings are and nothing reviewed; everything else (the finish, a word not here yet, a lesson,
 * a reader, a link) is [HomeworkPassScreen].
 */
@androidx.compose.runtime.Composable
fun HomeworkPassContent(
    app: dev.jeromeswannack.chineselearning.lab.LabApp,
    vm: HomeworkPassViewModel,
    actions: PassActions,
    onOpen: (String) -> Unit = {},
    lessonEnv: dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv = dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv(),
    readerEnv: dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderEnv = dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderEnv(),
) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val deck = ui as? PassUi.Deck
    val word = deck?.note
    if (deck != null && word != null && !deck.progress.complete) {
        StudyRoute(
            app = app,
            deckId = null,
            onExit = actions.onClose,
            onOpen = onOpen,
            pass = passCardUi(deck, word),
            passActions = StudyActions(
                onPassAnswer = vm::answer,
                onPassLongTerm = vm::setLongTerm,
                onPassBump = vm::setBump,
                onPassUndo = vm::undo,
            ),
        )
    } else {
        HomeworkPassScreen(ui, actions, lessonEnv = lessonEnv, readerEnv = readerEnv)
    }
}

/** What the study card shows around a pass word (StudyRoute's pass mode; web: DeckPass's `pass` prop). */
fun passCardUi(deck: PassUi.Deck, word: PassNote): PassCardUi = PassCardUi(
    assignmentId = deck.assignmentId,
    noteId = word.id,
    attempt = deck.attempt,
    title = deck.title,
    part = deck.part,
    due = deck.due,
    done = deck.progress.done,
    total = deck.progress.total,
    retrying = deck.progress.retrying,
    bar = deck.bar,
    longTermOn = LongTerm.isLongTerm(word.longTerm, deck.deckInReview, word.started),
    started = word.started,
    bumped = deck.bumped,
    bumpedBy = deck.bumpedBy,
    busy = deck.busy,
    canUndo = deck.canUndo,
)

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
        cachedTranslation = { r -> tools.cachedClueTranslation(r.hanzi) },
        translate = { r -> tools.clueTranslation(r.hanzi, r.pinyin) },
        decks = { withContext(Dispatchers.IO) { dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { it.id to it.name } } },
        deckHas = tools::deckHas,
        addCard = { deckId, c -> tools.addNote(deckId, NewNoteBody(c.hanzi, c.pinyin, c.english)) },
    )
}
