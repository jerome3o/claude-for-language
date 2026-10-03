package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/**
 * A bottom sheet with the Lab look: card colour, optional title, scrolling content, padded
 * above the navigation bar. For per-item menus (the web's ⋯ sheets) and short forms.
 *
 *   if (showMenu) LabBottomSheet(onDismiss = { showMenu = false }, title = "打算") {
 *       NavRow("🚩", "Flag for tutor", onClick = { … })
 *   }
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabBottomSheet(onDismiss: () -> Unit, title: String? = null, skipPartiallyExpanded: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = skipPartiallyExpanded),
        containerColor = Lab.colors.card,
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
            if (title != null) {
                Text(title, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.padding(horizontal = 24.dp))
                Spacer(Modifier.height(8.dp))
            }
            content()
        }
    }
}

/**
 * Confirm a consequential action. [danger] paints the confirm button red (delete, sign out
 * with unsynced reviews). Dismissing = cancel.
 */
@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    dismissLabel: String = "Cancel",
    danger: Boolean = false,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Lab.colors.card,
        title = { Text(title, color = Lab.colors.ink) },
        // A long body scrolls inside the dialog; the buttons below it stay put.
        text = { Text(text, color = Lab.colors.muted, modifier = Modifier.verticalScroll(rememberScrollState())) },
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }) {
                Text(confirmLabel, color = if (danger) Palette.Again else Lab.colors.accent, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(dismissLabel, color = Lab.colors.muted) } },
    )
}
