package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import dev.jeromeswannack.chineselearning.lab.core.DeckQueue
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.ui.cards.Field
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

data class DecksActions(
    val onQuery: (String) -> Unit = {},
    val onOpenDeck: (String) -> Unit = {},
    val onStudy: (String) -> Unit = {},
    val onAddMore: (String) -> Unit = {},
    val onMove: (String, DeckQueue.Move) -> Unit = { _, _ -> },
    val onCommitOrder: (List<String>) -> Unit = {},
    val onNewDeck: () -> Unit = {},
    val onGenerate: () -> Unit = {},
    val onAnalyze: () -> Unit = {},
    val onStarter: () -> Unit = {},
    val onSettings: () -> Unit = {},
    val onEditNote: (String) -> Unit = {},
    val onDismissNotice: () -> Unit = {},
    val onLift: () -> Unit = {},
    val onSlot: () -> Unit = {},
)

/**
 * The Decks tab (web: DecksPage.tsx): a search field over every card on the phone, then the
 * deck queue — #N badge with a move menu, press-and-hold to drag, due counts in the queue
 * colours, Study / +10 More / Done ✓ — and New deck · Generate · Analyze.
 *
 * [liftedPreview] renders one deck lifted as if mid-drag (screenshots only).
 */
@Composable
fun DecksTabScreen(
    ui: DecksUi,
    actions: DecksActions,
    listState: LazyListState = rememberLazyListState(),
    liftedPreview: String? = null,
) {
    val ids = ui.decks.map { it.id }
    val drag = rememberDragReorderState(listState, ids, onLift = actions.onLift, onSlot = actions.onSlot, onCommit = actions.onCommitOrder)
    val order = drag.order()
    val byId = ui.decks.associateBy { it.id }
    val searching = ui.search != null

    LabScreenFrame {
        ScreenTitle("Decks", subtitle = if (ui.decks.isEmpty()) null else "${ui.decks.size} decks · studied top to bottom")
        LazyColumn(
            Modifier.fillMaxSize().dragReorderList(drag),
            state = listState,
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "search") { SearchField(ui.query, actions.onQuery) }
            ui.notice?.let { n ->
                item(key = "notice") {
                    InlineNotice(n, kind = if (ui.noticeIsError) NoticeKind.Error else NoticeKind.Info, actionLabel = "OK", onAction = actions.onDismissNotice)
                }
            }
            when {
                searching -> searchResults(ui, actions)
                !ui.loaded -> item(key = "loading") { LoadingState() }
                ui.decks.isEmpty() -> item(key = "empty") {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        EmptyState("📖", "No decks yet", body = "Create your first deck, start with 15 everyday words, or let Claude write one.", actionLabel = "Create deck", onAction = actions.onNewDeck)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            SecondaryPill("🌱 Starter deck", enabled = !ui.busy && ui.online) { actions.onStarter() }
                            SecondaryPill("✨ Generate") { actions.onGenerate() }
                        }
                    }
                }
                else -> {
                    item(key = "caption") { QueueCaption(ui.newPerDay, actions.onSettings) }
                    items(order, key = { it }) { id ->
                        val deck = byId[id] ?: return@items
                        val lifted = drag.dragId == id || liftedPreview == id
                        val position = order.indexOf(id) + 1
                        DeckQueueCard(
                            deck = deck,
                            position = position,
                            total = order.size,
                            lifted = lifted,
                            actions = actions,
                            modifier = Modifier
                                .zIndex(if (lifted) 1f else 0f)
                                .graphicsLayer { translationY = if (drag.dragId == id) drag.dragOffsetY else 0f }
                                .then(if (drag.dragId == id) Modifier else Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))),
                        )
                    }
                    item(key = "actions") {
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            PrimaryPill("+ New deck", Modifier.weight(1f).height(52.dp)) { actions.onNewDeck() }
                            SecondaryPill("✨ Generate", Modifier.weight(1f)) { actions.onGenerate() }
                            SecondaryPill("Analyze", Modifier.weight(0.8f)) { actions.onAnalyze() }
                        }
                    }
                }
            }
        }
    }
}


