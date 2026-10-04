package dev.jeromeswannack.chineselearning.lab.ui.bumps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.BumpWord
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatScreen
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatUi
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachSamples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** The Coach's "⚡ Study … today" chip and picker (core SentenceBumps): `coach-bump-*.png`. */
class SentenceBumpScreenshots : LabScreenshotTest() {
    private val words = listOf(
        BumpWord("n1", "商店", "shāngdiàn", "shop; store"),
        BumpWord("n2", "苹果", "píngguǒ", "apple"),
        BumpWord("n3", "昨天", "zuótiān", "yesterday"),
        BumpWord("n4", "买", "mǎi", "to buy"),
    )
    private val ui = CoachChatUi(thread = Loadable(CoachSamples.thread), decks = CoachSamples.decks, deckId = "d1")

    /** Some of the sentence's words are cards: one chip that opens the picker (no bare count). */
    @Test fun wordsChip() = shoot("coach-bump-01-words-chip") {
        CoachChatScreen(ui.copy(bumpWords = words), CoachChatActions())
    }

    /** The picker: longest words first, nothing ticked by default; 买 already bumped (⚡). One ticked here. */
    @Test fun picker() = shoot("coach-bump-02-picker") {
        Box(Modifier.fillMaxSize()) {
            CoachChatScreen(ui.copy(bumpWords = words), CoachChatActions())
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 24.dp),
            ) {
                SentenceBumpForm(words, bumpedIds = setOf("n4"), onAdd = {}, onCancel = {}, initialPicked = setOf("n1"))
            }
        }
    }

    /** The sentence is itself one of his cards: "⚡ Study this today" bumps only it. */
    @Test fun exactChip() = shoot("coach-bump-03-exact-chip") {
        CoachChatScreen(ui.copy(bumpExact = BumpWord("s", "我昨天去商店买了苹果。", "", "")), CoachChatActions())
    }

    /** After "⚡ Add 1 to today". */
    @Test fun bumped() = shoot("coach-bump-04-bumped") {
        CoachChatScreen(ui.copy(bumpWords = words, bumpedNoteIds = setOf("n1"), bumpMessage = "⚡ 商店 will come first in today’s study"), CoachChatActions())
    }
}
