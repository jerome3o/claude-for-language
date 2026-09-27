package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
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
import dev.jeromeswannack.chineselearning.lab.core.DueLabel
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

data class HomeworkListUi(val loaded: Boolean = false, val todo: List<HomeworkItemView> = emptyList(), val done: List<HomeworkItemView> = emptyList())

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
            } else HomeworkList(ui.todo, showTutor = true, onOpen = onOpen)
        }
        if (ui.done.isNotEmpty()) {
            item { SectionHeader("Done") }
            item { HomeworkList(if (showAllDone) ui.done else ui.done.take(DONE_LIMIT), showTutor = true, onOpen = onOpen) }
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
    val sentence: String?,
    val sentenceTranslation: String?,
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
    ) : PassUi

    /** A lesson or reader: played once in the regular player (package B), done by a `done` event. */
    data class Player(val kind: String, val title: String, val complete: Boolean, val available: Boolean) : PassUi
}

class PassActions(
    val onClose: () -> Unit = {},
    val onReveal: () -> Unit = {},
    val onAnswer: (right: Boolean) -> Unit = {},
    val onPlay: () -> Unit = {},
    val onAddToDaily: () -> Unit = {},
    val onRetrySync: () -> Unit = {},
    val onAllHomework: () -> Unit = {},
    /** Lesson / reader: play it in the player (the main app until package B's player is native). */
    val onStartPlayer: () -> Unit = {},
)

/** The one-off pass (web: HomeworkPassPage) — full screen like a study session. */
@Composable
fun HomeworkPassScreen(ui: PassUi, actions: PassActions) {
    LabScreenFrame {
        when (ui) {
            PassUi.Loading -> Box(Modifier.fillMaxSize())
            PassUi.Missing -> {
                PassTopBar("Homework", onClose = actions.onAllHomework)
                EmptyState("📭", "This homework isn’t on this device.", body = "It downloads with your next sync.", actionLabel = "All homework", onAction = actions.onAllHomework)
            }
            is PassUi.Deck -> DeckPass(ui, actions)
            is PassUi.Player -> PlayerPass(ui, actions)
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
private fun DeckPass(ui: PassUi.Deck, actions: PassActions) {
    val p = ui.progress
    val counter: @Composable () -> Unit = { Text("${p.done}/${p.total}", color = Lab.colors.muted, fontWeight = FontWeight.SemiBold, modifier = Modifier.testTag("hw-pass-count")) }
    PassTopBar(ui.title, actions.onClose, counter)
    if (p.complete) {
        PassDone(if (ui.part != null) "${ui.title} · ${ui.part}" else ui.title, p.total, ui.oneOffOnly, ui.addState, ui.online, actions)
        return
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        ProgressBar(if (p.total > 0) p.done.toFloat() / p.total else 0f, Modifier.fillMaxWidth().padding(top = 4.dp))
        Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (ui.part != null) Text(ui.part.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            DueChip(ui.due)
            if (p.retrying > 0) StatusPill("${p.retrying} to try again", Palette.Hard)
        }
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            val note = ui.note
            if (note == null) {
                EmptyState("⏳", "The words for this homework haven’t reached this device yet.", actionLabel = "Try again", onAction = actions.onRetrySync)
            } else {
                AnimatedContent(
                    targetState = note to ui.revealed,
                    transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.96f, animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy))) togetherWith fadeOut() },
                    label = "pass-card",
                ) { (n, revealed) -> PassCard(n, revealed, actions.onPlay) }
            }
        }
        if (ui.note != null) {
            Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (ui.revealed) {
                    PrimaryPill("Not yet", Modifier.weight(1f).height(56.dp).testTag("hw-notyet"), enabled = !ui.busy, color = Palette.Hard) { actions.onAnswer(false) }
                    PrimaryPill("Got it", Modifier.weight(1f).height(56.dp).testTag("hw-gotit"), enabled = !ui.busy, color = Palette.Good) { actions.onAnswer(true) }
                } else {
                    PrimaryPill("Show answer", Modifier.fillMaxWidth().height(56.dp).testTag("hw-show")) { actions.onReveal() }
                }
            }
        }
    }
}

@Composable
private fun PassCard(note: PassNote, revealed: Boolean, onPlay: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Lab.colors.card).padding(24.dp).testTag("hw-pass-card"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(note.hanzi, fontSize = 52.sp, color = Lab.colors.ink, textAlign = TextAlign.Center, lineHeight = 60.sp)
        Box(
            Modifier.size(52.dp).clip(CircleShape).background(Lab.colors.accentSoft).bouncyClickable(onClick = onPlay),
            contentAlignment = Alignment.Center,
        ) { Text("▶", color = Lab.colors.accent, fontSize = 20.sp) }
        if (revealed) {
            Text(note.pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent, textAlign = TextAlign.Center)
            Text(note.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
            if (!note.sentence.isNullOrBlank()) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.background).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(note.sentence, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    if (!note.sentenceTranslation.isNullOrBlank()) Text(note.sentenceTranslation, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
                }
            }
        } else {
            Text("Say what it means, then check.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        }
    }
}

@Composable
private fun PassDone(title: String, words: Int?, oneOffOnly: Boolean, addState: AddState, online: Boolean, actions: PassActions) {
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp).testTag("hw-pass-done"),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        ) {
            Text("🎉", fontSize = 64.sp)
            Text("Homework done!", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
            Text(title + (words?.let { " · $it ${if (it == 1) "word" else "words"}" } ?: ""), style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted, textAlign = TextAlign.Center)
            if (oneOffOnly) {
                LabCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (addState == AddState.Done) {
                            Text("Added — these words now come up in your daily review.", color = Lab.colors.ink)
                        } else {
                            Text("These words were a one-off. Want to keep them for good?", color = Lab.colors.ink)
                            SecondaryPill(if (addState == AddState.Busy) "Adding…" else "Add to my daily review", Modifier.fillMaxWidth(), enabled = addState != AddState.Busy && online) { actions.onAddToDaily() }
                            if (!online) Text("Available when you’re online.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                            if (addState == AddState.Error) Text("Couldn’t add them — try again later.", style = MaterialTheme.typography.bodySmall, color = Palette.Again)
                        }
                    }
                }
            }
            PrimaryPill("Done", Modifier.fillMaxWidth().height(56.dp)) { actions.onClose() }
        }
        ConfettiRain(key = title, colors = Palette.Confetti)
    }
}

@Composable
private fun PlayerPass(ui: PassUi.Player, actions: PassActions) {
    PassTopBar(ui.title, actions.onClose)
    if (ui.complete) {
        PassDone(ui.title, null, false, AddState.Idle, true, actions)
        return
    }
    val what = if (ui.kind == "reader") "reader" else "mini lesson"
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
        Text(if (ui.kind == "reader") "📖" else "🎓", fontSize = 56.sp)
        Text(ui.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Text(
            if (ui.available) "Go through this $what once — finishing it marks the homework done." else "This hasn’t reached this device yet. It will download with your next sync.",
            color = Lab.colors.muted,
            textAlign = TextAlign.Center,
        )
        PrimaryPill("Start", Modifier.fillMaxWidth().height(56.dp)) { actions.onStartPlayer() }
        Spacer(Modifier.width(1.dp))
    }
}
