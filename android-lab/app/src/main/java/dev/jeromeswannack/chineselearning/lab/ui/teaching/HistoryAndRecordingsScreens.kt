package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.DeckRefDto
import dev.jeromeswannack.chineselearning.lab.data.api.HistoryEventDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightRangeDto
import dev.jeromeswannack.chineselearning.lab.data.api.InsightRecordingDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import java.time.Instant

// ---------------- pure rules (unit-tested) ----------------

/** One word in "By word" (web: StudentHistoryPage WordList). */
data class WordGroup(val note: HistoryEventDto, val events: List<HistoryEventDto>) {
    val forgot: Int get() = events.count { it.rating == 0 }
    /** Distinct wrong typed answers, in order. */
    val wrong: List<String> get() = events.mapNotNull { e -> e.user_answer?.takeIf { !TutorPageFormat.answersMatch(it, note.hanzi) }?.trim() }.distinct()
}

/** Groups loaded attempts by word, most-forgotten first, then most attempts. */
fun groupByWord(events: List<HistoryEventDto>): List<WordGroup> {
    val map = LinkedHashMap<String, MutableList<HistoryEventDto>>()
    for (e in events) map.getOrPut(e.note_id) { mutableListOf() } += e
    return map.values.map { WordGroup(it.first(), it) }
        .sortedWith(compareByDescending<WordGroup> { it.forgot }.thenByDescending { it.events.size })
}

enum class RecordingFilter { ALL, UNLISTENED, NEEDS_WORK }

/** Unlistened first, then needs work, then listened; newest first within each (web: InboxBody). */
fun sortRecordings(list: List<InsightRecordingDto>): List<InsightRecordingDto> {
    fun order(r: InsightRecordingDto) = when (r.mark?.status) { null -> 0; "needs_work" -> 1; else -> 2 }
    return list.sortedWith(compareBy<InsightRecordingDto> { order(it) }.thenByDescending { TeachingFormat.parse(it.reviewed_at)?.toEpochMilli() ?: 0L })
}

fun filterRecordings(list: List<InsightRecordingDto>, f: RecordingFilter): List<InsightRecordingDto> = when (f) {
    RecordingFilter.ALL -> list
    RecordingFilter.UNLISTENED -> list.filter { it.mark == null }
    RecordingFilter.NEEDS_WORK -> list.filter { it.mark?.status == "needs_work" }
}

// ---------------- history ----------------

/** The history range choices; "lesson" = no from, the server anchors it. */
val HISTORY_RANGES = listOf("lesson" to "Since last lesson", "7d" to "Last 7 days", "30d" to "Last 30 days", "90d" to "Last 90 days", "365d" to "Last year")

data class HistoryFilters(val q: String = "", val deckId: String? = null, val cardType: String? = null, val rating: Int? = null, val range: String = "30d") {
    fun from(): String? = if (range == "lesson") null else TutorPageFormat.daysAgo(range.removeSuffix("d").toInt())
}

data class HistoryUi(
    val relId: String,
    val studentName: String,
    val filters: HistoryFilters = HistoryFilters(),
    val events: List<HistoryEventDto> = emptyList(),
    val decks: List<DeckRefDto> = emptyList(),
    val range: InsightRangeDto? = null,
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val hasMore: Boolean = false,
    val error: String? = null,
    val byWord: Boolean = false,
    val playingKey: String? = null,
)

data class HistoryActions(
    val back: () -> Unit = {},
    val open: (String) -> Unit = {},
    val setFilters: (HistoryFilters) -> Unit = {},
    val setByWord: (Boolean) -> Unit = {},
    val loadMore: () -> Unit = {},
    val play: (String) -> Unit = {},
    val retry: () -> Unit = {},
)

