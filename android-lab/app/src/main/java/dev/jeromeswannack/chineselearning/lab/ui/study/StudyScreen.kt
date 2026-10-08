package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.ui.kit.studyCardTransition
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.fx.SparkBurst
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody

/** Everything the session screen can ask for. Defaults are no-ops so screenshots need none. */
class StudyActions(
    val onClose: () -> Unit = {},
    val onUndo: () -> Unit = {},
    val onReveal: (AnswerKey.Verdict?) -> Unit = {},
    /** A revealed card turned to its other face (peek at the question / back to the answer): haptic only. */
    val onPeek: () -> Unit = {},
    val onRate: (rating: Int, timeSpentMs: Long, userAnswer: String?) -> Unit = { _, _, _ -> },
    val onPlay: (key: String?, text: String) -> Unit = { _, _ -> },
    /** The word itself: its recordings in turn ([advance] = next voice), else its own clip. */
    val onPlayWord: (advance: Boolean) -> Unit = {},
    /** "Couldn't make audio — retry" (auto-audio). */
    val onRetryAudio: () -> Unit = {},
    val onStudyMore: () -> Unit = {},
    val onToggleOffline: () -> Unit = {},
    val onDismissExplainer: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
    // ⋯ menu
    val onGenerateFunFact: () -> Unit = {},
    val onRegenerateAudio: () -> Unit = {},
    val onNewVoice: () -> Unit = {},
    val onRoleplay: () -> Unit = {},
    val onPlayMyRecording: () -> Unit = {},
    // my pronunciation (read cards)
    val onStartRecording: (skipDelay: Boolean) -> Unit = {},
    val onStopRecording: (flipped: Boolean) -> Unit = {},
    val onClearRecording: () -> Unit = {},
    /** Cancel a "Record again" (back gesture / Cancel): the new take is dropped, the previous one kept. */
    val onCancelRecording: () -> Unit = {},
    /** "Couldn't transcribe — tap to retry" (the same saved take). */
    val onRetryTranscription: () -> Unit = {},
    val recordingLevel: kotlinx.coroutines.flow.StateFlow<Float> = kotlinx.coroutines.flow.MutableStateFlow(0f),
    /** "Use in sentence" when the note has none yet, and ↻ on the shown one. */
    val onGenerateSentenceClue: () -> Unit = {},
    // multiple choice
    val onShowMc: () -> Unit = {},
    val onRegenerateMc: () -> Unit = {},
    val onRevealMc: () -> Unit = {},
    val onTypeInstead: () -> Unit = {},
    /** A light tick (choosing an option). */
    val onTick: () -> Unit = {},
    /** The card's state changed (revealed, typed answer, grid result): kept so leaving Study never loses it. */
    val onCardProgress: (presentation: Int, revealed: Boolean, answer: String, mcSlots: List<MultipleChoice.Slot>?) -> Unit = { _, _, _, _ -> },
    /** ⋯ → Sentence coach, prefilled with [text]; back returns to this card as it is. */
    val onOpenCoach: (text: String) -> Unit = {},
    val sendFlag: suspend (FlagTutor, String) -> Boolean = { _, _ -> false },
    val edit: EditCardActions = EditCardActions(),
    val ask: AskActions = AskActions(),
    val sentences: SentenceActions = SentenceActions(),
    // tap a character on the back → the character sheet (ui/chars)
    val chars: dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetActions = dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetActions(),
    // ---- Package B: mini lessons in the session ----
    val lessonEnv: dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv = dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv(),
    val onLessonComplete: (dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult) -> Unit = {},
    val readerEnv: @Composable (readerId: String) -> dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderEnv = { dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderEnv() },
    /** Today's reader was finished (Finish, or listened to the end — `how` = finish | listened). */
    val onReaderFinished: (timeSpentMs: Long, how: String) -> Unit = { _, _ -> },
    /** Lab "today split": Continue on the "Flashcards done" pause. (Later = [onClose].) */
    val onContinueExtras: () -> Unit = {},
)

