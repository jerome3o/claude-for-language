package dev.jeromeswannack.chineselearning.lab.ui.bumps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.SentenceBumps
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.BumpWord
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatScreen
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatUi
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachSamples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The Coach's "⚡ Study … today" (core SentenceBumps): the words picker starts with NOTHING
 * ticked, "⚡ Add N to today" bumps exactly the ticked words, a word already in today's pocket
 * shows ⚡ and can't be ticked, and the pinned button stays on a short screen; the chip reads
 * "⚡ Study this today" when the sentence is itself a card, and the picker label otherwise.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h600dp-xxhdpi", application = android.app.Application::class)
class SentenceBumpSheetTest {
    @get:Rule val compose = createComposeRule()

    private val words = listOf(
        BumpWord("y", "一对", "yí duì", "a pair; a couple"),
        BumpWord("k", "可爱", "kě'ài", "cute"),
        BumpWord("q", "情侣", "qínglǚ", "couple; sweethearts"),
        BumpWord("w", "外卖", "wàimài", "takeaway food"),
        BumpWord("c", "吃", "chī", "to eat"),
    )

    @Test
    fun nothingTickedAndAddBumpsExactlyThePicked() {
        val added = mutableListOf<List<String>>()
        compose.setContent {
            LabTheme {
                Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(top = 48.dp)) {
                    Column(Modifier.fillMaxSize().background(Lab.colors.card)) {
                        SentenceBumpForm(words, bumpedIds = setOf("c"), onAdd = { added += it }, onCancel = {})
                    }
                }
            }
        }
        compose.onNodeWithText(SentenceBumps.SHEET_TITLE).assertIsDisplayed()
        for (id in listOf("y", "k", "q", "w")) compose.onNodeWithTag("sentence-bump-check-$id").assertIsOff().assertIsEnabled()
        // Already in today's pocket: ⚡, ticked and disabled.
        compose.onNodeWithTag("sentence-bump-check-c").assertIsOn().assertIsNotEnabled()
        compose.onNodeWithTag("sentence-bump-row-c").performScrollTo()
        compose.onNodeWithTag("sentence-bump-on-c", useUnmergedTree = true).assertIsDisplayed()
        // The pinned button waits for a pick.
        compose.onNodeWithTag("sentence-bump-add").assertIsDisplayed()
        compose.onNodeWithText("⚡ Add to today").assertIsDisplayed()
        compose.onNodeWithTag("sentence-bump-add").performClick()
        assertEquals(emptyList<List<String>>(), added)

        compose.onNodeWithTag("sentence-bump-row-w").performClick()
        compose.onNodeWithTag("sentence-bump-check-q").performClick()
        compose.onNodeWithTag("sentence-bump-check-w").assertIsOn()
        compose.onNodeWithText("⚡ Add 2 to today").assertIsDisplayed()
        compose.onNodeWithTag("sentence-bump-row-q").performClick() // untick
        compose.onNodeWithText("⚡ Add 1 to today").assertIsDisplayed()
        compose.onNodeWithTag("sentence-bump-add").performClick()
        assertEquals(listOf(listOf("w")), added)
    }

    @Test
    fun chipIsTheSentenceItselfOrThePicker() {
        var ui by mutableStateOf(CoachChatUi(thread = Loadable(CoachSamples.thread), decks = CoachSamples.decks, deckId = "d1"))
        var exactTaps = 0
        var opened = 0
        compose.setContent {
            LabTheme { CoachChatScreen(ui, CoachChatActions(onBumpExact = { exactTaps++ }, onOpenBumpPicker = { opened++ })) }
        }
        // Nothing matches: no chip.
        compose.onNodeWithTag("coach-bump").assertDoesNotExist()

        ui = ui.copy(bumpWords = words.take(2))
        compose.onNodeWithText(SentenceBumps.WORDS_LABEL).assertIsDisplayed().performClick()
        // The chip arrived after the row was drawn and still sits first (not scrolled off to the left).
        assertEquals(true, compose.onNodeWithTag("coach-bump").fetchSemanticsNode().boundsInRoot.left < 200f)
        assertEquals(1, opened)

        ui = ui.copy(bumpExact = BumpWord("s", "我昨天去商店买了苹果。", "", ""), bumpWords = emptyList())
        compose.onNodeWithText(SentenceBumps.EXACT_LABEL).assertIsDisplayed().performClick()
        assertEquals(1, exactTaps)

        ui = ui.copy(bumpedNoteIds = setOf("s"))
        compose.onNodeWithText(SentenceBumps.DONE_LABEL).assertIsDisplayed().assertIsNotEnabled()
    }
}