/** Every attempt, newest first, filters, infinite scroll, "By word" (web: StudentHistoryPage.tsx). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HistoryScreen(ui: HistoryUi, actions: HistoryActions, now: Instant = Instant.now()) {
    val listState = rememberLazyListState()
    var sheet by remember { mutableStateOf<String?>(null) }
    val nearEnd by remember { derivedStateOf { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= listState.layoutInfo.totalItemsCount - 4 } ?: false } }
    LaunchedEffect(nearEnd, ui.hasMore, ui.loadingMore) { if (nearEnd && ui.hasMore && !ui.loadingMore && !ui.byWord) actions.loadMore() }
    val f = ui.filters
    LabScreen("History", onBack = actions.back, subtitle = ui.studentName, listState = listState, spacing = 8.dp) {
        item { TutorPageTabs(ui.relId, "history", actions.open) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(f.q, { actions.setFilters(f.copy(q = it)) }, Modifier.fillMaxWidth(), placeholder = { Text("Search hanzi, pinyin or English") }, singleLine = true)
                ChipRow {
                    LabChip(ui.decks.firstOrNull { it.id == f.deckId }?.name ?: "All decks", selected = f.deckId != null) { sheet = "deck" }
                    LabChip(f.cardType?.let { TutorPageFormat.CARD_TYPE_LONG[it] } ?: "All card types", selected = f.cardType != null) { sheet = "type" }
                    LabChip(f.rating?.let { TutorPageFormat.RATING_LABELS[it] } ?: "Any rating", selected = f.rating != null) { sheet = "rating" }
                    LabChip(HISTORY_RANGES.first { it.first == f.range }.second, selected = true) { sheet = "range" }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MutedLine(ui.range?.let { "${TutorPageFormat.dateTime(it.from, now)} → ${TutorPageFormat.dateTime(it.to, now)} · ${ui.events.size} loaded" } ?: "", Modifier.weight(1f))
                    LabChip("By attempt", selected = !ui.byWord) { actions.setByWord(false) }
                    LabChip("By word", selected = ui.byWord) { actions.setByWord(true) }
                }
            }
        }
        if (ui.error != null) item { InlineNotice(ui.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.retry) }
        if (ui.loading && ui.events.isEmpty()) item { LoadingState(text = "Loading history...") }
        else if (!ui.loading && ui.events.isEmpty() && ui.error == null) item { TeachCard { MutedLine("No attempts match these filters.") } }
        if (ui.byWord) {
            items(groupByWord(ui.events), key = { it.note.note_id }) { g -> WordGroupRow(g, ui.playingKey, actions.play, now) }
        } else {
            items(ui.events, key = { it.event_id }) { ev ->
                TeachCard {
                    WordHead(ev.hanzi, ev.pinyin, ev.english)
                    AttemptLine(ev.reviewed_at, ev.card_type, ev.rating, ev.user_answer, ev.hanzi, ev.time_spent_ms, ev.recording_url, ui.playingKey, actions.play, now)
                }
            }
        }
        item {
            MutedLine(
                when {
                    ui.loadingMore -> "Loading more…"
                    ui.hasMore && ui.byWord -> "Grouping what has loaded so far — switch to By attempt to load more."
                    ui.hasMore -> "Scroll for more"
                    ui.events.isNotEmpty() -> "That is everything in this range."
                    else -> ""
                },
                Modifier.fillMaxWidth().padding(vertical = 12.dp),
            )
        }
    }
    when (sheet) {
        "deck" -> ChoiceSheet("Deck", listOf<Pair<String?, String>>(null to "All decks") + ui.decks.map { it.id to it.name }, f.deckId, { sheet = null }) { actions.setFilters(f.copy(deckId = it)) }
        "type" -> ChoiceSheet("Card type", listOf<Pair<String?, String>>(null to "All card types") + TutorPageFormat.CARD_TYPE_LONG.entries.map { it.key to it.value }, f.cardType, { sheet = null }) { actions.setFilters(f.copy(cardType = it)) }
        "rating" -> ChoiceSheet("Rating", listOf<Pair<String?, String>>(null to "Any rating") + TutorPageFormat.RATING_LABELS.mapIndexed { i, l -> i.toString() to l }, f.rating?.toString(), { sheet = null }) { actions.setFilters(f.copy(rating = it?.toInt())) }
        "range" -> ChoiceSheet("Range", HISTORY_RANGES.map { (k, v) -> k to v }, f.range, { sheet = null }) { actions.setFilters(f.copy(range = it ?: "30d")) }
    }
}

@Composable
private fun <K> ChoiceSheet(title: String, options: List<Pair<K, String>>, selected: K, onDismiss: () -> Unit, onPick: (K) -> Unit) {
    LabBottomSheet(onDismiss = onDismiss, title = title) {
        options.forEach { (k, label) -> NavRow(if (k == selected) "✓" else "", label, onClick = { onDismiss(); onPick(k) }, trailing = {}) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WordGroupRow(g: WordGroup, playing: String?, play: (String) -> Unit, now: Instant) {
    var open by remember { mutableStateOf(false) }
    TeachCard(Modifier.animateContentSize().bouncyClickable(pressedScale = 0.99f) { open = !open }) {
        WordHead(g.note.hanzi, g.note.pinyin, g.note.english) {
            TeachPill(if (g.forgot > 0) "forgot ${g.forgot}/${g.events.size}" else "${g.events.size}/${g.events.size} right", if (g.forgot > 0) PillTone.Flags else PillTone.Ok)
        }
        if (g.wrong.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { g.wrong.take(5).forEach { WrongChip(it) } }
        if (open) {
            MutedLine(g.note.deck_name)
            g.events.forEach { ev -> AttemptLine(ev.reviewed_at, ev.card_type, ev.rating, ev.user_answer, ev.hanzi, ev.time_spent_ms, ev.recording_url, playing, play, now) }
        }
    }
}

// ---------------- recordings inbox ----------------

val RECORDING_RANGES = listOf("lesson" to "Since last lesson", "30d" to "Last 30 days", "90d" to "Last 90 days", "365d" to "Last year")

data class RecordingsUi(
    val relId: String,
    val studentName: String,
    val range: String = "30d",
    val filter: RecordingFilter = RecordingFilter.ALL,
    val recordings: List<InsightRecordingDto>? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val offline: Boolean = false,
    val playingKey: String? = null,
    /** Event ids with a mark being saved. */
    val saving: Set<String> = emptySet(),
    val markError: String? = null,
)