@Composable
fun StudyRoute(app: LabApp, deckId: String?, onExit: () -> Unit, onOpen: (String) -> Unit, practice: PracticeSpec? = null) {
    // Today is the session (docs/STUDY_SESSION.md): the view model belongs to the activity, not to
    // this screen, so leaving Study — ✕, back, the coach, Home — ends nothing. The card on screen
    // (revealed, typed answer, recording), the undo and the queue are all still here on return.
    // (The tutor-notes practice is a focused mini session of its own: scoped to its screen.)
    val vmKey = if (practice != null) "practice-${practice.cardIds.joinToString(",")}" else "study-${deckId ?: "all"}"
    val owner = if (practice == null) androidx.compose.ui.platform.LocalContext.current.findViewModelStoreOwner() else null
    val vm: StudyViewModel = if (owner != null) viewModel(viewModelStoreOwner = owner, key = vmKey, factory = StudyViewModel.Factory(app, deckId, practice))
        else viewModel(key = vmKey, factory = StudyViewModel.Factory(app, deckId, practice))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val playing by app.audio.playingKey.collectAsState()
    val sync by app.repo.status.collectAsState()
    // Active study time: in front + being used; paused in the background / screen off, and when leaving.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    androidx.compose.runtime.DisposableEffect(lifecycle, vm) {
        vm.onReturn()
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            when (event) {
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> vm.onForeground()
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> vm.onBackground()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            vm.onLeave()
        }
    }
    // ✕ / back just leave: nothing to confirm, nothing ends.
    BackHandler(onBack = onExit)
    val tools = vm.tools
    val currentNote = { (vm.ui.value.phase as? StudyPhase.Showing)?.view?.note }
    StudyScreen(
        ui = ui,
        playingKey = playing,
        pendingReviews = sync.unsynced,
        modifier = Modifier.pointerInput(Unit) {
            // Every touch on the study screen is activity (observed, never consumed).
            awaitPointerEventScope {
                while (true) {
                    val e = awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                    if (e.type == androidx.compose.ui.input.pointer.PointerEventType.Press) vm.onInteraction()
                }
            }
        },
        actions = StudyActions(
            onClose = onExit,
            onUndo = vm::undoLast,
            onReveal = vm::onRevealed,
            onPeek = { app.haptics.flip() },
            onRate = vm::rate,
            onPlay = vm::play,
            onPlayWord = vm::playWord,
            onRetryAudio = vm::retryAudio,
            onStudyMore = vm::studyMore,
            onToggleOffline = vm::toggleForcedOffline,
            onDismissExplainer = vm::dismissExplainer,
            onDismissNotice = vm::dismissNotice,
            onGenerateFunFact = vm::generateFunFact,
            onRegenerateAudio = vm::regenerateAudio,
            onNewVoice = vm::newVoice,
            onRoleplay = { vm.roleplay(onOpen) },
            onGenerateSentenceClue = { vm.generateSentenceClue() },
            onShowMc = vm::showMc,
            onRegenerateMc = vm::regenerateMc,
            onRevealMc = vm::revealMc,
            onTypeInstead = vm::typeInstead,
            onTick = { app.haptics.tick() },
            onCardProgress = vm::onCardProgress,
            onOpenCoach = { text -> app.analytics.track("study.sentence_coach"); onOpen(dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.coach(draft = text, focus = true)) },
            onPlayMyRecording = vm::playMyRecording,
            onStartRecording = vm::startRecording,
            onStopRecording = vm::stopRecording,
            onClearRecording = vm::clearRecording,
            onCancelRecording = vm::cancelRecording,
            onRetryTranscription = vm::retryTranscription,
            recordingLevel = vm.level,
            sendFlag = vm::flag,
            edit = EditCardActions(
                save = vm::saveEdit,
                delete = { vm.deleteCurrentNote() },
                generateClue = { currentNote()?.let { n -> tools.generateSentenceClue(n.id) } },
                recordings = { currentNote()?.let { n -> tools.recordings(n.id) }.orEmpty() },
                setPrimary = { id -> currentNote()?.let { n -> tools.setPrimaryRecording(n.id, id) } },
                deleteRecording = { id -> currentNote()?.let { n -> tools.deleteRecording(n.id, id) } },
                play = vm::play,
                media = { noteId, fields -> dev.jeromeswannack.chineselearning.lab.ui.cards.NoteMediaSections(app, noteId, fields) },
            ),
            ask = AskActions(
                ask = vm::ask,
                approve = vm::approveTools,
                reject = vm::rejectTools,
                setLanguage = { l -> vm.setAskLanguage(l, "sheet") },
                translate = vm::translateAsk,
                readAloud = vm::readAloudAsk,
                setListening = { on -> vm.setAskListening(on, "sheet") },
                listen = vm::listenAsk,
                reveal = vm::revealAsk,
                toggleSlow = vm::toggleAskListenSlow,
                audioBusy = vm::askAudioBusy,
                stopListening = vm::stopAskListening,
                onOpen = vm::refreshAskPrefs,
                openPath = onOpen,
                known = vm::knownHanzi,
                track = vm::trackAskTool,
            ),
            sentences = SentenceActions(
                generate = vm::generateSentences,
                clear = vm::clearSentences,
                ensureAudio = vm::ensureSentenceAudio,
                cachedExplanation = { r -> tools.cachedExplanation(r.sentenceId, r.hanzi) },
                explain = { r -> tools.explain(r.sentenceId, r.hanzi, r.pinyin, r.translation) },
                cachedTranslation = { r -> tools.cachedClueTranslation(r.hanzi) },
                translate = { r -> tools.clueTranslation(r.hanzi, r.pinyin) },
                decks = vm::deckChoices,
                deckHas = tools::deckHas,
                addCard = { deckId, c -> tools.addNote(deckId, NewNoteBody(c.hanzi, c.pinyin, c.english)) },
            ),
            chars = dev.jeromeswannack.chineselearning.lab.ui.chars.rememberCharSheetActions(app, onOpenCard = { id -> onOpen(dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.cardHub(id)) }),
            lessonEnv = dev.jeromeswannack.chineselearning.lab.ui.lessons.rememberExerciseEnv(app), // Package B
            onLessonComplete = vm::completeLesson, // Package B
            readerEnv = { id -> dev.jeromeswannack.chineselearning.lab.ui.readers.rememberReaderEnv(app, id) }, // Package B
            onReaderFinished = vm::finishReader, // Package B
            onContinueExtras = vm::continueToExtras, // Lab today split
        ),
    )
}

