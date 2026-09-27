package dev.jeromeswannack.chineselearning.lab.ui.study

import android.graphics.Color
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The top-bar counts: which bucket the card is in, and the image the tap copies. */
class QueueCountsScreenshots : LabScreenshotTest() {
    private val now = Js.parseDate("2026-09-27T09:30:00.000Z")

    /** A card in [queue] (NEW 0, LEARNING 1, REVIEW 2). */
    private fun ui(queue: Int, secondary: Boolean = false): StudyUi {
        var state = CardScheduler.initialCardState()
        if (queue != CardQueue.NEW) state = CardScheduler.applyReview(state, 2, "2026-09-27T09:20:00.000Z")
        if (queue == CardQueue.REVIEW) {
            state = CardScheduler.applyReview(state, 2, "2026-09-27T09:21:00.000Z")
            state = CardScheduler.applyReview(state, 2, "2026-09-27T09:29:00.000Z")
        }
        val card = QueueCard("c1", Samples.note.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, Samples.note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Plans & time", isSecondaryNew = secondary)
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true)
    }

    private fun study(ui: StudyUi, copy: CountsCopy? = null) = shoot(name(ui, copy)) {
        StudyScreen(ui, playingKey = null, actions = StudyActions(), autoplay = false, initialCountsCopy = copy)
    }

    private fun name(ui: StudyUi, copy: CountsCopy?) = when {
        copy == CountsCopy.COPIED -> "study-c05-counts-copied"
        else -> when (ui.activeBucket) {
            CountBucket.NEW -> "study-c01-counts-new"
            CountBucket.SECONDARY -> "study-c02-counts-secondary"
            CountBucket.LEARNING -> "study-c03-counts-learning"
            else -> "study-c04-counts-review"
        }
    }

    @Test fun activeNew() = study(ui(CardQueue.NEW))
    @Test fun activeSecondary() = study(ui(CardQueue.NEW, secondary = true))
    @Test fun activeLearning() = study(ui(CardQueue.LEARNING))
    @Test fun activeReview() = study(ui(CardQueue.REVIEW))
    @Test fun copied() = study(ui(CardQueue.REVIEW), CountsCopy.COPIED)

    @Test fun copiedImage() {
        val counts = QueueCounts(new = 3, secondaryNew = 2, learning = 1, review = 18)
        val bitmap = QueueCountsShare.render(counts)
        assertTrue("wider than tall", bitmap.width > bitmap.height)
        assertEquals(Color.WHITE, bitmap.getPixel(2, 2))
        shoot("study-c06-counts-image") {
            Column(
                Modifier.fillMaxSize().background(Lab.colors.background).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("What a tap on the counts puts on the clipboard:", color = Lab.colors.muted)
                Image(bitmap.asImageBitmap(), "Study counts image", Modifier.fillMaxWidth())
            }
        }
    }

    @Test fun buckets() {
        assertEquals(CountBucket.NEW, CountBucket.of(0, false))
        assertEquals(CountBucket.SECONDARY, CountBucket.of(0, true))
        assertEquals(CountBucket.LEARNING, CountBucket.of(1, false))
        assertEquals(CountBucket.LEARNING, CountBucket.of(3, false)) // relearning
        assertEquals(CountBucket.REVIEW, CountBucket.of(2, true))
        assertNull(CountBucket.of(null, false))
        assertEquals("3 + 2 + 1 + 18", QueueCountsShare.text(QueueCounts(3, 2, 1, 18)))
        // A lesson / reader on screen highlights nothing.
        assertNull(StudyUi(StudyPhase.Done, Samples.counts).activeBucket)
    }
}
