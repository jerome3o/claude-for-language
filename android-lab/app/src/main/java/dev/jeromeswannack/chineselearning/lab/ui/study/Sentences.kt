package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A sentence row: the card's own clue first, then the generated graded set. */
data class SentenceRow(
    val key: String,
    /** The set row's id; null for the card's own sentence (explained by its text). */
    val sentenceId: String?,
    val hanzi: String,
    val pinyin: String?,
    val translation: String?,
    val audioUrl: String?,
    val badge: String?,
    val focusNote: String? = null,
)

/** SentenceSet.tsx `FOCUS_LABELS`. */
private val FOCUS_LABELS = mapOf(
    "shared_character" to "Shared character",
    "contrast" to "Contrast",
    "collocation" to "Collocation",
    "complex" to "Complex",
)

fun sentenceRows(view: CardView): List<SentenceRow> = sentenceRows(view.note, view.sentences)

fun sentenceRows(note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity, sentences: List<dev.jeromeswannack.chineselearning.lab.data.SentenceEntity>): List<SentenceRow> {
    val rows = ArrayList<SentenceRow>()
    val clue = note.sentenceClue?.takeIf { it.isNotBlank() }
    if (clue != null && sentences.none { it.hanzi == clue }) {
        rows += SentenceRow("clue:${note.id}", null, clue, note.sentenceCluePinyin, note.sentenceClueTranslation, note.sentenceClueAudioUrl, "From the card")
    }
    sentences.sortedBy { it.position }.forEach { s ->
        rows += SentenceRow(s.id, s.id, s.hanzi, s.pinyin, s.translation, s.audioUrl, s.focus?.let { FOCUS_LABELS[it] ?: it.takeIf { f -> f != "core" }?.replace('_', ' ') }, s.focusNote)
    }
    return rows
}

/** A word or sentence the learner is turning into a card (AddChunkModal's `Chunk`; fun_facts optional, sent as is). */
data class Chunk(val hanzi: String, val pinyin: String, val english: String, val funFacts: String? = null)

/** The sentence list's network side (all online; the list itself is offline). */
class SentenceActions(
    /** `generateAndStoreSentenceSet` for the current note; the card shows the new set. */
    val generate: suspend (count: Int, keepExisting: Boolean, customPrompt: String?) -> Unit = { _, _, _ -> },
    val clear: suspend () -> Unit = {},
    val cachedExplanation: suspend (SentenceRow) -> SentenceExplanation? = { null },
    val explain: suspend (SentenceRow) -> SentenceExplanation = { error("offline") },
    /** Decks (current note's deck first) and whether one already has this hanzi. */
    val decks: suspend () -> List<Pair<String, String>> = { emptyList() },
    val deckHas: suspend (deckId: String, hanzi: String) -> Boolean = { _, _ -> false },
    val addCard: suspend (deckId: String, Chunk) -> Unit = { _, _ -> },
)

/**
 * The web's SentenceSet on the card back: every row starts blank (listen first); each tap
 * uncovers one more line (hanzi → pinyin → English) and a tap on a fully open row hides it
 * again. EN flips a row to translate-back mode. A fully open row has its tools line —
 * "What's going on here?" (word-by-word breakdown, each word tappable to make a card) and
 * + Add as card — and the header ⋯ regenerates / extends / clears the set.
 */
@Composable
fun SentenceList(view: CardView, ui: StudyUi, playingKey: String?, actions: StudyActions, startExplained: Map<String, SentenceExplanation> = emptyMap(), startShowAll: Boolean = false, modifier: Modifier = Modifier) =
    SentenceList(view.note, view.sentences, view.presentation, ui.aiAvailable, playingKey, actions.sentences, actions.onPlay, startExplained, startShowAll, modifier)

/**
 * The same list for any note (the card editor's "Sentence Set" section): [presentation]
 * resets the reveal state when it changes; [onPlay] plays a clip key with the text as fallback.
 *
 * It is ONE node — a Column holding the header, the rows and the "+ 5 more sentences" line — so a
 * caller may wrap it in anything (the card back wraps it in a tap-keeping block): emitted as loose
 * siblings, a Box parent drew them all on top of each other (the header under the rows, the
 * "+ 5 more" line over the first row).
 */