/** The activity behind [this] context (Compose may hand out a ContextWrapper), which owns the study view model. */
private fun android.content.Context.findViewModelStoreOwner(): androidx.lifecycle.ViewModelStoreOwner? {
    var c: android.content.Context? = this
    while (c != null) {
        if (c is androidx.lifecycle.ViewModelStoreOwner) return c
        c = (c as? android.content.ContextWrapper)?.baseContext
    }
    return null
}

@Composable
fun StudyScreen(ui: StudyUi, playingKey: String?, actions: StudyActions, cardStart: CardStartState? = null, autoplay: Boolean = true, pendingReviews: Int = 0, initialCountsCopy: CountsCopy? = null, modifier: Modifier = Modifier) {
    var countsCopy by remember { mutableStateOf(initialCountsCopy) }
    var copyTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(copyTick) { if (copyTick > 0) { kotlinx.coroutines.delay(2500); countsCopy = null } }
    val context = androidx.compose.ui.platform.LocalContext.current
    Box(modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize()) {
            StudyTopBar(ui, actions, pendingReviews, onCountsCopied = { countsCopy = it; copyTick++ })
            ui.practice?.let { p -> if (ui.phase is StudyPhase.Showing) PracticeBanner(p.counts) }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                AnimatedContent(
                    targetState = ui.phase,
                    contentKey = { p -> when (p) { is StudyPhase.Showing -> p.view.presentation; is StudyPhase.Lesson -> "lesson-${p.lesson.key}"; is StudyPhase.Reader -> "reader-${p.reader.key}"; is StudyPhase.Extras -> "extras"; StudyPhase.Done -> "done"; StudyPhase.Loading -> "loading" } },
                    transitionSpec = { cardTransition(ui.lastRating) },
                    label = "card",
                ) { phase ->
                    when (phase) {
                        StudyPhase.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Lab.colors.accent) }
                        is StudyPhase.Showing -> CardStage(phase.view, ui, playingKey, actions, cardStart ?: phase.view.start, autoplay)
                        is StudyPhase.Lesson -> dev.jeromeswannack.chineselearning.lab.ui.lessons.SessionLessonView(phase.lesson, ui.counts, actions.lessonEnv, actions.onLessonComplete) // Package B
                        is StudyPhase.Reader -> dev.jeromeswannack.chineselearning.lab.ui.readers.StudyReaderView(phase.reader, actions.readerEnv(phase.reader.reader.id), actions.onReaderFinished) // Package B
                        is StudyPhase.Extras -> ExtrasBreakView(phase, ui, actions) // Lab today split
                        StudyPhase.Done -> DoneView(ui, actions)
                    }
                }
            }
        }
        AnimatedVisibility(countsCopy != null, Modifier.align(Alignment.TopCenter).padding(top = 58.dp), enter = fadeIn() + scaleIn(initialScale = 0.9f), exit = fadeOut()) {
            countsCopy?.let { CountsCopiedChip(it, onShare = { QueueCountsShare.share(context, ui.counts); countsCopy = null }) }
        }
        AnimatedVisibility(ui.showExplainer && ui.phase is StudyPhase.Showing, enter = fadeIn(), exit = fadeOut()) {
            FirstCardExplainer(actions.onDismissExplainer)
        }
    }
}

