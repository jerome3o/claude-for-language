package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** The tall sheet's grab handle (tap = close). */
const val TALL_SHEET_HANDLE_TAG = "claude-thread-close"

/**
 * A sheet that takes the whole height under the status bar ([sheetBelowStatusBar]) with a SLIM
 * grab handle — for a screen in a sheet (a Claude thread over the study card, a reader page or a
 * chat message), where every line counts (Jerome, Nov 2026: "way less visible space … hard to
 * read"). The handle is the sheet's close control: drag down / tap it / back / the scrim close it
 * (no ✕ in the content). Material's default handle is 48dp tall; this one is 20dp.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabTallSheet(onDismiss: () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Lab.colors.card,
        dragHandle = { TallSheetHandle(onDismiss) },
    ) {
        Column(Modifier.fillMaxWidth().sheetBelowStatusBar()) {
            Box(Modifier.fillMaxWidth().fillMaxHeight().imePadding().then(modifier), content = content)
        }
    }
}

@Composable
private fun TallSheetHandle(onClose: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(20.dp)
            .clickable(onClickLabel = "Close", onClick = onClose)
            .semantics { contentDescription = "Close" }
            .testTag(TALL_SHEET_HANDLE_TAG),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(50)).background(Lab.colors.muted.copy(alpha = 0.45f)))
    }
}
