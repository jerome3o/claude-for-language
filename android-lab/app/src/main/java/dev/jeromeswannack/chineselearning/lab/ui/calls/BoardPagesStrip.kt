package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPages
import dev.jeromeswannack.chineselearning.lab.core.calls.BoardPagesState
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPages
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** What the page strip can do (CallController's page actions). */
data class BoardPageActions(
    val onOpen: (String) -> Unit = {},
    val onNew: () -> Unit = {},
    val onDuplicate: (String) -> Unit = {},
    /** null = back to "Page N". */
    val onRename: (String, String?) -> Unit = { _, _ -> },
    val onDelete: (String) -> Unit = {},
    val onGoThere: () -> Unit = {},
    val onFollow: (Boolean) -> Unit = {},
    val onBringHere: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
)

/** Under a thumbnail: the title, else the page's number ("7"). */
fun thumbLabel(index: Int, title: String?): String = title?.trim()?.takeIf { it.isNotEmpty() } ?: "${index + 1}"

private fun parseHex(hex: String): Color = Color(0xFF000000 or hex.removePrefix("#").toLong(16))

/**
 * One page as a small sheet of paper: the start of its text in a tiny font (clipped), the number
 * or title under it; [current] = accent border; [dot] = the other person is on this page (their
 * presence colour). Tap opens it, long-press (or ⋯ on the current page) opens its menu.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PageThumb(
    label: String,
    preview: String,
    current: Boolean,
    modifier: Modifier = Modifier,
    dot: Color? = null,
    showMore: Boolean = false,
    onClick: () -> Unit = {},
    onLongClick: (() -> Unit)? = null,
) {
    val haptics = LocalHapticFeedback.current
    Column(
        modifier.width(68.dp).clip(RoundedCornerShape(10.dp))
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick?.let { l -> { haptics.performHapticFeedback(HapticFeedbackType.LongPress); l() } },
                onLongClickLabel = if (onLongClick != null) "Page menu" else null,
            )
            .padding(horizontal = 4.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(width = 58.dp, height = 72.dp).clip(RoundedCornerShape(6.dp)).background(BoardPaper.Paper)
                .border(if (current) 2.dp else 1.dp, if (current) BoardPaper.Accent else BoardPaper.Border, RoundedCornerShape(6.dp)),
        ) {
            Text(
                preview, color = BoardPaper.Ink, fontSize = 6.5.sp, lineHeight = 8.sp, overflow = TextOverflow.Clip,
                modifier = Modifier.padding(horizontal = 5.dp, vertical = 4.dp),
            )
            if (dot != null) Box(
                Modifier.align(Alignment.TopEnd).padding(3.dp).size(10.dp).clip(CircleShape).background(Color.White).padding(1.5.dp).clip(CircleShape).background(dot),
            )
            if (showMore) Text(
                "⋯", color = BoardPaper.Accent, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.BottomEnd).padding(2.dp).clip(RoundedCornerShape(6.dp)).background(BoardPaper.AccentSoft).padding(horizontal = 4.dp),
            )
        }
        Spacer(Modifier.height(3.dp))
        Text(
            label, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            color = if (current) BoardPaper.Accent else BoardPaper.Muted, fontWeight = if (current) FontWeight.Bold else FontWeight.Medium,
        )
    }
}

/**
 * The call's page strip under the text board (web: the board's page strip): thumbnails of every
 * page, the current one highlighted, a dot where the other person is, "+" for a new page; and, when
 * they are on another page, the "<name> is on page N" bar — Go there · Follow · Bring <name> here
 * (or "Following <name>" · Stop).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BoardPagesStrip(
    pages: BoardPagesState,
    /** The other person's first name ("Minghui"), null while nobody else is here. */
    otherName: String?,
    /** Their presence colour (the same as their caret). */
    otherColor: Color?,
    actions: BoardPageActions,
    modifier: Modifier = Modifier,
    onTick: () -> Unit = {},
) {
    var menuFor by rememberSaveable { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    val shownIndex = pages.pages.indexOfFirst { it.id == pages.shown }
    // Keep the current page in view (and the "+" once a new page lands at the end).
    LaunchedEffect(shownIndex, pages.pages.size) {
        if (shownIndex < 0) return@LaunchedEffect
        val visible = list.layoutInfo.visibleItemsInfo
        val fully = visible.filter { it.offset >= 0 && it.offset + it.size <= list.layoutInfo.viewportEndOffset }.map { it.index }
        if (shownIndex !in fully) list.animateScrollToItem(maxOf(0, shownIndex - 1))
    }
    Column(modifier.fillMaxWidth().background(BoardPaper.Surround).drawBehind { drawLine(BoardPaper.Border, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }) {
        val bar = otherName?.let { BoardPages.followBar(pages, it) }
        AnimatedVisibility(bar != null, enter = fadeIn() + slideInVertically { it / 2 }, exit = fadeOut() + slideOutVertically { it / 2 }) {
            val b = bar ?: return@AnimatedVisibility
            FlowRow(
                Modifier.fillMaxWidth().background(BoardPaper.AccentSoft).padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.Center,
            ) {
                Row(Modifier.heightIn(min = 44.dp).align(Alignment.CenterVertically), verticalAlignment = Alignment.CenterVertically) {
                    if (otherColor != null) Box(Modifier.size(8.dp).clip(CircleShape).background(otherColor))
                    Spacer(Modifier.width(6.dp))
                    Text(b.text, color = BoardPaper.Ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.width(4.dp))
                if (b.following) BarButton("Stop") { actions.onFollow(false); onTick() }
                else {
                    BarButton("Go there", primary = true) { actions.onGoThere(); onTick() }
                    BarButton("Follow") { actions.onFollow(true); onTick() }
                    BarButton("Bring $otherName here") { actions.onBringHere(); onTick() }
                }
            }
        }
        LazyRow(
            state = list,
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Top,
        ) {
            itemsIndexed(pages.pages, key = { _, p -> p.id }) { i, p ->
                val current = p.id == pages.shown
                PageThumb(
                    thumbLabel(i, p.title), p.preview, current,
                    Modifier.animateItem(),
                    dot = otherColor?.takeIf { pages.otherPage == p.id },
                    showMore = current,
                    onClick = { if (current) menuFor = p.id else { actions.onOpen(p.id); onTick() } },
                    onLongClick = { menuFor = p.id },
                )
            }
            item(key = "+") {
                Column(Modifier.width(68.dp).padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        Modifier.size(width = 58.dp, height = 72.dp).clip(RoundedCornerShape(6.dp))
                            .border(1.5.dp, BoardPaper.Border, RoundedCornerShape(6.dp))
                            .bouncyClickable { actions.onNew(); onTick() },
                        contentAlignment = Alignment.Center,
                    ) { Text("+", color = BoardPaper.Accent, fontSize = 26.sp, fontWeight = FontWeight.Light) }
                    Spacer(Modifier.height(3.dp))
                    Text("New", fontSize = 11.sp, color = BoardPaper.Muted)
                }
            }
        }
    }
    val target = menuFor?.let { id -> pages.pages.indexOfFirst { it.id == id }.takeIf { it >= 0 } }
    if (target != null) {
        val p = pages.pages[target]
        BoardPageSheet(
            index = target, title = p.title, onlyPage = pages.pages.size <= 1,
            onDismiss = { menuFor = null },
            onRename = { t -> actions.onRename(p.id, t); menuFor = null },
            onDuplicate = { actions.onDuplicate(p.id); menuFor = null },
            onDelete = { actions.onDelete(p.id); menuFor = null },
        )
    } else if (menuFor != null) menuFor = null
}

@Composable
private fun BarButton(label: String, primary: Boolean = false, onClick: () -> Unit) {
    Text(
        label, color = if (primary) Color.White else BoardPaper.Accent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.heightIn(min = 44.dp).padding(vertical = 4.dp).clip(RoundedCornerShape(999.dp))
            .background(if (primary) BoardPaper.Accent else BoardPaper.Paper)
            .border(1.dp, if (primary) BoardPaper.Accent else BoardPaper.ChipBorder, RoundedCornerShape(999.dp))
            .bouncyClickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 9.dp),
    )
}

/**
 * A page's menu: Rename (blank = "Page N"), Duplicate, Delete — confirmed, and not for the only
 * page. [initialConfirm] opens the delete confirmation at once (screenshots).
 */
@Composable
fun BoardPageSheet(
    index: Int,
    title: String?,
    onlyPage: Boolean,
    onDismiss: () -> Unit,
    onRename: (String?) -> Unit,
    onDuplicate: () -> Unit,
    onDelete: () -> Unit,
    initialConfirm: Boolean = false,
) {
    var name by rememberSaveable(index, title) { mutableStateOf(title.orEmpty()) }
    var confirm by rememberSaveable { mutableStateOf(initialConfirm) }
    val label = CallPages.pageLabel(index, title)
    // The confirmation replaces the sheet (Cancel brings it back).
    if (!confirm) LabBottomSheet(onDismiss = onDismiss, title = label) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                name, { name = it.take(CallPages.MAX_PAGE_TITLE * 2) },
                modifier = Modifier.weight(1f),
                singleLine = true,
                label = { Text("Name") },
                placeholder = { Text("Page ${index + 1}") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onRename(CallPages.sanitizePageTitle(name)) }),
            )
            PrimaryPill("Rename", Modifier.height(52.dp), enabled = CallPages.sanitizePageTitle(name) != CallPages.sanitizePageTitle(title)) { onRename(CallPages.sanitizePageTitle(name)) }
        }
        Text(
            "Leave it blank for “Page ${index + 1}”.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        Spacer(Modifier.height(8.dp))
        NavRow("⧉", "Duplicate", desc = "A copy right after this page — you go to it", onClick = onDuplicate)
        NavRow(
            "🗑️", "Delete", danger = true, enabled = !onlyPage,
            desc = if (onlyPage) "The board's last page can't be deleted" else "For both of you",
            onClick = if (onlyPage) null else ({ confirm = true }),
        )
    }
    if (confirm) ConfirmDialog(
        "Delete page ${index + 1}?", "Its text is removed for both of you.", "Delete",
        onConfirm = onDelete, onDismiss = { confirm = false }, danger = true,
    )
}

/** "Minghui brought you to page 3" over the call, for a few seconds. */
@Composable
fun BoardNoticePill(notice: BoardNotice?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    LaunchedEffect(notice?.id) {
        if (notice == null) return@LaunchedEffect
        kotlinx.coroutines.delay(4_000)
        onDismiss()
    }
    AnimatedVisibility(notice != null, modifier, enter = fadeIn() + slideInVertically { -it }, exit = fadeOut() + slideOutVertically { -it }) {
        val n = remember(notice?.id) { notice } ?: return@AnimatedVisibility
        Text(
            "📝 ${n.text}", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0xE61F2937)).bouncyClickable(onClick = onDismiss)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
}

/** The other person's presence colour (their caret's). */
fun presenceColorOf(userId: String?): Color? = userId?.takeIf { it.isNotBlank() }?.let { parseHex(dev.jeromeswannack.chineselearning.lab.core.calls.CallTextDoc.presenceColor(it)) }