/** Good/Easy fling the card away to the right, Again drops it, Hard slides it left; the next one rises in (shared with the homework pass). */
private fun cardTransition(lastRating: Int?): ContentTransform = studyCardTransition(lastRating)

@Composable
private fun StudyTopBar(ui: StudyUi, actions: StudyActions, pendingReviews: Int, onCountsCopied: (CountsCopy) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = actions.onClose) { Icon(Icons.Filled.Close, "Leave study (you can come back to this card)", tint = Lab.colors.muted) }
            QueueCountsBar(ui.counts, ui.activeBucket, Modifier.weight(1f), onCountsCopied)
            // Lab today split: what's waiting after the cards ("📘2 📖1").
            if (ui.todayLeft.any && (ui.phase is StudyPhase.Showing || ui.phase is StudyPhase.Loading)) TodayLeftChip(ui.todayLeft)
            OfflinePill(ui.online, ui.forcedOffline, pendingReviews, actions.onToggleOffline)
            IconButton(onClick = actions.onUndo, enabled = ui.canUndo) {
                Icon(Icons.AutoMirrored.Filled.Undo, "Undo last review", tint = if (ui.canUndo) Lab.colors.ink else Lab.colors.muted.copy(alpha = 0.3f))
            }
        }
        val progress by animateFloatAsState(ui.progress, spring(dampingRatio = 0.9f, stiffness = 120f), label = "progress")
        Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).height(6.dp).clip(CircleShape).background(Lab.colors.faint)) {
            Box(
                Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).clip(CircleShape)
                    .background(Brush.horizontalGradient(listOf(Lab.colors.accent, Palette.Gold))),
            )
        }
    }
}

/** The quiet line under the top bar in the tutor-notes practice: does this rating count? */
@Composable
private fun PracticeBanner(counts: Boolean) {
    Text(
        dev.jeromeswannack.chineselearning.lab.core.TutorNotesRules.practiceHint(counts),
        style = MaterialTheme.typography.labelMedium,
        color = if (counts) Palette.Good else Lab.colors.muted,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp).clip(CircleShape)
            .background(if (counts) Palette.Good.copy(alpha = 0.12f) else Lab.colors.faint.copy(alpha = 0.6f))
            .padding(horizontal = 12.dp, vertical = 5.dp)
            .then(Modifier),
    )
}

