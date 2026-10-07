package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetSamples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/**
 * Frequency decals in the explorer (`explorer-decals-*.png` →
 * docs/pr-screenshots/explorer-frequency-tiers/lab-*.png): outlines on the word and character
 * tiles from the shipped word-freq list, the ⓘ key open, light and dark.
 */
class ExplorerDecalScreenshots : LabScreenshotTest() {
    @Composable
    private fun sheet(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f))) {
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(top = 40.dp)
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 12.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.muted.copy(alpha = 0.4f)))
                Spacer(Modifier.height(8.dp))
                CompositionLocalProvider(LocalExplorer provides ExplorerController()) { content() }
            }
        }
    }

    private fun xing() = CharSheetSamples.loaded().copy(decalOf = ExplorerSamples.decals, keyOpen = true)

    /** 行: the glyph (top 100, purple), its components, "Words with 行" with a tile per word and the key open. */
    @Test fun charView() = shoot("explorer-decals-01-char") {
        sheet { CharacterView(xing(), listOf(ExplorerItem.Char("行")), canWrite = true) }
    }

    @Test fun charViewDark() = shoot("explorer-decals-02-char-dark", dark = true) {
        sheet { CharacterView(xing(), listOf(ExplorerItem.Char("行")), canWrite = true) }
    }

    private fun yinhang() = ExplorerSamples.wordUi(mine = MyWord(), item = ExplorerItem.Word("银行", "yínháng", "bank")).copy(keyOpen = true)

    /** 银行: the character chips (银 top 1,000, 行 top 100) and the related words with the key open. */
    @Test fun wordView() = shoot("explorer-decals-03-word") {
        sheet { WordView(yinhang(), listOf(ExplorerItem.Word("银行")), canOpenCard = true, canBump = true) }
    }

    @Test fun wordViewDark() = shoot("explorer-decals-04-word-dark", dark = true) {
        sheet { WordView(yinhang(), listOf(ExplorerItem.Word("银行")), canOpenCard = true, canBump = true) }
    }
}
