package dev.jeromeswannack.chineselearning.lab.ui.materials

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.MaterialToc
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDetailDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabModalSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** A material's Contents from its detail: the stored outline / slide titles, else one row per page (core MaterialToc). */
fun contentsOf(d: MaterialDetailDto, pageCount: Int = d.pages.size): MaterialToc.Contents =
    MaterialToc.contents(d.material.toc, pageCount, d.pages.map { MaterialToc.PageText(it.page_index, it.text) })

/** "material.contents_open" when the ☰ Contents list opens (where = call | viewer). */
fun trackContentsOpen(where: String, c: MaterialToc.Contents) =
    Analytics.track("material.contents_open", mapOf("where" to where, "source" to c.source.wire, "entries" to c.entries.size))

/**
 * A material's ☰ Contents (web components/materials/MaterialContents.tsx): the sections — or its pages by
 * their first line — with the one on show marked; a tap jumps there ([onJump]; in a call a page turn both
 * people follow) and closes the sheet.
 */
@Composable
fun MaterialContentsSheet(contents: MaterialToc.Contents, page: Int, where: String, onJump: (Int) -> Unit, onDismiss: () -> Unit) {
    val current = MaterialToc.currentIndex(contents.entries, page)
    val list = rememberLazyListState(initialFirstVisibleItemIndex = maxOf(0, current - 3))
    LabModalSheet(onDismiss) {
        Text(MaterialToc.CONTENTS_LABEL, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.padding(horizontal = 24.dp))
        if (contents.source == MaterialToc.Source.PAGES) Text(
            "No chapters in this file — its pages by their first line.", color = Lab.colors.muted, fontSize = 13.sp,
            modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 4.dp),
        )
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 16.dp).testTag("material-contents-list"), state = list) {
            itemsIndexed(contents.entries) { i, e ->
                val on = i == current
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(10.dp))
                        .background(if (on) Lab.colors.accentSoft else Color.Transparent)
                        .semantics { selected = on }
                        .bouncyClickable(role = Role.Button) {
                            Analytics.track("material.contents_jump", mapOf("where" to where, "source" to contents.source.wire))
                            onJump(e.page)
                            onDismiss()
                        }
                        .heightIn(min = 48.dp)
                        .padding(start = if (e.level > 0) 32.dp else 12.dp, end = 12.dp, top = 8.dp, bottom = 8.dp)
                        .testTag("material-contents-row"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        (if (on) "▸ " else "") + e.title,
                        color = if (on) Lab.colors.accent else Lab.colors.ink,
                        fontSize = if (e.level > 0) 15.sp else 16.sp,
                        fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                    )
                    Text("${e.page + 1}", color = Lab.colors.muted, fontSize = 13.sp)
                }
            }
        }
    }
}