@Composable
fun SentenceList(
    note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity,
    sentences: List<dev.jeromeswannack.chineselearning.lab.data.SentenceEntity>,
    presentation: Int,
    online: Boolean,
    playingKey: String?,
    s: SentenceActions,
    onPlay: (key: String?, text: String) -> Unit,
    startExplained: Map<String, SentenceExplanation> = emptyMap(),
    startShowAll: Boolean = false,
    modifier: Modifier = Modifier,
) = Column(modifier.fillMaxWidth()) {
    val rows = remember(presentation, sentences, note.sentenceClue, note.sentenceCluePinyin, note.sentenceClueTranslation) { sentenceRows(note, sentences) }
    val steps = remember(presentation) { mutableStateMapOf<String, Int>() }
    val english = remember(presentation) { mutableStateMapOf<String, Boolean>() }
    val explanations = remember(presentation) { mutableStateMapOf<String, SentenceExplanation?>().apply { putAll(startExplained) } }
    val explaining = remember(presentation) { mutableStateMapOf<String, Boolean>() }
    val failed = remember(presentation) { mutableStateMapOf<String, Boolean>() }
    var showAll by remember(presentation) { mutableStateOf(startShowAll) }
    var menu by remember(presentation) { mutableStateOf(false) }
    var custom by remember(presentation) { mutableStateOf(false) }
    var prompt by remember(presentation) { mutableStateOf("") }
    var generating by remember(presentation) { mutableStateOf(false) }
    var error by remember(presentation) { mutableStateOf<String?>(null) }
    var adding by remember(presentation) { mutableStateOf<Chunk?>(null) }
    val scope = rememberCoroutineScope()
    val hasSet = sentences.isNotEmpty()

    fun generate(count: Int, keep: Boolean = false, customPrompt: String? = null) {
        menu = false
        generating = true
        error = null
        scope.launch {
            try { s.generate(count, keep, customPrompt) } catch (e: Exception) { error = "Could not generate sentences. Try again in a moment." } finally { generating = false }
        }
    }

    // Rows already explained (a synced set row, the clue on this device) show at once.
    LaunchedEffect(rows) { for (r in rows) if (explanations[r.key] == null) s.cachedExplanation(r)?.let { explanations[r.key] = it } }

    if (rows.isEmpty()) {
        SecondaryPill(
            if (generating) "Generating sentences…" else "✨ Generate example sentences",
            Modifier.fillMaxWidth().height(48.dp),
            enabled = !generating && online,
        ) { generate(6) }
        error?.let { Spacer(Modifier.height(8.dp)); InlineNotice(it, kind = NoticeKind.Error) }
        Spacer(Modifier.height(12.dp))
    } else {

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Example sentences", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            TextButton(onClick = { showAll = !showAll; if (!showAll) steps.clear() }) {
                Text(if (showAll) "Hide all" else "Show all", color = Lab.colors.accent)
            }
            Box {
                TextButton(onClick = { menu = true }, enabled = online && !generating) {
                    Text(if (generating) "…" else "⋯", color = if (online) Lab.colors.ink else Lab.colors.muted, fontWeight = FontWeight.Bold)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Lab.colors.card) {
                    for (count in listOf(5, 10)) DropdownMenuItem(text = { Text(if (hasSet) "New set of $count" else "Generate $count") }, onClick = { generate(count) })
                    if (hasSet) DropdownMenuItem(text = { Text("Add 5 more") }, onClick = { generate(5, keep = true) })
                    DropdownMenuItem(text = { Text("Custom…") }, onClick = { menu = false; custom = true })
                    if (hasSet) DropdownMenuItem(text = { Text("Clear set", color = Palette.Again) }, onClick = {
                        menu = false
                        scope.launch { runCatching { s.clear() } }
                    })
                }
            }
        }
        error?.let { InlineNotice(it, kind = NoticeKind.Error); Spacer(Modifier.height(8.dp)) }
        AnimatedVisibility(custom) {
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    placeholder = { Text("Describe the sentences you want…") },
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
                )
                Spacer(Modifier.width(6.dp))
                TextButton(enabled = prompt.isNotBlank(), onClick = { generate(6, customPrompt = prompt.trim()); prompt = ""; custom = false }) { Text("Go", color = Lab.colors.accent) }
                TextButton(onClick = { custom = false; prompt = "" }) { Text("Cancel", color = Lab.colors.muted) }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (row in rows) {
                val en = english[row.key] == true && row.translation != null
                val chain = buildList {
                    add("hanzi")
                    if (!row.pinyin.isNullOrBlank()) add("pinyin")
                    if (!en && !row.translation.isNullOrBlank()) add("translation")
                }
                val step = if (showAll) chain.size else (steps[row.key] ?: 0)
                val open = step >= chain.size
                val playing = playingKey != null && (playingKey == row.audioUrl || playingKey == "tts:${row.hanzi}")
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).animateContentSize(),
                ) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                val cur = steps[row.key] ?: 0
                                steps[row.key] = if (cur >= chain.size) 0 else cur + 1
                            }
                            .padding(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier.size(34.dp).clip(CircleShape)
                                .background(if (en) Lab.colors.accentSoft else Lab.colors.card)
                                .clickable(enabled = row.translation != null) { english[row.key] = !en; steps[row.key] = 0; if (!en) showAll = false },
                            contentAlignment = Alignment.Center,
                        ) { Text("EN", style = MaterialTheme.typography.labelSmall, color = if (en) Lab.colors.accent else Lab.colors.muted) }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                            if (en) Text(row.translation!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                            if (step == 0 && !en) Text("Tap to reveal", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted.copy(alpha = 0.6f))
                            if (step >= 1) Text(row.hanzi, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, fontWeight = FontWeight.Medium)
                            if (step >= 2 && chain.getOrNull(1) == "pinyin") Text(row.pinyin!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent)
                            val translationStep = chain.indexOf("translation") + 1
                            if (translationStep > 0 && step >= translationStep) Text(row.translation!!, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                            if (open && (row.badge != null || row.focusNote != null)) {
                                Spacer(Modifier.height(4.dp))
                                Text(listOfNotNull(row.badge, row.focusNote).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                            }
                        }
                        Box(
                            Modifier.size(40.dp).clip(CircleShape).background(if (playing) Lab.colors.accentSoft else Lab.colors.card).clickable { onPlay(row.audioUrl, row.hanzi) },
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Filled.PlayArrow, "Play sentence", tint = Lab.colors.accent) }
                    }
                    if (open) {
                        val ex = explanations[row.key]
                        Row(Modifier.padding(start = 50.dp, end = 8.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            if (ex == null) {
                                val busy = explaining[row.key] == true
                                ToolLink(
                                    when { busy -> "Explaining…"; failed[row.key] == true -> "Explain failed — retry"; else -> "What’s going on here?" },
                                    enabled = !busy && online,
                                ) {
                                    explaining[row.key] = true
                                    failed[row.key] = false
                                    scope.launch {
                                        try { explanations[row.key] = s.explain(row) } catch (e: Exception) { failed[row.key] = true } finally { explaining[row.key] = false }
                                    }
                                }
                            }
                            if (!row.pinyin.isNullOrBlank() && !row.translation.isNullOrBlank()) {
                                ToolLink("+ Add as card", enabled = online) { adding = Chunk(row.hanzi, row.pinyin, row.translation) }
                            }
                        }
                        explanations[row.key]?.let { ex ->
                            SentenceBreakdown(
                                ex,
                                enabled = online,
                                onWord = { w -> adding = Chunk(w.hanzi, w.pinyin, w.gloss) },
                                modifier = Modifier.padding(start = 50.dp, end = 10.dp, bottom = 10.dp),
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            TextButton(onClick = { if (hasSet) generate(5, keep = true) else generate(6) }, enabled = online && !generating) {
                Text(if (generating) "Generating…" else if (hasSet) "+ 5 more sentences" else "✨ Generate example sentences", color = if (online) Lab.colors.accent else Lab.colors.muted)
            }
        }
        Spacer(Modifier.height(12.dp))
        adding?.let { chunk -> AddChunkSheet(chunk, note.deckId, s, onDismiss = { adding = null }) }
    }
}

/** Test tags on a breakdown word's two cells (the row merges them, so tests read the unmerged tree). */
const val BREAKDOWN_HANZI_TAG = "breakdown-hanzi"
const val BREAKDOWN_MEANING_TAG = "breakdown-meaning"

/**
 * "What's going on here?" — port of `renderExplanation` in SentenceSet.tsx (`.sentence-set-words`):
 * one word per full-width row, stacked top to bottom — the hanzi in its own column (as wide as the
 * longest word, so every row lines up), then pinyin + meaning, wrapping inside their column — and
 * the construction paragraph under the list. Each row adds that word as a card; inside the card
 * back's tap-keeping block it is interactive, so it never flips the card.
 */
@Composable
fun SentenceBreakdown(
    ex: SentenceExplanation,
    enabled: Boolean,
    onWord: (ExplainedWord) -> Unit,
    modifier: Modifier = Modifier,
) = Column(
    modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.card).padding(horizontal = 4.dp, vertical = 6.dp),
) {
    val hanziStyle = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Medium)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    // The hanzi column is as wide as the widest word (web: min-width 3.25rem), capped so a long
    // phrase can't squeeze the meanings out; a word wider than the cap wraps inside its column.
    val widest = remember(ex.words, hanziStyle, density) {
        with(density) { (ex.words.maxOfOrNull { measurer.measure(it.hanzi, hanziStyle, maxLines = 1).size.width } ?: 0).toDp() }
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val column = widest.coerceIn(52.dp, maxOf(52.dp, maxWidth * 0.4f))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (w in ex.words) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = enabled, onClickLabel = "Add ${w.hanzi} as a card") { onWord(w) }
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(Modifier.weight(1f)) {
                        Text(
                            w.hanzi, style = hanziStyle, color = Lab.colors.ink,
                            modifier = Modifier.width(column).alignByBaseline().testTag(BREAKDOWN_HANZI_TAG),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            buildAnnotatedString {
                                withStyle(SpanStyle(color = Lab.colors.accent)) { append(w.pinyin) }
                                if (w.pinyin.isNotBlank() && w.gloss.isNotBlank()) append("  ")
                                withStyle(SpanStyle(color = Lab.colors.ink.copy(alpha = 0.85f))) { append(w.gloss) }
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f).alignByBaseline().testTag(BREAKDOWN_MEANING_TAG),
                        )
                    }
                }
            }
        }
    }
    ex.construction?.takeIf { it.isNotBlank() }?.let {
        Spacer(Modifier.height(6.dp))
        MarkdownText(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

@Composable
private fun ToolLink(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = if (enabled) Lab.colors.accent else Lab.colors.muted,
        modifier = Modifier.heightIn(min = 36.dp).clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 6.dp, vertical = 10.dp),
    )
}

