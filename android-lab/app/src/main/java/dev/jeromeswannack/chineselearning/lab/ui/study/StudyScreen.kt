package dev.jeromeswannack.chineselearning.lab.ui.study

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
import dev.jeromeswannack.chineselearning.lab.data.api.VocabularyDefinition
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody

/** Everything the session screen can ask for. Defaults are no-ops so screenshots need none. */
class StudyActions(
    val onClose: () -> Unit = {},
    val onUndo: () -> Unit = {},
    val onReveal: (AnswerKey.Verdict?) -> Unit = {},
    val onRate: (rating: Int, timeSpentMs: Long, userAnswer: String?) -> Unit = { _, _, _ -> },
    val onPlay: (key: String?, text: String) -> Unit = { _, _ -> },
    /** The word itself: its recordings in turn ([advance] = next voice), else its own clip. */
    val onPlayWord: (advance: Boolean) -> Unit = {},
    val onStudyMore: () -> Unit = {},
    val onToggleOffline: () -> Unit = {},
    val onDismissExplainer: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
    // ⋯ menu
    val onGenerateFunFact: () -> Unit = {},
    val onRegenerateAudio: () -> Unit = {},
    val onNewVoice: () -> Unit = {},
    val onRoleplay: () -> Unit = {},
    val onWriteIt: (hanzi: String) -> Unit = {},
    val onPlayMyRecording: () -> Unit = {},
    /** "Use in sentence" when the note has none yet, and ↻ on the shown one. */
    val onGenerateSentenceClue: () -> Unit = {},
    val sendFlag: suspend (FlagTutor, String) -> Boolean = { _, _ -> false },
    val edit: EditCardActions = EditCardActions(),
    val ask: AskActions = AskActions(),
    // tap a character
    val define: suspend (hanzi: String, context: String, refresh: Boolean) -> CardTools.Definition = { _, _, _ -> error("offline") },
    val deckHolding: suspend (String) -> String? = { null },
    val addDefinition: suspend (VocabularyDefinition) -> Unit = {},
    // ---- Package B: mini lessons in the session ----
    val lessonEnv: dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv = dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv(),
    val onLessonComplete: (dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult) -> Unit = {},
)

@Composable
fun StudyRoute(app: LabApp, deckId: String?, onExit: () -> Unit, onOpen: (String) -> Unit, onHandoff: (String) -> Unit) {
    val vm: StudyViewModel = viewModel(key = "study-${deckId ?: "all"}", factory = StudyViewModel.Factory(app, deckId))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val playing by app.audio.playingKey.collectAsState()
    val sync by app.repo.status.collectAsState()
    var confirmExit by remember { mutableStateOf(false) }
    val requestExit = { if (ui.stats.reviews == 0 || ui.phase is StudyPhase.Done) onExit() else confirmExit = true }
    BackHandler(onBack = requestExit)
    val tools = vm.tools
    val currentNote = { (vm.ui.value.phase as? StudyPhase.Showing)?.view?.note }
    val newNote = { d: VocabularyDefinition -> NewNoteBody(d.hanzi, d.pinyin, d.english, d.fun_facts) }
    StudyScreen(
        ui = ui,
        playingKey = playing,
        pendingReviews = sync.unsynced,
        actions = StudyActions(
            onClose = requestExit,
            onUndo = vm::undoLast,
            onReveal = vm::onRevealed,
            onRate = vm::rate,
            onPlay = vm::play,
            onPlayWord = vm::playWord,
            onStudyMore = vm::studyMore,
            onToggleOffline = vm::toggleForcedOffline,
            onDismissExplainer = vm::dismissExplainer,
            onDismissNotice = vm::dismissNotice,
            onGenerateFunFact = vm::generateFunFact,
            onRegenerateAudio = vm::regenerateAudio,
            onNewVoice = vm::newVoice,
            onRoleplay = { vm.roleplay(onOpen) },
            onWriteIt = { hanzi -> onHandoff("/practice/strokes?text=" + java.net.URLEncoder.encode(hanzi, "UTF-8").replace("+", "%20")) },
            onGenerateSentenceClue = { vm.generateSentenceClue() },
            sendFlag = vm::flag,
            edit = EditCardActions(
                save = vm::saveEdit,
                delete = { vm.deleteCurrentNote() },
                generateClue = { currentNote()?.let { n -> tools.generateSentenceClue(n.id) } },
                recordings = { currentNote()?.let { n -> tools.recordings(n.id) }.orEmpty() },
                setPrimary = { id -> currentNote()?.let { n -> tools.setPrimaryRecording(n.id, id) } },
                deleteRecording = { id -> currentNote()?.let { n -> tools.deleteRecording(n.id, id) } },
                play = vm::play,
            ),
            ask = AskActions(
                ask = vm::ask,
                approve = vm::approveTools,
                reject = vm::rejectTools,
                toFlashcard = tools::toFlashcard,
                decks = vm::deckChoices,
                addFlashcard = { deckId, d -> tools.addNote(deckId, NewNoteBody(d.hanzi, d.pinyin, d.english, d.fun_facts)) },
            ),
            define = { h, c, r -> tools.define(h, c, r) },
            deckHolding = tools::deckHolding,
            addDefinition = { d -> tools.addNote(currentNote()?.deckId ?: error("No card"), newNote(d)) },
            lessonEnv = dev.jeromeswannack.chineselearning.lab.ui.lessons.rememberExerciseEnv(app), // Package B
            onLessonComplete = vm::completeLesson, // Package B
        ),
    )
    if (confirmExit) {
        val n = ui.stats.reviews
        AlertDialog(
            onDismissRequest = { confirmExit = false },
            title = { Text("End session?") },
            text = { Text((if (n == 1) "Your review is saved." else "Your $n reviews are saved.") + " ${ui.stats.accuracy}% right, best streak ${ui.stats.bestStreak}.") },
            confirmButton = { TextButton(onClick = { confirmExit = false }) { Text("Keep studying") } },
            dismissButton = { TextButton(onClick = { confirmExit = false; onExit() }) { Text("End session") } },
        )
    }
}

