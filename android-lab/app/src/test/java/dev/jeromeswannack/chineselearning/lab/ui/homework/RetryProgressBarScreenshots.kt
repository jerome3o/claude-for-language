package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.RetryBar
import dev.jeromeswannack.chineselearning.lab.core.RetryBars
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.RETRY_BAR_TAG
import dev.jeromeswannack.chineselearning.lab.ui.kit.RetryProgressBar
import dev.jeromeswannack.chineselearning.lab.ui.study.CardStartState
import dev.jeromeswannack.chineselearning.lab.ui.study.PASS_RETRY_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/**
 * The pass's retry progress bar (docs/HOMEWORK.md §3c): blue = answers given, orange (hatched,
 * "↺ N") = Not yet words still owed at the right end. `./gradlew :app:recordRoborazziDebug` →
 * app/screenshots/hwretry-*.png: the study card at the start, after a few Not yet, on retries
 * (blue meets orange), and the bar's states side by side, light and dark.
 */
class RetryProgressBarScreenshots : LabScreenshotTest() {
    companion object {
        private val ids = (0 until 12).map { "n$it" }

        /** A pass walked answer by answer ("n3" to "wrong", …), one minute apart. */
        fun walk(vararg answers: Pair<String, String>): RetryBar {
            val events = answers.mapIndexed { i, (item, result) ->
                HomeworkEvent("e$i", "a1", item, result, "2026-10-22T10:%02d:00.000Z".format(i))
            }
            return RetryBars.passRetryBar(ids, events)
        }

        val start = walk()
        val notYet = walk("n0" to "right", "n1" to "wrong", "n2" to "right", "n3" to "wrong", "n4" to "right", "n5" to "wrong")
        val onRetries = walk(*(ids.map { it to if (it in setOf("n1", "n3", "n5")) "wrong" else "right" }.toTypedArray()))
        val lastRetry = walk(*(ids.map { it to if (it in setOf("n1", "n3", "n5")) "wrong" else "right" } + listOf("n1" to "right", "n3" to "wrong", "n5" to "right")).toTypedArray())
        val done = walk(*(ids.map { it to if (it == "n1") "wrong" else "right" } + listOf("n1" to "right")).toTypedArray())
    }

    @Composable
    private fun card(bar: RetryBar) = StudyScreen(
        PassStudyCardScreenshots.ui(), playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = false), autoplay = false,
        pass = PassStudyCardScreenshots.pass(done = bar.itemsDone, retrying = bar.retries).copy(bar = bar),
    )

    @Composable
    private fun States() {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            listOf("Start" to start, "After 3 × Not yet" to notYet, "Blue meets orange: on retries" to onRetries, "Last retry" to lastRetry, "Done" to done).forEach { (title, bar) ->
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(title, style = MaterialTheme.typography.labelLarge, color = Lab.colors.ink)
                    RetryProgressBar(bar, Modifier.fillMaxWidth())
                    Text(RetryBars.label(bar), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
            }
        }
    }

    @Test fun cardStart() = shoot("hwretry-01-start") { card(start) }
    @Test fun cardNotYet() = shoot("hwretry-02-after-not-yet") { card(notYet) }
    @Test fun cardOnRetries() = shoot("hwretry-03-on-retries") { card(onRetries) }
    @Test fun cardOnRetriesDark() = shoot("hwretry-04-on-retries-dark", dark = true) { card(onRetries) }
    @Test fun states() = shoot("hwretry-05-states") { States() }
    @Test fun statesDark() = shoot("hwretry-06-states-dark", dark = true) { States() }

    /** The bar reads without colour: its semantics carry the label; the note under it says where he is. */
    @Test fun semantics() {
        compose.setContent { dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme { card(onRetries) } }
        compose.onNodeWithTag(RETRY_BAR_TAG).assertContentDescriptionEquals("9 of 12 words done · 3 to retry")
        compose.onNodeWithTag(PASS_RETRY_TAG).assertExists()
        assert(onRetries.onRetries && notYet.retries == 3 && !notYet.onRetries && done.complete && done.doneFraction == 1.0)
        assert(notYet.doneFraction > 3.0 / 12) // the Not yets moved the blue too
    }
}
