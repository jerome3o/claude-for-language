package dev.jeromeswannack.chineselearning.lab.ui.idioms

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomEntry
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomLine
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomRef
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomSummary
import dev.jeromeswannack.chineselearning.lab.core.idioms.Idioms
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.StickyFooter
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * 成语 Idioms (beta; web pages/IdiomsPage.tsx + IdiomPage.tsx, docs/IDIOMS.md): the list
 * (look one up, the starter grid, opened on this phone) and one idiom's reading page. Stateless:
 * [IdiomsUi] / [IdiomUi] in, taps out — IdiomsNav wires them.
 */

// ── colours (paper + ink, light and dark) ─────────────────────────────────

private object IdiomColors {
    @Composable fun dark() = Lab.colors.card.luminance() < 0.4f
    @Composable fun paper() = if (dark()) Color(0xFF2A2117) else Color(0xFFFFFBEB)
    @Composable fun line() = if (dark()) Color(0xFF4A3A26) else Color(0xFFF3E3C3)
    @Composable fun ink() = if (dark()) Color(0xFFFDBA74) else Color(0xFF7C2D12)
}

const val IDIOM_TILE_TAG = "idiom-tile"
const val IDIOM_HANZI_TAG = "idiom-hanzi"
const val IDIOM_STORY_TAG = "idiom-story"
const val IDIOM_ADD_TAG = "idiom-add-card"
const val IDIOM_LINK_TAG = "explorer-idiom-link"

// ── the list ───────────────────────────────────────────────────────────────

data class IdiomsUi(
    val starter: List<IdiomSummary> = Idioms.STARTER.map { IdiomSummary(it.hanzi, it.pinyin, it.english, "missing", true) },
    val more: List<IdiomSummary> = emptyList(),
    /** Opened on this phone (not in the starter list), most recent first. */
    val opened: List<IdiomSummary> = emptyList(),
    /** Ready entries on this phone (✓ on the tile; the only ones that open offline). */
    val onDevice: Set<String> = emptySet(),
    val online: Boolean = true,
    val query: String = "",
    val problem: String? = null,
)

data class IdiomsActions(
    val onBack: (() -> Unit)? = null,
    val onQuery: (String) -> Unit = {},
    val onLookUp: () -> Unit = {},
    val onOpen: (String) -> Unit = {},
)

