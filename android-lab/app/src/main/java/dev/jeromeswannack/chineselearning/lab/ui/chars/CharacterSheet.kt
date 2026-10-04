package dev.jeromeswannack.chineselearning.lab.ui.chars

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CharWordRow
import dev.jeromeswannack.chineselearning.lab.core.CharWordStatus
import dev.jeromeswannack.chineselearning.lab.core.CharWords
import dev.jeromeswannack.chineselearning.lab.data.api.CharRecordDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharWordDto
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi
import dev.jeromeswannack.chineselearning.lab.ui.bumps.rememberBumpHanzi
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkExisting
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

/*
 * The character sheet (docs/STUDY_SESSION.md "Character sheet"; web
 * frontend/src/components/chars/CharacterSheet.tsx), opened by tapping a character on the
 * card back. Card-INDEPENDENT dictionary data (data/chars/CharDict, cached on the device):
 * readings, meaning, radical / components, strokes, and the frequent words with the
 * character — each marked ✓ Known / 📚 In your decks from this device's own cards (core
 * CharWords, parity-tested). A row opens the add-card sheet (⚡ Study it today when they
 * already have it). "✨ More about 字" lazily asks for a short explanation shared by everyone.
 */

/** "✨ More about 字": idle → asking → the text / offline / error (+ Try again). */
sealed interface CharMore {
    data object Idle : CharMore
    data object Loading : CharMore
    data class Done(val text: String) : CharMore
    data object Offline : CharMore
    data class Error(val message: String) : CharMore
}

/** What the sheet shows. [lookup] null = still looking it up; [rows] null = statuses not read yet. */
data class CharSheetUi(
    val char: String,
    val lookup: CharDict.Lookup? = null,
    val rows: List<CharWordRow<CharWordDto>>? = null,
    val more: CharMore = CharMore.Idle,
    /** "✍️ Write it" is offered (the stroke-order practice). */
    val canWrite: Boolean = true,
) {
    val record: CharRecordDto? get() = (lookup as? CharDict.Lookup.Ok)?.record

    /** The rows to draw: the statuses once read, else every word as "none" (web: the same fallback). */
    val shownRows: List<CharWordRow<CharWordDto>>
        get() = rows ?: record?.words.orEmpty().map { CharWordRow(it, CharWordStatus.None, emptyList(), false) }
}

/** The sheet's environment: the device dictionary, statuses from Room, analytics. Defaults = offline previews. */
class CharSheetActions(
    val lookup: suspend (String) -> CharDict.Lookup = { CharDict.Lookup.Offline },
    val statuses: suspend (words: List<CharWordDto>, cardHanzi: String?) -> List<CharWordRow<CharWordDto>> =
        { w, _ -> w.map { CharWordRow(it, CharWordStatus.None, emptyList(), false) } },
    val explain: suspend (String) -> CharDict.Explain = { CharDict.Explain.Offline },
    /** Deck names of these notes ("You already have 银行 in HSK 2"). */
    val deckNames: suspend (noteIds: List<String>) -> List<String> = { emptyList() },
    val track: (event: String, props: Map<String, Any?>) -> Unit = { _, _ -> },
    /** "Open card →" in the add sheet (the card hub `/cards/:noteId`); null = no link. */
    val onOpenCard: ((noteId: String) -> Unit)? = null,
    val tick: () -> Unit = {},
)

/**
 * The stateful sheet: looks the character up (device first), reads the word statuses, asks
 * Claude on demand, and opens the add-card sheet for a row (statuses refresh when it closes).
 */
