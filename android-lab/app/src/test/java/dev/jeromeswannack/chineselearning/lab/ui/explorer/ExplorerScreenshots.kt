package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CharWords
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetSamples
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** The language explorer (ui/explorer): `explorer-*.png` → docs/pr-screenshots/language-explorer/lab-*.png. */
class ExplorerScreenshots : LabScreenshotTest() {
    /** A study card behind (dimmed), the explorer sheet over it, as tall as its content (≤ the screen minus the status bar). */
    @Composable
    private fun overCard(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Column(Modifier.fillMaxWidth().padding(top = 60.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("银行", fontSize = 56.sp, color = Lab.colors.ink)
                Text("yínháng", color = Lab.colors.accent, fontSize = 22.sp)
                Text("bank", color = Lab.colors.ink, fontSize = 18.sp, textAlign = TextAlign.Center)
            }
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 860.dp)
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 12.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.muted.copy(alpha = 0.4f)))
                Spacer(Modifier.height(8.dp))
                // Inside the shell the explorer is in reach, so the sentences are tappable.
                CompositionLocalProvider(LocalExplorer provides ExplorerController()) { content() }
            }
        }
    }

    private fun yinUi(): CharSheetUi {
        val rows = CharWords.rows(ExplorerSamples.yin.words, listOf(dev.jeromeswannack.chineselearning.lab.core.CharStatusNote("n", "银行")), listOf(dev.jeromeswannack.chineselearning.lab.core.CharStatusCard("n", 2, 9.0)), "银行") { it.hanzi }
        return CharSheetUi("银", CharDict.Lookup.Ok(ExplorerSamples.yin), rows)
    }

    /** Tapped 银 on the 银行 card: the Character view in the stack — components tappable, words open the Word view, ✍️ Write it pinned. */
    @Test fun charView() = shoot("explorer-01-char-view") {
        overCard { CharacterView(yinUi(), listOf(ExplorerItem.Char("银")), canWrite = true) }
    }

    /** 银 › 银行: the Word view of a word they have — 📚 You have this in …, Open card + ⚡ Study it today. */
    @Test fun wordWithCard() = shoot("explorer-02-word-with-card") {
        overCard { WordView(ExplorerSamples.wordUi(), listOf(ExplorerItem.Char("银"), ExplorerSamples.item()), canOpenCard = true, canBump = true) }
    }

    /** A word from a reader page they don't have: + Add as card, "More about this word" answered. */
    @Test fun wordWithoutCard() = shoot("explorer-03-word-new") {
        overCard {
            WordView(
                ExplorerSamples.wordUi(mine = MyWord(examples = ExplorerSamples.mine.examples.take(1)), more = WordMore.Done(ExplorerSamples.explanation)),
                listOf(ExplorerSamples.item()), canOpenCard = true, canBump = true,
            )
        }
    }

    /** Deep in: 银行 › 银 › 银子 › 子 › 孩子 › 行 — the breadcrumb keeps the first and the last two. */
    @Test fun deepStack() = shoot("explorer-04-deep-stack") {
        val stack = listOf(ExplorerSamples.item(), ExplorerItem.Char("银"), ExplorerItem.Word("银子"), ExplorerItem.Char("子"), ExplorerItem.Word("孩子"), ExplorerItem.Char("行"))
        overCard { CharacterView(CharSheetSamples.loaded(), stack, canWrite = true) }
    }

    /** Offline, the word never looked up: the reader chip's pinyin / gloss, the characters on the phone, More about needs internet. */
    @Test fun wordOffline() = shoot("explorer-05-word-offline") {
        overCard {
            WordView(
                ExplorerSamples.wordUi(mine = MyWord(), lookup = WordDict.Lookup.Offline, online = false)
                    .copy(item = ExplorerItem.Word("银行", "yínháng", "bank", "明天我要去银行办卡。"), charRecords = mapOf("银" to ExplorerSamples.yin)),
                listOf(ExplorerItem.Word("银行", "yínháng", "bank", "明天我要去银行办卡。")), canOpenCard = true, canBump = true,
            )
        }
    }

    @Test fun wordDark() = shoot("explorer-06-word-dark", dark = true) {
        overCard { WordView(ExplorerSamples.wordUi(), listOf(ExplorerItem.Char("银"), ExplorerSamples.item()), canOpenCard = true, canBump = true) }
    }

    // ── Quick drills (explorer-drill-*.png → docs/pr-screenshots/language-explorer-drills/lab-*.png) ──

    /** 银行 and its related words, seed 3: meaning · listen · tone · tone · write. */
    private fun drill(): List<dev.jeromeswannack.chineselearning.lab.core.explorer.DrillQuestion> {
        val (target, pool) = wordDrill(ExplorerSamples.wordUi()) ?: error("no drill")
        return dev.jeromeswannack.chineselearning.lab.core.explorer.Drill.buildDrill(target, pool, 3)
    }

    private val drillStack = listOf(ExplorerItem.Char("银"), ExplorerSamples.item())

    /** 🎯 1 / 5 — "What does it mean?" with four English options. */
    @Test fun drillMeaning() = shoot("explorer-drill-01-meaning") {
        overCard { DrillView(drillStack, drill()) }
    }

    /** "Which tone is 行 here?" — the word with the character highlighted, five tone buttons. */
    @Test fun drillTone() = shoot("explorer-drill-02-tone") {
        val qs = drill()
        val i = qs.indexOfLast { it.kind == dev.jeromeswannack.chineselearning.lab.core.explorer.DrillKind.TONE }
        overCard { DrillView(drillStack, qs, initial = DrillUiState(index = i, correct = i)) }
    }

    /** Answered wrong: the pick in red, the right one in green, the pinyin revealed, Next →. */
    @Test fun drillAnswered() = shoot("explorer-drill-03-answered") {
        val qs = drill()
        val q = qs[0]
        overCard { DrillView(drillStack, qs, initial = DrillUiState(index = 0, picked = (q.answer + 1) % q.options.size)) }
    }

    /** The score: 4 / 5 — 很好！Nice, 🎉, practice only, Again / Keep exploring. */
    @Test fun drillDone() = shoot("explorer-drill-04-done") {
        overCard { DrillView(drillStack, drill(), initial = DrillUiState(index = 4, correct = 4, done = true)) }
    }
}