data class RecordingsActions(
    val back: () -> Unit = {},
    val open: (String) -> Unit = {},
    val setRange: (String) -> Unit = {},
    val setFilter: (RecordingFilter) -> Unit = {},
    val play: (String) -> Unit = {},
    /** status null = clear the mark. */
    val mark: (InsightRecordingDto, String?, String?) -> Unit = { _, _, _ -> },
    val retry: () -> Unit = {},
)

/** Recordings inbox with Listened / Needs work + a note (web: RecordingsInboxPage.tsx). */
@Composable
fun RecordingsScreen(ui: RecordingsUi, actions: RecordingsActions, now: Instant = Instant.now()) {
    var rangeSheet by remember { mutableStateOf(false) }
    val all = ui.recordings.orEmpty()
    val visible = filterRecordings(sortRecordings(all), ui.filter)
    LabScreen("Recordings", onBack = actions.back, subtitle = ui.studentName, spacing = 10.dp) {
        item { TutorPageTabs(ui.relId, "recordings", actions.open) }
        item {
            ChipRow {
                LabChip("All (${all.size})", selected = ui.filter == RecordingFilter.ALL) { actions.setFilter(RecordingFilter.ALL) }
                LabChip("Unlistened (${all.count { it.mark == null }})", selected = ui.filter == RecordingFilter.UNLISTENED) { actions.setFilter(RecordingFilter.UNLISTENED) }
                LabChip("Needs work (${all.count { it.mark?.status == "needs_work" }})", selected = ui.filter == RecordingFilter.NEEDS_WORK) { actions.setFilter(RecordingFilter.NEEDS_WORK) }
                LabChip(RECORDING_RANGES.first { it.first == ui.range }.second + " ▾") { rangeSheet = true }
            }
        }
        when {
            ui.recordings == null && ui.loading -> item { LoadingState(text = "Loading recordings...") }
            ui.error != null -> item { InlineNotice(ui.error, kind = if (ui.offline) NoticeKind.Offline else NoticeKind.Error, actionLabel = "Retry", onAction = actions.retry) }
        }
        ui.markError?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }
        if (ui.recordings != null && visible.isEmpty()) item {
            TeachCard { MutedLine(if (all.isEmpty()) "No recordings in this period. Recordings are made on the \"Hanzi → meaning\" card when the student taps the microphone." else "Nothing here for this filter.") }
        }
        items(visible, key = { it.event_id }) { r -> InboxRow(r, ui.playingKey == r.recording_url, r.event_id in ui.saving, actions, now) }
    }
    if (rangeSheet) ChoiceSheet("Range", RECORDING_RANGES, ui.range, { rangeSheet = false }) { actions.setRange(it) }
}

