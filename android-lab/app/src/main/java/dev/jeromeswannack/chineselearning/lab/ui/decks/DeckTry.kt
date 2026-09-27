package dev.jeromeswannack.chineselearning.lab.ui.decks

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One word as the Try-it viewer shows it. */
data class TryNoteUi(
    val id: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val audioUrl: String?,
    val sentenceClue: String? = null,
    val sentenceCluePinyin: String? = null,
    val sentenceClueTranslation: String? = null,
    val funFacts: String? = null,
)

data class DeckTryUi(val loaded: Boolean = false, val deckName: String? = null, val notes: List<TryNoteUi> = emptyList())

enum class TryMode(val cardType: String, val label: String) {
    HANZI_TO_MEANING("hanzi_to_meaning", "汉字 → EN"),
    MEANING_TO_HANZI("meaning_to_hanzi", "EN → 汉字"),
    AUDIO_TO_HANZI("audio_to_hanzi", "🔊 → 汉字"),
}

data class DeckTryActions(val onClose: () -> Unit = {}, val onPlay: (TryNoteUi) -> Unit = {}, val onFlip: () -> Unit = {})

/**
 * "Try it" for a deck (web: pages/DeckTryPage.tsx): flip through it card by card in any of
 * the three card types, as a student would see them. A pure viewer over Room — no review
 * events, no scheduling, no streak, works offline. Made for tutor accounts checking the
 * homework they send.
 */
class DeckTryViewModel(private val env: DecksEnv, private val deckId: String) : ViewModel() {
    private val _ui = MutableStateFlow(DeckTryUi())
    val ui: StateFlow<DeckTryUi> = _ui

    init {
        viewModelScope.launch {
            env.dataVersion.collect {
                _ui.value = withContext(Dispatchers.IO) {
                    val deck = env.dao.decks().firstOrNull { it.id == deckId }
                    val notes = env.dao.allNotes().filter { it.deckId == deckId }.sortedBy { it.createdAt.orEmpty() }
                    DeckTryUi(true, deck?.name, notes.map { TryNoteUi(it.id, it.hanzi, it.pinyin, it.english, it.audioUrl, it.sentenceClue, it.sentenceCluePinyin, it.sentenceClueTranslation, it.funFacts) })
                }
            }
        }
    }

    fun play(note: TryNoteUi) = env.fx.playAudio(note.audioUrl, note.hanzi)
    fun flip() = env.fx.lift()

    class Factory(private val env: DecksEnv, private val deckId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = DeckTryViewModel(env, deckId) as T
    }
}

@Composable
fun DeckTryScreen(
    ui: DeckTryUi,
    actions: DeckTryActions,
    initialMode: TryMode = TryMode.HANZI_TO_MEANING,
    initialIndex: Int = 0,
    initialRevealed: Boolean = false,
) {
    var mode by rememberSaveable { mutableStateOf(initialMode) }
    var index by rememberSaveable { mutableIntStateOf(initialIndex) }
    var revealed by rememberSaveable { mutableStateOf(initialRevealed) }
    val note = ui.notes.getOrNull(index.coerceAtMost(ui.notes.lastIndex).coerceAtLeast(0))
    fun go(delta: Int) {
        if (ui.notes.isEmpty()) return
        index = (index + delta).coerceIn(0, ui.notes.lastIndex)
        revealed = false
    }
    fun reveal() { if (!revealed) { revealed = true; actions.onFlip() } }

    // The audio card starts by playing the word, as in study.
    LaunchedEffect(note?.id, mode) { if (note != null && mode == TryMode.AUDIO_TO_HANZI && !revealed) actions.onPlay(note) }

    LabScreenFrame {
        ScreenTitle(ui.deckName ?: "Deck", subtitle = "Preview · nothing is recorded", actions = {
            Text("✕", fontSize = 22.sp, color = Lab.colors.muted, modifier = Modifier.clip(CircleShape).bouncyClickable(onClick = actions.onClose).padding(12.dp))
        })
        Column(Modifier.fillMaxSize().padding(horizontal = 16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ChipRow {
                TryMode.entries.forEach { m -> LabChip(m.label, selected = mode == m) { mode = m; revealed = false } }
            }
            when {
                !ui.loaded -> LoadingState()
                note == null -> EmptyState("🃏", "This deck has no words on this device yet.")
                else -> {
                    Text("${index + 1} / ${ui.notes.size}", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted, modifier = Modifier.align(Alignment.CenterHorizontally))
                    Box(
                        Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Lab.colors.card)
                            .bouncyClickable(enabled = !revealed, pressedScale = 0.985f) { reveal() },
                        contentAlignment = Alignment.Center,
                    ) {
                        AnimatedContent(
                            targetState = Triple(note.id, mode, revealed),
                            transitionSpec = { (fadeIn() + scaleIn(spring(dampingRatio = Spring.DampingRatioMediumBouncy), initialScale = 0.96f)) togetherWith fadeOut() },
                            label = "try-card",
                        ) { (_, m, open) ->
                            if (!open) TryFront(note, m, actions) else TryBack(note, actions)
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SecondaryPill("‹ Back", Modifier.weight(1f).height(56.dp), enabled = index > 0) { go(-1) }
                        when {
                            !revealed -> PrimaryPill("Show answer", Modifier.weight(1.4f).height(56.dp)) { reveal() }
                            index < ui.notes.lastIndex -> PrimaryPill("Next ›", Modifier.weight(1.4f).height(56.dp)) { go(1) }
                            else -> PrimaryPill("Done", Modifier.weight(1.4f).height(56.dp)) { actions.onClose() }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TryFront(note: TryNoteUi, mode: TryMode, actions: DeckTryActions) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
        when (mode) {
            TryMode.HANZI_TO_MEANING -> Text(note.hanzi, fontSize = 56.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
            TryMode.MEANING_TO_HANZI -> Text(note.english, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center)
            TryMode.AUDIO_TO_HANZI -> Box(
                Modifier.size(96.dp).clip(CircleShape).background(Lab.colors.accent).bouncyClickable { actions.onPlay(note) },
                contentAlignment = Alignment.Center,
            ) { Text("▶", fontSize = 40.sp, color = androidx.compose.ui.graphics.Color.White) }
        }
        Text(
            if (mode == TryMode.HANZI_TO_MEANING) "The student says the meaning aloud" else "The student types the characters",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun TryBack(note: TryNoteUi, actions: DeckTryActions) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(note.hanzi, fontSize = 48.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Text(note.pinyin, fontSize = 20.sp, color = Lab.colors.accent, textAlign = TextAlign.Center)
        Text(note.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
        SecondaryPill("▶ Play") { actions.onPlay(note) }
        note.sentenceClue?.takeIf { it.isNotBlank() }?.let { clue ->
            Spacer(Modifier.height(4.dp))
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(clue, fontSize = 18.sp, color = Lab.colors.ink)
                note.sentenceCluePinyin?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
                note.sentenceClueTranslation?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
            }
        }
        note.funFacts?.takeIf { it.isNotBlank() }?.let { MarkdownText(it, Modifier.fillMaxWidth()) }
    }
}