/** `/idioms` — the web's IdiomsPage: search box, opened on this phone, the starter grid, looked up by others. */
@Composable
fun IdiomsScreen(ui: IdiomsUi, actions: IdiomsActions) {
    val kind = Idioms.STARTER.associate { it.hanzi to it.kind }
    val story = ui.starter.filter { kind[it.hanzi] == "story" }
    val everyday = ui.starter.filter { kind[it.hanzi] != "story" }
    val others = ui.more.filter { it.hanzi !in ui.onDevice }
    LabScreen("📜 成语 Idioms", onBack = actions.onBack, subtitle = "beta") {
        item {
            Text(
                "Four characters, a whole story. Each idiom comes with what it really means, the story behind it (典故) in simple Chinese, and how to use it — with a quick check at the end.",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
            )
        }
        item { SearchCard(ui, actions) }
        if (ui.opened.isNotEmpty()) tileSection("Opened on this phone", ui.opened, ui, actions)
        tileSection("With a story · 有典故", story, ui, actions)
        tileSection("Everyday · 常用", everyday, ui, actions)
        if (others.isNotEmpty()) tileSection("Looked up by others", others, ui, actions)
        item {
            Text(
                "Written by Claude and checked for consistency, not by a dictionary editor — when something looks off, ask your tutor.",
                style = MaterialTheme.typography.bodySmall,
                color = Lab.colors.muted,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun SearchCard(ui: IdiomsUi, actions: IdiomsActions) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).padding(16.dp)) {
        Text("Look up any 成语", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = ui.query,
                onValueChange = actions.onQuery,
                placeholder = { Text("e.g. 废寝忘食") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { actions.onLookUp() }),
                textStyle = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f).testTag("idiom-search"),
            )
            Spacer(Modifier.width(8.dp))
            PrimaryPill("Look up", Modifier.height(56.dp), enabled = ui.query.isNotBlank(), onClick = actions.onLookUp)
        }
        ui.problem?.let {
            Spacer(Modifier.height(6.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.Again)
        }
        if (!ui.online) {
            Spacer(Modifier.height(8.dp))
            InlineNotice("Offline — idioms you’ve opened before still work; new ones need internet.", kind = NoticeKind.Offline)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
private fun LazyListScope.tileSection(title: String, rows: List<IdiomSummary>, ui: IdiomsUi, actions: IdiomsActions) {
    item(key = "h-$title") { SectionHeader(title) }
    item(key = "g-$title") {
        // Two columns on the phone, more when unfolded (each tile ≥ 170dp).
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), maxItemsInEachRow = 4) {
            for (r in rows) IdiomTile(r, cached = r.hanzi in ui.onDevice, offline = !ui.online, onClick = { actions.onOpen(r.hanzi) }, modifier = Modifier.weight(1f).widthIn(min = 150.dp))
        }
    }
}

@Composable
private fun IdiomTile(row: IdiomSummary, cached: Boolean, offline: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val dim = offline && !cached
    Box(
        modifier.heightIn(min = 96.dp).bouncyClickable(onClick = onClick).clip(RoundedCornerShape(14.dp))
            .background(IdiomColors.paper()).border(1.dp, IdiomColors.line(), RoundedCornerShape(14.dp))
            .alpha(if (dim) 0.45f else 1f).testTag(IDIOM_TILE_TAG).padding(12.dp),
    ) {
        Column {
            Text(row.hanzi, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold, color = IdiomColors.ink(), letterSpacing = 1.sp)
            Text(row.pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            Text(row.english, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (cached) Text("✓", color = Palette.Good, fontSize = 12.sp, modifier = Modifier.align(Alignment.TopEnd))
    }
}

// ── one idiom ──────────────────────────────────────────────────────────────

sealed interface IdiomState {
    data object Loading : IdiomState
    data class Ready(val entry: IdiomEntry) : IdiomState
    data object Generating : IdiomState
    data class Failed(val message: String) : IdiomState
    data class NotIdiom(val reason: String, val suggestion: String?) : IdiomState
    data object Offline : IdiomState
    data class Unavailable(val message: String) : IdiomState
}

/** The learner's own card of the idiom (the footer's "📚 You have this in <deck>"). */
data class IdiomCard(val noteId: String, val deckName: String)

data class IdiomUi(
    val hanzi: String,
    val state: IdiomState = IdiomState.Loading,
    val showPinyin: Boolean = false,
    val showEnglish: Boolean = false,
    /** Paragraphs whose English is peeked at (EN). */
    val peek: Set<Int> = emptySet(),
    /** Example index → reveal step (0 blank · 1 Chinese · 2 pinyin · 3 English). */
    val revealed: Map<Int, Int> = emptyMap(),
    /** "Try it": the option picked per question (null = not yet). */
    val picked: List<Int?> = emptyList(),
    /** What is playing: "head", "para:2", "ex:0", "story:1". */
    val playing: String? = null,
    /** null = not read yet; [IdiomCard.noteId] empty = not a card. */
    val card: IdiomCard? = null,
    val cardLoaded: Boolean = false,
    val added: Boolean = false,
    val bumped: String? = null,
    val retrying: Boolean = false,
    val online: Boolean = true,
)

data class IdiomActions(
    val onBack: () -> Unit = {},
    val onPlay: (key: String, text: String) -> Unit = { _, _ -> },
    val onPlayStory: () -> Unit = {},
    val onTogglePinyin: () -> Unit = {},
    val onToggleEnglish: () -> Unit = {},
    val onPeek: (Int) -> Unit = {},
    val onReveal: (Int) -> Unit = {},
    val onPick: (question: Int, option: Int) -> Unit = { _, _ -> },
    val onResetQuiz: () -> Unit = {},
    val onChar: (String) -> Unit = {},
    val onRef: (String) -> Unit = {},
    val onAdd: () -> Unit = {},
    val onBump: () -> Unit = {},
    val onOpenCard: (String) -> Unit = {},
    val onRetry: () -> Unit = {},
)

/** `/idioms/:hanzi` — the web's IdiomPage. */
@Composable
fun IdiomScreen(ui: IdiomUi, actions: IdiomActions, list: androidx.compose.foundation.lazy.LazyListState = rememberLazyListState()) {
    LabScreenFrame { Column(Modifier.fillMaxSize()) {
        ScreenTitle("成语 Idioms", subtitle = "beta", onBack = actions.onBack)
        val state = ui.state
        if (state !is IdiomState.Ready) {
            Column(Modifier.fillMaxWidth().padding(24.dp).testTag("idiom-state"), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(ui.hanzi, fontSize = 40.sp, lineHeight = 48.sp, color = IdiomColors.ink(), letterSpacing = 3.sp)
                Spacer(Modifier.height(16.dp))
                StateBody(ui, state, actions)
            }
            return@Column
        }
        val entry = state.entry
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item { Head(entry, ui, actions) }
            item { Literal(entry, actions) }
            item { Story(entry, ui, actions) }
            item { Usage(entry, ui, actions) }
            if (entry.synonyms.isNotEmpty() || entry.antonyms.isNotEmpty()) item { Refs(entry, actions) }
            if (entry.quiz.isNotEmpty()) item { TryIt(entry, ui, actions) }
        }
        StickyFooter(moreAbove = list.canScrollForward, above = {
            ui.card?.takeIf { it.noteId.isNotEmpty() }?.let { c ->
                Text("📚 You have this card in ${c.deckName.ifBlank { "your decks" }}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.padding(bottom = 6.dp))
            }
            ui.bumped?.let { InlineNotice(it, kind = NoticeKind.Success, modifier = Modifier.padding(bottom = 6.dp)) }
            if (ui.added) Text("✓ Added — it’s in your deck.", style = MaterialTheme.typography.bodyMedium, color = Palette.Good, modifier = Modifier.padding(bottom = 6.dp))
        }) {
            val card = ui.card
            when {
                !ui.cardLoaded -> Unit
                card != null && card.noteId.isNotEmpty() -> {
                    SecondaryPill("Open card", Modifier.weight(0.8f).height(52.dp)) { actions.onOpenCard(card.noteId) }
                    Spacer(Modifier.width(10.dp))
                    PrimaryPill("⚡ Study it today", Modifier.weight(1.2f).height(52.dp), onClick = actions.onBump)
                }
                !ui.added -> PrimaryPill("+ Add as card", Modifier.weight(1f).height(52.dp).testTag(IDIOM_ADD_TAG), onClick = actions.onAdd)
                else -> Unit
            }
        }
    } }
}

@Composable
private fun StateBody(ui: IdiomUi, state: IdiomState, actions: IdiomActions) {
    val body = MaterialTheme.typography.bodyLarge
    when (state) {
        IdiomState.Loading -> LoadingState(text = "Loading…")
        IdiomState.Generating -> {
            Text("✍️", fontSize = 36.sp)
            Spacer(Modifier.height(8.dp))
            Text("Claude is writing the story and usage of ${ui.hanzi}…", style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(6.dp))
            Text("About half a minute, once — then it’s here for everyone, offline too.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
        }
        is IdiomState.Failed -> {
            Text(state.message, style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            PrimaryPill(if (ui.retrying) "Starting…" else "Try again", Modifier.height(52.dp), enabled = !ui.retrying && ui.online, onClick = actions.onRetry)
        }
        is IdiomState.NotIdiom -> {
            Text(state.reason.ifBlank { "${ui.hanzi} doesn’t look like a 成语." }, style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
            state.suggestion?.let { s ->
                Spacer(Modifier.height(12.dp))
                Text("Did you mean", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                Text(s, fontSize = 26.sp, color = IdiomColors.ink(), modifier = Modifier.bouncyClickable { actions.onRef(s) }.padding(8.dp).testTag("idiom-suggestion"))
            }
            Spacer(Modifier.height(12.dp))
            SecondaryPill("It is one — write it up anyway", enabled = !ui.retrying && ui.online, onClick = actions.onRetry)
        }
        IdiomState.Offline -> Text("You’re offline and this idiom isn’t on the phone yet. Open it once online and it stays here.", style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
        is IdiomState.Unavailable -> Text(state.message, style = body, color = Lab.colors.ink, textAlign = TextAlign.Center)
        is IdiomState.Ready -> Unit
    }
}

@Composable
private fun PlayDot(active: Boolean, label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).bouncyClickable(pressedScale = 0.9f, onClick = onClick).clip(CircleShape)
            .background(if (active) IdiomColors.ink() else Lab.colors.card).border(1.dp, IdiomColors.line(), CircleShape),
        contentAlignment = Alignment.Center,
    ) { Text(if (active) "■" else "▶", color = if (active) Color.White else IdiomColors.ink(), fontSize = 14.sp) }
}

@Composable
private fun Paper(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(IdiomColors.paper()).border(1.dp, IdiomColors.line(), RoundedCornerShape(18.dp)).padding(16.dp)) { content() }
}

@Composable
private fun H2(text: String) = Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)

@Composable
private fun H3(text: String) = Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Lab.colors.muted, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp))

@Composable
private fun Head(entry: IdiomEntry, ui: IdiomUi, actions: IdiomActions) {
    Paper {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(entry.hanzi, fontSize = 40.sp, lineHeight = 48.sp, fontWeight = FontWeight.SemiBold, color = IdiomColors.ink(), letterSpacing = 3.sp, modifier = Modifier.testTag(IDIOM_HANZI_TAG))
            Spacer(Modifier.width(12.dp))
            PlayDot(ui.playing == "head", "Play ${entry.hanzi}") { actions.onPlay("head", entry.hanzi) }
        }
        Text(entry.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
        Spacer(Modifier.height(6.dp))
        Text(entry.meaning, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        Spacer(Modifier.height(8.dp))
        Text(entry.explanation_zh, fontSize = 18.sp, color = Lab.colors.ink)
        if (entry.explanation_pinyin.isNotBlank()) Text(entry.explanation_pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        if (entry.confidence != "high") {
            Spacer(Modifier.height(10.dp))
            Text(
                "ⓘ Claude wasn’t fully sure about some details${entry.confidence_note?.let { ": $it" } ?: "."} Check with your tutor.",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Lab.colors.faint).padding(8.dp).testTag("idiom-caution"),
            )
        }
    }
}

@Composable
private fun Literal(entry: IdiomEntry, actions: IdiomActions) {
    Column {
        H2("Character by character")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (c in entry.literal) {
                Column(
                    Modifier.weight(1f).heightIn(min = 44.dp).bouncyClickable { actions.onChar(c.hanzi) }.clip(RoundedCornerShape(14.dp))
                        .background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(vertical = 10.dp, horizontal = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(c.hanzi, fontSize = 28.sp, lineHeight = 34.sp, color = Lab.colors.ink)
                    Text(c.pinyin, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                    Text(c.gloss, style = MaterialTheme.typography.labelSmall, color = Lab.colors.ink, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        if (entry.literal_english.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text("Literally “${entry.literal_english}”", style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic, color = Lab.colors.muted)
        }
    }
}

@Composable
private fun Toggle(label: String, on: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        label,
        color = if (on) Color.White else Lab.colors.muted,
        fontSize = 13.sp,
        modifier = modifier.heightIn(min = 36.dp).bouncyClickable(pressedScale = 0.94f, onClick = onClick).clip(RoundedCornerShape(50))
            .background(if (on) IdiomColors.ink() else Lab.colors.card).border(1.dp, if (on) IdiomColors.ink() else Lab.colors.cardBorder, RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 9.dp),
    )
}

@Composable
private fun Story(entry: IdiomEntry, ui: IdiomUi, actions: IdiomActions) {
    val o = entry.origin
    Column(Modifier.animateContentSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { H2("📜 典故 · The story") }
            if (o.story.isNotEmpty()) SecondaryPill(if (ui.playing?.startsWith("story") == true) "■ Stop" else "▶ Play story", Modifier.height(44.dp), onClick = actions.onPlayStory)
        }
        val where = listOfNotNull(o.source, o.era).filter { it.isNotBlank() }.joinToString(" · ")
        if (where.isNotEmpty()) Text(where, style = MaterialTheme.typography.bodyMedium, color = IdiomColors.ink(), modifier = Modifier.padding(top = 4.dp).testTag("idiom-source"))
        o.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp)) }
        if (o.story.isNotEmpty()) {
            Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Toggle("拼音", ui.showPinyin, onClick = actions.onTogglePinyin)
                Toggle("English", ui.showEnglish, Modifier.testTag("idiom-toggle-english"), onClick = actions.onToggleEnglish)
            }
            Column(Modifier.testTag(IDIOM_STORY_TAG), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                o.story.forEachIndexed { i, p ->
                    val speaking = ui.playing == "story:$i"
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.card)
                            .border(1.dp, if (speaking) IdiomColors.ink() else Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(12.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            ExplorableText(p.hanzi, source = "idioms", fontSize = 19.sp, lineHeight = 32.sp)
                            if (ui.showPinyin && p.pinyin.isNotBlank()) Text(p.pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp))
                            if ((ui.showEnglish || i in ui.peek) && p.english.isNotBlank()) Text(p.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.padding(top = 6.dp).testTag("idiom-para-en"))
                        }
                        Spacer(Modifier.width(8.dp))
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            PlayDot(ui.playing == "para:$i", "Play paragraph ${i + 1}") { actions.onPlay("para:$i", p.hanzi) }
                            if (!ui.showEnglish) Toggle("EN", i in ui.peek) { actions.onPeek(i) }
                        }
                    }
                }
            }
        }
        if (o.summary.isNotBlank()) {
            Text("In one line: ${o.summary}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Usage(entry: IdiomEntry, ui: IdiomUi, actions: IdiomActions) {
    val u = entry.usage
    val dark = IdiomColors.dark()
    Column {
        H2("用法 · How to use it")
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (r in u.roles) Chip("$r ${Idioms.ROLES[r] ?: ""}".trim())
            val tone = when (u.sentiment) { "praise" -> Palette.Good; "criticism" -> Palette.Again; else -> null }
            Chip(Idioms.sentimentLabel(u.sentiment), tone?.copy(alpha = if (dark) 0.25f else 0.14f), tone)
            Chip(Idioms.registerLabel(u.register))
        }
        if (u.note.isNotBlank()) Text(u.note, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.padding(top = 8.dp))
        if (u.collocations.isNotEmpty()) {
            H3("Goes with")
            for (c in u.collocations) {
                Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(vertical = 2.dp)) {
                    Text(c.hanzi, fontSize = 17.sp, color = Lab.colors.ink)
                    Spacer(Modifier.width(8.dp))
                    Text("${c.pinyin} · ${c.english}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
            }
        }
        H3("Examples · easiest first")
        u.examples.forEachIndexed { i, ex -> ExampleRow(ex, i, ui.revealed[i] ?: 0, ui.playing == "ex:$i", { actions.onReveal(i) }, { actions.onPlay("ex:$i", ex.hanzi) }) }
        if (u.mistake.isNotBlank()) {
            Spacer(Modifier.height(10.dp))
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (dark) Color(0xFF3A2410) else Color(0xFFFFF7ED))
                    .border(1.dp, if (dark) Color(0xFF7C4A1A) else Color(0xFFFED7AA), RoundedCornerShape(14.dp)).padding(12.dp),
            ) {
                Text("⚠ Common mistake", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                Text(u.mistake, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun Chip(text: String, bg: Color? = null, fg: Color? = null) {
    Text(
        text, fontSize = 13.sp, color = fg ?: Lab.colors.ink,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(bg ?: Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

@Composable
private fun ExampleRow(line: IdiomLine, index: Int, step: Int, playing: Boolean, onReveal: () -> Unit, onPlay: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(
            Modifier.weight(1f).heightIn(min = 52.dp).bouncyClickable(pressedScale = 0.98f, onClick = onReveal).clip(RoundedCornerShape(14.dp))
                .background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 10.dp)
                .animateContentSize().testTag("idiom-example"),
        ) {
            if (step == 0) {
                Text("Example ${index + 1} · listen, then tap to reveal", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            } else {
                Text(line.hanzi, fontSize = 17.sp, lineHeight = 26.sp, color = Lab.colors.ink)
                if (step >= 2 && line.pinyin.isNotBlank()) Text(line.pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                if (step >= (if (line.pinyin.isNotBlank()) 3 else 2) && line.english.isNotBlank()) Text(line.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            }
        }
        Spacer(Modifier.width(8.dp))
        PlayDot(playing, "Play example ${index + 1}", onPlay)
    }
}

/** Taps through an example: blank → Chinese → pinyin → English → blank (steps it lacks are skipped). */
fun nextExampleStep(line: IdiomLine, step: Int): Int {
    val steps = 1 + (if (line.pinyin.isNotBlank()) 1 else 0) + (if (line.english.isNotBlank()) 1 else 0)
    return if (step >= steps) 0 else step + 1
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Refs(entry: IdiomEntry, actions: IdiomActions) {
    Column {
        if (entry.synonyms.isNotEmpty()) RefRow("近义 · Similar", entry.synonyms, actions)
        if (entry.antonyms.isNotEmpty()) RefRow("反义 · Opposite", entry.antonyms, actions)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RefRow(title: String, refs: List<IdiomRef>, actions: IdiomActions) {
    H3(title)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (r in refs) {
            Column(
                Modifier.heightIn(min = 44.dp).bouncyClickable { actions.onRef(r.hanzi) }.clip(RoundedCornerShape(14.dp))
                    .background(IdiomColors.paper()).border(1.dp, IdiomColors.line(), RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(r.hanzi, fontSize = 18.sp, color = IdiomColors.ink())
                Text(r.english, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            }
        }
    }
}

@Composable
private fun TryIt(entry: IdiomEntry, ui: IdiomUi, actions: IdiomActions) {
    val picked = if (ui.picked.size == entry.quiz.size) ui.picked else entry.quiz.map { null }
    Column(Modifier.animateContentSize()) {
        H2("🎯 Try it")
        entry.quiz.forEachIndexed { qi, q ->
            Spacer(Modifier.height(10.dp))
            Text(q.prompt, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            Spacer(Modifier.height(6.dp))
            val chosen = picked[qi]
            q.options.forEachIndexed { oi, opt ->
                val (bg, border) = when {
                    chosen == null -> Lab.colors.card to Lab.colors.cardBorder
                    oi == q.answer -> Palette.Good.copy(alpha = 0.16f) to Palette.Good
                    oi == chosen -> Palette.Again.copy(alpha = 0.14f) to Palette.Again
                    else -> Lab.colors.card to Lab.colors.cardBorder
                }
                Text(
                    opt, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp).heightIn(min = 44.dp)
                        .bouncyClickable(enabled = chosen == null, pressedScale = 0.98f) { actions.onPick(qi, oi) }
                        .clip(RoundedCornerShape(12.dp)).background(bg).border(1.dp, border, RoundedCornerShape(12.dp))
                        .alpha(if (chosen != null && oi != q.answer && oi != chosen) 0.55f else 1f)
                        .padding(horizontal = 12.dp, vertical = 11.dp).testTag("idiom-quiz-option"),
                )
            }
            if (chosen != null) {
                val right = chosen == q.answer
                Text((if (right) "✓ Right. " else "✗ Not quite. ") + q.explanation, style = MaterialTheme.typography.bodyMedium, color = if (right) Palette.Good else Palette.Again, modifier = Modifier.padding(top = 4.dp))
            }
        }
        if (picked.isNotEmpty() && picked.all { it != null }) {
            val correct = picked.withIndex().count { (i, p) -> p == entry.quiz[i].answer }
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(IdiomColors.paper()).border(1.dp, IdiomColors.line(), RoundedCornerShape(14.dp)).padding(12.dp).testTag("idiom-quiz-score"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(Idioms.quizScoreLine(correct, entry.quiz.size), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                SecondaryPill("Try again", Modifier.height(44.dp), onClick = actions.onResetQuiz)
            }
        }
    }
}

/** The explorer Word view's "📜 Story & usage" row for a 成语. */
@Composable
fun IdiomLinkRow(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).bouncyClickable(onClick = onClick).clip(RoundedCornerShape(14.dp))
            .background(IdiomColors.paper()).border(1.dp, IdiomColors.line(), RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 10.dp)
            .testTag(IDIOM_LINK_TAG),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("📜 Story & usage", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = IdiomColors.ink(), modifier = Modifier.weight(1f))
        Text("成语 · 典故 and how to use it →", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}
