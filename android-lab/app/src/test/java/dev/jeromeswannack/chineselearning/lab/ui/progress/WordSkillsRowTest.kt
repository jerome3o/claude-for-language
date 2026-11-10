package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.KnownCounts
import dev.jeromeswannack.chineselearning.lab.core.KnownProgress
import dev.jeromeswannack.chineselearning.lab.core.NewCardOrder
import dev.jeromeswannack.chineselearning.lab.core.WordSkills
import dev.jeromeswannack.chineselearning.lab.ui.settings.NewCardOrderSection
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId
import kotlin.test.assertEquals

/**
 * "Listening first": the Progress card's "by reading · by ear" line (+ the hint while the ear lags far
 * behind) and the Settings switch "Start new words by ear" (web KnownCounts WordSkillsRow, NewCardOrderSection).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class WordSkillsRowTest {
    @get:Rule val compose = createComposeRule()

    private fun known(skills: WordSkills) =
        KnownProgress(KnownCounts(800, 50), KnownCounts(1342, 377), KnownCounts(0, 0), emptyList(), emptyList(), skills)

    @Test
    fun showsBothCountsAndTheHintWhileTheEarLags() {
        compose.setContent { LabTheme { KnownCard(known(WordSkills(1240, 610)), ZoneId.of("UTC")) } }
        compose.onNodeWithText("1,240 by reading · 610 by ear").assertIsDisplayed()
        compose.onNodeWithTag("known-skills-hint").assertIsDisplayed()
    }

    @Test
    fun noHintWhenTheEarKeepsUp() {
        compose.setContent { LabTheme { KnownCard(known(WordSkills(100, 80)), ZoneId.of("UTC")) } }
        compose.onNodeWithText("100 by reading · 80 by ear").assertIsDisplayed()
        compose.onNodeWithTag("known-skills-hint").assertDoesNotExist()
    }

    @Test
    fun nothingBeforeAnyWordIsKnownEitherWay() {
        compose.setContent { LabTheme { KnownCard(known(WordSkills(0, 0)), ZoneId.of("UTC")) } }
        compose.onNodeWithTag("known-skills").assertDoesNotExist()
    }

    @Test
    fun theSettingsSwitchTogglesNewWordsByEar() {
        val toggles = mutableListOf<Pair<String, Boolean>>()
        compose.setContent { LabTheme { NewCardOrderSection(NewCardOrder.DEFAULT, busy = false, note = null, onToggle = { k, on -> toggles += k to on }, onReset = {}) } }
        compose.onNodeWithText(NewCardOrder.BY_EAR_OPTION.label).assertIsDisplayed()
        compose.onNodeWithTag("nco-new_words_by_ear").performClick()
        assertEquals(listOf("new_words_by_ear" to false), toggles)
    }
}