/** AddChunkModal: pick a deck (this card's first), warn on a duplicate, add. */
@Composable
fun AddChunkSheet(chunk: Chunk, preferredDeck: String, actions: SentenceActions, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss) { AddChunkBody(chunk, preferredDeck, actions, onDismiss) }
}

@Composable
fun AddChunkBody(chunk: Chunk, preferredDeck: String, actions: SentenceActions, onDismiss: () -> Unit) {
    var decks by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var deckId by remember { mutableStateOf(preferredDeck) }
    var duplicate by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        decks = actions.decks().sortedByDescending { it.first == preferredDeck }
        if (decks.none { it.first == deckId }) deckId = decks.firstOrNull()?.first.orEmpty()
    }
    LaunchedEffect(deckId) { duplicate = deckId.isNotEmpty() && runCatching { actions.deckHas(deckId, chunk.hanzi) }.getOrDefault(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp), verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(chunk.hanzi, style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink)
        Text(chunk.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
        Text(chunk.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        if (duplicate) InlineNotice("This word is already in the selected deck.", kind = NoticeKind.Warning)
        Text("Save to deck:", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth())
        ChipRow(Modifier.fillMaxWidth()) { for ((id, name) in decks) LabChip(name, selected = id == deckId) { deckId = id } }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryPill("Cancel", Modifier.weight(1f).height(50.dp), onClick = onDismiss)
            PrimaryPill(if (done) "✓ Added" else if (busy) "Adding…" else if (duplicate) "Add anyway" else "Add to deck", Modifier.weight(1f).height(50.dp), enabled = !busy && !done && deckId.isNotEmpty()) {
                busy = true
                error = null
                scope.launch {
                    try { actions.addCard(deckId, chunk); done = true; delay(800); onDismiss() } catch (e: Exception) { error = CardTools.message(e) } finally { busy = false }
                }
            }
        }
    }
}
