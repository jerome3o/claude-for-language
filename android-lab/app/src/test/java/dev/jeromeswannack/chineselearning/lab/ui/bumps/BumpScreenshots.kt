package dev.jeromeswannack.chineselearning.lab.ui.bumps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatScreen
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatUi
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachSamples
import dev.jeromeswannack.chineselearning.lab.ui.home.DeckSummary
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.readers.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderWordPanel
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkBody
import dev.jeromeswannack.chineselearning.lab.ui.study.CardView
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SessionStats
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** "⚡ Study it today" (data/bumps/BumpStore.kt): `bump-*.png` → docs/pr-screenshots/claude-bump-to-today/lab-*.png. */
class BumpScreenshots : LabScreenshotTest() {
    private val decks = listOf("d1" to "HSK 3 · Plans & time", "d2" to "Homework · 第八课", "d3" to "From my chats")
    private val fakeBump: BumpHanzi = { hanzi, _ -> dev.jeromeswannack.chineselearning.lab.core.Bumps.bumpedMessage(hanzi) }

    @Composable
    private fun sheet(behind: @Composable () -> Unit, content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize()) {
            behind()
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 24.dp, bottom = 16.dp),
            ) { content() }
        }
    }

    private val coachUi = CoachChatUi(thread = Loadable(CoachSamples.thread), decks = CoachSamples.decks, deckId = "d1",
        bumpWords = listOf(
            dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.BumpWord("n1", "商店", "shāngdiàn", "shop; store"),
            dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.BumpWord("n2", "苹果", "píngguǒ", "apple"),
        ),
    )

    /** The Coach: 商店 is already a card → "⚡ Study it today" first, "Add anyway" second. */
    @Test fun coachDuplicate() = shoot("bump-01-coach") {
        sheet({ CoachChatScreen(coachUi, CoachChatActions()) }) {
            AddChunkBody(
                Chunk("商店", "shāngdiàn", "shop; store"), "d1",
                SentenceActions(decks = { decks }, deckHas = { _, _ -> true }), onDismiss = {}, bump = fakeBump,
            )
        }
    }

    /** A reader word that is already a card. */
    @Test fun readerWordSheet() = shoot("bump-02-sheet") {
        sheet({ Box(Modifier.fillMaxSize().background(Lab.colors.background)) }) {
            ReaderWordPanel(
                ReaderWordDto("打算", "dǎsuàn", "to plan"), "我打算明年去中国学习中文。", known = true,
                actions = ReaderWordActions(decks = { decks.map { DeckChoice(it.first, it.second, null) } }),
                initialExplanation = ReaderWordExplanationDto("打算", "dǎsuàn", "to plan; to intend", "打算 + verb: what you plan to do. 我打算明年去中国 = I plan to go to China next year."),
                bump = fakeBump,
            )
        }
    }

    @Test fun home() = shoot("bump-03-home") {
        HomeScreen(
            ui = HomeUi(
                loaded = true, userName = "Jerome Swannack", due = QueueCounts(3, 2, 2, 17), reviewedToday = 12, bumped = 1,
                decks = listOf(
                    DeckSummary("d1", "HSK 3 · Plans & time", 120, QueueCounts(3, 2, 2, 9)),
                    DeckSummary("d2", "Homework · 第八课", 24, QueueCounts(0, 0, 0, 6)),
                    DeckSummary("d3", "From my chats", 58, QueueCounts(0, 0, 0, 2)),
                ),
            ),
            sync = SyncStatus(lastSyncAt = System.currentTimeMillis() - 120_000),
            online = true,
            actions = HomeActions(),
        )
    }

    /** A card from the pocket: "⚡ from Minghui" (a tutor bumped it) beside the card type. */
    @Test fun studyCard() = shoot("bump-04-card") {
        val now = Js.parseDate("2026-10-04T09:30:00.000Z")
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-09-20T08:00:00.000Z")
        state = CardScheduler.applyReview(state, 2, "2026-09-20T08:12:00.000Z")
        state = CardScheduler.applyReview(state, 2, "2026-09-24T08:00:00.000Z")
        val card = QueueCard("c1", Samples.note.id, "d1", CardTypes.HANZI_TO_MEANING, state.copy(queue = CardQueue.REVIEW))
        val view = CardView(card, Samples.note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Plans & time", bumped = true, bumpedBy = "Minghui")
        StudyScreen(
            StudyUi(StudyPhase.Showing(view), QueueCounts(3, 2, 2, 17), SessionStats(reviews = 4, correct = 4), canUndo = true),
            playingKey = null, actions = StudyActions(), autoplay = false,
        )
    }

    /** The Coach's quick-action chip once the sentence's words are cards, just after tapping it. */
    @Test fun coachChip() = shoot("bump-05-coach-chip") {
        CoachChatScreen(coachUi.copy(bumpMessage = "⚡ 商店 and 苹果 will come first in today’s study"), CoachChatActions())
    }
}
