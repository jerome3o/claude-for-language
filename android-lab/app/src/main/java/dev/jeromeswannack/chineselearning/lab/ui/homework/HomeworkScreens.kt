package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.AnswerTile
import dev.jeromeswannack.chineselearning.lab.ui.kit.AnswerTileHeight
import dev.jeromeswannack.chineselearning.lab.ui.kit.StudyCardFlip
import dev.jeromeswannack.chineselearning.lab.ui.kit.studyCardSurface
import dev.jeromeswannack.chineselearning.lab.ui.kit.studyCardTransition
import dev.jeromeswannack.chineselearning.lab.ui.kit.studyHanziSize
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.DueLabel
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.core.LongTerm
import dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonPlayer
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PlayerContext
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderEnv
import dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader
import dev.jeromeswannack.chineselearning.lab.ui.readers.StudyReaderView
import dev.jeromeswannack.chineselearning.lab.core.HomeworkItemView
import dev.jeromeswannack.chineselearning.lab.core.PassProgress
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

// ---------------- /homework ----------------

data class HomeworkListUi(
    val loaded: Boolean = false,
    val todo: List<HomeworkItemView> = emptyList(),
    val done: List<HomeworkItemView> = emptyList(),
    /** The day the status chips are computed for (the device's calendar day). */
    val today: String = dev.jeromeswannack.chineselearning.lab.core.Homework.localDate(),
)

private const val DONE_LIMIT = 10

/**
 * All one-off homework: what's still to do (overdue first, with due labels) and what's done
 * (web: HomeworkPage). Offline — reads the mirror; the sync keeps it current.
 */
@Composable
fun HomeworkListScreen(ui: HomeworkListUi, onBack: (() -> Unit)?, onOpen: (String) -> Unit) {
    var showAllDone by remember { mutableStateOf(false) }
    LabScreen("Homework", onBack = onBack) {
        item {
            Text(
                "One-off practice your tutor set, with a date to have it done by. It isn’t spaced repetition: go through each item once.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
            )
        }
        if (!ui.loaded) {
            item { LoadingState() }
            return@LabScreen
        }
        item { SectionHeader("To do") }
        item {
            if (ui.todo.isEmpty()) {
                LabCard { Text("Nothing to do — you’re all caught up. 🎉", Modifier.padding(16.dp).testTag("hw-empty"), color = Lab.colors.muted) }
            } else HomeworkList(ui.todo, showTutor = true, today = ui.today, onOpen = onOpen)
        }
        if (ui.done.isNotEmpty()) {
            item { SectionHeader("Done") }
            item { HomeworkList(if (showAllDone) ui.done else ui.done.take(DONE_LIMIT), showTutor = true, today = ui.today, onOpen = onOpen) }
            if (!showAllDone && ui.done.size > DONE_LIMIT) {
                item { SecondaryPill("Show all ${ui.done.size}") { showAllDone = true } }
            }
        }
    }
}

// ---------------- /homework/:id ----------------

data class PassNote(
    val id: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val audioUrl: String?,
    /** The card's own sentence, then the note's generated set (the study card's rows, `sentenceRows`). */
    val sentences: List<SentenceRow> = emptyList(),
    /** Where "+ Add as card" from a sentence goes by default (the word's own deck). */
    val deckId: String = "",
    /** The learner's "long-term review" choice (core LongTerm.kt): 1 in, 0 out, null = follow the deck. */
    val longTerm: Int? = null,
    /** A card of this word was already reviewed: it is in the reviews whatever the switch says. */
    val started: Boolean = false,
)

enum class AddState { Idle, Busy, Done, Error }

sealed interface PassUi {
    data object Loading : PassUi
    /** The assignment isn't on this phone. */
    data object Missing : PassUi

    data class Deck(
        val title: String,
        val part: String?,
        val due: DueLabel,
        val progress: PassProgress,
        /** The word to show now; null when its note hasn't synced yet. */
        val note: PassNote?,
        val revealed: Boolean,
        val deckId: String,
        /** One-off only (no long-term review): offer "Add to my daily review" at the end. */
        val oneOffOnly: Boolean,
        val addState: AddState = AddState.Idle,
        val online: Boolean = true,
        val busy: Boolean = false,
        /** The deck's own default for the long-term switch (a one-off-only copy, caps 0 + 0, is off). */
        val deckInReview: Boolean = !oneOffOnly,
        /** What the pass decided, for the finish screen ("12 words added to daily review · 4 left out"). */
        val longTermSummary: LongTerm.Summary? = null,
    ) : PassUi

