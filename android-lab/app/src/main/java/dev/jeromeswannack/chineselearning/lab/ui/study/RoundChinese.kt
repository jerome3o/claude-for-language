package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSegmentInput
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Where the explorer was opened from: an answered Sentence round row ("+ Add as card" → "From example sentences"). */
const val SENTENCE_ROUND_EXPLORER_SOURCE = "sentence_round"

/**
 * A Sentence round row's Chinese (the web's components/study/RoundChinese.tsx; docs/STUDY_SESSION.md
 * "Sentence round"): once the row is answered — a "Read it aloud" take judged, a "Say it in Chinese" answer
 * revealed, a listen exercise's reveal — every word opens the language explorer (source `sentence_round`,
 * core SourceDecks → "From example sentences"). Words from the device segmenter ([DeviceWords]; character by
 * character until its lists load). Before that — the sentence is the question, or a take is recording — plain
 * text. The words look like the plain line (no tint, no underline, no chips).
 */
@Composable
fun RoundChinese(text: String, explorable: Boolean, modifier: Modifier = Modifier) {
    val tagged = modifier.testTag(SentenceRoundTags.CHINESE)
    if (!explorable) {
        Text(text, tagged, color = Lab.colors.ink, fontSize = 22.sp)
        return
    }
    val segments = remember(text, DeviceWords.of(text) != null) {
        DeviceWords.of(text)?.map { WordSegmentInput(it.text, it.pinyin, it.gloss) }
    }
    ExplorableText(text, source = SENTENCE_ROUND_EXPLORER_SOURCE, modifier = tagged, segments = segments, fontSize = 22.sp, color = Lab.colors.ink)
}
