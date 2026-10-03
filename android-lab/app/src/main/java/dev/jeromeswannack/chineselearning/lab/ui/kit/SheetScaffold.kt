package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Test tag on every sticky footer (tests assert the primary action is on screen). */
const val STICKY_FOOTER_TAG = "sticky-footer"

/**
 * A form whose actions are always on screen: [header] fixed at the top, [content] scrolling in
 * the middle, [footer] (Save / Add / Send / Cancel…) pinned at the bottom, OUTSIDE the scroll.
 * Jerome has many decks: a long deck picker or a tall card editor must never push Save off the
 * phone. Only the middle scrolls; a hairline + soft shadow above the footer shows while there
 * is more content below it.
 *
 * The scaffold needs a bounded height: use it as the whole body of a [LabFormSheet], a
 * [FormScreen], a dialog or a screenshot box — never inside another vertical scroll.
 *
 *   SheetScaffold(
 *       header = { SheetTitle("Edit card") },
 *       footer = {
 *           SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp), onClick = onDismiss)
 *           PrimaryPill("Save", Modifier.weight(1f).height(52.dp)) { save() }
 *       },
 *   ) { Field(…); Field(…) }
 *
 * [footerColor] is the sheet colour by default; a full-screen page passes the page background.
 * The footer pads the keyboard and the navigation bar (insets a sheet / frame has already
 * consumed count 0, so it never pads twice).
 */
@Composable
fun SheetScaffold(
    modifier: Modifier = Modifier,
    header: (@Composable ColumnScope.() -> Unit)? = null,
    /** null = no buttons in this state (e.g. a pick-a-row step); [footerAbove] alone still pins its notice. */
    footer: (@Composable RowScope.() -> Unit)?,
    footerAbove: (@Composable ColumnScope.() -> Unit)? = null,
    scrollState: ScrollState = rememberScrollState(),
    contentPadding: PaddingValues = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
    spacing: Dp = 10.dp,
    footerColor: Color = Lab.colors.card,
    /** true = fill the available height (a full page: footer at the very bottom even when the form is short). */
    fillHeight: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth().then(if (fillHeight) Modifier.fillMaxHeight() else Modifier)) {
        header?.invoke(this)
        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f, fill = fillHeight)
                .verticalScroll(scrollState)
                .padding(contentPadding),
            verticalArrangement = Arrangement.spacedBy(spacing),
        ) { content() }
        if (footer != null || footerAbove != null) {
            StickyFooter(moreAbove = scrollState.canScrollForward, color = footerColor, above = footerAbove, content = footer)
        } else {
            Spacer(Modifier.navigationBarsPadding().imePadding().height(12.dp))
        }
    }
}

/**
 * [SheetScaffold] for a long list (a lazy body): pickers with hundreds of rows. The list
 * scrolls; [footer] stays put.
 */
@Composable
fun LazySheetScaffold(
    modifier: Modifier = Modifier,
    header: (@Composable ColumnScope.() -> Unit)? = null,
    footer: @Composable RowScope.() -> Unit,
    footerAbove: (@Composable ColumnScope.() -> Unit)? = null,
    listState: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
    spacing: Dp = 10.dp,
    footerColor: Color = Lab.colors.card,
    fillHeight: Boolean = false,
    content: LazyListScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth().then(if (fillHeight) Modifier.fillMaxHeight() else Modifier)) {
        header?.invoke(this)
        LazyColumn(
            Modifier.fillMaxWidth().weight(1f, fill = fillHeight),
            state = listState,
            contentPadding = contentPadding,
            verticalArrangement = Arrangement.spacedBy(spacing),
            content = content,
        )
        StickyFooter(moreAbove = listState.canScrollForward, color = footerColor, above = footerAbove, content = footer)
    }
}

/**
 * The pinned action row on its own (for a screen that lays out its own scrolling body, e.g. an
 * editor with a LazyColumn of its own): put it under a `Modifier.weight(1f)` body.
 * [moreAbove] shows the divider + shadow ("there is more above this bar").
 */