    /**
     * A lesson or reader: played once in the regular player (the session's lesson player /
     * reader view), done by a `done` event. [lesson] / [reader] are the copy on this phone
     * (null = it hasn't synced here yet → "Missing"); [loaded] is false until the local
     * stores have been read; [finished] = finished in this sitting.
     */
    data class Player(
        val kind: String,
        val title: String,
        val complete: Boolean,
        val loaded: Boolean = true,
        val lesson: PassLesson? = null,
        val reader: SessionReader? = null,
        val finished: Boolean = false,
    ) : PassUi

    /** Link homework (docs/HOMEWORK.md §8): open it outside the app, then mark it done with a note. */
    data class Link(val link: LinkPassUi) : PassUi
}

class PassActions(
    val onClose: () -> Unit = {},
    val onReveal: () -> Unit = {},
    val onAnswer: (right: Boolean) -> Unit = {},
    val onPlay: () -> Unit = {},
    val onAddToDaily: () -> Unit = {},
    /** The answer side's "Add to my long-term review" switch flipped to `on`. */
    val onLongTerm: (on: Boolean) -> Unit = {},
    val onRetrySync: () -> Unit = {},
    val onAllHomework: () -> Unit = {},
    /** Lesson: the rated run (completion + attempt + recordings, then the homework `done`). */
    val onLessonComplete: (LessonResult) -> Unit = {},
    /** Reader: rated on its last page. */
    val onReaderFinished: (timeSpentMs: Long, how: String) -> Unit = { _, _ -> },
    /** The example sentences' breakdown / add-as-card (the study card's); never a review. */
    val sentences: SentenceActions = SentenceActions(),
    /** ▶ on a sentence row: its clip, else the device voice. */
    val onPlaySentence: (key: String?, text: String) -> Unit = { _, _ -> },
    /** Link homework: open the link outside the app. */
    val onOpenLink: (String) -> Unit = {},
    /** Link homework: the `done` event with the optional note. */
    val onLinkDone: (String?) -> Unit = {},
    /** A finished lesson pass: "▶ Do it again" (the replay route, `/lessons/:id/play`). */
    val onLessonAgain: (lessonId: String) -> Unit = {},
)

/** The lesson a pass plays (the web's `db.customLessons.get(target_id)` + its interval previews). */
data class PassLesson(val id: String, val title: String, val icon: String?, val spec: CustomLessonSpec, val previews: List<IntervalPreview>)

/** The one-off pass (web: HomeworkPassPage) — full screen like a study session. */
@Composable
fun HomeworkPassScreen(
    ui: PassUi,
    actions: PassActions,
    lessonEnv: ExerciseEnv = ExerciseEnv(),
    readerEnv: ReaderEnv = ReaderEnv(),
    playingKey: String? = null,
    sentences: PassSentencesStart = PassSentencesStart(),
) {
    LabScreenFrame {
        when (ui) {
            PassUi.Loading -> Box(Modifier.fillMaxSize())
            PassUi.Missing -> {
                PassTopBar("Homework", onClose = actions.onAllHomework)
                EmptyState("📭", "This homework isn’t on this device.", body = "It downloads with your next sync.", actionLabel = "All homework", onAction = actions.onAllHomework)
            }
            is PassUi.Deck -> DeckPass(ui, actions, playingKey, sentences)
            is PassUi.Player -> PlayerPass(ui, actions, lessonEnv, readerEnv)
            is PassUi.Link -> {
                PassTopBar("Homework", onClose = actions.onClose)
                Box(Modifier.fillMaxSize()) {
                    LinkPassContent(ui.link, actions.onOpenLink, actions.onLinkDone, actions.onClose)
                    if (ui.link.justDone) ConfettiRain(key = ui.link.title, colors = Palette.Confetti)
                }
            }
        }
    }
}

@Composable
private fun PassTopBar(title: String, onClose: () -> Unit, right: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f), maxLines = 1)
        right()
        IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Close", tint = Lab.colors.muted) }
    }
}

