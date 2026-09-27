package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

// New lesson (web: NewLessonSheet in LessonLibraryPage.tsx): Claude drafts it from a
// description, a conversation lesson from a situation + level, or start blank.

data class NewLessonActions(
    val onPrompt: (String) -> Unit = {},
    val onSituation: (String) -> Unit = {},
    val onLevel: (String) -> Unit = {},
    val onDraft: () -> Unit = {},
    val onDraftConversation: () -> Unit = {},
    val onBlank: () -> Unit = {},
    val onDismiss: () -> Unit = {},
)

@Composable
fun NewLessonSheet(ui: NewLessonUi, actions: NewLessonActions) {
    LabBottomSheet(onDismiss = actions.onDismiss, title = "New lesson") {
        NewLessonBody(ui, actions)
    }
}

@Composable
fun ColumnScope.NewLessonBody(ui: NewLessonUi, actions: NewLessonActions) {
    val busy = ui.busy != null
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
        SheetText("Describe it and let Claude draft it")
        OutlinedTextField(
            value = ui.prompt,
            onValueChange = actions.onPrompt,
            enabled = !busy,
            minLines = 4,
            placeholder = {
                Text(
                    "e.g. A beginner lesson on 把 sentences with kitchen verbs: a short explanation, two word-order exercises, a listening exercise contrasting 把 and 吧, and a speaking task.",
                    color = Lab.colors.muted,
                )
            },
            shape = RoundedCornerShape(14.dp),
            colors = fieldColors(),
            textStyle = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.fillMaxWidth(),
        )
        if (ui.error != null) {
            Spacer(Modifier.height(10.dp))
            InlineNotice(ui.error, kind = NoticeKind.Error)
        }
        Spacer(Modifier.height(12.dp))
        PrimaryPill(
            if (ui.busy == NewLessonBusy.DRAFT) "Drafting… (about a minute)" else "✨ Draft with Claude",
            Modifier.fillMaxWidth().height(54.dp),
            enabled = !busy && ui.prompt.isNotBlank(),
            onClick = actions.onDraft,
        )

        HorizontalDivider(Modifier.padding(vertical = 20.dp), color = Lab.colors.faint)

        SheetText("💬 Or a conversation lesson from a situation")
        OutlinedTextField(
            value = ui.situation,
            onValueChange = actions.onSituation,
            enabled = !busy,
            singleLine = true,
            placeholder = { Text("e.g. Booking a hotel room by phone", color = Lab.colors.muted) },
            shape = RoundedCornerShape(14.dp),
            colors = fieldColors(),
            textStyle = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        )
        Spacer(Modifier.height(10.dp))
        ChipRow {
            CONVERSATION_LEVELS.forEach { level -> LabChip(level, selected = level == ui.level, enabled = !busy) { actions.onLevel(level) } }
        }
        Spacer(Modifier.height(12.dp))
        SecondaryPill(
            if (ui.busy == NewLessonBusy.CONVERSATION) "Drafting…" else "💬 Draft the conversation lesson",
            Modifier.fillMaxWidth().height(52.dp),
            enabled = !busy && ui.situation.isNotBlank(),
            onClick = actions.onDraftConversation,
        )
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = actions.onBlank, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally).heightIn(min = 48.dp)) {
            Text(if (ui.busy == NewLessonBusy.BLANK) "Creating…" else "or start blank", color = Lab.colors.accent, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun SheetText(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = Lab.colors.muted, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
}

@Composable
internal fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Lab.colors.accent,
    unfocusedBorderColor = Lab.colors.cardBorder,
    cursorColor = Lab.colors.accent,
    focusedTextColor = Lab.colors.ink,
    unfocusedTextColor = Lab.colors.ink,
    disabledTextColor = Lab.colors.muted,
)