@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit) {
    OutlinedTextField(
        value = query,
        onValueChange = onQuery,
        placeholder = { Text("Search your cards… (hanzi, pinyin, english)", color = Lab.colors.muted) },
        leadingIcon = { Text("🔍", fontSize = 16.sp) },
        trailingIcon = if (query.isNotEmpty()) {
            { Text("✕", color = Lab.colors.muted, modifier = Modifier.clip(CircleShape).clickable { onQuery("") }.padding(12.dp)) }
        } else null,
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        shape = RoundedCornerShape(16.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Lab.colors.accent,
            unfocusedBorderColor = Lab.colors.cardBorder,
            focusedContainerColor = Lab.colors.card,
            unfocusedContainerColor = Lab.colors.card,
            cursorColor = Lab.colors.accent,
            focusedTextColor = Lab.colors.ink,
            unfocusedTextColor = Lab.colors.ink,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun QueueCaption(newPerDay: Int, onSettings: () -> Unit) {
    val text = buildAnnotatedString {
        append("Studied in this order: $newPerDay new ${if (newPerDay == 1) "word" else "words"} a day come from the top deck down (")
        withStyle(SpanStyle(color = Lab.colors.accent)) { append("change") }
        append("). ")
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("Press and hold a deck to drag it") }
        append(", or tap its number to move it.")
    }
    Text(text, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.clickable(onClick = onSettings).padding(vertical = 2.dp))
}

/** The web's DeckCard, as a full-width row. */
@Composable
fun DeckQueueCard(deck: DeckCardUi, position: Int, total: Int, lifted: Boolean, actions: DecksActions, modifier: Modifier = Modifier) {
    val scale by animateFloatAsState(if (lifted) 1.03f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "lift")
    val elevation by animateDpAsState(if (lifted) 14.dp else 0.dp, label = "lift-shadow")
    Column(
        modifier
            .fillMaxWidth()
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .shadow(elevation, RoundedCornerShape(18.dp))
            .clip(RoundedCornerShape(18.dp))
            .background(Lab.colors.card)
            .border(if (lifted) 2.dp else 0.dp, if (lifted) Lab.colors.accent else Color.Transparent, RoundedCornerShape(18.dp))
            .bouncyClickable(pressedScale = 0.985f) { actions.onOpenDeck(deck.id) }
            .padding(start = 16.dp, end = 10.dp, top = 12.dp, bottom = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(deck.name, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Text("${deck.noteCount} words", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    if (deck.totalCards > 0) {
                        Spacer(Modifier.width(8.dp))
                        MasteryBar(deck.totalCards, deck.mastered, deck.learning, Modifier.weight(1f))
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            QueueBadge(position, total) { to -> actions.onMove(deck.id, to) }
        }
        HorizontalDivider(Modifier.padding(top = 10.dp, bottom = 6.dp, end = 6.dp), color = Lab.colors.faint)
        Row(verticalAlignment = Alignment.CenterVertically) {
            QueueCountsText(deck.counts, Modifier.weight(1f))
            when {
                deck.counts.total > 0 -> SmallPill("Study (${deck.counts.total})", filled = true) { actions.onStudy(deck.id) }
                deck.hasMoreNew -> SmallPill("+10 More", filled = false) { actions.onAddMore(deck.id) }
                else -> Text("Done ✓", style = MaterialTheme.typography.labelMedium, color = Palette.Good, modifier = Modifier.padding(end = 8.dp))
            }
        }
    }
}

/** new + secondary + learning + review, in the web's queue colours. */
@Composable
fun QueueCountsText(c: QueueCounts, modifier: Modifier = Modifier) {
    val plus = SpanStyle(color = Lab.colors.muted)
    val text = buildAnnotatedString {
        withStyle(SpanStyle(color = Palette.New, fontWeight = FontWeight.Bold)) { append("${c.new}") }
        withStyle(plus) { append(" + ") }
        withStyle(SpanStyle(color = Palette.Secondary, fontWeight = FontWeight.Bold)) { append("${c.secondaryNew}") }
        withStyle(plus) { append(" + ") }
        withStyle(SpanStyle(color = Palette.Hard, fontWeight = FontWeight.Bold)) { append("${c.learning}") }
        withStyle(plus) { append(" + ") }
        withStyle(SpanStyle(color = Palette.Good, fontWeight = FontWeight.Bold)) { append("${c.review}") }
    }
    Text(text, fontSize = 15.sp, modifier = modifier)
}

@Composable
fun MasteryBar(total: Int, mastered: Int, learning: Int, modifier: Modifier = Modifier) {
    val m = mastered.toFloat() / total
    val l = learning.toFloat() / total
    Row(modifier.height(5.dp).clip(RoundedCornerShape(3.dp)).background(Lab.colors.faint)) {
        if (m > 0) Box(Modifier.weight(m).height(5.dp).background(Palette.Good))
        if (l > 0) Box(Modifier.weight(l).height(5.dp).background(Palette.Hard))
        if (1f - m - l > 0.0001f) Box(Modifier.weight(1f - m - l).height(5.dp))
    }
}

@Composable
private fun SmallPill(label: String, filled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (filled) Color.White else Lab.colors.accent,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = Modifier
            .heightIn(min = 40.dp)
            .bouncyClickable(pressedScale = 0.93f, onClick = onClick)
            .clip(RoundedCornerShape(14.dp))
            .background(if (filled) Lab.colors.accent else Lab.colors.accentSoft)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

/** "#N" with Move to top / up / down / bottom (the web's QueuePositionMenu). */
@Composable
fun QueueBadge(position: Int, total: Int, label: String = "the queue", onMove: (DeckQueue.Move) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val first = position == 1
    Box {
        Text(
            "#$position",
            color = if (first) Color(0xFFB91C1C) else Lab.colors.muted,
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
            modifier = Modifier
                .heightIn(min = 44.dp)
                .clip(RoundedCornerShape(50))
                .clickable { open = true }
                .padding(horizontal = 4.dp, vertical = 10.dp)
                .clip(RoundedCornerShape(50))
                .background(if (first) Color(0xFFFEE2E2) else Lab.colors.faint)
                .padding(horizontal = 9.dp, vertical = 3.dp),
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Text(
                if (first) "Studied first" else "$position of $total in $label",
                style = MaterialTheme.typography.labelMedium,
                color = Lab.colors.muted,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
            for ((to, text) in listOf(DeckQueue.Move.TOP to "⤒ Move to top", DeckQueue.Move.UP to "↑ Move up", DeckQueue.Move.DOWN to "↓ Move down", DeckQueue.Move.BOTTOM to "⤓ Move to bottom")) {
                val disabled = if (to == DeckQueue.Move.TOP || to == DeckQueue.Move.UP) first else position == total
                DropdownMenuItem(text = { Text(text) }, enabled = !disabled, onClick = { open = false; onMove(to) })
            }
        }
    }
}

// ---------------- search results ----------------

private fun androidx.compose.foundation.lazy.LazyListScope.searchResults(ui: DecksUi, actions: DecksActions) {
    val s = ui.search ?: return
    item(key = "search-count") {
        Text(
            if (s.total > DecksViewModel.MAX_RESULTS) "First ${DecksViewModel.MAX_RESULTS} of ${s.total} results" else "${s.total} result${if (s.total != 1) "s" else ""}",
            style = MaterialTheme.typography.labelLarge,
            color = Lab.colors.muted,
        )
    }
    if (s.results.isEmpty()) {
        val server = s.server
        item(key = "search-empty") {
            val text = when {
                server?.loading == true -> "Nothing on this device — checking the server…"
                server != null && server.hits.isNotEmpty() -> buildString {
                    val n = server.hits.size
                    append("Not on this device yet, but the server has $n${if (n == DecksViewModel.SERVER_LIMIT) "+" else ""} match${if (n == 1) "" else "es"} for \"${s.query.trim()}\"")
                    if (s.localNotes < server.totalNotes) append(" (this device has ${s.localNotes} of your ${server.totalNotes} cards — More → Full resync brings the rest down)")
                    append(":")
                }
                else -> "No cards found matching \"${s.query.trim()}\"" + if (server?.failed == true) " (the server could not be reached)" else if (!ui.online) " on this phone (you're offline)" else ""
            }
            Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        }
        server?.hits?.let { hits ->
            items(hits, key = { "server-${it.id}" }) { h ->
                SearchRow(h.hanzi, h.pinyin, h.english, h.sentence_clue, h.deck_name ?: "Deck", null, null, onClick = { actions.onOpenDeck(h.deck_id) }, onDeck = { actions.onOpenDeck(h.deck_id) })
            }
        }
        return
    }
    item(key = "legend") { RatingLegend() }
    items(s.results, key = { "hit-${it.noteId}" }) { r ->
        SearchRow(r.hanzi, r.pinyin, r.english, r.sentenceClue, r.deckName, r.ratings, r.mastery, onClick = { actions.onEditNote(r.noteId) }, onDeck = { actions.onOpenDeck(r.deckId) })
    }
}

@Composable
fun RatingLegend() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((c, l) in listOf(Palette.Again to "Again", Palette.Hard to "Hard", Palette.Good to "Good", Palette.Easy to "Easy")) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(c))
            Text(l, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            Spacer(Modifier.width(4.dp))
        }
    }
}

private val RATING_COLORS = listOf(Palette.Again, Palette.Hard, Palette.Good, Palette.Easy)

/** Oldest on the left, most recent on the right (the web reverses the most-recent-first list). */
@Composable
fun RatingDots(ratings: List<Int>) {
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        for (r in ratings.reversed()) Box(Modifier.size(8.dp).clip(CircleShape).background(RATING_COLORS.getOrElse(r) { Lab.colors.muted }))
    }
}

@Composable
fun RatingsGrid(ratings: Map<String, List<Int>>) {
    val any = ratings.values.any { it.isNotEmpty() }
    if (!any) {
        Text("—", color = Lab.colors.muted)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        for (type in DeckStats.CARD_TYPES) {
            val list = ratings[type].orEmpty()
            if (list.isEmpty()) continue
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(DeckStats.SHORT.getValue(type), fontSize = 10.sp, color = Lab.colors.muted, modifier = Modifier.width(34.dp))
                RatingDots(list)
            }
        }
    }
}

@Composable
private fun SearchRow(
    hanzi: String,
    pinyin: String,
    english: String,
    clue: String?,
    deckName: String,
    ratings: Map<String, List<Int>>?,
    mastery: Int?,
    onClick: () -> Unit,
    onDeck: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).bouncyClickable(pressedScale = 0.985f, onClick = onClick).padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(hanzi, fontSize = 22.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                Text(pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent)
                Text(english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (!clue.isNullOrEmpty()) Text(clue, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (ratings != null) {
                Spacer(Modifier.width(8.dp))
                RatingsGrid(ratings)
            }
            if (mastery != null) {
                Spacer(Modifier.width(8.dp))
                Text("$mastery%", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
            }
        }
        Text(
            deckName,
            style = MaterialTheme.typography.labelMedium,
            color = Lab.colors.accent,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp).clip(RoundedCornerShape(50)).background(Lab.colors.accentSoft).clickable(onClick = onDeck).padding(horizontal = 10.dp, vertical = 5.dp),
        )
    }
}

// ---------------- new deck ----------------

/** "+ New deck" (the web's AddDeckModal: Generate with Claude inside, or an empty deck). */
@Composable
fun NewDeckSheet(busy: Boolean, online: Boolean, error: String?, onCreate: (String, String) -> Unit, onGenerate: () -> Unit, onStarter: () -> Unit, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss, title = "Create new deck") {
        NewDeckForm(busy, online, error, onCreate, onGenerate, onStarter, onDismiss)
    }
}

@Composable
fun NewDeckForm(busy: Boolean, online: Boolean, error: String?, onCreate: (String, String) -> Unit, onGenerate: () -> Unit, onStarter: () -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        NavRow("✨", "Generate with Claude", desc = "Describe a topic and get 8–12 words with audio", onClick = onGenerate)
        NavRow("🌱", "Starter Chinese", desc = "15 everyday words with example sentences", enabled = online && !busy, onClick = onStarter)
        Text("or start an empty deck", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 24.dp, vertical = 6.dp))
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!online) InlineNotice("You're offline — a new deck needs the server.", kind = NoticeKind.Offline)
            error?.let { InlineNotice(it, kind = NoticeKind.Error) }
            Field("Deck name", name, hint = "e.g., Restaurant Vocabulary") { name = it }
            Field("Description (optional)", description, lines = 2, hint = "What will you learn in this deck?") { description = it }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryPill("Cancel", Modifier.weight(1f)) { onDismiss() }
                PrimaryPill(if (busy) "Creating…" else "Create deck", Modifier.weight(1f).height(52.dp), enabled = name.isNotBlank() && !busy && online) { onCreate(name, description) }
            }
        }
    }
}