@Composable
private fun InboxRow(r: InsightRecordingDto, playing: Boolean, saving: Boolean, actions: RecordingsActions, now: Instant) {
    var showComment by remember { mutableStateOf(false) }
    var comment by remember(r.mark?.comment) { mutableStateOf(r.mark?.comment ?: "") }
    val status = r.mark?.status
    val edge = when (status) { null -> Palette.Secondary; "needs_work" -> Palette.Hard; else -> Color.Transparent }
    TeachCard(Modifier.animateContentSize().border(2.dp, edge.copy(alpha = if (status == "listened") 0f else 0.5f), RoundedCornerShape(20.dp))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RecordingButton(r.recording_url, playing, actions.play)
            androidx.compose.foundation.layout.Spacer(Modifier.padding(start = 10.dp))
            Column(Modifier.weight(1f)) { WordHead(r.note.hanzi, r.note.pinyin, r.note.english) { RatingDot(r.rating) } }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CardTypeChip(r.card_type)
            MutedLine("${TutorPageFormat.dateTime(r.reviewed_at, now)} · ${r.note.deck_name ?: ""}")
        }
        if (!r.mark?.comment.isNullOrBlank() && !showComment) {
            Text(r.mark!!.comment!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.Hard.copy(alpha = 0.08f)).padding(10.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MarkButton("✓ Listened", status == "listened", Palette.Good, !saving, Modifier.weight(1f)) { actions.mark(r, if (status == "listened") null else "listened", r.mark?.comment) }
            MarkButton("⚠ Needs work", status == "needs_work", Palette.Hard, !saving, Modifier.weight(1.3f)) { actions.mark(r, if (status == "needs_work") null else "needs_work", r.mark?.comment) }
            MarkButton(if (!r.mark?.comment.isNullOrBlank()) "Edit note" else "+ Note", false, Lab.colors.accent, true, Modifier.weight(0.9f)) { showComment = !showComment }
        }
        if (showComment) {
            OutlinedTextField(comment, { comment = it }, Modifier.fillMaxWidth(), minLines = 2, placeholder = { Text("What to tell them — e.g. second tone sounds like fourth") })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TeachButton("Save note", Modifier.weight(1f), primary = true, enabled = !saving) { actions.mark(r, status ?: "needs_work", comment.trim().ifEmpty { null }); showComment = false }
                TeachButton("Cancel", Modifier.weight(1f)) { showComment = false }
            }
        }
    }
}

@Composable
private fun MarkButton(label: String, active: Boolean, color: Color, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Text(
        label, color = if (active) Color.White else color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1,
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        modifier = modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).bouncyClickable(enabled, 0.94f, onClick = onClick)
            .background(if (active) color else color.copy(alpha = 0.1f)).padding(vertical = 12.dp, horizontal = 2.dp),
    )
}
