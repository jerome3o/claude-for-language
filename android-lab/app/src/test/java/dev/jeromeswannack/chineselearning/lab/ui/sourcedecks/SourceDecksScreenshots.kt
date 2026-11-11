package dev.jeromeswannack.chineselearning.lab.ui.sourcedecks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.api.AddedNote
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.decks.DeckCardUi
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksActions
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksTabScreen
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.AddedToDeckRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.SourceDeckActions
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.readers.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordPanel
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkBody
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/**
 * Source decks (docs/STUDY_SESSION.md "Source decks"): the add-card sheet BEFORE (deck chips to
 * pick from) and AFTER (one tap, "✓ Added to From readers · Change"), and the Decks tab with the
 * source decks in it.
 */
class SourceDecksScreenshots : LabScreenshotTest() {
    private val decks = listOf("HSK 3 · Plans & time", "Homework — 周末的活动", "Food & ordering", "Travel · 火车站", "Starter Chinese")
        .mapIndexed { i, n -> DeckChoice("d$i", n, null) }

    private val explanation = ReaderWordExplanationDto(
        "咖啡", "kāfēi", "coffee", "A loanword: 咖 and 啡 were made for its sound. 喝咖啡 = drink coffee; 一杯咖啡 = a cup of coffee.",
    )

    @Composable
    private fun Sheet(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f))) {
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 860.dp)
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 24.dp),
            ) { content() }
        }
    }

    /** Before: "+ Add as card" opened the deck chips — pick one, then "Add to deck". */
    @Test fun before() = shoot("source-decks-01-before-picker") {
        Sheet {
            ReaderWordPanel(
                ReaderWordDto("咖啡", "kāfēi", "coffee"), "他喝了一杯咖啡。", known = false,
                actions = ReaderWordActions(decks = { decks }),
                initialExplanation = explanation,
                startAdding = true,
            )
        }
    }

    /** After: one tap saved it into "From example sentences"; Change moves it. */
    @Test fun afterSentenceWord() = shoot("source-decks-02-after-added") {
        Sheet {
            AddChunkBody(
                Chunk("周末", "zhōumò", "weekend"), "",
                SentenceActions(
                    addCard = { _, _ -> AddedNote(listOf("n1"), "d-src", "From example sentences", "sentences") },
                    move = SourceDeckActions(),
                ),
                onDismiss = {},
                bump = null,
            )
        }
    }

    /** The line itself, after a reader word and after Change. */
    @Test fun lines() = shoot("source-decks-03-lines") {
        Sheet {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                AddedToDeckRow(AddedNote(listOf("n1"), "d-r", "From readers", "readers"), SourceDeckActions())
                Box(Modifier.padding(top = 12.dp)) {
                    AddedToDeckRow(AddedNote(listOf("n1", "n2", "n3"), "d-c", "From chats", "chats"), SourceDeckActions())
                }
            }
        }
    }

    /** The Decks tab: the source decks are ordinary decks (renamable, movable in the queue). */
    @Test fun decksList() = shootInShell("source-decks-04-decks-list", TabId.MORE) {
        DecksTabScreen(
            DecksUi(
                loaded = true,
                newPerDay = 3,
                decks = listOf(
                    DeckCardUi("s1", "From readers", 6, QueueCounts(0, 0, 0, 3), hasMoreNew = true, totalCards = 18, mastered = 0, learning = 2),
                    DeckCardUi("s2", "From Claude", 4, QueueCounts(0, 1, 0, 3), hasMoreNew = true, totalCards = 12, mastered = 0, learning = 1),
                    DeckCardUi("s3", "From chats", 3, QueueCounts(0, 0, 0, 3), hasMoreNew = false, totalCards = 9, mastered = 0, learning = 0),
                    DeckCardUi("d1", "Homework — 周末的活动", 24, QueueCounts(3, 2, 1, 0), hasMoreNew = true, totalCards = 72, mastered = 12, learning = 20),
                    DeckCardUi("d2", "HSK 3 · Plans & time", 120, QueueCounts(0, 0, 0, 0), hasMoreNew = true, totalCards = 360, mastered = 150, learning = 60),
                ),
            ),
            DecksActions(),
        )
    }
}