@Composable
private fun DeckPass(ui: PassUi.Deck, actions: PassActions, playingKey: String?, start: PassSentencesStart) {
    val p = ui.progress
    val counter: @Composable () -> Unit = { Text("${p.done}/${p.total}", color = Lab.colors.muted, fontWeight = FontWeight.SemiBold, modifier = Modifier.testTag("hw-pass-count")) }
    PassTopBar(ui.title, actions.onClose, counter)
    if (p.complete) {
        PassDone(if (ui.part != null) "${ui.title} · ${ui.part}" else ui.title, p.total, ui.oneOffOnly, ui.addState, ui.online, actions, ui.longTermSummary, ui.deckInReview)
        return
    }
    // How the last card left (Got it flings it away like Good, Not yet drops it like Again),
    // and a fresh key each time a card is shown again (a "Not yet" word coming back).
    var lastRight by remember { mutableStateOf<Boolean?>(null) }
    val shown = remember { PassShown() }
    val answer: (Boolean) -> Unit = { right -> lastRight = right; actions.onAnswer(right) }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        ProgressBar(if (p.total > 0) p.done.toFloat() / p.total else 0f, Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 4.dp))
        Row(Modifier.padding(horizontal = 4.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (ui.part != null) Text(ui.part.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            DueChip(ui.due)
            if (p.retrying > 0) StatusPill("${p.retrying} to try again", Palette.Hard)
        }
        // The card takes the room between the header and the answer bar, like a study card.
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            val note = ui.note
            if (note == null) {
                EmptyState("⏳", "The words for this homework haven’t reached this device yet.", actionLabel = "Try again", onAction = actions.onRetrySync)
            } else {
                AnimatedContent(
                    targetState = PassFace(shown.key(note.id, ui.revealed), note, ui.revealed),
                    contentKey = { it.key },
                    transitionSpec = { studyCardTransition(when (lastRight) { true -> Rating.GOOD; false -> Rating.AGAIN; null -> null }) },
                    label = "pass-card",
                ) { face ->
                    PassCard(face.note, face.revealed, actions.onPlay, longTerm = {
                        LongTermSwitch(
                            on = LongTerm.isLongTerm(face.note.longTerm, ui.deckInReview, face.note.started),
                            started = face.note.started,
                            onChange = actions.onLongTerm,
                        )
                    }) {
                        PassSentences(
                            key = face.key,
                            rows = face.note.sentences,
                            deckId = face.note.deckId,
                            online = ui.online,
                            playingKey = playingKey,
                            actions = actions.sentences,
                            onPlay = actions.onPlaySentence,
                            startExplained = start.explained,
                            startSteps = start.steps,
                            startMore = start.more,
                        )
                    }
                }
            }
        }
        // The answer bar: anchored at the bottom, clear of the navigation bar (the frame pads it).
        if (ui.note != null) {
            Row(
                Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 16.dp).testTag("hw-pass-actions"),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (ui.revealed) {
                    AnswerTile("Not yet", Palette.Hard, Modifier.weight(1f).testTag("hw-notyet"), enabled = !ui.busy) { answer(false) }
                    AnswerTile("Got it", Palette.Good, Modifier.weight(1f).testTag("hw-gotit"), enabled = !ui.busy) { answer(true) }
                } else {
                    PrimaryPill("Show answer", Modifier.fillMaxWidth().height(AnswerTileHeight).testTag("hw-show")) { actions.onReveal() }
                }
            }
        }
    }
}

/**
 * How the sentence rows start — for screenshots (a row opened, a breakdown on screen); the
 * app always starts them closed.
 */
data class PassSentencesStart(
    val explained: Map<String, SentenceExplanation> = emptyMap(),
    val steps: Map<String, Int> = emptyMap(),
    val more: Boolean = false,
)

/** What the card shows: [key] changes when a new card comes up (the same word again gets a new one). */
private data class PassFace(val key: String, val note: PassNote, val revealed: Boolean)

/** Counts the cards shown: a card is done when its answer side gives way to a question side. */
private class PassShown {
    private var count = 0
    private var wasRevealed = false
    fun key(noteId: String, revealed: Boolean): String {
        if (wasRevealed && !revealed) count++
        wasRevealed = revealed
        return "$noteId#$count"
    }
}

