package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.core.HomeworkSend
import dev.jeromeswannack.chineselearning.lab.data.api.JobReaderDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S
import org.junit.Test

/** Create, then send: the finished job with Send buttons, the confirm, after sending, and the form's hint. */
class HomeworkSendScreenshots : LabScreenshotTest() {
    @OptIn(ExperimentalRoborazziApi::class)
    private fun shootScreen(name: String, content: @Composable () -> Unit) {
        compose.setContent { LabTheme(dark = false) { content() } }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        captureScreenRoboImage("screenshots/$name.png")
    }

    /** Made in the tutor's account, nothing sent yet: deck, mini lesson and reader. */
    private val unsent = DraftSamples.job.copy(
        id = "sj-new", review = null,
        result = DraftSamples.job.result.copy(reader = JobReaderDto("rd1", "At the restaurant", "在饭馆", 6)),
    )
    private val sent = unsent.copy(
        result = unsent.result.copy(
            deck = unsent.result.deck!!.copy(target_deck_id = "t1"),
            lessons = unsent.result.lessons.map { it.copy(lesson_id = "l1") },
            reader = unsent.result.reader!!.copy(target_reader_id = "tr1"),
        ),
    )
    private val actions = JobActions(send = { _, _, _ -> }, remove = {})

    @Test fun unsentJob() = shoot("send-01-unsent") {
        SessionNotesScreen(SessionNotesUi("rel-jerome", "Jerome Swannack", listOf(unsent) + DraftSamples.jobs.drop(1)), actions, back = {}, submit = { _, _, _, _, _, _, _ -> }, now = S.now)
    }

    @Test fun confirmAll() = shootScreen("send-02-confirm-all") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            SessionJobCard(unsent, actions, S.now, "Jerome Swannack", initialConfirmSend = unsentKeys())
        }
    }

    private fun unsentKeys(): List<String> = listOf("deck", "lesson:${unsent.result.lessons[0].library_item_id}", "reader")

    @Test fun afterSending() = shoot("send-03-sent") {
        SessionNotesScreen(
            SessionNotesUi("rel-jerome", "Jerome Swannack", listOf(sent), toast = HomeworkSend.sentToast(listOf("a", "b", "c"), "Jerome Swannack")),
            actions, back = {}, submit = { _, _, _, _, _, _, _ -> }, now = S.now,
        )
    }

    @Test fun formHint() = shoot("send-04-form") {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) { SessionNotesForm("Jerome", true, { _, _, _, _, _, _, _ -> }) {} }
    }
}
