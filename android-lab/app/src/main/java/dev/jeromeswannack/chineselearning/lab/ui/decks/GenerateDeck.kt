package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.data.NoteDto
import dev.jeromeswannack.chineselearning.lab.ui.cards.Field
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.FormScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class GeneratedUi(val deckId: String, val deckName: String, val notes: List<NoteDto>)

data class GenerateUi(
    val prompt: String = "",
    val deckName: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val online: Boolean = true,
    val result: GeneratedUi? = null,
)

/** "Generate with Claude" (web: pages/GeneratePage.tsx, `POST /api/ai/generate-deck`). */
class GenerateDeckViewModel(private val env: DecksEnv) : ViewModel() {
    private val _ui = MutableStateFlow(GenerateUi())
    val ui: StateFlow<GenerateUi> = _ui

    init {
        viewModelScope.launch { env.online.collect { on -> _ui.update { it.copy(online = on) } } }
    }

    fun setPrompt(p: String) = _ui.update { it.copy(prompt = p) }

    fun setDeckName(n: String) = _ui.update { it.copy(deckName = n) }

    fun generate() {
        val s = _ui.value
        if (s.prompt.isBlank() || s.busy) return
        _ui.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            env.writes.generateDeck(s.prompt, s.deckName).fold(
                onSuccess = { r ->
                    dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("deck.generate")
                    dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("deck.create", mapOf("source" to "generate"))
                    env.fx.success()
                    _ui.update { it.copy(busy = false, result = GeneratedUi(r.deck.id, r.deck.name, r.notes)) }
                },
                onFailure = { e ->
                    env.fx.failure()
                    _ui.update { it.copy(busy = false, error = "Failed to generate deck. ${e.message.orEmpty()}".trim()) }
                },
            )
        }
    }

    fun again() = _ui.update { GenerateUi(online = it.online) }

    fun play(n: NoteDto) = env.fx.playAudio(n.audio_url, n.hanzi)

    class Factory(private val env: DecksEnv) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = GenerateDeckViewModel(env) as T
    }

    companion object {
        val EXAMPLES = listOf(
            "Common greetings and polite expressions",
            "Food and drinks vocabulary for restaurants",
            "Numbers, dates, and time expressions",
            "Transportation and directions",
            "Shopping and bargaining phrases",
            "Weather and seasons vocabulary",
        )
    }
}

data class GenerateActions(
    val onBack: () -> Unit = {},
    val onPrompt: (String) -> Unit = {},
    val onDeckName: (String) -> Unit = {},
    val onGenerate: () -> Unit = {},
    val onAgain: () -> Unit = {},
    val onOpenDeck: (String) -> Unit = {},
    val onPlay: (NoteDto) -> Unit = {},
)

@Composable
fun GenerateDeckScreen(ui: GenerateUi, actions: GenerateActions) {
    val r = ui.result
    if (r != null) {
        LabScreen("Deck generated!", subtitle = "Created \"${r.deckName}\" with ${r.notes.size} notes", onBack = actions.onBack) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill("Generate another", Modifier.weight(1f)) { actions.onAgain() }
                    PrimaryPill("View deck", Modifier.weight(1f).height(52.dp)) { actions.onOpenDeck(r.deckId) }
                }
            }
            item { SectionHeader("Generated notes") }
            items(r.notes.size, key = { r.notes[it].id }) { i ->
                val n = r.notes[i]
                AnimatedVisibility(true, enter = fadeIn() + slideInVertically { it / 3 }) {
                    LabCard {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(n.hanzi, fontSize = 22.sp, fontWeight = FontWeight.Medium, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                                Text("🔊", modifier = Modifier.clip(CircleShape).clickable { actions.onPlay(n) }.padding(10.dp))
                            }
                            Text("${n.pinyin} — ${n.english}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                            n.fun_facts?.takeIf { it.isNotBlank() }?.let { MarkdownText(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
                        }
                    }
                }
            }
        }
        return
    }
    FormScreen(
        "Generate with Claude",
        subtitle = "Describe what you want to learn and Claude will make a deck of cards with audio.",
        onBack = actions.onBack,
        footerAbove = if (ui.error == null && ui.online) null else {
            {
                ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                if (!ui.online) InlineNotice("You're offline. AI generation requires an internet connection.", kind = NoticeKind.Offline)
            }
        },
        footer = {
            PrimaryPill(
                if (ui.busy) "Generating… (about 30 s)" else "✨ Generate deck",
                Modifier.weight(1f).height(56.dp),
                enabled = ui.online && ui.prompt.isNotBlank() && !ui.busy,
            ) { actions.onGenerate() }
        },
    ) {
        Field("What do you want to learn?", ui.prompt, lines = 4, hint = "e.g. Vocabulary for ordering food at a Chinese restaurant", onChange = actions.onPrompt)
        Field("Deck name (optional)", ui.deckName, hint = "Leave blank to auto-generate", onChange = actions.onDeckName)
        SectionHeader("Example prompts")
        LabCard {
            GenerateDeckViewModel.EXAMPLES.forEachIndexed { i, e ->
                if (i > 0) RowDivider()
                NavRow("💡", e, onClick = { actions.onPrompt(e) })
            }
        }
    }
}
