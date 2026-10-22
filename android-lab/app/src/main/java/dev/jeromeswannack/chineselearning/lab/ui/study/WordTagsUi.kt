package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.WordFrequency
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTag
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTagExplanation
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTagLexicon
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTags
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTagsAi
import dev.jeromeswannack.chineselearning.lab.core.explorer.FrequencyDecal
import dev.jeromeswannack.chineselearning.lab.ui.explorer.decalStyle
import dev.jeromeswannack.chineselearning.lab.ui.explorer.frequencyDecal
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.dropWhile
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.TextUnit
import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSegmentInput
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalInExplorer

/*
 * Word tags (docs/STUDY_SESSION.md "Word tags"; web components/wordTags/WordTagPills.tsx):
 * the quiet pills under the meaning on the answer side and in the explorer's Word view — part of
 * speech, separable verb, register, measure word, HSK level, how common, traditional form — from
 * the shipped lexicon (core WordTags, parity-tested). Where the lexicon has nothing, the note's
 * AI verdict (notes.word_tags, core WordTagsAi) adds transitivity / a register, marked ✨.
 * A tap opens the one-line explanation.
 */

const val WORD_TAGS_TAG = "word-tags"
const val WORD_TAG_SHEET_TAG = "word-tag-sheet"
const val WORD_TAG_SHEET_AI_TAG = "word-tag-sheet-ai"
const val WORD_TAG_SHEET_NOTE_TAG = "word-tag-sheet-note"
const val WORD_TAG_SHEET_EXAMPLE_TAG = "word-tag-sheet-example"
const val WORD_TAG_SHEET_HINT_TAG = "word-tag-sheet-hint"
fun wordTagTestTag(id: String) = "word-tag-$id"

/** The web's tone tints (wordTags.css): background + text, light and dark. */
private object WordTagColors {
    private val light = mapOf(
        "plain" to (Color(0xFFF3F4F6) to Color(0xFF4B5563)),
        "grammar" to (Color(0xFFEDE9FE) to Color(0xFF5B21B6)),
        "formal" to (Color(0xFFE0F2FE) to Color(0xFF075985)),
        "casual" to (Color(0xFFFEF3C7) to Color(0xFF92400E)),
        "warning" to (Color(0xFFFEE2E2) to Color(0xFF991B1B)),
        "level" to (Color(0xFFCCFBF1) to Color(0xFF115E59)),
    )
    private val dark = mapOf(
        "plain" to (Color(0xFF2A2A30) to Color(0xFFD4D4D8)),
        "grammar" to (Color(0xFF2E2348) to Color(0xFFC4B5FD)),
        "formal" to (Color(0xFF12304A) to Color(0xFF7DD3FC)),
        "casual" to (Color(0xFF3A2A10) to Color(0xFFFCD34D)),
        "warning" to (Color(0xFF3F1D1D) to Color(0xFFFCA5A5)),
        "level" to (Color(0xFF113532) to Color(0xFF5EEAD4)),
    )

    /** A frequency tone has no tint: the card colour with the explorer's decal outline. */
    @Composable
    fun of(tone: String): Pair<Color, Color> {
        val isDark = Lab.colors.card.luminance() < 0.4f
        return (if (isDark) dark else light)[tone] ?: (Lab.colors.card to Lab.colors.ink)
    }
}

private fun decalOf(tone: String): FrequencyDecal? = FrequencyDecal.entries.firstOrNull { it.wire == tone }

/** One pill (also the header of the explanation sheet). */
@Composable
fun WordTagPill(tag: WordTag, onClick: (() -> Unit)?, modifier: Modifier = Modifier) {
    val (bg, fg) = WordTagColors.of(tag.tone)
    val shape = RoundedCornerShape(50)
    val tappable = if (onClick != null) {
        modifier.bouncyClickable(pressedScale = 0.94f, onClick = onClick).testTag(wordTagTestTag(tag.id))
            .semantics { role = Role.Button; contentDescription = "${tag.label}${if (tag.ai) " (suggested by AI)" else ""} — what it means" }
    } else {
        modifier
    }
    Box(
        tappable
            .heightIn(min = 32.dp)
            .clip(shape)
            .background(bg)
            .frequencyDecal(decalStyle(decalOf(tag.tone)), shape)
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // An AI-suggested pill (core WordTagsAi): the same tint, a small ✨ before the label.
            if (tag.ai) Text("✨", fontSize = 10.sp, modifier = Modifier.padding(end = 3.dp))
            Text(tag.label, color = fg, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        }
    }
}

