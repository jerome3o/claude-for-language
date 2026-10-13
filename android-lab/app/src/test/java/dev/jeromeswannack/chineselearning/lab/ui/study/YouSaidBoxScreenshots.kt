package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import org.junit.Test

/**
 * The read card's "You said" box in every state, light and dark: green "Match", orange "Contains the
 * answer" with ▶ and the round ✎ Check in Coach, red "Didn't match", "Couldn't transcribe — tap to
 * retry" and "Transcribing…". `study-yousaid-NN-*` = the whole study card; `study-yousaid-box-*` = the
 * box on a minimal card back, beside `study-yousaid-before-*` (the box as it was until Oct 2026, kept
 * here only for the before / after comparison).
 */
class YouSaidBoxScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-10-11T09:30:00.000Z")
    private val note = Samples.note.copy(
        hanzi = "曾", pinyin = "céng", english = "once, at some time in the past",
        funFacts = "**曾** (céng) marks something that happened before, often with 过: 我曾去过中国 = I once went to China.\n- 曾经 céngjīng is the more common two-character form in speech.",
    )

    private fun ui(transcription: TranscriptionUi): StudyUi {
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 4 · Words", true, start = CardStartState(flipped = true))
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = true, forcedOffline = false, extras = CardExtras(take = TakeUi(hasTake = true, transcription = transcription)))
    }

    private fun done(text: String) = TranscriptionUi.Done(Transcription.compare(text, note.hanzi))
    private val states = listOf(
        "match" to done("曾"),
        "contains" to done("我曾经去过中国。"),
        "miss" to done("已经"),
        "failed" to TranscriptionUi.Failed,
        "transcribing" to TranscriptionUi.Working,
    )

    private fun card(name: String, t: TranscriptionUi, dark: Boolean) = shoot(name, dark = dark, settleMs = 2_000) {
        StudyScreen(ui(t), playingKey = null, actions = StudyActions(onYouSaidCoach = { _, _ -> }, onYouSaidPlay = {}), autoplay = false)
    }

    @Test fun match() = card("study-yousaid-01-match", done("曾"), dark = false)
    @Test fun matchDark() = card("study-yousaid-02-match-dark", done("曾"), dark = true)
    @Test fun contains() = card("study-yousaid-03-contains", done("我曾经去过中国。"), dark = false)
    @Test fun containsDark() = card("study-yousaid-04-contains-dark", done("我曾经去过中国。"), dark = true)
    @Test fun miss() = card("study-yousaid-05-miss", done("已经"), dark = false)
    @Test fun missDark() = card("study-yousaid-06-miss-dark", done("已经"), dark = true)
    @Test fun failed() = card("study-yousaid-07-failed", TranscriptionUi.Failed, dark = false)
    @Test fun failedDark() = card("study-yousaid-08-failed-dark", TranscriptionUi.Failed, dark = true)
    @Test fun working() = card("study-yousaid-09-transcribing", TranscriptionUi.Working, dark = false)
    @Test fun workingDark() = card("study-yousaid-10-transcribing-dark", TranscriptionUi.Working, dark = true)

    /** Every state stacked on a minimal card back: the new box, and the old one for comparison. */
    @Test fun boxesLight() = shoot("study-yousaid-box-light") { Boxes { NewBox(it) } }
    @Test fun boxesDark() = shoot("study-yousaid-box-dark", dark = true) { Boxes { NewBox(it) } }
    @Test fun beforeLight() = shoot("study-yousaid-before-light") { Boxes { LegacyBox(it) } }
    @Test fun beforeDark() = shoot("study-yousaid-before-dark", dark = true) { Boxes { LegacyBox(it) } }

    @Composable
    private fun Boxes(box: @Composable (TranscriptionUi) -> Unit) {
        Column(
            Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            states.forEach { (_, t) ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Lab.colors.card).padding(horizontal = 20.dp, vertical = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    box(t)
                    Spacer(Modifier.height(6.dp))
                    Text(note.pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent)
                }
            }
        }
    }

    @Composable
    private fun NewBox(t: TranscriptionUi) = when (t) {
        TranscriptionUi.Failed -> YouSaidFailed("Your recording is saved", {})
        TranscriptionUi.Working -> YouSaidPending()
        TranscriptionUi.Offline -> YouSaidOffline()
        is TranscriptionUi.Done -> YouSaidBox(t.result, onCoach = {}, onPlay = {})
    }

    /** The box until Oct 2026 (CardStage.kt `TintedBox` / `YouSaidBox`), for the before shots only. */
    @Composable
    private fun LegacyBox(t: TranscriptionUi) {
        @Composable
        fun tinted(text: String, tint: Color) = Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = Lab.colors.ink,
            textAlign = TextAlign.Center,
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(tint.copy(alpha = 0.12f)).border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 7.dp),
        )
        when (t) {
            TranscriptionUi.Failed -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(Palette.Again.copy(alpha = 0.10f))
                    .border(1.dp, Palette.Again.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
                    .padding(horizontal = 14.dp, vertical = 7.dp),
            ) {
                Text("Couldn’t transcribe — tap to retry", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center)
                Text("Your recording is saved", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
            }
            TranscriptionUi.Working -> tinted("Transcribing…", Palette.Easy)
            TranscriptionUi.Offline -> tinted("Recording saved, will transcribe when online", Lab.colors.muted)
            is TranscriptionUi.Done -> {
                val r = t.result
                val mark = if (r.isMatch || r.containsExpected) "✅" else "❌"
                val color = if (r.isMatch) Palette.Good else if (r.containsExpected) Palette.Hard else Palette.Again
                val text = "You said: ${r.transcribedPinyin} (${r.transcribedHanzi}) $mark" + (if (r.containsExpected && !r.isMatch) "\nAnswer found in your sentence" else "")
                if (r.isMatch || !r.containsExpected) {
                    tinted(text, color)
                } else {
                    Box(
                        Modifier.clip(RoundedCornerShape(10.dp)).background(color.copy(alpha = 0.12f)).border(1.dp, color.copy(alpha = 0.35f), RoundedCornerShape(10.dp)).padding(vertical = 7.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 52.dp))
                        Column(
                            Modifier.align(Alignment.CenterEnd).padding(end = 4.dp).size(width = 44.dp, height = 48.dp)
                                .clip(RoundedCornerShape(8.dp)).background(Lab.colors.card.copy(alpha = 0.7f))
                                .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(8.dp)),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text("✏️", fontSize = 15.sp)
                            Text("Check", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = color)
                        }
                    }
                }
            }
        }
    }
}
