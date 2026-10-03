package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LazyFormScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

data class DeckChoice(val id: String, val name: String, val description: String?)

data class GenerateUi(
    val decks: List<DeckChoice> = emptyList(),
    /** Words due today (from the offline study queue); null while counting. */
    val dueWords: Int? = null,
    val source: String = "decks",
    val selected: Set<String> = emptySet(),
    val topic: String = "",
    val difficulty: String = "beginner",
    val submitting: Boolean = false,
    val error: String? = null,
    val online: Boolean = true,
) {
    val canGenerate: Boolean get() = !submitting && online && if (source == "decks") selected.isNotEmpty() else (dueWords ?: 0) > 0
}

class GenerateActions(
    val onBack: () -> Unit = {},
    val onSource: (String) -> Unit = {},
    val onToggleDeck: (String) -> Unit = {},
    val onSelectAll: () -> Unit = {},
    val onClear: () -> Unit = {},
    val onTopic: (String) -> Unit = {},
    val onDifficulty: (String) -> Unit = {},
    val onGenerate: () -> Unit = {},
)

private val DIFFICULTIES = listOf(
    Triple("beginner", "Beginner", "Very simple sentences, basic grammar"),
    Triple("elementary", "Elementary", "Simple sentences with connectors"),
    Triple("intermediate", "Intermediate", "More complex sentences"),
    Triple("advanced", "Advanced", "Natural flowing prose"),
)

/** `/readers/generate` — the web's GenerateReaderPage. */
@Composable
fun GenerateReaderScreen(ui: GenerateUi, actions: GenerateActions) {
    // Many decks to pick from: the list scrolls, "Generate Story" stays pinned.
    LazyFormScreen(
        "Generate Graded Reader",
        onBack = actions.onBack,
        footerAbove = if (ui.online && ui.error == null) null else {
            {
                if (!ui.online) InlineNotice("You're offline — stories are written on the server. Try again when you're online.", kind = NoticeKind.Offline)
                ui.error?.let { e -> InlineNotice(e, kind = NoticeKind.Error) }
            }
        },
        footer = { PrimaryPill(if (ui.submitting) "Starting…" else "Generate Story", Modifier.weight(1f).height(58.dp), enabled = ui.canGenerate, onClick = actions.onGenerate) },
    ) {
        item {
            Text("Create an AI-generated story using vocabulary from your decks. The story will only use words you've already learned.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        }
        item { SectionHeader("Vocabulary source") }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OptionRow("From decks", "Uses only words you've already learned from the selected decks", ui.source == "decks", radio = true) { actions.onSource("decks") }
                val dueDesc = ui.dueWords?.let { n -> "Weaves your $n due word${if (n == 1) "" else "s"} into a natural story (best effort — realism over coverage)" }
                    ?: "Weaves the words due for review today into a natural story"
                OptionRow("From today's due cards", dueDesc, ui.source == "due_cards", radio = true) { actions.onSource("due_cards") }
            }
        }
        if (ui.source == "decks") {
            item {
                SectionHeader("Select decks", trailing = {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryPill("Select All", onClick = actions.onSelectAll)
                        SecondaryPill("Clear", onClick = actions.onClear)
                    }
                })
            }
            if (ui.decks.isEmpty()) item { Text("No decks available. Create a deck first.", color = Lab.colors.muted) }
            items(ui.decks.size) { i ->
                val d = ui.decks[i]
                OptionRow(d.name, d.description, d.id in ui.selected, radio = false) { actions.onToggleDeck(d.id) }
            }
            if (ui.selected.isNotEmpty()) item { Text("${ui.selected.size} deck${if (ui.selected.size > 1) "s" else ""} selected", fontSize = 13.sp, color = Lab.colors.muted) }
        }
        item { SectionHeader("Topic (optional)") }
        item {
            OutlinedTextField(
                ui.topic, actions.onTopic,
                placeholder = { Text("e.g., A day at the park, Shopping adventure...", color = Lab.colors.muted) },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = Lab.colors.ink),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent, unfocusedBorderColor = Lab.colors.cardBorder, focusedContainerColor = Lab.colors.card, unfocusedContainerColor = Lab.colors.card),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item { Text("Leave blank to let AI choose a topic based on your vocabulary", fontSize = 13.sp, color = Lab.colors.muted) }
        item { SectionHeader("Difficulty") }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((value, label, desc) in DIFFICULTIES) OptionRow(label, desc, ui.difficulty == value, radio = true) { actions.onDifficulty(value) }
            }
        }
    }
}

@Composable
private fun OptionRow(label: String, desc: String?, selected: Boolean, radio: Boolean, onClick: () -> Unit) {
    val border by animateColorAsState(if (selected) Lab.colors.accent else Lab.colors.cardBorder, label = "opt")
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).bouncyClickable(pressedScale = 0.98f, onClick = onClick).clip(RoundedCornerShape(16.dp))
            .background(if (selected) Lab.colors.accentSoft else Lab.colors.card).border(1.5.dp, border, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val shape = if (radio) CircleShape else RoundedCornerShape(6.dp)
        Box(Modifier.size(22.dp).clip(shape).border(2.dp, border, shape).background(if (selected) Lab.colors.accent else Color.Transparent), contentAlignment = Alignment.Center) {
            if (selected) Text(if (radio) "" else "✓", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(label, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            desc?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
        }
    }
}
