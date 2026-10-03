package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ImportPlanner
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.decks.DeckSettingsForm
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksSamples
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteActions
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteInputs
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteUi
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteWordsModel
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteWordsScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.EditCardActions
import dev.jeromeswannack.chineselearning.lab.ui.study.EditCardForm
import dev.jeromeswannack.chineselearning.lab.ui.teaching.DeckOption
import dev.jeromeswannack.chineselearning.lab.ui.teaching.SendHomeworkActions
import dev.jeromeswannack.chineselearning.lab.ui.teaching.SendHomeworkContent
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * Sticky sheet footers: the forms Jerome hit ("I have to scroll down a bunch to click Save"),
 * shot on the folded Fold (412×915dp) and on a short viewport (412×600dp — the keyboard half
 * up). Save / Send / Add stays on the bottom edge; only the middle scrolls.
 */
class StickySaveScreenshots : LabScreenshotTest() {

    /** A sheet over the dimmed screen, the way ModalBottomSheet draws it. */
    @Composable
    private fun Sheet(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.ink.copy(alpha = 0.32f))) {
            Column(
                Modifier.padding(top = 48.dp).fillMaxSize().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(Lab.colors.card).padding(top = 22.dp),
            ) { content() }
        }
    }

    private val editNote = Samples.note.copy(
        funFacts = "打 (dǎ) to hit, to do + 算 (suàn) to calculate: 打算 = to plan, to intend.\n" +
            "Used before a verb phrase: 我打算明年去中国。\nAlso a noun: 你有什么打算？ — what are your plans?\n" +
            "Contrast 计划 (jìhuà): more formal, a written plan.",
        alternatives = """["计划"]""",
    )

    private val decks = (1..24).map { DeckOption("d$it", if (it == 3) "Food & ordering" else "Homework week $it · 第${it}课", "Words from lesson $it", 18 + it) }

    @Composable private fun editCard() = Sheet { EditCardForm(editNote, aiAvailable = true, actions = EditCardActions(), onDismiss = {}, loadRecordings = false) }

    @Composable private fun deckSettings() = Sheet { DeckSettingsForm(DecksSamples.deck, { _, _, _, _ -> }, {}) }

    @Composable private fun sendHomework() = Sheet {
        SendHomeworkContent(
            "Jerome", decks, Loadable(), TeachingSamples.homeworkDecks, emptyList(), online = true, today = TeachingSamples.TODAY,
            actions = SendHomeworkActions(), initialDeck = decks[2], title = "Send homework to Jerome",
        )
    }

    @Composable private fun pasteList() {
        val text = (listOf("苹果\tpíngguǒ\tapple", "香蕉\txiāngjiāo\tbanana", "葡萄\tpútao\tgrape", "西瓜\txīguā\twatermelon", "草莓\tcǎoméi\tstrawberry", "橙子\tchéngzi\torange", "梨\tlí\tpear", "桃子\ttáozi\tpeach", "芒果\tmángguǒ\tmango", "樱桃\tyīngtáo\tcherry")).joinToString("\n")
        val inputs = PasteInputs(text = text)
        val existing = listOf(ImportPlanner.Existing("n1", "苹果", "píngguǒ", "apple"))
        PasteWordsScreen(PasteUi(inputs = inputs, derived = PasteWordsModel.derive(inputs, existing, dev.jeromeswannack.chineselearning.lab.core.Pinyin::toPinyin), deckName = "Fruit 水果"), PasteActions())
    }

    @Test fun editCardPhone() = shoot("lab-sticky-01-edit-card") { editCard() }

    @Config(qualifiers = SHORT) @Test fun editCardShort() = shoot("lab-sticky-02-edit-card-short") { editCard() }

    @Test fun deckSettingsPhone() = shoot("lab-sticky-03-deck-settings") { deckSettings() }

    @Config(qualifiers = SHORT) @Test fun deckSettingsShort() = shoot("lab-sticky-04-deck-settings-short") { deckSettings() }

    @Test fun pastePhone() = shoot("lab-sticky-05-paste-list") { pasteList() }

    @Config(qualifiers = SHORT) @Test fun pasteShort() = shoot("lab-sticky-06-paste-list-short") { pasteList() }

    @Test fun sendHomeworkPhone() = shoot("lab-sticky-07-send-homework") { sendHomework() }

    @Config(qualifiers = SHORT) @Test fun sendHomeworkShort() = shoot("lab-sticky-08-send-homework-short") { sendHomework() }

    companion object {
        const val SHORT = "w412dp-h600dp-xxhdpi"
    }
}