/**
 * The word card (web: `.hw-pass-card`), built like the study card: it fills its slot, the
 * question centred on the front; Show answer turns it over to the answer side — hanzi,
 * pinyin, meaning, the example sentence — which scrolls when it doesn't fit (large fonts).
 */
@Composable
private fun PassCard(note: PassNote, revealed: Boolean, onPlay: () -> Unit, longTerm: @Composable () -> Unit = {}, sentences: @Composable () -> Unit) {
    val rotation by animateFloatAsState(if (revealed) 180f else 0f, StudyCardFlip, label = "flip")
    val density = LocalDensity.current
    Box(
        Modifier
            .fillMaxSize()
            .padding(vertical = 4.dp)
            .graphicsLayer {
                rotationY = rotation
                cameraDistance = 14f * density.density
            }
            .studyCardSurface(Lab.colors.card, Lab.colors.cardBorder, lifted = revealed)
            .testTag("hw-pass-card"),
    ) {
        if (rotation <= 90f) {
            PassFront(note, onPlay)
        } else {
            Box(Modifier.fillMaxSize().graphicsLayer { rotationY = 180f }) { PassBack(note, onPlay, longTerm, sentences) }
        }
    }
}

@Composable
private fun PassFront(note: PassNote, onPlay: () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val minHeight = maxHeight
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .heightIn(min = minHeight)
                // Like a study card: the face is inert — only Show answer reveals.
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Spacer(Modifier.height(0.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val size = studyHanziSize(note.hanzi)
                Text(note.hanzi, fontSize = size, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center, lineHeight = size * 1.2f)
                Spacer(Modifier.height(16.dp))
                PlayCircle(onPlay)
            }
            Text("Say what it means, then check.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp))
        }
    }
}

@Composable
private fun PassBack(note: PassNote, onPlay: () -> Unit, longTerm: @Composable () -> Unit, sentences: @Composable () -> Unit) {
    // Centred in the card while it fits (a word's answer is short — no big empty half);
    // scrolls from the top when it doesn't (large fonts, a long sentence).
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val minHeight = maxHeight
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).heightIn(min = minHeight).padding(22.dp).testTag("hw-pass-answer"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Column(Modifier.widthIn(max = 560.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            val size = studyHanziSize(note.hanzi) * 0.85f
            // Revealed: each character opens the language explorer (ui/explorer).
            dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText(
                note.hanzi, source = "homework", context = note.hanzi,
                fontSize = size, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center, lineHeight = size * 1.2f,
            )
            Spacer(Modifier.height(8.dp))
            Text(note.pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent, textAlign = TextAlign.Center)
            Spacer(Modifier.height(4.dp))
            Text(note.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier.clip(CircleShape).background(Lab.colors.faint).clickable(onClick = onPlay).padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.AutoMirrored.Filled.VolumeUp, null, Modifier.size(18.dp), tint = Lab.colors.accent)
                Spacer(Modifier.width(6.dp))
                Text("Play", color = Lab.colors.ink, style = MaterialTheme.typography.labelLarge)
            }
            Spacer(Modifier.height(10.dp))
            longTerm()
            if (note.sentences.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                sentences()
            }
        }
    }
    }
}

/** ▶ on the question side (the study card's play button, smaller). */
@Composable
private fun PlayCircle(onPlay: () -> Unit) {
    Box(
        Modifier.size(56.dp).clip(CircleShape).background(Lab.colors.accentSoft).bouncyClickable(onClick = onPlay),
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.AutoMirrored.Filled.VolumeUp, "Play", Modifier.size(24.dp), tint = Lab.colors.accent) }
}

