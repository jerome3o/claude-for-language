package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * A bottom sheet whose content lays itself out — no outer scroll — so a [PinnedFooterColumn]
 * inside can keep its primary button on screen (the add-card sheets). Lifts above the
 * keyboard (imePadding); the footer pads itself above the navigation bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabFooterSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Lab.colors.card,
    ) {
        Column(Modifier.fillMaxWidth().imePadding()) { content() }
    }
}

/**
 * [body] scrolls (weight 1, not filled — the sheet still wraps short content) and [footer]
 * stays pinned under it: the add / save button is always visible however many decks or
 * cards there are. With no height bound (inside an outer scroll, e.g. a screenshot frame)
 * it is a plain column.
 */
@Composable
fun PinnedFooterColumn(
    modifier: Modifier = Modifier,
    body: @Composable ColumnScope.() -> Unit,
    footer: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        if (!constraints.hasBoundedHeight) {
            Column(Modifier.fillMaxWidth()) {
                body()
                Column(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp)) { footer() }
            }
        } else {
            Column(Modifier.fillMaxWidth().heightIn(max = maxHeight)) {
                Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState())) { body() }
                HorizontalDivider(color = Lab.colors.cardBorder.copy(alpha = 0.5f))
                Column(
                    Modifier.fillMaxWidth().background(Lab.colors.card).navigationBarsPadding().padding(top = 12.dp, bottom = 12.dp),
                ) { footer() }
            }
        }
    }
}

/**
 * A column that scrolls itself when it has a height bound (inside a [LabFooterSheet], whose
 * content does not scroll) and is a plain column otherwise (inside an outer scroll).
 */
@Composable
fun BoundedScrollColumn(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val scroll = if (constraints.hasBoundedHeight) Modifier.verticalScroll(rememberScrollState()) else Modifier
        Column(Modifier.fillMaxWidth().then(scroll)) { content() }
    }
}

/**
 * The deck chips of an add-card sheet in their own scrolling region, at most [maxHeight]
 * tall (about three rows), so a long deck list never pushes the button away.
 */
@Composable
fun DeckChipList(modifier: Modifier = Modifier, maxHeight: Dp = 164.dp, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth().heightIn(max = maxHeight).verticalScroll(rememberScrollState())) {
        ChipRow(Modifier.fillMaxWidth().padding(vertical = 2.dp)) { content() }
    }
}