@Composable
fun StudyScreen(ui: StudyUi, playingKey: String?, actions: StudyActions, cardStart: CardStartState = CardStartState(), autoplay: Boolean = true, pendingReviews: Int = 0) {
    var milestone by remember { mutableIntStateOf(0) }
    LaunchedEffect(ui.stats.streak) { if (ui.stats.streak in setOf(5, 10, 20, 30, 50, 75, 100)) milestone++ }
    Box(Modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize()) {
            StudyTopBar(ui, actions, pendingReviews)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                AnimatedContent(
                    targetState = ui.phase,
                    contentKey = { p -> when (p) { is StudyPhase.Showing -> p.view.presentation; is StudyPhase.Lesson -> "lesson-${p.lesson.key}"; StudyPhase.Done -> "done"; StudyPhase.Loading -> "loading" } },
                    transitionSpec = { cardTransition(ui.lastRating) },
                    label = "card",
                ) { phase ->
                    when (phase) {
                        StudyPhase.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Lab.colors.accent) }
                        is StudyPhase.Showing -> CardStage(phase.view, ui, playingKey, actions, cardStart, autoplay)
                        is StudyPhase.Lesson -> dev.jeromeswannack.chineselearning.lab.ui.lessons.SessionLessonView(phase.lesson, ui.counts, actions.lessonEnv, actions.onLessonComplete) // Package B
                        StudyPhase.Done -> DoneView(ui, actions)
                    }
                }
                SparkBurst(milestone, Palette.Confetti, origin = Offset(0.5f, 0.1f), sparks = 40)
            }
        }
        AnimatedVisibility(ui.showExplainer && ui.phase is StudyPhase.Showing, enter = fadeIn(), exit = fadeOut()) {
            FirstCardExplainer(actions.onDismissExplainer)
        }
    }
}

/** Good/Easy fling the card away to the right, Again drops it, Hard slides it left; the next one rises in. */
private fun cardTransition(lastRating: Int?): ContentTransform {
    val enter = slideInVertically(spring(dampingRatio = 0.8f, stiffness = 380f)) { it / 6 } +
        scaleIn(spring(dampingRatio = 0.8f, stiffness = 380f), initialScale = 0.94f) + fadeIn(tween(180))
    val exit = when (lastRating) {
        0 -> slideOutVertically(tween(260)) { it / 3 } + fadeOut(tween(200))
        1 -> slideOutHorizontally(tween(240)) { -it / 2 } + fadeOut(tween(200))
        2, 3 -> slideOutHorizontally(tween(260)) { it } + scaleOut(tween(260), targetScale = 0.9f) + fadeOut(tween(240))
        else -> fadeOut(tween(150))
    }
    return enter togetherWith exit
}