@Composable
private fun DoneView(ui: StudyUi, actions: StudyActions) {
    val today = ui.today
    val stats = ui.stats
    val practice = ui.practice
    // 🎉 + confetti only for the finish being celebrated now; quiet when today's finish was
    // already celebrated (back to Study later with nothing due). The practice keeps its own finish.
    val quiet = practice == null && today?.celebrate != true && today?.allClear != true
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(24.dp))
            var shown by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { shown = true }
            val scale by animateFloatAsState(if (shown) 1f else 0.3f, spring(dampingRatio = 0.45f, stiffness = 200f), label = "trophy")
            Text(if (quiet) "✅" else if (today?.allClear == true && today.celebrate != true) "🌟" else "🎉", fontSize = 84.sp, modifier = Modifier.scale(scale))
            Text(
                when {
                    practice != null -> if (stats.reviews > 0) "Practised!" else "Nothing to practise"
                    today != null && today.reviews == 0 -> "Nothing due right now"
                    quiet -> "All done for now"
                    else -> "All done!"
                },
                style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                when {
                    practice != null -> if (stats.reviews == 0) "These cards are not on this phone yet — sync and try again."
                    else "${practice.counted} counted as ${if (practice.counted == 1) "a review" else "reviews"} (due today) · ${practice.practiceOnly} practice only"
                    ui.hasMoreNew -> "You've finished today's new words" + (if (ui.bonus > 0) " (+${ui.bonus} bonus)" else "") + ". Want more?"
                    else -> "Nothing else is due today. 明天见！"
                },
                style = MaterialTheme.typography.bodyLarge,
                color = Lab.colors.muted,
                textAlign = TextAlign.Center,
            )
            if (practice != null && stats.reviews > 0) {
                Spacer(Modifier.height(24.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("Cards rated", stats.reviews, "", Modifier.weight(1f))
                    StatTile("Right", stats.accuracy, "%", Modifier.weight(1f))
                }
            } else if (today != null && today.reviews > 0) {
                Spacer(Modifier.height(24.dp))
                // Where the session recap was: today's active time and reviews (every device).
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("Minutes today", (today.activeMs / 60_000).toInt(), "", Modifier.weight(1f))
                    StatTile("Reviews today", today.reviews, "", Modifier.weight(1f))
                    today.accuracy?.let { StatTile("Right", it, "%", Modifier.weight(1f)) }
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    dev.jeromeswannack.chineselearning.lab.core.ActiveTime.todayLine(today.activeMs, today.reviews),
                    style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted,
                )
                TodayDoneLine(today)
                if (ui.stats.leeches.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text("${ui.stats.leeches.size} word${if (ui.stats.leeches.size == 1) "" else "s"} needed several tries — they'll be back soon.", style = MaterialTheme.typography.bodyMedium, color = Palette.Again, textAlign = TextAlign.Center)
                }
            }
            Spacer(Modifier.height(28.dp))
            if (ui.hasMoreNew && practice == null) {
                PrimaryPill("Study 10 more new words", Modifier.fillMaxWidth().height(58.dp), onClick = actions.onStudyMore)
                Spacer(Modifier.height(10.dp))
            }
            if (ui.canUndo) TextButton(onClick = actions.onUndo) { Text("↺ Undo last review", color = Lab.colors.muted) }
            TextButton(onClick = actions.onClose) { Text(if (practice != null) "Back to notes" else "Done", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold) }
        }
        if (practice != null && stats.reviews > 0) ConfettiRain(key = stats.reviews, colors = Palette.Confetti)
        else if (today?.celebrate == true) ConfettiRain(key = today.reviews, colors = Palette.Confetti)
        // The second, smaller one: flashcards, lessons and today's story all done.
        else if (today?.allClear == true) SparkBurst(trigger = 1, colors = Palette.Confetti, sparks = 34)
    }
}

