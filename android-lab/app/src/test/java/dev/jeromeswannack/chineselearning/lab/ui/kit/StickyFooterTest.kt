package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditActions
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditForm
import dev.jeromeswannack.chineselearning.lab.ui.decks.DeckSettingsForm
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksSamples
import dev.jeromeswannack.chineselearning.lab.ui.study.EditCardActions
import dev.jeromeswannack.chineselearning.lab.ui.study.EditCardForm
import dev.jeromeswannack.chineselearning.lab.ui.teaching.DeckOption
import dev.jeromeswannack.chineselearning.lab.ui.teaching.InviteForm
import dev.jeromeswannack.chineselearning.lab.ui.teaching.SendHomeworkActions
import dev.jeromeswannack.chineselearning.lab.ui.teaching.SendHomeworkContent
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * "Save is always on screen": on a short phone viewport (412×600dp — the Fold's outer screen
 * with the keyboard half up) every converted form keeps its primary action visible without any
 * scrolling, however long its content is (many decks, many fields, a long card). The content
 * itself is longer than the screen (its last field is NOT displayed), so the footer really is
 * pinned and not merely short enough to fit.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h600dp-xxhdpi", application = android.app.Application::class)
class StickyFooterTest {
    @get:Rule val compose = createComposeRule()

    /** The sheet as the app shows it: a card-coloured panel under a 48dp strip of the screen behind. */
    private fun showSheet(content: @Composable () -> Unit) {
        compose.setContent {
            LabTheme {
                Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(top = 48.dp)) {
                    Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(top = 16.dp)) { content() }
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
    }

    private fun SemanticsNodeInteraction.assertOnScreen() {
        assertIsDisplayed()
        val root = compose.onRoot().getBoundsInRoot()
        val b = getBoundsInRoot()
        assertTrue("button bottom ${b.bottom} is below the screen ${root.bottom}", b.bottom <= root.bottom)
        assertTrue("button top ${b.top} is above the screen", b.top >= root.top)
    }

    private val manyDecks = (1..40).map { DeckOption("deck$it", "Homework deck $it · 第${it}课", "Words from lesson $it", 20 + it) }

    @Test
    fun editCardSaveIsVisibleWithoutScrolling() {
        val longNote = Samples.note.copy(
            funFacts = (1..12).joinToString("\n") { "Line $it: 打 (dǎ) to hit + 算 (suàn) to calculate — together: to plan." },
            alternatives = """["计划","准备","想要"]""",
        )
        // Many recordings / sentence rows under the fields (the card editor's media section).
        val media = EditCardActions(media = { _, _ -> Column { (1..15).forEach { Text("Recording $it", Modifier.padding(12.dp)) } } })
        showSheet { EditCardForm(longNote, aiAvailable = true, actions = media, onDismiss = {}, loadRecordings = false) }

        compose.onNodeWithText("Save").assertOnScreen()
        compose.onNodeWithText("Cancel").assertOnScreen()
        // The form really is longer than the screen: its last rows are below the fold…
        compose.onNodeWithText("Recording 15").assertIsNotDisplayed()
        // …and scrolling to them keeps Save where it was.
        compose.onNodeWithText("Recording 15").performScrollTo()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText("Recording 15").assertIsDisplayed()
        compose.onNodeWithText("Save").assertOnScreen()
    }

    @Test
    fun deckPageNoteEditorAddWordIsVisible() {
        showSheet {
            NoteEditForm(
                DecksSamples.edit.copy(noteId = null),
                NoteEditActions(onGenerateSentence = {}),
            )
        }
        compose.onNodeWithText("Add word").assertOnScreen()
        compose.onNodeWithText("Translation").assertIsNotDisplayed()
    }

    @Test
    fun deckSettingsSaveIsVisible() {
        showSheet { DeckSettingsForm(DecksSamples.deck, { _, _, _, _ -> }, {}) }
        compose.onNodeWithText("Save").assertOnScreen()
    }

    @Test
    fun sendHomeworkSendIsVisibleWithManyDecks() {
        showSheet {
            SendHomeworkContent(
                "Jerome", manyDecks, Loadable(), emptyList(), emptyList(), online = true, today = TeachingSamples.TODAY,
                actions = SendHomeworkActions(), initialDeck = manyDecks[3], title = "Send homework to Jerome",
            )
        }
        compose.onNodeWithText("Send deck").assertOnScreen()
        compose.onNodeWithText("Back").assertOnScreen()
    }

    @Test
    fun inviteCreateLinkIsVisibleWithManyDecks() {
        showSheet { InviteForm(manyDecks, online = true, create = { _, _, _ -> }, title = "Invite a student") {} }
        compose.onNodeWithText("Create link").assertOnScreen()
        compose.onNodeWithText(manyDecks.last().name).assertIsNotDisplayed()
    }
}
