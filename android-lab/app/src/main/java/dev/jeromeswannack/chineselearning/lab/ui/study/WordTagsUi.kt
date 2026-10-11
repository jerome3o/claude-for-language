package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
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
import dev.jeromeswannack.chineselearning.lab.core.explorer.FrequencyDecal
import dev.jeromeswannack.chineselearning.lab.ui.explorer.decalStyle
import dev.jeromeswannack.chineselearning.lab.ui.explorer.frequencyDecal
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * Word tags (docs/STUDY_SESSION.md "Word tags"; web components/wordTags/WordTagPills.tsx):
 * the quiet pills under the meaning on the answer side and in the explorer's Word view — part of
 * speech, separable verb, register, measure word, HSK level, how common, traditional form — from
 * the shipped lexicon (core WordTags, parity-tested). A tap opens the one-line explanation.
 */

const val WORD_TAGS_TAG = "word-tags"
const val WORD_TAG_SHEET_TAG = "word-tag-sheet"
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
            .semantics { role = Role.Button; contentDescription = "${tag.label} — what it means" }
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
        Text(tag.label, color = fg, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
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
fun WordTagSheet(tag: WordTag, explanation: WordTagExplanation, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss) {
        WordTagSheetContent(tag, explanation, onDismiss)
    }
}

/** The sheet's body (stateless; screenshot tests render it without the modal). */
@Composable
fun WordTagSheetContent(tag: WordTag, explanation: WordTagExplanation, onDismiss: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).testTag(WORD_TAG_SHEET_TAG)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            WordTagPill(tag, onClick = null)
            Spacer(Modifier.width(10.dp))
            Text(explanation.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        }
        Spacer(Modifier.height(12.dp))
        Text(explanation.body, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        if (explanation.example.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Text(
                explanation.example, fontSize = 18.sp, color = Lab.colors.ink,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 12.dp, vertical = 8.dp),
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
    modifier: Modifier = Modifier,
    exclude: Set<String> = emptySet(),
    centred: Boolean = true,
) {
    val context = LocalContext.current
    val prefs = remember { StudyPrefs.get(context) }
    val on by prefs.wordTagsOn.collectAsState()
    val lexicon = rememberWordTagLexicon()
    var open by rememberSaveable(hanzi) { mutableStateOf<String?>(null) }
    if (!on || lexicon == null) return
    val tags = remember(hanzi, lexicon, exclude) {
        val key = WordTags.key(hanzi)
        val freq = WordFrequency.shipped
        val rank = freq?.let { if (key.codePointCount(0, key.length) == 1) it.chars[key] else it.words[key] }
        WordTags.tags(hanzi, lexicon, rankLoaded = freq != null, rank = rank, exclude = exclude)
    }
    WordTagPillsRow(tags, onTap = { t ->
        open = t.id
        (context.applicationContext as? LabApp)?.analytics?.track("study.word_tag_open", mapOf("kind" to t.kind, "tag" to t.id, "source" to source))
    }, centred = centred, modifier = modifier)
    val tag = tags.firstOrNull { it.id == open }
    if (tag != null) WordTagSheet(tag, WordTags.explanation(tag, hanzi, lexicon)) { open = null }
}
