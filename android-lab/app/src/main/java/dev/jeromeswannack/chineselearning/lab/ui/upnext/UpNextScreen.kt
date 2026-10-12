package dev.jeromeswannack.chineselearning.lab.ui.upnext

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** One row of the list (core UpNext.statusLabel for [status]). */
data class UpNextRowUi(
    val noteId: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val deck: String,
    val status: String,
    val addedBy: String? = null,
)

/** A search result. [studied] = every card studied: it can't go on the list (⚡ instead, learner only). */
data class UpNextHitUi(
    val noteId: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val deck: String,
    val onList: Boolean = false,
    val studied: Boolean = false,
)

/** A word in today's ⚡ pocket (learner only). */
data class UpNextTodayUi(
    val noteId: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val deck: String,
    val from: String? = null,
    val canMoveToUpNext: Boolean = true,
)

data class UpNextUi(
    val title: String = "Up next",
    val intro: String = "Words you choose to learn next. They take the first of your daily new cards, in this order — nothing extra is added.",
    val loading: Boolean = false,
    val error: String? = null,
    val rows: List<UpNextRowUi> = emptyList(),
    val today: List<UpNextTodayUi> = emptyList(),
    val query: String = "",
    val hits: List<UpNextHitUi>? = null,
    val searching: Boolean = false,
    val searchPlaceholder: String = "Search your cards: 银行, yinhang, bank…",
    val emptyText: String = "Nothing chosen yet — search above to pick the words you want next.",
    /** The learner's own list: rows get ⚡ (study it today instead). */
    val learner: Boolean = true,
    /** Changes are off (the tutor offline) — why. */
    val readOnlyReason: String? = null,
    val toast: String? = null,
    val toastUndo: Boolean = false,
)

data class UpNextActions(
    val onBack: (() -> Unit)? = null,
    val onQuery: (String) -> Unit = {},
    /** [position]: "top", "bottom" or a 0-based Int (a drop). */
    val onAdd: (noteId: String, position: Any) -> Unit = { _, _ -> },
    val onReorder: (order: List<String>, how: String) -> Unit = { _, _ -> },
    val onRemove: (noteId: String) -> Unit = {},
    val onBolt: (noteId: String) -> Unit = {},
    val onBoltHit: (noteId: String) -> Unit = {},
    val onTodayToUpNext: (noteId: String) -> Unit = {},
    val onTodayClear: (noteId: String) -> Unit = {},
    val onUndo: () -> Unit = {},
    val onToastDone: () -> Unit = {},
    val onLift: () -> Unit = {},
    val onSlot: () -> Unit = {},
    val onRetry: () -> Unit = {},
)

private val Indigo = Color(0xFF4338CA)
private val IndigoSoft = Color(0xFFEEF2FF)
private val Amber = Color(0xFFB45309)

/**
 * The Up next screen (web pages/UpNextPage.tsx + components/upNext/UpNextBoard.tsx): ⚡ Today, then a
 * search to add words (＋ Top / ＋ Bottom, or press and hold a result and drag it into place), then
 * the ordered list (press and hold to move, ↑ to the top, ✕ to take one off — Undo).
 * [previewOrder] / [previewDrag] render a drag in screenshot tests.
 */
