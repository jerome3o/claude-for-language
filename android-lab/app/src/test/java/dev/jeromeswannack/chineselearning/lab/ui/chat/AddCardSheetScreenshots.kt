package dev.jeromeswannack.chineselearning.lab.ui.chat

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
import dev.jeromeswannack.chineselearning.lab.core.PickerDecks
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.SuggestedCard
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordPanel
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkBody
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/**
 * The add-card sheets reached from chat with 25 decks: decks in study-queue order with the top
 * deck preselected, the chips in their own scrolling region, the add button pinned at the bottom.
 */
class AddCardSheetScreenshots : LabScreenshotTest() {
    private data class Deck(val id: String, val name: String, val priority: Int, val createdAt: String)

    /** 25 decks; this week's homework is at the top of the study queue. */
    private val all: List<Deck> = run {
        val names = listOf(
            "HSK 1", "HSK 2", "HSK 3 · Unit 1", "HSK 3 · Unit 2", "HSK 3 · Unit 3", "HSK 3 · Unit 4", "Homework · 第七课",
            "Homework · 第八课", "From my chats", "Weekend words", "Food & restaurants", "Travel · 火车站", "Measure words",
            "Chengyu", "Work small talk", "Family", "Weather", "Shopping", "Doctor & health", "Numbers & time",
            "Directions", "Hobbies", "Starter Chinese", "Reader words", "Tones drill",
        )
        val top = listOf("Homework · 第八课", "Homework · 第七课", "HSK 3 · Unit 4", "From my chats")
        names.mapIndexed { i, n ->
            val rank = top.indexOf(n)
            Deck("d$i", n, if (rank >= 0) 10 - rank else 0, "2026-0${1 + i % 9}-1${i % 10} 10:00:00")
        }
    }
    private val queued = PickerDecks.inQueueOrder(all, { it.priority }, { it.createdAt })
    private val pairs = queued.map { it.id to it.name }

    /** The real sheet: bottom-anchored, at most the screen minus the status gap; the content lays itself out (LabFooterSheet). */
    @Composable
    private fun Sheet(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f))) {
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 860.dp)
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 24.dp),
            ) { content() }
        }
    }

    @Test fun wordSheet() = shoot("add-card-01-word-sheet") {
        Sheet {
            ReaderWordPanel(
                ReaderWordDto("商店", "shāngdiàn", "shop"), "我昨天去商店买东西了。", known = false,
                actions = ReaderWordActions(decks = { queued.map { dev.jeromeswannack.chineselearning.lab.ui.readers.DeckChoice(it.id, it.name, null) } }),
                initialExplanation = ReaderWordExplanationDto(
                    "商店", "shāngdiàn", "shop; store", "商 is trade and 店 a shop: 商店 is any shop you buy things in. 去商店 = go to the shop.",
                ),
                startAdding = true,
            )
        }
    }

    @Test fun saveAsFlashcard() = shoot("add-card-02-save-as-flashcard") {
        Sheet { AddChunkBody(Chunk("周末你做了什么？", "zhōumò nǐ zuò le shénme", "What did you do at the weekend?"), "", SentenceActions(decks = { pairs }), onDismiss = {}) }
    }

    @Test fun makeFlashcards() = shoot("add-card-03-make-flashcards") {
        Sheet { ReviewPanel(S.review.copy(deckId = queued.first().id), queued.map { DeckChoice(it.id, it.name) }, online = true, actions = ReviewActions()) }
    }

    @Test fun saveToDeckList() = shoot("add-card-04-save-to-deck-list") {
        Sheet {
            Column(Modifier.padding(horizontal = 20.dp)) {
                CardPreview(SuggestedCard("下雨", "xià yǔ", "to rain", "下 (xià) fall + 雨 (yǔ) rain"))
                DeckPicker(S.student.copy(decks = queued.map { DeckChoice(it.id, it.name) }), 1, ChatSheetActions()) { _, _ -> }
            }
        }
    }

    @Test fun wordSheetDark() = shoot("add-card-05-word-sheet-dark", dark = true) {
        Sheet { AddChunkBody(Chunk("商店", "shāngdiàn", "shop"), "", SentenceActions(decks = { pairs }), onDismiss = {}) }
    }
}