/** The row of pills (stateless, for screenshots). Centred under the meaning, or start-aligned in the explorer. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WordTagPillsRow(tags: List<WordTag>, onTap: (WordTag) -> Unit, centred: Boolean = true, modifier: Modifier = Modifier) {
    if (tags.isEmpty()) return
    FlowRow(
        modifier.testTag(WORD_TAGS_TAG),
        horizontalArrangement = Arrangement.spacedBy(6.dp, if (centred) Alignment.CenterHorizontally else Alignment.Start),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (t in tags) WordTagPill(t, onClick = { onTap(t) })
    }
}

/** The tiny explanation sheet: the pill, what it means, one example, where it comes from. */
@Composable
fun WordTagSheet(tag: WordTag, explanation: WordTagExplanation, onExplore: ((ExplorerItem) -> Unit)? = null, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss) {
        WordTagSheetContent(tag, explanation, onExplore, onDismiss)
    }
}

private fun hasHan(text: String): Boolean = text.codePoints().anyMatch { Known.isHan(it) }

/**
 * A line of the sheet: plain without Chinese, else explorable by WORD (the device segmenter,
 * [DeviceWords]; by character until its lists are loaded) — the register note's "use 人品 or
 * 脾气 in casual speech" → tap 人品 → the explorer (web WordTagPills SheetChinese).
 */
@Composable
private fun SheetText(
    text: String,
    onExplore: ((ExplorerItem) -> Unit)?,
    style: TextStyle = LocalTextStyle.current,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontWeight: FontWeight? = null,
    modifier: Modifier = Modifier,
) {
    if (!hasHan(text)) {
        Text(text, style = style, fontSize = fontSize, fontWeight = fontWeight, color = Lab.colors.ink, modifier = modifier)
        return
    }
    val words = DeviceWords.of(text)
    ExplorableText(
        text,
        source = "word_tag",
        segments = words?.map { WordSegmentInput(it.text, it.pinyin.ifBlank { null }, it.gloss.ifBlank { null }) },
        style = style,
        fontSize = fontSize,
        fontWeight = fontWeight,
        underline = true,
        onTap = onExplore,
        modifier = modifier,
    )
}

