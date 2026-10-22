package dev.jeromeswannack.chineselearning.lab.ui.study

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
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.OtherCardTypes
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** ⋯ → "Practise this word other ways…" (core OtherCardTypes): `other-card-types-*.png`. */
class OtherCardTypesScreenshots : LabScreenshotTest() {
    private val day = 86_400_000L
    private val cutoff = 1_792_000_000_000L
    private val blank = CardScheduler.initialCardState()
    private fun card(id: String, type: String, queue: Int, due: Long?) = QueueCard(id, "n", "d", type, blank.copy(queue = queue, dueTimestamp = due))

    /** On the read card: English → 汉字 is new (ticked), Listen → 汉字 is in review, due in 12 days. */
    private val rows = OtherCardTypes.rows(
        listOf(
            card("h", CardTypes.HANZI_TO_MEANING, 2, cutoff - day),
            card("m", CardTypes.MEANING_TO_HANZI, 0, null),
            card("a", CardTypes.AUDIO_TO_HANZI, 2, cutoff + 11 * day + 5 * 3_600_000L),
        ),
        "h", cutoff,
    )

    @androidx.compose.runtime.Composable
    private fun overScrim(content: @androidx.compose.runtime.Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 24.dp),
            ) { content() }
        }
    }

    @Test fun sheet() = shoot("other-card-types-01-sheet") {
        overScrim { OtherCardsForm("银行", OtherCardsUi(rows, OtherCardTypes.defaultPicks(rows).toSet(), loading = false), OtherCardsActions(), onDismiss = {}, autoClose = false) }
    }

    @Test fun bothTicked() = shoot("other-card-types-02-both") {
        overScrim { OtherCardsForm("银行", OtherCardsUi(rows, setOf("m", "a"), loading = false), OtherCardsActions(), onDismiss = {}, autoClose = false) }
    }

    @Test fun added() = shoot("other-card-types-03-added") {
        overScrim {
            OtherCardsForm(
                "银行",
                OtherCardsUi(rows, setOf("m"), loading = false, done = OtherCardTypes.addedMessage(listOf("English → 汉字"))),
                OtherCardsActions(), onDismiss = {}, autoClose = false,
            )
        }
    }
}
