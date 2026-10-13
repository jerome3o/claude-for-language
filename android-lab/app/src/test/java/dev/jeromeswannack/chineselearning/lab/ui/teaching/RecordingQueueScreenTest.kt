package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingMarkDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingQueueDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * "Needs your ear": tapping Listened springs the recording out of the queue (the tab count drops),
 * the last one leaves the empty state, the Reference button only shows when the card has a clip,
 * and the tabs switch views.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class RecordingQueueScreenTest {
    @get:Rule val compose = createComposeRule()

    private val P = TutorPagesSamples

    private fun host(start: RecordingQueueDto, marks: MutableList<Pair<String, String?>> = mutableListOf(), views: MutableList<String> = mutableListOf(), refs: MutableList<String> = mutableListOf()) {
        var data by mutableStateOf(start)
        compose.setContent {
            LabTheme {
                RecordingQueueScreen(
                    RecordingQueueUi("rel-jerome", "Jerome Swannack", data = data, loading = false),
                    RecordingQueueActions(
                        mark = { r, s, c -> marks += r.event_id to s; data = RecordingQueueRules.afterMark(data, r.event_id, s?.let { RecordingMarkDto(r.event_id, it, c) }) },
                        setView = { views += it },
                        playReference = { key, _ -> refs += key },
                    ),
                )
            }
        }
    }

    @Test fun listenedSpringsTheRecordingOutOfTheQueue() {
        val marks = mutableListOf<Pair<String, String?>>()
        host(P.queue, marks)
        compose.onNodeWithTag("recq-item-q1").assertIsDisplayed()
        compose.onNodeWithText("Needs your ear (4)").assertIsDisplayed()
        compose.onNodeWithTag("recq-listened-q1").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag("recq-item-q1").assertDoesNotExist()
        compose.onNodeWithTag("recq-item-q2").assertExists()
        compose.onNodeWithText("Needs your ear (3)").assertIsDisplayed()
        assertEquals(listOf("q1" to "listened"), marks)
    }

    @Test fun theLastOneLeavesTheEmptyState() {
        host(P.queue.copy(items = P.queue.items.take(1), counts = P.queue.counts.copy(queue = 1, all = 5, checking = 0)))
        compose.onNodeWithTag("recq-listened-q1").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag("recq-empty").assertIsDisplayed()
        compose.onNodeWithText("Nothing needs your ear 🎧 — 5 recordings in this range sound fine.").assertIsDisplayed()
    }

    @Test fun noReferenceButtonWithoutAClip() {
        host(P.queue.copy(items = P.queue.items.filter { it.event_id == "q3" }))
        compose.onNodeWithTag("recq-item-q3").assertIsDisplayed()
        compose.onNodeWithText("▶ Their recording").assertIsDisplayed()
        compose.onNodeWithText("▶ Reference").assertDoesNotExist()
    }

    @Test fun theNoteBoxRecordsAModelAnswerAndSavesItAsNeedsWork() {
        val started = mutableListOf<String>()
        val saved = mutableListOf<Triple<String, String, String?>>()
        var model by mutableStateOf(ModelRecUi())
        compose.setContent {
            LabTheme {
                RecordingQueueScreen(
                    RecordingQueueUi("rel-jerome", "Jerome Swannack", data = P.queue, loading = false, model = model),
                    RecordingQueueActions(
                        startModel = { started += it; model = ModelRecUi(recordingFor = it, elapsedMs = 1_000) },
                        stopModel = { model = ModelRecUi(drafts = mapOf("q1" to ModelDraftUi(durationMs = 1_900))) },
                        saveNote = { r, s, c -> saved += Triple(r.event_id, s, c) },
                    ),
                )
            }
        }
        compose.onNodeWithTag("recq-note-q1").performClick()
        compose.onNodeWithTag("recq-model-q1").assertIsDisplayed()
        compose.onNodeWithText("🎤 Record it").performClick()
        assertEquals(listOf("q1"), started)
        compose.onNodeWithText("⏹ Stop · 0:01").performClick()
        compose.onNodeWithText("▶ Your take · 0:01").assertIsDisplayed()
        compose.onNodeWithText("Needs work + recording").performClick()
        assertEquals(listOf(Triple("q1", "needs_work", null as String?)), saved)
    }

    @Test fun aSavedModelRecordingPlaysFromTheCard() {
        val played = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                RecordingQueueScreen(
                    RecordingQueueUi("rel-jerome", "Jerome Swannack", view = "all", data = P.queueAll, loading = false),
                    RecordingQueueActions(playModelSaved = { played += it }),
                )
            }
        }
        compose.onNodeWithTag("recq-model-saved-q6").assertExists()
        compose.onNodeWithText("▶ Your recording").performClick()
        assertEquals(listOf("/api/recording-marks/q6/model-audio?v=a1b2c3d4e5f6"), played)
    }

    @Test fun referencePlaysTheCardClipAndTabsSwitch() {
        val views = mutableListOf<String>()
        val refs = mutableListOf<String>()
        host(P.queue, views = views, refs = refs)
        compose.onAllNodesWithText("▶ Reference").onFirst().performClick()
        assertEquals(listOf("generated/n7.mp3"), refs)
        compose.onNodeWithTag("recq-tab-all").performClick()
        assertEquals(listOf("all"), views)
        compose.onNodeWithTag("recq-checking").assertIsDisplayed()
    }
}