@Composable
private fun PassDone(
    title: String,
    words: Int?,
    oneOffOnly: Boolean,
    addState: AddState,
    online: Boolean,
    actions: PassActions,
    longTerm: LongTerm.Summary? = null,
    deckInReview: Boolean = !oneOffOnly,
    /** A finished lesson: "▶ Do it again". */
    onAgain: (() -> Unit)? = null,
) {
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp).testTag("hw-pass-done"),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        ) {
            Text("🎉", fontSize = 64.sp)
            Text("Homework done!", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
            Text(title + (words?.let { " · $it ${if (it == 1) "word" else "words"}" } ?: ""), style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted, textAlign = TextAlign.Center)
            // What the switches decided (web: longTermLine) — for a deck in review always, for a
            // one-off deck once a word was switched on.
            if (longTerm != null && (deckInReview || longTerm.added > 0) && addState != AddState.Done) {
                Text(
                    LongTerm.line(longTerm.added, longTerm.leftOut),
                    style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Palette.Secondary,
                    textAlign = TextAlign.Center, modifier = Modifier.testTag("hw-longterm-summary"),
                )
            }
            val someAdded = longTerm != null && longTerm.added > 0
            if (oneOffOnly && (longTerm == null || (!deckInReview && longTerm.leftOut > 0))) {
                LabCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (addState == AddState.Done) {
                            Text("Added — these words now come up in your daily review.", color = Lab.colors.ink)
                        } else {
                            Text(if (someAdded) "The others were a one-off. Keep them all for good?" else "These words were a one-off. Want to keep them for good?", color = Lab.colors.ink)
                            SecondaryPill(if (addState == AddState.Busy) "Adding…" else if (someAdded) "Add them all to my daily review" else "Add to my daily review", Modifier.fillMaxWidth(), enabled = addState != AddState.Busy && online) { actions.onAddToDaily() }
                            if (!online) Text("Available when you’re online.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                            if (addState == AddState.Error) Text("Couldn’t add them — try again later.", style = MaterialTheme.typography.bodySmall, color = Palette.Again)
                        }
                    }
                }
            }
            if (onAgain != null) SecondaryPill("▶ Do it again", Modifier.fillMaxWidth().height(52.dp).testTag("hw-lesson-again")) { onAgain() }
            PrimaryPill("Done", Modifier.fillMaxWidth().height(56.dp)) { actions.onClose() }
        }
        ConfettiRain(key = title, colors = Palette.Confetti)
    }
}

/** Lesson / reader: the regular players, once (web: LessonPass / ReaderPass). */
@Composable
private fun PlayerPass(ui: PassUi.Player, actions: PassActions, lessonEnv: ExerciseEnv, readerEnv: ReaderEnv) {
    val lesson = ui.lesson
    val reader = ui.reader
    when {
        ui.complete || ui.finished -> {
            val title = reader?.reader?.titleChinese?.ifBlank { null } ?: ui.title
            PassTopBar(title, actions.onClose)
            val again = lesson?.id?.takeIf { ui.kind == "lesson" && it.isNotEmpty() }?.let { id -> { actions.onLessonAgain(id) } }
            PassDone(title, null, false, AddState.Idle, true, actions, onAgain = again)
        }
        !ui.loaded -> Box(Modifier.fillMaxSize())
        ui.kind == "reader" && reader != null && reader.reader.pages.isNotEmpty() ->
            Column(Modifier.fillMaxSize()) {
                PassTopBar(reader.reader.titleChinese.ifBlank { ui.title }, actions.onClose)
                Box(Modifier.weight(1f).fillMaxWidth()) { StudyReaderView(reader, readerEnv, actions.onReaderFinished) }
            }
        ui.kind == "lesson" && lesson != null ->
            LessonPlayer(
                title = lesson.title,
                icon = lesson.icon,
                spec = lesson.spec,
                env = lessonEnv,
                context = PlayerContext.Homework,
                previews = lesson.previews,
                onComplete = actions.onLessonComplete,
                onEnd = actions.onClose,
                resume = if (lesson.id.isNotEmpty()) dev.jeromeswannack.chineselearning.lab.ui.lessons.rememberLessonResume(androidx.compose.ui.platform.LocalContext.current, lesson.id, lesson.spec) else null,
            )
        else -> MissingTarget(ui.title, actions.onClose)
    }
}

/** The lesson / reader of this homework hasn't synced to this phone (web: `Missing`). */
@Composable
private fun MissingTarget(title: String, onClose: () -> Unit) {
    PassTopBar(title, onClose)
    Column(Modifier.fillMaxSize().padding(24.dp).testTag("hw-pass-missing"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
        Text("📭", fontSize = 56.sp)
        Text("This hasn’t reached this device yet. It will download with your next sync.", color = Lab.colors.muted, textAlign = TextAlign.Center)
        SecondaryPill("Back", Modifier.height(48.dp), onClick = onClose)
        Spacer(Modifier.width(1.dp))
    }
}