@Composable
private fun StudyTopBar(ui: StudyUi, actions: StudyActions, pendingReviews: Int) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = actions.onClose) { Icon(Icons.Filled.Close, "End session", tint = Lab.colors.muted) }
            Counts(ui.counts, Modifier.weight(1f))
            StreakChip(ui.stats.streak)
            Spacer(Modifier.width(6.dp))
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

@Composable
private fun Counts(counts: QueueCounts, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        CountNumber(counts.new, Palette.New)
        CountNumber(counts.secondaryNew, Palette.Secondary)
        CountNumber(counts.learning, Palette.Learning)
        CountNumber(counts.review, Palette.Review)
    }
}

@Composable
private fun CountNumber(value: Int, color: Color) {
    val shown by animateIntAsState(value, tween(300), label = "count")
    Text(
        "$shown",
        color = if (value == 0) color.copy(alpha = 0.35f) else color,
        fontWeight = FontWeight.Bold,
        fontSize = 17.sp,
        modifier = Modifier.padding(horizontal = 9.dp),
    )
}

@Composable
private fun StreakChip(streak: Int) {
    AnimatedVisibility(streak >= 2, enter = scaleIn() + fadeIn(), exit = scaleOut() + fadeOut()) {
        var pop by remember { mutableStateOf(false) }
        LaunchedEffect(streak) { pop = true; kotlinx.coroutines.delay(140); pop = false }
        val scale by animateFloatAsState(if (pop) 1.3f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium), label = "streak")
        Text(
            "🔥 $streak",
            modifier = Modifier.scale(scale).clip(CircleShape).background(Palette.Hard.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp),
            color = Palette.Hard,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
        )
    }
}

@Composable
private fun DoneView(ui: StudyUi, actions: StudyActions) {
    val stats = ui.stats
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(24.dp))
            var shown by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { shown = true }
            val scale by animateFloatAsState(if (shown) 1f else 0.3f, spring(dampingRatio = 0.45f, stiffness = 200f), label = "trophy")
            Text("🎉", fontSize = 84.sp, modifier = Modifier.scale(scale))
            Text(if (stats.reviews > 0) "All done!" else "Nothing due right now", style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink)
            Spacer(Modifier.height(6.dp))
            Text(
                when {
                    ui.hasMoreNew -> "You've finished today's new words" + (if (ui.bonus > 0) " (+${ui.bonus} bonus)" else "") + ". Want more?"
                    else -> "No more cards due today. 明天见！"
                },
                style = MaterialTheme.typography.bodyLarge,
                color = Lab.colors.muted,
                textAlign = TextAlign.Center,
            )
            if (stats.reviews > 0) {
                Spacer(Modifier.height(24.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("Reviews", stats.reviews, "", Modifier.weight(1f))
                    StatTile("Right", stats.accuracy, "%", Modifier.weight(1f))
                    StatTile("Best streak", stats.bestStreak, "", Modifier.weight(1f))
                }
                Spacer(Modifier.height(10.dp))
                val minutes = ((System.currentTimeMillis() - stats.startedAt) / 60000).toInt()
                Text("$minutes min this session", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                if (stats.leeches.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text("${stats.leeches.size} word${if (stats.leeches.size == 1) "" else "s"} needed several tries — they'll be back soon.", style = MaterialTheme.typography.bodyMedium, color = Palette.Again, textAlign = TextAlign.Center)
                }
            }
            Spacer(Modifier.height(28.dp))
            if (ui.hasMoreNew) {
                PrimaryPill("Study 10 more new words", Modifier.fillMaxWidth().height(58.dp), onClick = actions.onStudyMore)
                Spacer(Modifier.height(10.dp))
            }
            if (ui.canUndo) TextButton(onClick = actions.onUndo) { Text("↺ Undo last review", color = Lab.colors.muted) }
            TextButton(onClick = actions.onClose) { Text("Done", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold) }
        }
        if (stats.reviews > 0) ConfettiRain(key = stats.reviews, colors = Palette.Confetti)
    }
}

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