@Composable
fun UpNextScreen(ui: UpNextUi, actions: UpNextActions, previewOrder: List<String>? = null, previewDrag: String? = null) {
    val listState = rememberLazyListState()
    val ids = ui.rows.map { it.noteId }
    val readOnly = ui.readOnlyReason != null
    val draggable = if (readOnly) emptySet() else ui.hits.orEmpty().filter { !it.onList && !it.studied }.mapTo(HashSet()) { it.noteId }
    val drag = rememberUpNextDragState(
        listState, ids, draggable,
        onLift = actions.onLift, onSlot = actions.onSlot,
        onReorder = { actions.onReorder(it, "drag") },
        onDrop = { id, i -> actions.onAdd(id, i) },
    )
    val order = previewOrder ?: drag.order()
    val dragId = previewDrag ?: drag.dragId
    val rowsById = ui.rows.associateBy { it.noteId }
    val hitsById = ui.hits.orEmpty().associateBy { it.noteId }

    LaunchedEffect(ui.toast) {
        if (ui.toast != null) {
            kotlinx.coroutines.delay(6000)
            actions.onToastDone()
        }
    }

    LabScreenFrame {
        ScreenTitle(ui.title, onBack = actions.onBack)
        Box(Modifier.fillMaxSize()) {
            LazyColumn(
                Modifier.fillMaxSize().then(if (readOnly) Modifier else Modifier.upNextDrag(drag)).testTag("upnext-list"),
                state = listState,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item("intro") { Text(ui.intro, color = Lab.colors.muted, fontSize = 15.sp) }
                if (ui.error != null) item("error") { InlineNotice(ui.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRetry) }
                if (ui.readOnlyReason != null) item("readonly") { InlineNotice(ui.readOnlyReason, kind = NoticeKind.Offline) }

                if (ui.today.isNotEmpty()) {
                    item("today-head") { SectionTitle("⚡ Today", "${ui.today.size}", "First in today’s study, on top of the daily budget.") }
                    for (t in ui.today) item("today:${t.noteId}") { TodayRow(t, actions) }
                }

                if (!readOnly) {
                    item("search-head") { SectionTitle("＋ Add words", null, null) }
                    item("search") {
                        OutlinedTextField(
                            value = ui.query,
                            onValueChange = actions.onQuery,
                            modifier = Modifier.fillMaxWidth().testTag("upnext-search"),
                            singleLine = true,
                            placeholder = { Text(ui.searchPlaceholder, color = Lab.colors.muted) },
                        )
                    }
                    val hits = ui.hits
                    if (ui.query.isNotBlank()) {
                        when {
                            hits == null && ui.searching -> item("searching") { Text("Searching…", color = Lab.colors.muted) }
                            hits != null && hits.isEmpty() -> item("nohits") { Text("No card matches “${ui.query.trim()}”.", color = Lab.colors.muted) }
                        }
                        for (h in hits.orEmpty()) item(UpNextKeys.result(h.noteId)) { HitRow(h, lifted = dragId == h.noteId, learner = ui.learner, actions = actions) }
                        if (hits.orEmpty().any { !it.onList && !it.studied }) {
                            item("drag-tip") { Text("Tip: press and hold a word, then drag it into its place in the list.", color = Lab.colors.muted, fontSize = 14.sp) }
                        }
                    }
                }

                item(UpNextKeys.LIST_HEAD) {
                    SectionTitle(
                        "↑ Up next", "${ui.rows.size} ${if (ui.rows.size == 1) "word" else "words"}",
                        "Introduced first, in this order, from today’s new cards. Press and hold a word to move it.",
                    )
                }
                if (ui.loading && ui.rows.isEmpty()) item("loading") { LoadingState() }
                order.forEachIndexed { i, id ->
                    val row = rowsById[id]
                    val hit = if (row == null) hitsById[id] else null
                    if (row != null || hit != null) {
                        item(UpNextKeys.row(id)) {
                            val lifted = dragId == id && row != null
                            ListRow(
                                index = i,
                                row = row ?: UpNextRowUi(id, hit!!.hanzi, hit.pinyin, hit.english, hit.deck, "Drop it here"),
                                placeholder = row == null,
                                lifted = lifted,
                                offsetY = if (lifted && previewDrag == null) drag.dragOffsetY else 0f,
                                first = i == 0,
                                learner = ui.learner,
                                readOnly = readOnly,
                                actions = actions,
                                allIds = ids,
                            )
                        }
                    }
                }
                item(UpNextKeys.LIST_END) {
                    if (order.isEmpty() && !ui.loading) {
                        Box(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp)).padding(20.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(if (dragId != null) "Drop it here" else ui.emptyText, color = Lab.colors.muted) }
                    } else Spacer(Modifier.height(8.dp))
                }
            }
            if (ui.toast != null) {
                Row(
                    Modifier.align(Alignment.BottomCenter).padding(16.dp).shadow(8.dp, RoundedCornerShape(28.dp))
                        .clip(RoundedCornerShape(28.dp)).background(Color(0xFF1F2937)).padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp)
                        .testTag("upnext-toast"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(ui.toast, color = Color.White, fontSize = 15.sp, modifier = Modifier.weight(1f, fill = false))
                    if (ui.toastUndo) {
                        Spacer(Modifier.width(12.dp))
                        Box(
                            Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(Color(0xFFFBBF24)).clickable { actions.onUndo() }.padding(horizontal = 16.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text("Undo", color = Color(0xFF1F2937), fontWeight = FontWeight.Bold) }
                    } else Spacer(Modifier.width(12.dp))
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String, count: String?, hint: String?) {
    Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            if (count != null) Text(count, color = Lab.colors.muted, fontSize = 14.sp)
        }
        if (hint != null) Text(hint, color = Lab.colors.muted, fontSize = 14.sp)
    }
}

@Composable
private fun WordText(hanzi: String, pinyin: String, english: String, meta: String, modifier: Modifier = Modifier, metaExtra: String? = null) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(hanzi, fontSize = 21.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            Spacer(Modifier.width(8.dp))
            Text(pinyin, fontSize = 15.sp, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(english, fontSize = 15.sp, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row {
            Text(meta, fontSize = 13.sp, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (metaExtra != null) Text(" · $metaExtra", fontSize = 13.sp, color = Color(0xFF7C3AED), maxLines = 1)
        }
    }
}

@Composable
private fun IconAction(text: String, description: String, color: Color = Lab.colors.muted, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(text, fontSize = 19.sp, color = color) }
}

@Composable
private fun SmallPill(text: String, description: String, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(22.dp))
            .background(Lab.colors.card).bouncyClickable(onClick = onClick).padding(horizontal = 12.dp)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(text, fontSize = 15.sp, color = Lab.colors.ink) }
}

@Composable
private fun TodayRow(t: UpNextTodayUi, actions: UpNextActions) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFFFFFBEB)).border(1.dp, Color(0xFFFDE68A), RoundedCornerShape(12.dp))
            .padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        WordText(t.hanzi, t.pinyin, t.english, t.deck, Modifier.weight(1f), t.from?.let { "⚡ from $it" })
        if (t.canMoveToUpNext) SmallPill("↑ Up next", "Not today — introduce ${t.hanzi} next instead") { actions.onTodayToUpNext(t.noteId) }
        IconAction("✕", "Take ${t.hanzi} out of today") { actions.onTodayClear(t.noteId) }
    }
}