@Composable
fun StickyFooter(
    moreAbove: Boolean,
    modifier: Modifier = Modifier,
    color: Color = Lab.colors.card,
    contentPadding: PaddingValues = PaddingValues(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 12.dp),
    /** Pinned above the buttons: the error / offline notice of the action, so it is seen where the tap was. */
    above: (@Composable ColumnScope.() -> Unit)? = null,
    content: (@Composable RowScope.() -> Unit)?,
) {
    val line by animateColorAsState(if (moreAbove) Lab.colors.cardBorder else Color.Transparent, label = "footer-line")
    val shade by animateColorAsState(if (moreAbove) Color.Black.copy(alpha = 0.07f) else Color.Transparent, label = "footer-shade")
    Column(modifier.fillMaxWidth().testTag(STICKY_FOOTER_TAG)) {
        // A soft shadow cast upwards over the content's last line, then the hairline.
        Box(Modifier.fillMaxWidth().height(6.dp).background(Brush.verticalGradient(listOf(Color.Transparent, shade))))
        Box(Modifier.fillMaxWidth().height(1.dp).background(line))
        Column(
            Modifier
                .fillMaxWidth()
                .background(color)
                .imePadding()
                .navigationBarsPadding()
                .padding(contentPadding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            above?.invoke(this)
            if (content != null) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    content = content,
                )
            }
        }
    }
}

/** The title line of a form sheet (same look as [LabBottomSheet]'s title). */
@Composable
fun SheetTitle(title: String, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
    Row(modifier.fillMaxWidth().padding(start = 24.dp, end = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.weight(1f))
        trailing()
    }
}

/**
 * A bottom sheet holding a form with a pinned footer: [LabBottomSheet]'s look, but the body is a
 * [SheetScaffold] (only [content] scrolls; [footer] is always visible, above the keyboard).
 *
 *   if (open) LabFormSheet(onDismiss = { open = false }, title = "Deck settings",
 *       footer = { SecondaryPill("Cancel", …); PrimaryPill("Save", …) }) { fields… }
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabFormSheet(
    onDismiss: () -> Unit,
    title: String? = null,
    footer: (@Composable RowScope.() -> Unit)?,
    header: (@Composable ColumnScope.() -> Unit)? = null,
    footerAbove: (@Composable ColumnScope.() -> Unit)? = null,
    spacing: Dp = 10.dp,
    contentPadding: PaddingValues = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Lab.colors.card,
    ) {
        SheetScaffold(
            header = if (title == null && header == null) null else {
                {
                    if (title != null) SheetTitle(title)
                    header?.invoke(this)
                }
            },
            footer = footer,
            footerAbove = footerAbove,
            spacing = spacing,
            contentPadding = contentPadding,
            content = content,
        )
    }
}

/**
 * A bare bottom sheet (Lab look, no scrolling of its own) for a body that is already a
 * [SheetScaffold] — e.g. a reusable `FooForm` that pins its own footer.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabSheetFrame(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Lab.colors.card,
        content = content,
    )
}

/**
 * A full-screen form page (Settings sub-pages, editors without their own shell): [ScreenTitle],
 * the scrolling form, the pinned [footer] on the page background.
 */
@Composable
fun FormScreen(
    title: String,
    footer: @Composable RowScope.() -> Unit,
    modifier: Modifier = Modifier,
    footerAbove: (@Composable ColumnScope.() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    scrollState: ScrollState = rememberScrollState(),
    content: @Composable ColumnScope.() -> Unit,
) {
    LabScreenFrame(modifier) {
        ScreenTitle(title, subtitle, onBack, actions)
        SheetScaffold(
            footer = footer,
            footerAbove = footerAbove,
            fillHeight = true,
            scrollState = scrollState,
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 16.dp),
            spacing = 12.dp,
            footerColor = Lab.colors.background,
            content = content,
        )
    }
}

/**
 * [LabScreen] with a pinned [footer]: a list-shaped page (deck pickers, long option lists) whose
 * main action (Generate / Assign / Save) must never scroll away. Body is a `LazyColumn` scope.
 */
@Composable
fun LazyFormScreen(
    title: String,
    footer: @Composable RowScope.() -> Unit,
    modifier: Modifier = Modifier,
    footerAbove: (@Composable ColumnScope.() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    listState: LazyListState = rememberLazyListState(),
    spacing: Dp = 12.dp,
    content: LazyListScope.() -> Unit,
) {
    LabScreenFrame(modifier) {
        ScreenTitle(title, subtitle, onBack, actions)
        LazySheetScaffold(
            Modifier.fillMaxHeight(),
            footer = footer,
            footerAbove = footerAbove,
            listState = listState,
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 16.dp),
            spacing = spacing,
            footerColor = Lab.colors.background,
            fillHeight = true,
            content = content,
        )
    }
}
