package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.safeDrawing
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
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
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
@Composable
fun LabBottomSheet(onDismiss: () -> Unit, title: String? = null, skipPartiallyExpanded: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    LabModalSheet(onDismiss, skipPartiallyExpanded) {
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
 * THE modal bottom sheet of the Lab app — every sheet goes through it ([LabBottomSheet],
 * [LabFormSheet], [LabSheetFrame], one-off sheets with their own list): Material3's
 * `ModalBottomSheet` with the Lab colour, kept BELOW the status bar and the display cutout.
 *
 * Material3 1.3 draws the sheet edge to edge and only pads the BOTTOM inset, so a tall sheet
 * grows to the window's top edge — the character sheet's glyph tile and × ended up under the
 * clock and battery (Pixel Fold, folded). [sheetBelowStatusBar] caps the body so the whole
 * sheet (drag handle included) ends [SHEET_TOP_GAP] below the top inset; content taller than
 * that scrolls inside the sheet, as each caller already arranges.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabModalSheet(onDismiss: () -> Unit, skipPartiallyExpanded: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = skipPartiallyExpanded),
        containerColor = Lab.colors.card,
    ) {
        Column(Modifier.fillMaxWidth().sheetBelowStatusBar(), content = content)
    }
}

/** The scrim a full-height sheet leaves under the status bar, so it still reads as a sheet. */
val SHEET_TOP_GAP = 8.dp

/**
 * Caps a sheet body's height at what is left of the window under the status bar / cutout
 * ([WindowInsets.safeDrawing]'s top) and [SHEET_TOP_GAP]. A body inside `ModalBottomSheet` is
 * measured with the window height minus what sits above it (the drag handle) and the bottom
 * inset, so taking the top inset off that keeps the sheet's top edge below the status bar.
 */
@Composable
fun Modifier.sheetBelowStatusBar(): Modifier {
    val density = LocalDensity.current
    val top = WindowInsets.safeDrawing.getTop(density) + with(density) { SHEET_TOP_GAP.roundToPx() }
    return layout { measurable, constraints ->
        val capped = if (constraints.hasBoundedHeight) {
            constraints.copy(maxHeight = (constraints.maxHeight - top).coerceAtLeast(constraints.minHeight))
        } else constraints
        val placeable = measurable.measure(capped)
        layout(placeable.width, placeable.height) { placeable.place(0, 0) }
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