@Composable
private fun HitRow(h: UpNextHitUi, lifted: Boolean, learner: Boolean, actions: UpNextActions) {
    val scale by animateFloatAsState(if (lifted) 1.02f else 1f, label = "lift")
    Row(
        Modifier.fillMaxWidth().zIndex(if (lifted) 1f else 0f).graphicsLayer { scaleX = scale; scaleY = scale }
            .then(if (lifted) Modifier.shadow(10.dp, RoundedCornerShape(12.dp)) else Modifier)
            .clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
            .border(if (lifted) 2.dp else 1.dp, if (lifted) Indigo else Lab.colors.cardBorder, RoundedCornerShape(12.dp))
            .padding(start = 10.dp, end = 6.dp, top = 8.dp, bottom = 8.dp)
            .testTag("upnext-result"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!h.onList && !h.studied) Text("⠿", color = Lab.colors.muted, fontSize = 18.sp, modifier = Modifier.padding(end = 8.dp))
        WordText(h.hanzi, h.pinyin, h.english, if (h.studied) "${h.deck} · already studied" else h.deck, Modifier.weight(1f))
        when {
            h.onList -> Text("✓ Up next", color = Indigo, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 8.dp))
            h.studied -> if (learner) SmallPill("⚡ Today", "Study ${h.hanzi} today instead") { actions.onBoltHit(h.noteId) }
            else -> {
                SmallPill("＋ Top", "Add ${h.hanzi} at the top") { actions.onAdd(h.noteId, "top") }
                Spacer(Modifier.width(6.dp))
                SmallPill("＋ Bottom", "Add ${h.hanzi} at the bottom") { actions.onAdd(h.noteId, "bottom") }
            }
        }
    }
}

@Composable
private fun ListRow(
    index: Int,
    row: UpNextRowUi,
    placeholder: Boolean,
    lifted: Boolean,
    offsetY: Float,
    first: Boolean,
    learner: Boolean,
    readOnly: Boolean,
    actions: UpNextActions,
    allIds: List<String>,
) {
    val scale by animateFloatAsState(if (lifted) 1.03f else 1f, label = "lift")
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().zIndex(if (lifted) 1f else 0f)
            .graphicsLayer { translationY = offsetY; scaleX = scale; scaleY = scale }
            .then(if (lifted) Modifier.shadow(12.dp, shape) else Modifier)
            .clip(shape)
            .background(if (placeholder) IndigoSoft else Lab.colors.card)
            .border(if (placeholder || lifted) 2.dp else 1.dp, if (placeholder || lifted) Indigo else Lab.colors.cardBorder, shape)
            .padding(start = 10.dp, end = 4.dp, top = 8.dp, bottom = 8.dp)
            .testTag("upnext-row"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(IndigoSoft), contentAlignment = Alignment.Center) {
            Text("${index + 1}", color = Indigo, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
        Spacer(Modifier.width(10.dp))
        WordText(row.hanzi, row.pinyin, row.english, "${row.deck} · ${row.status}", Modifier.weight(1f), row.addedBy?.let { "added by $it" })
        if (!placeholder && !readOnly) {
            if (learner) IconAction("⚡", "Study ${row.hanzi} today instead", Amber) { actions.onBolt(row.noteId) }
            if (!first) IconAction("↑", "Move ${row.hanzi} to the top", Lab.colors.ink) { actions.onReorder(listOf(row.noteId) + allIds.filter { it != row.noteId }, "top") }
            IconAction("✕", "Take ${row.hanzi} off Up next") { actions.onRemove(row.noteId) }
        }
    }
}
