package dev.jeromeswannack.chineselearning.lab.ui.explorer

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CharWordStatus
import dev.jeromeswannack.chineselearning.lab.core.CharWords
import dev.jeromeswannack.chineselearning.lab.core.explorer.CharWordList
import dev.jeromeswannack.chineselearning.lab.core.explorer.DictWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.FrequencyTier
import dev.jeromeswannack.chineselearning.lab.core.explorer.RelatedWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.RelatedWords
import dev.jeromeswannack.chineselearning.lab.core.explorer.ResolvedWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordChar
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordNoteLike
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSource
import dev.jeromeswannack.chineselearning.lab.data.api.CharRecordDto
import dev.jeromeswannack.chineselearning.lab.data.api.CharWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * The explorer's Word view (docs/LANGUAGE_EXPLORER.md "Word view"): head (hanzi ▶, pinyin,
 * English, how common), a chip per character coloured by tone, the learner's own card, the
 * dictionary senses, the sentence it was tapped in + their own cards using it, "✨ More about
 * this word" and related words. Stateless: [WordViewUi] in, taps out — the host loads the data.
 */

/** "✨ More about this word": idle → asking → the explanation / offline / error. */
sealed interface WordMore {
    data object Idle : WordMore
    data object Loading : WordMore
    data class Done(val value: ReaderWordExplanationDto) : WordMore
    data object Offline : WordMore
    data class Error(val message: String) : WordMore
}

/** A related word with its ✓ Known / 📚 In your decks status. */
data class RelatedRow(val related: RelatedWord<CharWordDto>, val status: CharWordStatus)

data class WordViewUi(
    val item: ExplorerItem.Word,
    /** The word dictionary lookup (null = still looking). */
    val lookup: WordDict.Lookup? = null,
    /** The character records on the device, by character. */
    val charRecords: Map<String, CharRecordDto> = emptyMap(),
    /** The learner's own card / notes (null = not read yet). */
    val mine: MyWord? = null,
    /** Rank in the shipped word-freq list. */
    val rank: Int? = null,
    val more: WordMore = WordMore.Idle,
    val online: Boolean = true,
    /** Statuses of the related words (hanzi → status; missing = none). */
    val statuses: Map<String, CharWordStatus> = emptyMap(),
    /** A bump's message ("⚡ 银行 is in today's study"). */
    val bumped: String? = null,
    /** Rank of a related word in the shipped word-freq list. */
    val rankOf: (String) -> Int? = { null },
) {
    val hanzi: String get() = item.hanzi
    private val chars: List<String> get() = hanzi.codePoints().toArray().map { String(Character.toChars(it)) }
    val record get() = (lookup as? WordDict.Lookup.Ok)?.record

    /** Port of the web's resolution: dictionary, character lists, the learner's card, the tapped place. */
    val resolved: ResolvedWord
        get() = ExplorerWord.resolveWord(
            hanzi,
            record?.toCore(),
            charWords = chars.mapNotNull { charRecords[it] }.flatMap { r -> r.words.map { DictWord(it.hanzi, it.pinyin, it.english) } },
            notes = mine?.card?.let { listOf(WordNoteLike(hanzi, it.pinyin, it.english)) },
            hintPinyin = item.pinyin,
            hintGloss = item.gloss,
            rank = rank,
        )

    val wordChars: List<WordChar> get() = resolved.let { ExplorerWord.wordChars(hanzi, it.pinyin, it.syllables) }

    val related: List<RelatedRow>
        get() = RelatedWords.relatedWords(
            hanzi,
            chars.distinct().mapNotNull { c -> charRecords[c]?.let { CharWordList(c, it.words) } },
            { it.hanzi },
            rankOf,
        ).map { RelatedRow(it, statuses[it.word.hanzi] ?: CharWordStatus.None) }

    /** The sentence "More about this word" explains it in: the hint sentence, else the first example, else the word. */
    val explainSentence: String get() = item.sentence?.takeIf { it.isNotBlank() } ?: mine?.examples?.firstOrNull()?.text ?: hanzi
}

/**
 * A character chip's short meaning (web WordView): the record's reading whose pinyin is this
 * character's syllable in the word (行 in 银行 → háng "row"), else the record's meaning; the
 * part before the first ';' or ','.
 */
fun charChipMeaning(record: CharRecordDto?, syllable: String?): String? {
    record ?: return null
    val reading = syllable?.takeIf { it.isNotBlank() }?.let { s ->
        val n = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFC).lowercase()
        record.readings.firstOrNull { java.text.Normalizer.normalize(it.pinyin, java.text.Normalizer.Form.NFC).lowercase() == n }
    }
    val text = reading?.english?.takeIf { it.isNotBlank() } ?: record.meaning
    return text.split(';', ',').first().trim().ifBlank { null }
}

