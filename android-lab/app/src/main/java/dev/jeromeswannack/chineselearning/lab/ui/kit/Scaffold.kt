package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Readable column width on the unfolded Fold / tablets; phones use the full width. */
val MaxContentWidth: Dp = 720.dp

/**
 * The standard screen: title row (with ← when [onBack] is set, trailing [actions]), then a
 * scrolling list. Handles the status bar, the navigation bar, the keyboard and the unfolded
 * width, so screens never measure them (see [LabScreenFrame]).
 *
 *   LabScreen("Readers", onBack = nav::back) {
 *       item { SectionHeader("Today") }
 *       items(readers, key = { it.id }) { NavRow("📖", it.title, onClick = { … }) }
 *   }
 */
@Composable
fun LabScreen(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    listState: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
    spacing: Dp = 12.dp,
    content: LazyListScope.() -> Unit,
) {
    LabScreenFrame(modifier) {
        ScreenTitle(title, subtitle, onBack, actions)
        LazyColumn(
            Modifier.fillMaxSize(),
            state = listState,
            contentPadding = contentPadding,
            verticalArrangement = Arrangement.spacedBy(spacing),
            content = content,
        )
    }
}

/**
 * The frame alone (background, insets, max width) for screens that lay out their own body
 * (editors, players, two-pane layouts). Put [ScreenTitle] at the top yourself.
 *
 * It pads every system bar (safeDrawing), bottom included: the app draws edge to edge, so on
 * an immersive route (no tab bar) a bottom button would otherwise sit under the gesture /
 * navigation bar. While the tab bar shows, LabShell has already consumed the navigation bar
 * (the tab bar pads it), so the bottom padding is 0 there — a screen never adds it twice.
 */
@Composable
fun LabScreenFrame(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .fillMaxSize()
            .background(Lab.colors.background)
            .windowInsetsPadding(WindowInsets.safeDrawing),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(Modifier.fillMaxSize().widthIn(max = MaxContentWidth)) { content() }
    }
}

/** A screen's title row: optional back arrow, headline, optional subtitle, trailing actions. */
@Composable
fun ScreenTitle(title: String, subtitle: String? = null, onBack: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = if (onBack == null) 20.dp else 4.dp, end = 8.dp, top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Lab.colors.ink) }
            Spacer(Modifier.width(4.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2)
        }
        actions()
    }
}
