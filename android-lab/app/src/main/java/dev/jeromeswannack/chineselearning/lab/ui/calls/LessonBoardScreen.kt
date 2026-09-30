package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallPages
import dev.jeromeswannack.chineselearning.lab.data.api.BoardPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.relationshipBoardPages
import dev.jeromeswannack.chineselearning.lab.data.calls.BoardPagesStore
import dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class LessonBoardActions(
    val onBack: () -> Unit = {},
    val onCopy: (String) -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onTick: () -> Unit = {},
)

/** "Lesson board · 7 pages" (one page: "1 page"). */
fun lessonBoardTitle(n: Int): String = "Lesson board · $n ${if (n == 1) "page" else "pages"}"

/** The page shown when none is picked: the newest one. */
fun newestPage(pages: List<BoardPageDto>): BoardPageDto? = pages.maxWithOrNull(compareBy<BoardPageDto> { it.created_at }.thenBy { it.number })

private val DAY = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)

/**
 * `/connections/:relId/board` — the relationship's lesson board outside a call (web: the Lesson
 * board page): the newest page's full text large on paper (selectable), every page in the strip
 * at the bottom, Copy text. Read-only by design: the board is edited in a call, where the room
 * merges both people's typing. Cache-first ([BoardPagesStore]) so past pages open offline.
 */
@Composable
fun LessonBoardScreen(
    pages: Loadable<List<BoardPageDto>>,
    otherName: String?,
    actions: LessonBoardActions,
    initialSelected: String? = null,
    zone: ZoneId = ZoneId.systemDefault(),
) {
    val list = pages.data.orEmpty()
    var picked by rememberSaveable { mutableStateOf(initialSelected) }
    val selected = list.firstOrNull { it.id == picked } ?: newestPage(list)
    val selIndex = list.indexOf(selected)
    LabScreenFrame {
        // A compact title row: "Lesson board · 12 pages" must fit beside Copy text on the folded phone.
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = 4.dp, end = 8.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.IconButton(onClick = actions.onBack) {
                androidx.compose.material3.Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Lab.colors.ink)
            }
            Column(Modifier.weight(1f).padding(start = 4.dp)) {
                Text(
                    if (pages.data == null) "Lesson board" else lessonBoardTitle(list.size),
                    style = androidx.compose.material3.MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                    color = Lab.colors.ink, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
                if (otherName != null) Text("With $otherName", style = androidx.compose.material3.MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1)
            }
            if (selected != null && selected.text.isNotBlank()) Text(
                "Copy text", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                modifier = Modifier.clip(RoundedCornerShape(12.dp)).bouncyClickable { actions.onCopy(selected.text) }.padding(horizontal = 12.dp, vertical = 12.dp),
            )
        }
        when {
            pages.data == null && pages.loading -> LoadingState(text = "Loading the board…")
            pages.data == null && pages.offline -> EmptyState("📴", "You're offline", body = "This board hasn't been downloaded to this phone yet.", actionLabel = "Try again", onAction = actions.onRefresh)
            pages.data == null -> ErrorState(pages.error ?: "Something went wrong.", onRetry = actions.onRefresh)
            list.isEmpty() -> EmptyState("📝", "Nothing written on the board yet", body = "It fills up in your video lessons.")
            else -> Column(Modifier.fillMaxSize()) {
                if (pages.offline) OfflineNotice(Modifier.padding(horizontal = 16.dp), updatedAt = pages.updatedAt)
                else if (pages.error != null) InlineNotice(pages.error, Modifier.padding(horizontal = 16.dp), kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh)
                val page = selected!!
                Column(
                    Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
                        .clip(RoundedCornerShape(16.dp)).background(BoardPaper.Paper).border(1.dp, BoardPaper.Border, RoundedCornerShape(16.dp)),
                ) {
                    Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(CallPages.pageLabel(selIndex, page.title), color = BoardPaper.Ink, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.weight(1f))
                        if (page.updated_at > 0) Text(DAY.format(Instant.ofEpochMilli(page.updated_at).atZone(zone)), color = BoardPaper.Muted, fontSize = 13.sp)
                    }
                    val scroll = remember(page.id) { androidx.compose.foundation.ScrollState(0) }
                    Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(horizontal = 18.dp, vertical = 10.dp)) {
                        if (page.text.isBlank()) Text("This page is empty.", color = BoardPaper.Muted, fontSize = 17.sp)
                        else SelectionContainer { Text(page.text, color = BoardPaper.Ink, fontSize = 21.sp, lineHeight = 33.sp) }
                    }
                }
                val strip = rememberLazyListState()
                LaunchedEffect(Unit) { if (selIndex > 0) strip.scrollToItem(maxOf(0, selIndex - 1)) }
                LazyRow(
                    state = strip,
                    modifier = Modifier.fillMaxWidth().background(BoardPaper.Surround)
                        .drawBehind { drawLine(BoardPaper.Border, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    itemsIndexed(list, key = { _, p -> p.id }) { i, p ->
                        PageThumb(
                            thumbLabel(i, p.title), p.text.take(140), current = p.id == page.id,
                            onClick = { picked = p.id; actions.onTick() },
                        )
                    }
                }
            }
        }
    }
}

class LessonBoardViewModel(app: LabApp, relId: String) : ViewModel() {
    val pages: CachedResource<List<BoardPageDto>> = app.cachedResource(viewModelScope, BoardPagesStore.key(relId), BoardPagesStore.KIND) { relationshipBoardPages(relId) }

    class Factory(private val app: LabApp, private val relId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = LessonBoardViewModel(app, relId) as T
    }
}

/** How many board pages the relationship has on this phone (the "📝 Lesson board · N pages" row; 0 = hide it). */
@Composable
fun lessonBoardPageCount(app: LabApp, relId: String): Int {
    val flow = remember(relId) { app.cache.observe<List<BoardPageDto>>(BoardPagesStore.key(relId)) }
    val pages by flow.collectAsState(null)
    return pages?.size ?: 0
}