/** Tone colours of the syllable under each character (1 red · 2 green · 3 blue · 4 purple · neutral grey). */
@Composable
fun toneColor(tone: Int?): Color = when (tone) {
    1 -> Color(0xFFE53935)
    2 -> Color(0xFF2E9D4A)
    3 -> Color(0xFF2F6FDB)
    4 -> Color(0xFF8E44C9)
    else -> Lab.colors.muted
}

@Composable
private fun isDark() = Lab.colors.card.luminance() < 0.4f

class WordViewActions(
    val onPlay: () -> Unit = {},
    val onChar: (String) -> Unit = {},
    val onWord: (ExplorerItem) -> Unit = {},
    val onMore: () -> Unit = {},
)

const val EXPLORER_WORD_TAG = "explorer-word"
const val EXPLORER_WORD_CHAR_TAG = "explorer-word-char"
const val EXPLORER_RELATED_TAG = "explorer-related"
const val EXPLORER_MORE_TAG = "explorer-more"

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WordViewContent(ui: WordViewUi, actions: WordViewActions, modifier: Modifier = Modifier) {
    val r = ui.resolved
    val dark = isDark()
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag(EXPLORER_WORD_TAG)) {
        // Head: hanzi + ▶ · pinyin · English · how common
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(ui.hanzi, fontSize = 46.sp, lineHeight = 54.sp, fontWeight = FontWeight.Medium, color = Lab.colors.ink, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(14.dp))
            Box(
                Modifier.size(48.dp).bouncyClickable(pressedScale = 0.9f, onClick = actions.onPlay).clip(CircleShape).background(Lab.colors.accentSoft).testTag("explorer-play"),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.AutoMirrored.Filled.VolumeUp, "Play the word", Modifier.size(24.dp), tint = Lab.colors.accent) }
        }
        if (r.pinyin.isNotBlank()) Text(r.pinyin, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)
        if (r.english.isNotBlank()) {
            Spacer(Modifier.height(2.dp))
            Text(r.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        }
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val f = ExplorerWord.wordFrequencyLabel(r.rank)
            val c = when (f.tier) {
                FrequencyTier.TOP -> Palette.Good
                FrequencyTier.COMMON -> Palette.Easy
                FrequencyTier.UNCOMMON -> Palette.Hard
                FrequencyTier.RARE -> Lab.colors.muted
            }
            Pill(f.text, c.copy(alpha = if (dark) 0.22f else 0.13f), if (f.tier == FrequencyTier.RARE) Lab.colors.muted else c)
            when (r.source) {
                WordSource.YOUR_CARD -> Pill("From your card", Lab.colors.faint, Lab.colors.muted)
                WordSource.CONTEXT -> Pill("From the text", Lab.colors.faint, Lab.colors.muted)
                else -> Unit
            }
        }
        if (ui.lookup == WordDict.Lookup.Offline && r.source != WordSource.DICTIONARY) {
            Spacer(Modifier.height(10.dp))
            InlineNotice("You’re offline — the dictionary entry loads next time you’re online. Showing what’s on this phone.", kind = NoticeKind.Offline, modifier = Modifier.testTag("explorer-word-offline"))
        } else if (ui.lookup is WordDict.Lookup.Error) {
            Spacer(Modifier.height(10.dp))
            InlineNotice("Couldn’t load the dictionary entry: ${(ui.lookup as WordDict.Lookup.Error).message}", kind = NoticeKind.Error)
        }

        // Characters, each with its syllable coloured by tone → the Character view
        Spacer(Modifier.height(14.dp))
        SectionLabel("Characters")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (wc in ui.wordChars) {
                val meaning = charChipMeaning(ui.charRecords[wc.char], wc.syllable)
                Column(
                    Modifier.widthIn(min = 64.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint)
                        .bouncyClickable { actions.onChar(wc.char) }.testTag(EXPLORER_WORD_CHAR_TAG)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(wc.char, fontSize = 30.sp, lineHeight = 36.sp, color = toneColor(wc.tone).takeIf { wc.tone != null } ?: Lab.colors.ink)
                    wc.syllable?.takeIf { it.isNotBlank() }?.let { syl -> Text(syl, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = toneColor(wc.tone)) }
                    if (!meaning.isNullOrBlank()) Text(meaning, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 110.dp))
                }
            }
        }

        // Your card
        ui.mine?.card?.let { card ->
            Spacer(Modifier.height(14.dp))
            Text(
                "📚 You have this in ${card.deckName.ifBlank { "your decks" }}",
                style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                color = if (dark) Color(0xFF93C5FD) else Color(0xFF1E40AF),
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                    .background(if (dark) Palette.Easy.copy(alpha = 0.18f) else Color(0xFFDBEAFE))
                    .padding(horizontal = 12.dp, vertical = 10.dp).testTag("explorer-your-card"),
            )
        }
        ui.bumped?.let {
            Spacer(Modifier.height(8.dp))
            InlineNotice(it, kind = NoticeKind.Success)
        }

        // Meaning: the dictionary senses
        if (r.senses.size > 1 || (r.senses.size == 1 && r.senses[0] != r.english)) {
            Spacer(Modifier.height(16.dp))
            SectionLabel("Meaning")
            r.senses.forEachIndexed { i, s ->
                Row(Modifier.padding(vertical = 2.dp)) {
                    Text("${i + 1}.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.width(22.dp))
                    Text(s, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                }
            }
        }

        // In context: the sentence it was tapped in + the learner's own cards using it
        val sentence = ui.item.sentence?.takeIf { it.isNotBlank() && it.trim() != ui.hanzi }
        val examples = ui.mine?.examples.orEmpty()
        if (sentence != null || examples.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            SectionLabel("In context")
            sentence?.let {
                ExplorableText(
                    it, source = "explorer", fontSize = 20.sp, lineHeight = 30.sp, highlight = ui.hanzi,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
            if (examples.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("In your cards", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                for (ex in examples) {
                    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).testTag("explorer-example")) {
                        ExplorableText(ex.text, source = "explorer", fontSize = 18.sp, lineHeight = 27.sp, highlight = ui.hanzi)
                        ex.translation?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted) }
                    }
                }
            }
        }

        // ✨ More about this word
        Spacer(Modifier.height(14.dp))
        when (val m = ui.more) {
            WordMore.Idle -> if (ui.online) SecondaryPill("✨ More about this word", Modifier.heightIn(min = 46.dp).testTag(EXPLORER_MORE_TAG), onClick = actions.onMore)
            else Text("✨ More about this word · Needs internet", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.testTag("explorer-more-offline"))
            WordMore.Loading -> MoreBox { Text("Asking Claude…", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
            is WordMore.Done -> MoreBox(Modifier.testTag("explorer-more-done")) { MarkdownText(m.value.explanation, style = MaterialTheme.typography.bodyMedium) }
            WordMore.Offline -> MoreBox { Text("Needs internet — everything above works offline.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
            is WordMore.Error -> MoreBox {
                Text(
                    buildAnnotatedString {
                        append(m.message)
                        append(" ")
                        withStyle(SpanStyle(color = Lab.colors.accent, fontWeight = FontWeight.SemiBold)) { append("Try again") }
                    },
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                    modifier = Modifier.heightIn(min = 32.dp).clickable(onClick = actions.onMore),
                )
            }
        }

        // Related words
        val related = ui.related
        if (related.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = Lab.colors.cardBorder)
            Spacer(Modifier.height(12.dp))
            SectionLabel("Related words")
            val shared = ui.hanzi.codePoints().toArray().map { String(Character.toChars(it)) }.toSet()
            for (row in related) RelatedWordRow(row, shared) {
                ExplorerStack.itemForText(row.related.word.hanzi, row.related.word.pinyin, row.related.word.english)?.let(actions.onWord)
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun Pill(text: String, bg: Color, fg: Color) {
    Text(
        text, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = fg,
        modifier = Modifier.clip(CircleShape).background(bg).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

@Composable
private fun RelatedWordRow(row: RelatedRow, explored: Set<String>, onClick: () -> Unit) {
    val dark = isDark()
    val known = row.status == CharWordStatus.Known
    val w = row.related.word
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).bouncyClickable(onClick = onClick).testTag(EXPLORER_RELATED_TAG).padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            buildAnnotatedString {
                for (cp in w.hanzi.codePoints().toArray()) {
                    val s = String(Character.toChars(cp))
                    if (s in explored) withStyle(SpanStyle(color = Lab.colors.accent)) { append(s) } else append(s)
                }
            },
            fontSize = 22.sp, color = Lab.colors.ink,
            modifier = Modifier.widthIn(min = 64.dp).alpha(if (known) 0.6f else 1f),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).alpha(if (known) 0.6f else 1f)) {
            if (w.pinyin.isNotBlank()) Text(w.pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(w.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (row.status != CharWordStatus.None) {
            Spacer(Modifier.width(8.dp))
            val (bg, fg) = when (row.status) {
                CharWordStatus.Known -> if (dark) Palette.Good.copy(alpha = 0.2f) to Color(0xFF86EFAC) else Color(0xFFDCFCE7) to Color(0xFF166534)
                else -> if (dark) Palette.Easy.copy(alpha = 0.2f) to Color(0xFF93C5FD) else Color(0xFFDBEAFE) to Color(0xFF1E40AF)
            }
            Text(
                CharWords.label(row.status), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 1,
                modifier = Modifier.clip(CircleShape).background(bg).padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
    }
    HorizontalDivider(color = Lab.colors.cardBorder.copy(alpha = 0.6f))
}

@Composable
private fun MoreBox(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val dark = isDark()
    AnimatedVisibility(true, enter = fadeIn() + expandVertically()) {
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
