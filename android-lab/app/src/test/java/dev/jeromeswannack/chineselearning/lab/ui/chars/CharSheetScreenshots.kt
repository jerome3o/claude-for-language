package dev.jeromeswannack.chineselearning.lab.ui.chars

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Bumps
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkBody
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkExisting
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** The character sheet (ui/chars): `char-sheet-*.png` → docs/pr-screenshots/character-dictionary/lab/. */
class CharSheetScreenshots : LabScreenshotTest() {
    private val decks = listOf("d1" to "Homework · 第八课", "d2" to "HSK 3 · Money & shopping", "d3" to "From my chats")
    private val fakeBump: BumpHanzi = { hanzi, _ -> Bumps.bumpedMessage(hanzi) }

    /** The card back behind (a plain stand-in) dimmed, the sheet over it from [top] dp. */
    @Composable
    private fun overCard(top: Int = 70, content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("银行", fontSize = 56.sp, color = Lab.colors.ink)
                Text("yínháng", color = Lab.colors.accent, fontSize = 22.sp)
                Text("bank", color = Lab.colors.ink, fontSize = 18.sp, textAlign = TextAlign.Center)
            }
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(top = top.dp)
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 12.dp, bottom = 16.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.muted.copy(alpha = 0.4f)))
                Spacer(Modifier.height(10.dp))
                content()
            }
        }
    }

    /** 行 from the 银行 card: two readings, facts, components, and the words — 银行 first (yellow), known dimmed. */
    @Test fun loaded() = shoot("char-sheet-01-loaded") {
        overCard { Column(Modifier.verticalScroll(rememberScrollState())) { CharacterSheetContent(CharSheetSamples.loaded()) } }
    }

    /** "✨ More about 行" answered. */
    @Test fun more() = shoot("char-sheet-02-more") {
        overCard { Column(Modifier.verticalScroll(rememberScrollState())) { CharacterSheetContent(CharSheetSamples.loaded(more = CharMore.Done(CharSheetSamples.EXPLANATION))) } }
    }

    /** A row they don't have yet (行业) → the add sheet, the top-of-queue deck picked. */
    @Test fun addNew() = shoot("char-sheet-03-add-new") {
        overCard(top = 300) {
            AddChunkBody(Chunk("行业", "hángyè", "industry; profession"), "", SentenceActions(decks = { decks }), onDismiss = {}, bump = fakeBump)
        }
    }

    /** A row they already have (进行, 📚 In your decks) → ⚡ Study it today first, Open card →. */
    @Test fun addExisting() = shoot("char-sheet-04-add-existing") {
        overCard(top = 300) {
            AddChunkBody(
                Chunk("进行", "jìnxíng", "to carry out; to be in progress"), "", SentenceActions(decks = { decks }), onDismiss = {}, bump = fakeBump,
                existing = AddChunkExisting(listOf("HSK 3 · Money & shopping"), onOpenCard = {}),
            )
        }
    }

    /** Offline, the character never cached: the notice, Write it still there (More about needs a connection when tapped). */
    @Test fun offline() = shoot("char-sheet-05-offline") {
        overCard(top = 520) { CharacterSheetContent(CharSheetUi("钱", CharDict.Lookup.Offline)) }
    }

    /** "More about" tapped offline. */
    @Test fun moreOffline() = shoot("char-sheet-06-more-offline") {
        overCard(top = 520) { CharacterSheetContent(CharSheetUi("钱", CharDict.Lookup.Offline, more = CharMore.Offline)) }
    }

    @Test fun dark() = shoot("char-sheet-07-dark", dark = true) {
        overCard { Column(Modifier.heightIn(max = 900.dp).verticalScroll(rememberScrollState())) { CharacterSheetContent(CharSheetSamples.loaded()) } }
    }
}