/** "Flashcards ✓ · 2 mini lessons ✓ · Today's story ✓" under today's numbers (Lab today split). */
@Composable
private fun TodayDoneLine(today: TodaySummary) {
    if (today.lessonsDone == 0 && !today.readerDone) return
    Spacer(Modifier.height(8.dp))
    val parts = listOfNotNull(
        "Flashcards ✓",
        if (today.lessonsDone > 0) "${today.lessonsDone} mini lesson${if (today.lessonsDone == 1) "" else "s"} ✓" else null,
        if (today.readerDone) "Today's story ✓" else null,
    )
    Text(
        if (today.allClear) "Everything for today ✓" else parts.joinToString(" · "),
        style = MaterialTheme.typography.labelLarge,
        color = Palette.Good,
        fontWeight = FontWeight.SemiBold,
        textAlign = TextAlign.Center,
    )
    if (today.allClear) Text(parts.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
}

/** The top bar's "📘2 📖1": mini lessons and today's story waiting after the cards. */
@Composable
private fun TodayLeftChip(left: TodayLeft) {
    Text(
        left.chip,
        fontSize = 12.sp,
        color = Lab.colors.muted,
        maxLines = 1,
        modifier = Modifier.padding(horizontal = 2.dp).clip(CircleShape).background(Lab.colors.faint.copy(alpha = 0.7f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
            .describedAs("After the cards: ${dev.jeromeswannack.chineselearning.lab.core.TodayPlan.extrasPhrase(left.lessons, left.reader)}"),
    )
}

private fun Modifier.describedAs(label: String): Modifier =
    this.then(Modifier.semantics { contentDescription = label })

/**
 * Lab "today split": the flashcards are done and lessons / today's story are left — the
 * cards' celebration (once a day) and Continue / Later. Later just leaves: Home shows what's left.
 */
@Composable
private fun ExtrasBreakView(phase: StudyPhase.Extras, ui: StudyUi, actions: StudyActions) {
    val today = ui.today
    Box(Modifier.fillMaxSize().testTag(EXTRAS_BREAK_TAG)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(20.dp))
            var shown by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { shown = true }
            val scale by animateFloatAsState(if (shown) 1f else 0.3f, spring(dampingRatio = 0.45f, stiffness = 200f), label = "cardsDone")
            Text(if (today?.celebrate == true) "🎉" else "✅", fontSize = 72.sp, modifier = Modifier.scale(scale))
            Text("Flashcards done ✓", style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink)
            Spacer(Modifier.height(6.dp))
            Text(
                dev.jeromeswannack.chineselearning.lab.core.TodayPlan.extrasPhrase(phase.lessons, phase.reader).replaceFirstChar { it.uppercase() } + " left",
                style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted, textAlign = TextAlign.Center,
            )
            if (today != null && today.reviews > 0) {
                Spacer(Modifier.height(6.dp))
                Text(dev.jeromeswannack.chineselearning.lab.core.ActiveTime.todayLine(today.activeMs, today.reviews), style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
            }
            Spacer(Modifier.height(20.dp))
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).padding(vertical = 6.dp)) {
                phase.titles.forEach { t ->
                    Text(t, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp))
                }
            }
            Spacer(Modifier.height(24.dp))
            PrimaryPill("Continue", Modifier.fillMaxWidth().height(58.dp).testTag(EXTRAS_CONTINUE_TAG), onClick = actions.onContinueExtras)
            Spacer(Modifier.height(6.dp))
            TextButton(onClick = actions.onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text("Later", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold) }
        }
        if (today?.celebrate == true) ConfettiRain(key = today.reviews, colors = Palette.Confetti)
    }
}

/** Test tags of the "Flashcards done" pause. */
const val EXTRAS_BREAK_TAG = "study-extras-break"
const val EXTRAS_CONTINUE_TAG = "study-extras-continue"

@Composable
private fun StatTile(label: String, value: Int, suffix: String, modifier: Modifier) {
    var target by remember { mutableIntStateOf(0) }
    LaunchedEffect(value) { target = value }
    val shown by animateIntAsState(target, tween(900), label = "stat")
    Column(
        modifier.clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("$shown$suffix", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
    }
}