@Composable
fun CharacterSheet(
    char: String,
    cardHanzi: String?,
    actions: CharSheetActions,
    addActions: SentenceActions,
    onClose: () -> Unit,
    onWrite: ((String) -> Unit)?,
    bump: BumpHanzi? = rememberBumpHanzi("char_sheet"),
) {
    var lookup by remember(char) { mutableStateOf<CharDict.Lookup?>(null) }
    var rows by remember(char) { mutableStateOf<List<CharWordRow<CharWordDto>>?>(null) }
    var more by remember(char) { mutableStateOf<CharMore>(CharMore.Idle) }
    var adding by remember(char) { mutableStateOf<CharWordRow<CharWordDto>?>(null) }
    var existing by remember(char) { mutableStateOf<List<String>>(emptyList()) }
    var refresh by remember(char) { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(char) {
        val r = actions.lookup(char)
        lookup = r
        val record = (r as? CharDict.Lookup.Ok)?.record
        actions.track("study.char_sheet_open", mapOf("found" to (record != null), "words" to (record?.words?.size ?: 0)))
    }
    val record = (lookup as? CharDict.Lookup.Ok)?.record
    LaunchedEffect(record, cardHanzi, refresh) {
        val words = record?.words ?: return@LaunchedEffect
        rows = runCatching { actions.statuses(words, cardHanzi) }
            .getOrElse { words.map { CharWordRow(it, CharWordStatus.None, emptyList(), false) } }
    }

    fun askMore() {
        more = CharMore.Loading
        actions.track("study.char_explain", emptyMap())
        scope.launch {
            more = when (val out = actions.explain(char)) {
                is CharDict.Explain.Ok -> CharMore.Done(out.text)
                CharDict.Explain.Offline -> CharMore.Offline
                is CharDict.Explain.Error -> CharMore.Error(out.message)
            }
        }
    }

    LabBottomSheet(onDismiss = onClose) {
        CharacterSheetContent(
            CharSheetUi(char, lookup, rows, more, canWrite = onWrite != null),
            onClose = onClose,
            onWrite = { onWrite?.invoke(char) },
            onMore = ::askMore,
            onRow = { row ->
                actions.tick()
                actions.track("study.char_word_tap", mapOf("status" to row.status.wire, "current" to row.current))
                scope.launch {
                    existing = if (row.noteIds.isEmpty()) emptyList() else runCatching { actions.deckNames(row.noteIds) }.getOrDefault(emptyList())
                    adding = row
                }
            },
        )
    }

    adding?.let { row ->
        val w = row.word
        AddChunkSheet(
            Chunk(w.hanzi, w.pinyin, w.english),
            preferredDeck = "",
            actions = addActions,
            onDismiss = {
                adding = null
                refresh++
            },
            bumpSource = "char_sheet",
            bump = bump,
            existing = if (row.noteIds.isEmpty()) null else AddChunkExisting(
                existing,
                onOpenCard = actions.onOpenCard?.let { open -> { onClose(); open(row.noteIds.first()) } },
            ),
            onAdded = { actions.track("study.char_word_added", emptyMap()) },
        )
    }
}

/** The sheet's body, stateless (screenshot tests render it alone). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CharacterSheetContent(
    ui: CharSheetUi,
    onClose: () -> Unit = {},
    onWrite: () -> Unit = {},
    onMore: () -> Unit = {},
    onRow: (CharWordRow<CharWordDto>) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val record = ui.record
    val char = ui.char
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag(CHAR_SHEET_TAG)) {
        // Glyph · readings · meaning · ×
        Row(verticalAlignment = Alignment.Top) {
            Box(
                Modifier.widthIn(min = 76.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(horizontal = 8.dp, vertical = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(char, fontSize = 60.sp, lineHeight = 70.sp, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f).padding(top = 4.dp)) {
                record?.readings?.takeIf { it.isNotEmpty() }?.let { r ->
                    Text(r.joinToString(" · ") { it.pinyin }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)
                }
                record?.meaning?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.height(2.dp))
                    Text(it, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                }
            }
            Box(
                Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClose).testTag("char-sheet-close"),
                contentAlignment = Alignment.Center,
            ) { Text("×", fontSize = 26.sp, color = Lab.colors.muted) }
        }

        // Looking up / offline / missing / error
        when (val l = ui.lookup) {
            null -> StatusBox("Looking it up…")
            CharDict.Lookup.Offline -> StatusBox("You’re offline and this character isn’t on the device yet — it will be after the next sync.", Modifier.testTag("char-sheet-offline"))
            CharDict.Lookup.Missing -> StatusBox("This character isn’t in the dictionary.")
            is CharDict.Lookup.Error -> StatusBox("Couldn’t load it: ${l.message}", color = Palette.Again)
            is CharDict.Lookup.Ok -> Unit
        }

        if (record != null) {
            if (record.readings.size > 1) {
                Spacer(Modifier.height(10.dp))
                for (r in record.readings) {
                    Row(Modifier.padding(vertical = 2.dp)) {
                        Text(r.pinyin, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.widthIn(min = 56.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(r.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                    }
                }
            }
            val facts = buildList {
                record.radical?.let { add("Radical $it" + (record.radical_meaning?.let { m -> " $m" } ?: "")) }
                record.strokes?.takeIf { it > 0 }?.let { add("$it strokes") }
                record.rank?.takeIf { it in 1..5000 }?.let { add("#$it most common") }
            }
            if (facts.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (f in facts) {
                        Text(
                            f, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink,
                            modifier = Modifier.clip(CircleShape).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 5.dp),
                        )
                    }
                }
            }
            if (record.components.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    buildAnnotatedString {
                        append("Built from ")
                        record.components.forEachIndexed { i, c ->
                            if (i > 0) append(" + ")
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(c.char) }
                            c.meaning?.takeIf { it.isNotBlank() }?.let { append(" ($it)") }
                        }
                    },
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                )
            }
            record.etymology?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic, color = Lab.colors.muted)
            }
        }

        // ✍️ Write it · ✨ More about 字
        if (ui.canWrite || ui.more == CharMore.Idle) {
            Spacer(Modifier.height(14.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (ui.canWrite) SecondaryPill("✍️ Write it", Modifier.heightIn(min = 46.dp).testTag("char-sheet-write"), onClick = onWrite)
                if (ui.more == CharMore.Idle) SecondaryPill("✨ More about $char", Modifier.heightIn(min = 46.dp).testTag("char-sheet-more-button"), onClick = onMore)
            }
        }
        AnimatedVisibility(ui.more != CharMore.Idle, enter = fadeIn() + expandVertically()) {
            when (val m = ui.more) {
                CharMore.Loading -> MoreBox { Text("Asking Claude…", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
                is CharMore.Done -> MoreBox(Modifier.testTag("char-sheet-more")) { Text(m.text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, lineHeight = 21.sp) }
                CharMore.Offline -> MoreBox { Text("Needs a connection — the dictionary above works offline.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
                is CharMore.Error -> MoreBox {
                    Text(
                        buildAnnotatedString {
                            append(m.message)
                            append(" ")
                            withStyle(SpanStyle(color = Lab.colors.accent, fontWeight = FontWeight.SemiBold)) { append("Try again") }
                        },
                        style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                        modifier = Modifier.heightIn(min = 32.dp).clickable(onClick = onMore),
                    )
                }
                CharMore.Idle -> Unit
            }
        }

        // Words with 字
        if (record != null && record.words.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = Lab.colors.cardBorder)
            Spacer(Modifier.height(12.dp))
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Words with $char", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.alignByBaseline())
                ui.rows?.let { rows ->
                    Text(CharWords.summary(rows.map { it.status }), style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.alignByBaseline().padding(start = 8.dp))
                }
            }
            Spacer(Modifier.height(6.dp))
            for (row in ui.shownRows) WordRow(row, char) { onRow(row) }
            Spacer(Modifier.height(12.dp))
            Text("Dictionary: CC-CEDICT, Make Me a Hanzi, wordfreq — see Settings → About.", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
        }
        Spacer(Modifier.height(8.dp))
    }
}

const val CHAR_SHEET_TAG = "char-sheet"
const val CHAR_WORD_ROW_TAG = "char-word-row"

/** The yellow of the card's own word (web #fef9c3 + the secondary bar). */
private val CurrentLight = Color(0xFFFEF9C3)

@Composable
private fun isDark() = Lab.colors.card.luminance() < 0.4f

@Composable
private fun WordRow(row: CharWordRow<CharWordDto>, char: String, onClick: () -> Unit) {
    val dark = isDark()
    val known = row.status == CharWordStatus.Known
    val bar = Palette.Gold
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 54.dp)
            .then(
                if (row.current) Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (dark) Palette.Gold.copy(alpha = 0.16f) else CurrentLight)
                    .drawBehind { drawRect(bar, Offset.Zero, size.copy(width = 3.dp.toPx())) }
                else Modifier,
            )
            .bouncyClickable(onClick = onClick)
            .testTag(CHAR_WORD_ROW_TAG)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            buildAnnotatedString {
                for (cp in row.word.hanzi.codePoints().toArray()) {
                    val s = String(Character.toChars(cp))
                    if (s == char) withStyle(SpanStyle(color = Lab.colors.accent)) { append(s) } else append(s)
                }
            },
            fontSize = 22.sp,
            color = Lab.colors.ink,
            modifier = Modifier.widthIn(min = 60.dp).alpha(if (known) 0.6f else 1f),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).alpha(if (known) 0.6f else 1f)) {
            if (row.word.pinyin.isNotBlank()) Text(row.word.pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(row.word.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (row.status != CharWordStatus.None) {
            Spacer(Modifier.width(8.dp))
            val (bg, fg) = when (row.status) {
                CharWordStatus.Known -> if (dark) Palette.Good.copy(alpha = 0.2f) to Color(0xFF86EFAC) else Color(0xFFDCFCE7) to Color(0xFF166534)
                else -> if (dark) Palette.Easy.copy(alpha = 0.2f) to Color(0xFF93C5FD) else Color(0xFFDBEAFE) to Color(0xFF1E40AF)
            }
            Text(
                CharWords.label(row.status),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                color = fg,
                maxLines = 1,
                modifier = Modifier.clip(CircleShape).background(bg).padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
    }
    HorizontalDivider(color = Lab.colors.cardBorder.copy(alpha = 0.6f))
}

@Composable
private fun StatusBox(text: String, modifier: Modifier = Modifier, color: Color = Lab.colors.muted) {
    Spacer(Modifier.height(12.dp))
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = color,
        modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 12.dp, vertical = 10.dp),
    )
}

@Composable
private fun MoreBox(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val dark = isDark()
    Column(Modifier.padding(top = 10.dp)) {
        Box(
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(topEnd = 10.dp, bottomEnd = 10.dp))
                .background(if (dark) Palette.Gold.copy(alpha = 0.10f) else Color(0xFFFFFBEB))
                .drawBehind { drawRect(Palette.Gold, Offset.Zero, size.copy(width = 3.dp.toPx())) }
                .padding(start = 14.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
        ) { content() }
    }
}