/** The sheet's body (stateless; screenshot tests render it without the modal). */
@Composable
fun WordTagSheetContent(tag: WordTag, explanation: WordTagExplanation, onExplore: ((ExplorerItem) -> Unit)? = null, onDismiss: () -> Unit) {
    val tappable = remember(explanation) { listOf(explanation.title, explanation.body, explanation.note, explanation.example).any(::hasHan) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).testTag(WORD_TAG_SHEET_TAG)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            WordTagPill(tag, onClick = null)
            Spacer(Modifier.width(10.dp))
            SheetText(explanation.title, onExplore, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        if (explanation.ai) {
            Spacer(Modifier.height(12.dp))
            val dark = Lab.colors.card.luminance() < 0.4f
            Text(
                "✨ ${WordTagsAi.AI_WORD_TAG_NOTICE}",
                style = MaterialTheme.typography.bodyMedium,
                color = if (dark) Color(0xFFFDE68A) else Color(0xFF713F12),
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                    .background(if (dark) Color(0xFF3A3210) else Color(0xFFFEF9C3))
                    .padding(horizontal = 10.dp, vertical = 6.dp).testTag(WORD_TAG_SHEET_AI_TAG),
            )
        }
        Spacer(Modifier.height(12.dp))
        SheetText(explanation.body, onExplore, style = MaterialTheme.typography.bodyLarge)
        if (explanation.note.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Row(Modifier.height(androidx.compose.foundation.layout.IntrinsicSize.Min).testTag(WORD_TAG_SHEET_NOTE_TAG)) {
                Box(Modifier.width(3.dp).fillMaxHeight().background(Lab.colors.faint))
                Spacer(Modifier.width(10.dp))
                SheetText(explanation.note, onExplore, style = MaterialTheme.typography.bodyLarge)
            }
        }
        if (explanation.example.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            SheetText(
                explanation.example, onExplore, fontSize = 18.sp,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 12.dp, vertical = 8.dp)
                    .testTag(WORD_TAG_SHEET_EXAMPLE_TAG),
            )
        }
        if (tappable) {
            Spacer(Modifier.height(10.dp))
            Text(
                "Tap any Chinese word to explore it or add it as a card.",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.testTag(WORD_TAG_SHEET_HINT_TAG),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text("Source: ${explanation.source}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            PrimaryPill("Got it", onClick = onDismiss)
        }
    }
}

/** The shipped lexicon, parsed off the main thread once (null while loading / unreadable). */
@Composable
private fun rememberWordTagLexicon(): WordTagLexicon? {
    val lexicon by produceState(initialValue = if (WordTags.shippedLoaded) WordTags.shipped else null) {
        if (value == null) value = withContext(Dispatchers.Default) { WordTags.shipped }
    }
    return lexicon
}

/**
 * The word tags of [hanzi] (stateful: the Settings switch, the shipped lexicon and frequency
 * list, the explanation sheet, analytics). [source] = study | explorer; [exclude] = kinds left
 * out (the explorer shows how common a word is itself).
 */
@Composable
fun WordTagsFor(
    hanzi: String,
    source: String,
    /** The note's AI word tags (notes.word_tags JSON); null = lexicon only. */
    aiTags: String? = null,
    modifier: Modifier = Modifier,
    exclude: Set<String> = emptySet(),
    centred: Boolean = true,
) {
    val context = LocalContext.current
    val prefs = remember { StudyPrefs.get(context) }
    val on by prefs.wordTagsOn.collectAsState()
    val lexicon = rememberWordTagLexicon()
    var open by rememberSaveable(hanzi) { mutableStateOf<String?>(null) }
    val ai = remember(aiTags) { WordTagsAi.parse(aiTags) }
    if (!on || lexicon == null) return
    val tags = remember(hanzi, lexicon, exclude, ai) {
        val key = WordTags.key(hanzi)
        val freq = WordFrequency.shipped
        val rank = freq?.let { if (key.codePointCount(0, key.length) == 1) it.chars[key] else it.words[key] }
        WordTagsAi.tags(hanzi, lexicon, ai, rankLoaded = freq != null, rank = rank, exclude = exclude)
    }
    WordTagPillsRow(tags, onTap = { t ->
        open = t.id
        (context.applicationContext as? LabApp)?.analytics?.track(
            "study.word_tag_open",
            mapOf("kind" to t.kind, "tag" to t.id, "source" to source, "tag_source" to if (t.ai) "ai" else "lexicon"),
        )
    }, centred = centred, modifier = modifier)
    // A word tapped in the sheet: the sheet steps aside for the explorer and — when the explorer
    // was opened from here, not pushed inside one — comes back when it closes (web: onClosed).
    val explorer = LocalExplorer.current
    val inside = LocalInExplorer.current
    var parked by rememberSaveable(hanzi) { mutableStateOf<String?>(null) }
    LaunchedEffect(parked, explorer) {
        val p = parked ?: return@LaunchedEffect
        val ex = explorer ?: return@LaunchedEffect
        snapshotFlow { ex.isOpen }.dropWhile { !it }.first { !it }
        open = p
        parked = null
    }
    val tag = tags.firstOrNull { it.id == open }
    if (tag != null) {
        WordTagSheet(
            tag,
            WordTagsAi.explanation(tag, hanzi, lexicon, ai),
            onExplore = { item ->
                (context.applicationContext as? LabApp)?.analytics?.track(
                    "study.word_tag_word",
                    mapOf("kind" to tag.kind, "tag_source" to if (tag.ai) "ai" else "lexicon", "item" to item.kind, "inside" to inside),
                )
                open = null
                if (!inside) parked = tag.id
            },
        ) { open = null }
    }
}
